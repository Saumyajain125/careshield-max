import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { config } from '../common/config';
import { formatMoney } from '../common/money';
import { PaymentDeclinedError, PaymentGatewayError } from './payment.errors';
import type { Decimal } from 'decimal.js';

export interface AuthorizeChargeInput {
  /** Opaque token minted by the (mock) client-side SDK. Never a card number. */
  token: string;
  amount: Decimal;
  currency: string;
  /** Our own reference, echoed back by the gateway for reconciliation. */
  reference: string;
  /**
   * Gateway-side idempotency key. Real PSPs collapse repeat captures under one
   * key into a single charge, which is what stops two concurrent checkouts of
   * the same quote authorising the customer's card twice.
   */
  idempotencyKey: string;
}

export interface Charge {
  chargeId: string;
  status: 'CAPTURED';
  amount: string;
  currency: string;
  processedAt: Date;
}

/**
 * Stand-in for a real PSP (Razorpay/Stripe style).
 *
 * Behaviour is driven by the token prefix so every path through checkout is
 * reachable from a test or from the UI:
 *
 *   tok_decline_*     -> issuer decline (402, do not retry)
 *   tok_error_*       -> gateway/network failure (503, safe to retry)
 *   tok_fail_issue_*  -> charge succeeds, then policy issuance blows up
 *   tok_fail_void_*   -> charge succeeds, issuance fails, and the void fails too
 *   anything else     -> captured successfully
 *
 * The last two need ALLOW_PAYMENT_FAULT_INJECTION.
 */
@Injectable()
export class MockPaymentClient {
  private readonly logger = new Logger(MockPaymentClient.name);

  /** Charges we have captured, so voids can be asserted in tests. */
  private readonly charges = new Map<string, Charge & { voided: boolean }>();

  /** Gateway idempotency key -> charge id, as a real PSP would keep it. */
  private readonly keys = new Map<string, string>();

  /** Captures still in flight, so simultaneous ones collapse rather than race. */
  private readonly inFlight = new Map<string, Promise<Charge>>();

  async authorizeAndCapture(input: AuthorizeChargeInput): Promise<Charge> {
    const settled = this.findByKey(input.idempotencyKey);
    if (settled) {
      this.logger.log(`Returning existing charge ${settled.chargeId} for a repeated capture`);
      return { ...settled };
    }

    // Registered before the first await, so two concurrent captures under one
    // key really do collapse. A gateway serialises on the key; a Map lookup
    // after an await does not.
    const pending = this.inFlight.get(input.idempotencyKey);
    if (pending) {
      this.logger.log(`Joining the in-flight capture for ${input.reference}`);
      return { ...(await pending) };
    }

    const capture = this.performCapture(input).finally(() => {
      this.inFlight.delete(input.idempotencyKey);
    });
    this.inFlight.set(input.idempotencyKey, capture);

    return capture;
  }

  private async performCapture(input: AuthorizeChargeInput): Promise<Charge> {
    await this.simulateNetworkLatency();

    if (input.token.startsWith('tok_error')) {
      throw new PaymentGatewayError('Upstream gateway timed out before confirming the charge');
    }

    if (input.token.startsWith('tok_decline')) {
      throw new PaymentDeclinedError('Insufficient funds', 'ISSUER_DECLINED');
    }

    const charge: Charge & { voided: boolean } = {
      chargeId: `ch_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      status: 'CAPTURED',
      amount: formatMoney(input.amount),
      currency: input.currency,
      processedAt: new Date(),
      voided: false,
    };

    this.charges.set(charge.chargeId, charge);
    this.keys.set(input.idempotencyKey, charge.chargeId);
    this.logger.log(`Captured ${charge.currency} ${charge.amount} as ${charge.chargeId} for ${input.reference}`);

    return { ...charge };
  }

  /**
   * Compensating action. A captured charge cannot be undone by a database
   * rollback, so when issuance fails after the money moved we void the charge
   * explicitly rather than leave the customer paid but uninsured.
   *
   * Returns false when the gateway did not recognise the charge; throws when
   * the call itself failed. Both matter to the caller, because the 500 body
   * tells the customer whether their money came back.
   */
  async voidCharge(chargeId: string, token?: string): Promise<boolean> {
    await this.simulateNetworkLatency();

    if (token && config.allowFaultInjection && token.startsWith('tok_fail_void')) {
      throw new PaymentGatewayError(`Void of ${chargeId} failed at the gateway`);
    }

    const charge = this.charges.get(chargeId);
    if (!charge) {
      this.logger.error(`Void requested for unknown charge ${chargeId}`);
      return false;
    }

    charge.voided = true;
    this.logger.warn(`Voided charge ${chargeId} after a failed policy issuance`);
    return true;
  }

  /** True when the token asks us to fail *after* the money has moved. */
  shouldFailIssuance(token: string): boolean {
    return (
      config.allowFaultInjection &&
      (token.startsWith('tok_fail_issue') || token.startsWith('tok_fail_void'))
    );
  }

  /** Test affordance: every charge this client has seen, in capture order. */
  getChargeLedger(): Array<Charge & { voided: boolean }> {
    return [...this.charges.values()];
  }

  /** Test affordance: clear the ledger between test cases. */
  resetLedger(): void {
    this.charges.clear();
    this.keys.clear();
    this.inFlight.clear();
  }

  /** A voided charge does not block a fresh attempt under the same key. */
  private findByKey(idempotencyKey: string) {
    const chargeId = this.keys.get(idempotencyKey);
    if (!chargeId) return undefined;

    const charge = this.charges.get(chargeId);
    return charge && !charge.voided ? charge : undefined;
  }

  private simulateNetworkLatency(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 25));
  }
}
