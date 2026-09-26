import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKey } from '../common/idempotency/idempotency-key.decorator';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { SubmitMedicalDeclarationDto } from './dto/medical-declaration.dto';
import { MedicalDeclarationService } from './medical-declaration.service';
import { QuoteService } from './quote.service';

/**
 * The three steps of the CareShield Max buy journey. The global ValidationPipe
 * has already checked the payloads, so these handlers only orchestrate.
 */
@Controller('api/v1/insurance')
export class InsuranceController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly declarations: MedicalDeclarationService,
    private readonly checkoutService: CheckoutService,
  ) {}

  /** The published rate card - lets the UI explain the premium it renders. */
  @Get('rate-card')
  getRateCard() {
    return this.quotes.getRateCard();
  }

  /** Step 1 - calculate and lock a premium for 15 minutes. */
  @Post('quote')
  @HttpCode(HttpStatus.CREATED)
  createQuote(@Body() dto: CreateQuoteDto) {
    return this.quotes.createQuote(dto);
  }

  /** Re-read a quote, e.g. to rehydrate the countdown after a refresh. */
  @Get('quote/:quoteId')
  getQuote(@Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string) {
    return this.quotes.getQuote(quoteId);
  }

  /** Step 2 - underwrite the structured health disclosures. */
  @Post('quote/:quoteId/medical-declaration')
  @HttpCode(HttpStatus.OK)
  submitDeclaration(
    @Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string,
    @Body() dto: SubmitMedicalDeclarationDto,
  ) {
    return this.declarations.submit(quoteId, dto);
  }

  /**
   * Step 3 - charge the premium and bind the policy. Needs an Idempotency-Key.
   * The status is set by hand because a replay has to reproduce the original
   * one, including a remembered 402.
   */
  @Post('checkout')
  async checkout(
    @Body() dto: CheckoutDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.checkoutService.checkout(dto, idempotencyKey);

    res.status(result.status);
    // Lets a client tell a fresh bind from a replay when debugging a retry storm.
    res.setHeader('Idempotency-Replayed', String(result.replayed));

    return result.body;
  }
}
