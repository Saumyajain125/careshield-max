'use client';

import { useEffect, useState } from 'react';

/**
 * Task 3.2 - the quote-lock countdown.
 *
 * Anchored on the server's expiresInSeconds at the moment the quote arrives,
 * not on expiresAt against the browser clock: a machine running 20 minutes
 * fast would show a brand-new quote as already expired, and the replacement
 * quote too. It is advisory either way - the server answers a late payment
 * with 410.
 */
export function useCountdown(
  expiresInSeconds: number,
  quoteId: string,
): { secondsLeft: number; hasExpired: boolean } {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.floor(expiresInSeconds)));

  useEffect(() => {
    // Elapsed time is local, which is fine - only the starting point has to
    // come from the server. Recomputing from a deadline rather than
    // decrementing means a throttled or sleeping tab catches up on wake.
    const deadline = Date.now() + expiresInSeconds * 1000;
    const remaining = () => Math.max(0, Math.floor((deadline - Date.now()) / 1000));

    setSecondsLeft(remaining());

    const interval = setInterval(() => {
      const next = remaining();
      setSecondsLeft(next);
      if (next <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresInSeconds, quoteId]);

  return { secondsLeft, hasExpired: secondsLeft <= 0 };
}

export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function CountdownTimer({ secondsLeft, hasExpired }: { secondsLeft: number; hasExpired: boolean }) {
  const isUrgent = !hasExpired && secondsLeft <= 60;

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {hasExpired ? 'Quote expired' : 'Price locked for'}
      </span>
      {!hasExpired && (
        <span
          // Only announced in the last minute, so a screen reader is not read
          // 900 updates.
          role="timer"
          aria-live={isUrgent ? 'assertive' : 'off'}
          aria-label={`${Math.ceil(secondsLeft / 60)} minutes remaining on your quote`}
          className={`font-mono text-sm font-semibold tabular-nums ${
            isUrgent ? 'text-red-600' : 'text-ink'
          }`}
        >
          {formatCountdown(secondsLeft)}
        </span>
      )}
    </div>
  );
}
