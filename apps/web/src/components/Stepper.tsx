'use client';

const STEPS = ['Your premium', 'Health declaration', 'Payment'] as const;

/** Progress indicator. `aria-current` tells assistive tech where we are. */
export function Stepper({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <nav aria-label="Application progress" className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {STEPS.map((label, index) => {
          const isDone = current > index;
          const isCurrent = current === index;

          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-medium transition ${
                  isCurrent
                    ? 'bg-brand-600 text-white'
                    : isDone
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-black/5 text-muted'
                }`}
              >
                <span aria-hidden="true" className="text-xs tabular-nums opacity-80">
                  {index + 1}
                </span>
                {label}
                <span className="sr-only">
                  {isDone ? ' (completed)' : isCurrent ? ' (current step)' : ' (not started)'}
                </span>
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-black/20">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
