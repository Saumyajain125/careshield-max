'use client';

import type { PolicyView } from '@/lib/types';
import { Card, formatInr } from './ui';

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** The terminal, happy state: cover is bound and the contract ID is issued. */
export function PolicyCertificate({
  policy,
  onRestart,
}: {
  policy: PolicyView;
  onRestart: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-5">
            <path
              d="m5 13 4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          {/* Announced on arrival so a screen reader user hears the outcome. */}
          <h2 role="status" className="text-xl font-semibold text-ink">
            You&apos;re covered
          </h2>
          <p className="mt-1 text-sm text-muted">
            Your CareShield Max policy is active. We&apos;ve emailed your documents.
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 sm:grid-cols-2">
        <Detail label="Policy number" value={policy.policyNumber} mono />
        <Detail label="Premium paid" value={formatInr(policy.premiumPaid)} />
        <Detail label="Cover starts" value={dateFormat.format(new Date(policy.coverStart))} />
        <Detail label="Cover ends" value={dateFormat.format(new Date(policy.coverEnd))} />
        <Detail label="Payment reference" value={policy.paymentReference} mono />
        <Detail label="Plan" value="CareShield Max" />
      </dl>

      <button
        type="button"
        onClick={onRestart}
        className="mt-6 text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
      >
        Buy another policy
      </button>
    </Card>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold text-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
