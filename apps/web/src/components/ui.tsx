import type { ReactNode } from 'react';

/** Shared presentational primitives, kept tiny and dependency-free. */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8 ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClasses =
  'w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-ink shadow-sm transition ' +
  'placeholder:text-muted/60 hover:border-black/25 focus:border-brand-600 focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-600/20 disabled:cursor-not-allowed disabled:bg-black/5';

/**
 * Controlled checkbox. React resets an uncontrolled form once its action
 * settles, so holding the value in state is what keeps a user's answers on
 * screen when the server rejects a submission.
 */
export function Checkbox({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = value ? `${name}-${value}` : name;

  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-black/10 bg-white p-3 transition hover:border-brand-500/50 hover:bg-brand-50/40 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
    >
      <input
        id={id}
        name={name}
        value={value}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-black/25 text-brand-600 focus:ring-brand-600"
      />
      <span className="text-sm leading-snug text-ink">{label}</span>
    </label>
  );
}

/**
 * Error and status messaging.
 *
 * `role="alert"` makes a screen reader announce a failure the moment it
 * appears, which matters when the failure is "your payment was declined".
 */
export function Alert({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'warning' | 'info' | 'success';
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-brand-100 bg-brand-50 text-brand-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm ${tones[tone]}`}
    >
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 leading-relaxed">{children}</div> : null}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`size-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

/** Format a rupee string from the API for display, without touching its value. */
export function formatInr(amount: string): string {
  const [rupees] = amount.split('.');
  return `Rs ${Number(rupees).toLocaleString('en-IN')}`;
}

/**
 * One idempotency key per payment attempt.
 *
 * crypto.randomUUID is only defined in a secure context, which rules out
 * demoing over plain HTTP from a phone, so fall back to a random string of the
 * same shape. The server only requires 8-255 characters of [A-Za-z0-9_:.-].
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
