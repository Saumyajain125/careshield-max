'use client';

import { useCallback, useState } from 'react';
import type { Quote } from '@/lib/types';
import { MedicalDeclarationForm } from './MedicalDeclarationForm';
import { PaymentPanel } from './PaymentPanel';
import { PolicyCertificate } from './PolicyCertificate';
import { QuoteForm } from './QuoteForm';
import { QuoteSummary } from './QuoteSummary';
import { Stepper } from './Stepper';
import { Alert } from './ui';

/**
 * Orchestrates the three steps of the buy journey.
 *
 * Which step renders is decided by the quote's own status, not by a local step
 * counter: that is the only version of the truth that survives a refresh, a
 * second tab, or a checkout whose response went missing.
 */
export function BuyJourney() {
  const [quote, setQuote] = useState<Quote | null>(null);

  const restart = useCallback(() => setQuote(null), []);

  const declaration = quote?.medicalDeclaration ?? null;
  const blockedByUnderwriting = declaration !== null && !declaration.canProceedToPayment;
  const isBound = quote?.status === 'PREMIUM_PAID' || quote?.status === 'POLICY_ISSUED';

  return (
    <div id="buy-journey" className="space-y-6">
      <Stepper current={currentStep(quote)} />

      {quote && !isBound && <QuoteSummary quote={quote} />}

      {!quote && <QuoteForm onQuoted={setQuote} />}

      {quote && quote.status === 'QUOTE_GENERATED' && (
        <MedicalDeclarationForm quote={quote} onDeclared={setQuote} onRestart={restart} />
      )}

      {quote && quote.status === 'MEDICAL_DECLARED' && blockedByUnderwriting && (
        <UnderwritingOutcome quote={quote} onRestart={restart} />
      )}

      {quote && quote.status === 'MEDICAL_DECLARED' && !blockedByUnderwriting && (
        <PaymentPanel
          quote={quote}
          onIssued={(result) => setQuote(result.quote)}
          onQuoteRefreshed={setQuote}
          onRestart={restart}
        />
      )}

      {/* Paid but no policy in the payload is only reachable if a checkout
          committed and its response was lost; "check again" recovers it. */}
      {quote && isBound && quote.policy && (
        <PolicyCertificate policy={quote.policy} onRestart={restart} />
      )}

      {quote && isBound && !quote.policy && (
        <Alert tone="info" title="Your payment went through">
          <p>
            We are still putting your documents together. Refresh this page in a moment to see your
            policy.
          </p>
        </Alert>
      )}
    </div>
  );
}

/** A DECLINED or REFERRED case: honest about the outcome, and a way forward. */
function UnderwritingOutcome({ quote, onRestart }: { quote: Quote; onRestart: () => void }) {
  const declaration = quote.medicalDeclaration!;
  const isDeclined = declaration.decision === 'DECLINED';

  return (
    <div className="space-y-4">
      <Alert
        tone={isDeclined ? 'error' : 'warning'}
        title={
          isDeclined
            ? 'We are unable to offer CareShield Max'
            : 'Your application needs a closer look'
        }
      >
        <p>
          {isDeclined
            ? 'Based on your health declaration, this plan is not available to you. Our team can suggest alternatives.'
            : 'An underwriter needs to review your declaration before we can issue cover. We will be in touch within two working days.'}
        </p>
        <ul className="mt-2 list-inside list-disc space-y-0.5">
          {declaration.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Alert>

      <button
        type="button"
        onClick={onRestart}
        className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
      >
        Start a new application
      </button>
    </div>
  );
}

function currentStep(quote: Quote | null): 0 | 1 | 2 | 3 {
  if (!quote) return 0;

  switch (quote.status) {
    case 'QUOTE_GENERATED':
      return 1;
    case 'MEDICAL_DECLARED':
      return 2;
    default:
      return 3;
  }
}
