import { Injectable, Logger } from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { config } from '../common/config';
import { PrismaService } from '../common/prisma/prisma.service';
import type { CreateQuoteDto } from './dto/create-quote.dto';
import { calculatePremium, RATE_CARD } from './engines/premium.engine';
import { toQuoteView, type QuoteView } from './insurance.serializer';
import { quoteNotFound } from './quote-errors';

/** Every read of a quote carries the relations the UI needs to render a step. */
const QUOTE_INCLUDE = { medicalDeclaration: true, policy: true } as const;

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rate the applicant and persist the result with a hard expiry exactly
   * `quoteLockMinutes` into the future.
   *
   * The premium is computed server side from the rate card and written in the
   * same statement that sets `expires_at`, so the price and the window it is
   * honoured for are established atomically.
   */
  async createQuote(dto: CreateQuoteDto): Promise<QuoteView> {
    const premium = calculatePremium(dto);

    // Both timestamps are derived from one instant on one clock. Letting
    // `created_at` default to the database's now() while computing
    // `expires_at` in Node would make the lock window drift by the round-trip
    // time, so the quote would not be honoured for exactly 15 minutes.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.quoteLockMinutes * 60_000);

    const quote = await this.prisma.quote.create({
      data: {
        status: QuoteStatus.QUOTE_GENERATED,
        age: dto.age,
        hasPreExistingConditions: dto.hasPreExistingConditions,
        basePremium: premium.basePremium.toFixed(2),
        ageLoading: premium.ageLoading.toFixed(2),
        conditionLoading: premium.conditionLoading.toFixed(2),
        totalPremium: premium.totalPremium.toFixed(2),
        currency: premium.currency,
        createdAt: now,
        expiresAt,
      },
      include: QUOTE_INCLUDE,
    });

    this.logger.log(
      `Quote ${quote.id} locked at ${premium.currency} ${premium.totalPremium.toFixed(2)} until ${expiresAt.toISOString()}`,
    );

    return toQuoteView(quote);
  }

  /** Re-read a quote, e.g. to rehydrate the countdown after a page refresh. */
  async getQuote(quoteId: string): Promise<QuoteView> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: QUOTE_INCLUDE,
    });

    if (!quote) {
      throw quoteNotFound();
    }

    return toQuoteView(quote);
  }

  /** The published rate card, so the UI can explain the price it shows. */
  getRateCard() {
    return {
      planCode: RATE_CARD.planCode,
      currency: RATE_CARD.currency,
      basePremium: RATE_CARD.basePremium.toFixed(2),
      ageLoading: {
        appliesAboveAge: RATE_CARD.ageLoadingThreshold,
        rate: RATE_CARD.ageLoadingRate.toNumber(),
        description: `+${RATE_CARD.ageLoadingRate.times(100).toFixed(0)}% of base premium above age ${RATE_CARD.ageLoadingThreshold}`,
      },
      preExistingConditionLoading: {
        amount: RATE_CARD.preExistingConditionLoading.toFixed(2),
        description: `Flat Rs ${RATE_CARD.preExistingConditionLoading.toFixed(0)} where pre-existing conditions are declared`,
      },
      quoteLockMinutes: config.quoteLockMinutes,
    };
  }
}
