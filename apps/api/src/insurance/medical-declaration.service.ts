import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { SubmitMedicalDeclarationDto } from './dto/medical-declaration.dto';
import { evaluateEligibility } from './engines/underwriting.engine';
import { toQuoteView, type QuoteView } from './insurance.serializer';
import { hasExpired, quoteExpired, quoteNotFound } from './quote-errors';

@Injectable()
export class MedicalDeclarationService {
  private readonly logger = new Logger(MedicalDeclarationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Step 2 of the journey: underwrite the structured disclosures and advance
   * the quote to MEDICAL_DECLARED.
   *
   * The declaration and the status change are written in one transaction, so a
   * quote is never MEDICAL_DECLARED without the disclosures that justified it.
   * Re-declaring is allowed (an upsert) while the quote is still live, which
   * lets a customer correct a typo without losing their locked premium.
   */
  async submit(quoteId: string, dto: SubmitMedicalDeclarationDto): Promise<QuoteView> {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });

    if (!quote) {
      throw quoteNotFound();
    }

    if (quote.status === QuoteStatus.PREMIUM_PAID || quote.status === QuoteStatus.POLICY_ISSUED) {
      throw new ConflictException({
        error: 'DECLARATION_LOCKED',
        message: 'This quote has already been paid for; its medical declaration can no longer change.',
      });
    }

    if (hasExpired(quote.expiresAt)) {
      throw quoteExpired();
    }

    this.assertConsistentWithQuote(dto, quote.hasPreExistingConditions);

    const result = evaluateEligibility(dto.disclosures, quote.age);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.medicalDeclaration.upsert({
        where: { quoteId },
        create: {
          quoteId,
          disclosures: dto.disclosures as unknown as Prisma.InputJsonValue,
          decision: result.decision,
          reasons: result.reasons,
        },
        update: {
          disclosures: dto.disclosures as unknown as Prisma.InputJsonValue,
          decision: result.decision,
          reasons: result.reasons,
          declaredAt: new Date(),
        },
      });

      return tx.quote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.MEDICAL_DECLARED },
        include: { medicalDeclaration: true, policy: true },
      });
    });

    // Deliberately no BMI or disclosure detail in the log line: that is
    // identifiable health information, and it does not belong in stdout.
    this.logger.log(`Quote ${quoteId} underwritten as ${result.decision}`);

    return toQuoteView(updated);
  }

  /**
   * The quote was priced on the applicant's own answer about pre-existing
   * conditions. If the declaration contradicts that answer the locked premium
   * no longer reflects the risk, so we refuse rather than issue cover on a
   * price we would not have offered.
   */
  private assertConsistentWithQuote(
    dto: SubmitMedicalDeclarationDto,
    quotedWithPreExistingConditions: boolean,
  ): void {
    const declaredAny = dto.disclosures.diagnosedConditions.length > 0;

    if (declaredAny && !quotedWithPreExistingConditions) {
      throw new UnprocessableEntityException({
        error: 'DECLARATION_CONTRADICTS_QUOTE',
        message:
          'You declared a diagnosed condition but your quote was priced without pre-existing conditions. Please recalculate your premium.',
      });
    }

    if (!declaredAny && quotedWithPreExistingConditions) {
      throw new UnprocessableEntityException({
        error: 'DECLARATION_CONTRADICTS_QUOTE',
        message:
          'Your quote was priced with pre-existing conditions, so please select at least one diagnosed condition - or recalculate your premium without them.',
      });
    }
  }
}
