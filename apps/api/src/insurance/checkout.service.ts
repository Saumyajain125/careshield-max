import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EligibilityDecision, QuoteStatus, type Quote } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from '../common/config';
import {
  IdempotencyService,
  type KeyDisposition,
} from '../common/idempotency/idempotency.service';
import { money } from '../common/money';
import { PrismaService } from '../common/prisma/prisma.service';
import { MockPaymentClient, type Charge } from '../payments/mock-payment.client';
import { PaymentDeclinedError, PaymentGatewayError } from '../payments/payment.errors';
import type { CheckoutDto } from './dto/checkout.dto';
import { toPolicyView, toQuoteView, type PolicyView, type QuoteView } from './insurance.serializer';
import { hasExpired, invalidQuoteState, quoteExpired, quoteNotFound } from './quote-errors';

const ENDPOINT = 'POST /api/v1/insurance/checkout';

export interface CheckoutResult {
  status: number;
  body: { quote: QuoteView; policy: PolicyView };
  /** True when this response came from the idempotency store, not fresh work. */
  replayed: boolean;
}

/** Raised when the DB transaction is deliberately failed to prove rollback. */
class SimulatedIssuanceFailure extends Error {
  constructor() {
    super('Simulated policy issuance failure (fault injection)');
  }
}

/** What execute() learned along the way, for the failure handling to use. */
interface Attempt {
  quoteId?: string;
  charge?: Charge;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: MockPaymentClient,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Step 3: take the money and bind the policy.
   *
   * Wrapped in the idempotency protocol so a double-click cannot charge twice:
   *
   *   begin() -> work -> complete() in the same transaction (happy path)
   *   begin() -> REPLAY                                     (duplicate, done)
   *   begin() -> 409                                        (duplicate, in flight)
   *   begin() -> terminal failure -> complete()             (decline remembered)
   *   begin() -> retryable failure -> release()             (same key may retry)
   */
  async checkout(dto: CheckoutDto, idempotencyKey: string): Promise<CheckoutResult> {
    const outcome = await this.idempotency.begin(idempotencyKey, ENDPOINT, dto);

    if (outcome.kind === 'REPLAY') {
      return {
        status: outcome.status,
        body: outcome.body as CheckoutResult['body'],
        replayed: true,
      };
    }

    const attempt: Attempt = {};

    try {
      const body = await this.execute(dto, idempotencyKey, attempt);
      return { status: HttpStatus.CREATED, body, replayed: false };
    } catch (error) {
      throw await this.settleKey(idempotencyKey, error, attempt);
    }
  }

