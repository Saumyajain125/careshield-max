'use client';

import { useActionState, useCallback, useEffect, useState, useTransition } from 'react';
import { checkoutAction, refreshQuoteAction, type CheckoutSuccess } from '@/app/actions';
import { IDLE, type ActionState, type Quote } from '@/lib/types';
import { CountdownTimer, formatCountdown, useCountdown } from './CountdownTimer';
import { Alert, Card, Spinner, formatInr, newIdempotencyKey } from './ui';

/** Test cards, exposed in the UI so every branch is reachable by hand. */
const PAYMENT_TOKENS = [
  { value: 'tok_visa_4242', label: 'Visa 4242 - succeeds' },
  { value: 'tok_decline_nsf', label: 'Visa 0002 - declined by issuer' },
  { value: 'tok_error_timeout', label: 'Visa 0003 - gateway unreachable' },
  { value: 'tok_fail_issue_rollback', label: 'Visa 0004 - charges, then issuance fails' },
];

export function PaymentPanel({
  quote,
  onIssued,
  onQuoteRefreshed,
  onRestart,
}: {
  quote: Quote;
  onIssued: (result: CheckoutSuccess) => void;
  onQuoteRefreshed: (quote: Quote) => void;
  onRestart: () => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionState<CheckoutSuccess>, FormData>(
    checkoutAction,
    IDLE,
  );

  // Controlled, not defaultChecked: React resets an uncontrolled form once its
  // action settles, which would throw away the chosen card on every decline.
  const [paymentToken, setPaymentToken] = useState(PAYMENT_TOKENS[0].value);

  // Task 3.2 - the gate, anchored on the server's remaining seconds.
  const { secondsLeft, hasExpired } = useCountdown(quote.expiresInSeconds, quote.id);

  // Task 4.2, client half - one key per payment attempt. Lazy initialiser, so
  // it is minted once and not on each of the ~900 renders a lock produces.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  // Task 3.3 - a second transition for "check again", so refreshing the quote
  // neither blocks nor is blocked by the payment.
  const [isRefreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (state.status === 'success') {
      onIssued(state.data);
      return;
    }

    if (state.status !== 'error') return;

    // The server tells us what became of the key. Rotate only when it has
    // stored a final answer against it (or rejected it outright): anything
    // else - released, still held, or an outcome we never heard back about -
    // must reuse the key, or the retry becomes a second charge.
    if (state.keyDisposition === 'completed' || state.keyDisposition === 'invalid') {
      setIdempotencyKey(newIdempotencyKey());
    }
  }, [state, onIssued]);

  const refresh = useCallback(() => {
    startRefresh(async () => {
      const result = await refreshQuoteAction(quote.id);
      if (result.status === 'success') {
        onQuoteRefreshed(result.data);
      }
    });
  }, [quote.id, onQuoteRefreshed]);

  const isBusy = isPending || isRefreshing;
  const canPay = !hasExpired && !isBusy;
  const safeToRetry = state.status === 'error' && state.keyDisposition === 'released';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Pay and get covered</h2>
          <p className="mt-1 text-sm text-muted">
            Your policy is issued the moment your payment clears.
          </p>
        </div>
        <CountdownTimer secondsLeft={secondsLeft} hasExpired={hasExpired} />
      </div>

      <div className="mt-6 flex items-baseline justify-between rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
        <span className="text-sm font-medium text-brand-700">Amount due today</span>
        <span className="text-2xl font-bold tabular-nums text-brand-700">
          {formatInr(quote.premium.total)}
        </span>
      </div>

      {/* Task 3.2 - the form stays on screen but goes inert once the lock
          lapses. Removing it stranded anyone whose clock was fast. */}
      {hasExpired && (
        <div className="mt-6 space-y-4">
          <Alert tone="warning" title="Your quote has expired">
            <p>
              Premiums are only held for 15 minutes. Please recalculate to see today&apos;s price -
              it may have changed.
            </p>
          </Alert>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              Recalculate my premium
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={isRefreshing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-black/15 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-black/5 disabled:opacity-60"
            >
              {isRefreshing && <Spinner />}
              Check again
            </button>
          </div>
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-5">
        <input type="hidden" name="quoteId" value={quote.id} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <fieldset disabled={isBusy || hasExpired} className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-ink">Payment method</legend>
          <p className="mb-2 text-xs text-muted">
            This is a sandbox. Pick a card to exercise a particular outcome - no real money moves.
          </p>
          {PAYMENT_TOKENS.map((token) => (
            <label
              key={token.value}
              htmlFor={token.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-black/10 bg-white p-3 transition hover:border-brand-500/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                id={token.value}
                type="radio"
                name="paymentToken"
                value={token.value}
                checked={paymentToken === token.value}
                onChange={(event) => setPaymentToken(event.target.value)}
                className="size-4 border-black/25 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-ink">{token.label}</span>
            </label>
          ))}
        </fieldset>

        {state.status === 'error' && (
          <Alert tone="error" title="Your payment didn't go through">
            <p>{state.message}</p>
            {safeToRetry ? (
              <p className="mt-1 text-xs opacity-80">
                No money has been taken. You can safely try again.
              </p>
            ) : null}
          </Alert>
        )}

        {/* Task 3.3 - disabled for the whole transition, so a second human
            click cannot produce a request. The key is the real guarantee. */}
        <button
          type="submit"
          disabled={!canPay}
          aria-busy={isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && <Spinner />}
          {isPending
            ? 'Processing your payment - please do not close this page'
            : `Pay ${formatInr(quote.premium.total)} securely`}
        </button>

        {/* Politely announced to assistive tech without stealing focus. */}
        <p role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Processing your payment. Please wait.' : ''}
        </p>

        {!hasExpired && (
          <p className="text-center text-xs text-muted">
            Time remaining to pay at this price: {formatCountdown(secondsLeft)}
          </p>
        )}
      </form>
    </Card>
  );
}
