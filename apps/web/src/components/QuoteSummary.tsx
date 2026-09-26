'use client';

import type { Quote } from '@/lib/types';
import { formatInr } from './ui';

/** The premium breakdown, so the price is explainable rather than asserted. */
export function QuoteSummary({ quote }: { quote: Quote }) {
  const rows = [
    { label: 'Base premium', amount: quote.premium.base, always: true },
    {
      label: `Age loading (over 45)`,
      amount: quote.premium.ageLoading,
      always: false,
    },
    {
      label: 'Pre-existing condition loading',
      amount: quote.premium.conditionLoading,
      always: false,
    },
  ].filter((row) => row.always || Number(row.amount) > 0);

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your premium</h2>

      <dl className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted">{row.label}</dt>
            <dd className="font-medium tabular-nums text-ink">{formatInr(row.amount)}</dd>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-4 border-t border-black/10 pt-3">
          <dt className="text-sm font-semibold text-ink">Total payable</dt>
          <dd className="text-xl font-bold tabular-nums text-ink">
            {formatInr(quote.premium.total)}
            <span className="ml-1 text-xs font-normal text-muted">/ year</span>
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-muted">
        For a {quote.applicant.age}-year-old
        {quote.applicant.hasPreExistingConditions
          ? ' with pre-existing conditions'
          : ' with no pre-existing conditions'}
        .
      </p>
    </div>
  );
}