  /** The actual charge-and-bind, with no idempotency concerns mixed in. */
  private async execute(
    dto: CheckoutDto,
    idempotencyKey: string,
    attempt: Attempt,
  ): Promise<CheckoutResult['body']> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: dto.quoteId },
      include: { medicalDeclaration: true, policy: true },
    });

    if (!quote) {
      throw quoteNotFound();
    }

    // From here on the quote is real, so its id is safe to store against the
    // idempotency record (which has a foreign key to it).
    attempt.quoteId = quote.id;

    this.assertReadyForPayment(quote, quote.medicalDeclaration?.decision);

    // --- Move the money ---------------------------------------------------
    // Outside the transaction: holding a row lock open across a call to a
    // payment gateway is how you exhaust the connection pool when the gateway
    // slows down. The gateway gets a quote-derived key, so two checkouts of
    // one quote racing here collapse into a single authorisation.
    const charge = await this.capture(quote, dto.paymentToken);
    attempt.charge = charge;

    // Durable trace before the transaction opens. If the process dies between
    // the capture and the commit, this is the only record that money moved.
    await this.noteCharge(idempotencyKey, charge.chargeId);

    try {
      return await this.bindPolicy({
        quoteId: quote.id,
        chargeId: charge.chargeId,
        paymentToken: dto.paymentToken,
        idempotencyKey,
      });
    } catch (error) {
      throw await this.compensate(quote.id, charge, dto.paymentToken, error);
    }
  }

  /**
   * Task 4.1 - the atomic unit. Marking the quote converted, creating the
   * policy and storing the idempotent response all happen in one transaction.
   *
   * The rows are re-read FOR UPDATE inside it rather than trusting the
   * snapshot taken before the gateway call: if a concurrent request bound this
   * quote, or a corrected declaration flipped the decision while we were
   * talking to the PSP, this attempt aborts and its charge is voided.
   */
  private async bindPolicy(args: {
    quoteId: string;
    chargeId: string;
    paymentToken: string;
    idempotencyKey: string;
  }): Promise<CheckoutResult['body']> {
    const { quoteId, chargeId, paymentToken, idempotencyKey } = args;

    return this.prisma.$transaction(
      async (tx) => {
        // Serialise concurrent checkouts of the same quote on the row lock.
        const locked = await tx.$queryRaw<Array<{ status: QuoteStatus; expires_at: Date }>>`
          SELECT status, expires_at FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE
        `;

        const current = locked[0];
        if (!current) {
          throw quoteNotFound();
        }
        if (current.status !== QuoteStatus.MEDICAL_DECLARED) {
          throw invalidQuoteState(current.status);
        }
        if (hasExpired(current.expires_at)) {
          throw quoteExpired();
        }

        // The declaration is locked too, because it can be re-submitted while
        // the quote sits in MEDICAL_DECLARED - a correction disclosing, say,
        // CANCER flips the decision without changing the quote's status.
        const declared = await tx.$queryRaw<Array<{ decision: EligibilityDecision }>>`
          SELECT decision FROM medical_declarations WHERE quote_id = ${quoteId}::uuid FOR UPDATE
        `;
        this.assertEligible(declared[0]?.decision);

        // (1) Mark the quote as converted.
        const paid = await tx.quote.update({
          where: { id: quoteId },
          data: { status: QuoteStatus.PREMIUM_PAID },
        });

        // (2) Record the bound policy. The unique constraint on quote_id is
        //     the final backstop against a double issue.
        const coverStart = new Date();
        const coverEnd = new Date(coverStart);
        coverEnd.setMonth(coverEnd.getMonth() + config.policyTermMonths);

        const policy = await tx.policy.create({
          data: {
            quoteId,
            policyNumber: generatePolicyNumber(coverStart),
            premiumPaid: money(paid.totalPremium).toFixed(2),
            currency: paid.currency,
            paymentReference: chargeId,
            coverStart,
            coverEnd,
          },
        });

        // Fault injection goes here: after the money has moved and after both
        // writes, so a failure exercises the rollback and the void.
        if (this.payments.shouldFailIssuance(paymentToken)) {
          throw new SimulatedIssuanceFailure();
        }

        // (3) Advance to the terminal state.
        const issued = await tx.quote.update({
          where: { id: quoteId },
          data: { status: QuoteStatus.POLICY_ISSUED },
          include: { medicalDeclaration: true, policy: true },
        });

        const body = { quote: toQuoteView(issued), policy: toPolicyView(policy) };

        // (4) Stored here, not after the commit: outside the transaction a
        //     failed write releases a key whose payment already succeeded, and
        //     the retry gets ALREADY_PAID with no policy to show for it.
        await this.idempotency.complete(idempotencyKey, HttpStatus.CREATED, body, {
          quoteId,
          db: tx,
        });

        this.logger.log(`Policy ${policy.policyNumber} issued for quote ${quoteId}`);
        return body;
      },
      // maxWait defaults to 2s: under pool pressure $transaction would throw
      // before running a statement, having already taken the customer's money.
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  /**
   * The transaction rolled back, so the database is clean - but the money has
   * already moved. Void the charge, and be honest in the response about
   * whether that worked.
   */
  private async compensate(
    quoteId: string,
    charge: Charge,
    paymentToken: string,
    error: unknown,
  ): Promise<unknown> {
    // Two checkouts of one quote share a gateway charge (they collapse under
    // the same gateway key), so the loser of the race must not void the charge
    // that just paid for the winner's policy.
    if (await this.chargePaidForAPolicy(charge.chargeId)) {
      this.logger.warn(
        `Charge ${charge.chargeId} already belongs to an issued policy; leaving it captured`,
      );
      return error instanceof HttpException
        ? error
        : new InternalServerErrorException({
            error: 'POLICY_ISSUANCE_FAILED',
            message: 'We could not complete your purchase. Please check your policy documents.',
          });
    }

    let voided = false;

    try {
      voided = await this.payments.voidCharge(charge.chargeId, paymentToken);
    } catch (voidError) {
      // Never let this replace the error that actually failed the issuance.
      this.logger.error(
        `Void of charge ${charge.chargeId} failed; it needs manual reconciliation`,
        voidError instanceof Error ? voidError.stack : undefined,
      );
    }

    this.logger.error(
      `Issuance failed for quote ${quoteId} (charge ${charge.chargeId}, voided=${voided})`,
      error instanceof Error ? error.stack : undefined,
    );

    if (error instanceof HttpException) {
      return error;
    }

    return new InternalServerErrorException({
      error: 'POLICY_ISSUANCE_FAILED',
      message: voided
        ? 'We could not issue your policy and your payment has been voided. No money has been taken - please try again.'
        : 'We could not issue your policy. Your payment is being reversed and our team has been alerted - please contact us before trying again.',
    });
  }

  /**
   * Record the terminal answer, or free the key, and tell the client which of
   * those happened. Bookkeeping failures are logged rather than thrown: they
   * must not mask the response the customer is waiting for.
   */
  private async settleKey(key: string, error: unknown, attempt: Attempt): Promise<unknown> {
    const terminal = isTerminalBusinessFailure(error);
    const annotated = withKeyDisposition(error, terminal ? 'completed' : 'released');

    try {
      if (terminal && annotated instanceof HttpException) {
        // A decline or a bad state is a final answer. Remember it so a
        // duplicate click gets the same answer instead of re-hitting the PSP.
        await this.idempotency.complete(key, annotated.getStatus(), annotated.getResponse(), {
          quoteId: attempt.quoteId,
        });
      } else if (!terminal) {
        // Infrastructure wobble - free the key so the client may retry safely.
        await this.idempotency.release(key);
      }
    } catch (bookkeepingError) {
      this.logger.error(
        'Could not settle the idempotency record for a failed checkout',
        bookkeepingError instanceof Error ? bookkeepingError.stack : undefined,
      );
    }

    return annotated;
  }

  private async chargePaidForAPolicy(chargeId: string): Promise<boolean> {
    const count = await this.prisma.policy.count({ where: { paymentReference: chargeId } });
    return count > 0;
  }

  private async noteCharge(key: string, chargeId: string): Promise<void> {
    try {
      await this.idempotency.recordCharge(key, chargeId);
    } catch (error) {
      this.logger.error(
        `Could not attach charge ${chargeId} to its idempotency record`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Translate payment client failures into the right HTTP semantics. */
  private async capture(quote: Quote, token: string): Promise<Charge> {
    try {
      return await this.payments.authorizeAndCapture({
        token,
        amount: money(quote.totalPremium),
        currency: quote.currency,
        reference: `quote:${quote.id}`,
        idempotencyKey: `quote:${quote.id}`,
      });
    } catch (error) {
      if (error instanceof PaymentDeclinedError) {
        // 402: the issuer gave a definitive no. Terminal, so it is remembered
        // against the idempotency key and a retry needs a fresh key.
        throw new HttpException(
          {
            error: 'PAYMENT_DECLINED',
            message: `Your payment was declined (${error.reason}). Please try a different payment method.`,
            gatewayCode: error.gatewayCode,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      if (error instanceof PaymentGatewayError) {
        // 503: no definitive answer, and no database writes have happened yet.
        // Retryable with the same idempotency key.
        throw new ServiceUnavailableException({
          error: 'PAYMENT_GATEWAY_UNAVAILABLE',
          message: 'We could not reach the payment provider. No money has been taken - please try again.',
        });
      }

      throw error;
    }
  }

  private assertReadyForPayment(quote: Quote, decision?: EligibilityDecision): void {
    if (quote.status === QuoteStatus.POLICY_ISSUED || quote.status === QuoteStatus.PREMIUM_PAID) {
      throw new ConflictException({
        error: 'ALREADY_PAID',
        message: 'This quote has already been paid for. Check your policy documents.',
      });
    }

    if (quote.status === QuoteStatus.QUOTE_GENERATED) {
      throw new ConflictException({
        error: 'MEDICAL_DECLARATION_REQUIRED',
        message: 'Please complete your medical declaration before paying.',
      });
    }

    // Task 2.3 / 3.2 - the server is the authority on the quote lock. A client
    // with a frozen countdown or a doctored clock still cannot pay late.
    if (hasExpired(quote.expiresAt)) {
      throw quoteExpired();
    }

    this.assertEligible(decision);
  }

  private assertEligible(decision?: EligibilityDecision): void {
    if (decision === EligibilityDecision.ELIGIBLE) {
      return;
    }

    throw new UnprocessableEntityException({
      error: 'NOT_ELIGIBLE_FOR_INSTANT_ISSUE',
      message:
        decision === EligibilityDecision.DECLINED
          ? 'Based on your declaration we are unable to offer CareShield Max.'
          : 'Your declaration needs review by an underwriter, so this policy cannot be issued instantly.',
    });
  }
}

/** Customer-facing contract ID, e.g. CSM-2026-3F9A21C4. */
function generatePolicyNumber(issuedAt: Date): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CSM-${issuedAt.getUTCFullYear()}-${suffix}`;
}

/**
 * A terminal failure is a definitive 4xx: retrying changes nothing, so the
 * response is worth remembering. Anything else is retryable and frees the key.
 */
function isTerminalBusinessFailure(error: unknown): error is HttpException {
  return error instanceof HttpException && error.getStatus() >= 400 && error.getStatus() < 500;
}

/**
 * Tell the client what happened to its key, so it does not have to keep a
 * parallel copy of these rules and drift out of step with the server.
 */
function withKeyDisposition(error: unknown, disposition: KeyDisposition): unknown {
  if (!(error instanceof HttpException)) {
    return error;
  }

  const body = error.getResponse();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return error;
  }

  return new HttpException({ ...body, keyDisposition: disposition }, error.getStatus());
}
