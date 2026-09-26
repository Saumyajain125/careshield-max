'use client';

import { useActionState, useEffect, useState } from 'react';
import { submitDeclarationAction } from '@/app/actions';
import { DIAGNOSED_CONDITIONS, IDLE, type ActionState, type Quote } from '@/lib/types';
import { CountdownTimer, useCountdown } from './CountdownTimer';
import { Alert, Card, Checkbox, Field, Spinner, inputClasses } from './ui';

/**
 * Step 2 - structured health disclosures.
 *
 * The condition picker is only shown when the quote was rated *with*
 * pre-existing conditions, because the API rejects a declaration that
 * contradicts the basis the premium was calculated on.
 */
export function MedicalDeclarationForm({
  quote,
  onDeclared,
  onRestart,
}: {
  quote: Quote;
  onDeclared: (quote: Quote) => void;
  onRestart: () => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionState<Quote>, FormData>(
    submitDeclarationAction,
    IDLE,
  );

  /**
   * All fields are controlled. React resets an uncontrolled form as soon as
   * its action settles, which on this form would throw away seven answers
   * every time the server rejects the declaration - so the state lives here.
   */
  const [form, setForm] = useState({
    heightCm: '170',
    weightKg: '70',
    alcoholUnitsPerWeek: '0',
    smoker: false,
    hospitalisedInLast12Months: false,
    onRegularMedication: false,
    declarationAccepted: false,
    diagnosedConditions: [] as string[],
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const toggleCondition = (code: string, checked: boolean) =>
    setForm((previous) => ({
      ...previous,
      diagnosedConditions: checked
        ? [...previous.diagnosedConditions, code]
        : previous.diagnosedConditions.filter((existing) => existing !== code),
    }));

  useEffect(() => {
    if (state.status === 'success') {
      onDeclared(state.data);
    }
  }, [state, onDeclared]);

  const needsConditions = quote.applicant.hasPreExistingConditions;

  // The lock runs during this step too, and a 410 on submit used to leave the
  // customer looping on the same form with no way out.
  const { secondsLeft, hasExpired } = useCountdown(quote.expiresInSeconds, quote.id);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Your health declaration</h2>
          <p className="mt-1 text-sm text-muted">
            Answer honestly - your cover depends on these answers being true and complete.
          </p>
        </div>
        <CountdownTimer secondsLeft={secondsLeft} hasExpired={hasExpired} />
      </div>

      {hasExpired && (
        <div className="mt-6 space-y-4">
          <Alert tone="warning" title="Your quote has expired">
            <p>Premiums are only held for 15 minutes. Recalculate to carry on.</p>
          </Alert>
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Recalculate my premium
          </button>
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-6">
        <input type="hidden" name="quoteId" value={quote.id} />
        <fieldset disabled={hasExpired} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Height (cm)" htmlFor="heightCm">
              <input
                id="heightCm"
                name="heightCm"
                type="number"
                min={120}
                max={250}
                step={1}
                required
                value={form.heightCm}
                onChange={(event) => set('heightCm', event.target.value)}
                className={inputClasses}
              />
            </Field>
            <Field label="Weight (kg)" htmlFor="weightKg">
              <input
                id="weightKg"
                name="weightKg"
                type="number"
                min={25}
                max={400}
                step={0.1}
                required
                value={form.weightKg}
                onChange={(event) => set('weightKg', event.target.value)}
                className={inputClasses}
              />
            </Field>
          </div>

          <Field
            label="Alcohol units per week"
            htmlFor="alcoholUnitsPerWeek"
            hint="One unit is roughly a small glass of wine or half a pint of beer."
          >
            <input
              id="alcoholUnitsPerWeek"
              name="alcoholUnitsPerWeek"
              type="number"
              min={0}
              max={200}
              step={1}
              required
              value={form.alcoholUnitsPerWeek}
              onChange={(event) => set('alcoholUnitsPerWeek', event.target.value)}
              aria-describedby="alcoholUnitsPerWeek-hint"
              className={inputClasses}
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-ink">
              Please tell us if any of these apply
            </legend>
            <Checkbox
              name="smoker"
              label="I smoke or use tobacco products"
              checked={form.smoker}
              onChange={(checked) => set('smoker', checked)}
            />
            <Checkbox
              name="hospitalisedInLast12Months"
              label="I have been hospitalised in the last 12 months"
              checked={form.hospitalisedInLast12Months}
              onChange={(checked) => set('hospitalisedInLast12Months', checked)}
            />
            <Checkbox
              name="onRegularMedication"
              label="I take regular prescription medication"
              checked={form.onRegularMedication}
              onChange={(checked) => set('onRegularMedication', checked)}
            />
          </fieldset>

          {needsConditions && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-ink">
                Which conditions have you been diagnosed with?
              </legend>
              <p className="mb-2 text-xs text-muted">
                Your quote was priced with pre-existing conditions, so please select at least one.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {DIAGNOSED_CONDITIONS.map((condition) => (
                  <Checkbox
                    key={condition.code}
                    name="diagnosedConditions"
                    value={condition.code}
                    label={condition.label}
                    checked={form.diagnosedConditions.includes(condition.code)}
                    onChange={(checked) => toggleCondition(condition.code, checked)}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
            <Checkbox
              name="declarationAccepted"
              label="I confirm the information above is true and complete to the best of my knowledge. I understand that cover may be void if it is not."
              checked={form.declarationAccepted}
              onChange={(checked) => set('declarationAccepted', checked)}
            />
          </div>

          {state.status === 'error' && (
            <Alert tone="error" title="We couldn't accept your declaration">
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
        </fieldset>

        <button
          type="submit"
          disabled={isPending || hasExpired}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isPending && <Spinner />}
          {isPending ? 'Checking eligibility...' : 'Submit declaration'}
        </button>
      </form>
    </Card>
  );
}
