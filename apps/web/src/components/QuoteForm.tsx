'use client';

import { useActionState, useEffect, useState } from 'react';
import { createQuoteAction } from '@/app/actions';
import { IDLE, type ActionState, type Quote } from '@/lib/types';
import { Alert, Card, Field, Spinner, inputClasses } from './ui';

/**
 * Step 1 - collect the rating factors.
 *
 * `useActionState` gives us the pending flag and the result in one hook, and
 * because the form posts to a Server Action it still submits with JavaScript
 * disabled.
 */
export function QuoteForm({ onQuoted }: { onQuoted: (quote: Quote) => void }) {
  const [state, formAction, isPending] = useActionState<ActionState<Quote>, FormData>(
    createQuoteAction,
    IDLE,
  );

  // Controlled so a rejected submission does not wipe what was typed: React
  // resets an uncontrolled form as soon as its action settles.
  const [age, setAge] = useState('30');
  const [hasPreExistingConditions, setHasPreExistingConditions] = useState('no');

  useEffect(() => {
    if (state.status === 'success') {
      onQuoted(state.data);
    }
  }, [state, onQuoted]);

  return (
    <Card>
      <h2 className="text-xl font-semibold text-ink">Get your premium</h2>
      <p className="mt-1 text-sm text-muted">
        Two questions, and we&apos;ll hold your price for 15 minutes.
      </p>

      <form action={formAction} className="mt-6 space-y-6">
        <Field
          label="Your age"
          htmlFor="age"
          hint="CareShield Max is available from age 18 to 80."
        >
          <input
            id="age"
            name="age"
            type="number"
            inputMode="numeric"
            min={18}
            max={80}
            step={1}
            required
            autoComplete="off"
            value={age}
            onChange={(event) => setAge(event.target.value)}
            aria-describedby="age-hint"
            className={inputClasses}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            Do you have any pre-existing medical conditions?
          </legend>
          <p className="text-xs text-muted">
            Conditions diagnosed before today, such as diabetes or high blood pressure.
          </p>
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ].map((option) => (
              <label
                key={option.value}
                htmlFor={`pec-${option.value}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-black/10 bg-white p-3 transition hover:border-brand-500/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
              >
                <input
                  id={`pec-${option.value}`}
                  type="radio"
                  name="hasPreExistingConditions"
                  value={option.value}
                  checked={hasPreExistingConditions === option.value}
                  onChange={(event) => setHasPreExistingConditions(event.target.value)}
                  className="size-4 border-black/25 text-brand-600 focus:ring-brand-600"
                />
                <span className="text-sm font-medium text-ink">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {state.status === 'error' && (
          <Alert tone="error" title="We couldn't calculate your premium">
            <p>{state.message}</p>
            {state.fieldErrors?.length ? (
              <ul className="mt-2 list-inside list-disc space-y-0.5">
                {state.fieldErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isPending && <Spinner />}
          {isPending ? 'Calculating...' : 'Calculate my premium'}
        </button>
      </form>
    </Card>
  );
}
