'use server';

import { apiFetch, ApiError } from '@/lib/api';
import type { ActionState, PolicyView, Quote } from '@/lib/types';

// Server Actions for the buy journey. Each turns an exception into an
// ActionState, because useActionState renders state, not thrown errors - and a
// declined payment is an outcome to show, not a crash.

function toErrorState(error: unknown): ActionState<never> {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
      keyDisposition: error.keyDisposition,
    };
  }

  return {
    status: 'error',
    code: 'UNEXPECTED',
    message: 'Something went wrong on our side. Please try again.',
  };
}

/** Step 1 - calculate and lock the premium. */
export async function createQuoteAction(
  _prevState: ActionState<Quote>,
  formData: FormData,
): Promise<ActionState<Quote>> {
  const rawAge = formData.get('age');
  const age = Number(rawAge);

  // Cheap client-side-shaped guard so an empty form does not need a round trip.
  // The API re-validates regardless; this is UX, not a security boundary.
  if (!rawAge || !Number.isInteger(age)) {
    return { status: 'error', code: 'INVALID_AGE', message: 'Please enter your age in whole years.' };
  }

  try {
    const quote = await apiFetch<Quote>('/api/v1/insurance/quote', {
      method: 'POST',
      body: { age, hasPreExistingConditions: formData.get('hasPreExistingConditions') === 'yes' },
    });
    return { status: 'success', data: quote };
  } catch (error) {
    return toErrorState(error);
  }
}

/** Step 2 - submit structured health disclosures for underwriting. */
export async function submitDeclarationAction(
  _prevState: ActionState<Quote>,
  formData: FormData,
): Promise<ActionState<Quote>> {
  const quoteId = String(formData.get('quoteId') ?? '');

  const disclosures = {
    smoker: formData.get('smoker') === 'on',
    alcoholUnitsPerWeek: Number(formData.get('alcoholUnitsPerWeek') ?? 0),
    heightCm: Number(formData.get('heightCm')),
    weightKg: Number(formData.get('weightKg')),
    hospitalisedInLast12Months: formData.get('hospitalisedInLast12Months') === 'on',
    onRegularMedication: formData.get('onRegularMedication') === 'on',
    diagnosedConditions: formData.getAll('diagnosedConditions').map(String),
  };

  try {
    const quote = await apiFetch<Quote>(`/api/v1/insurance/quote/${quoteId}/medical-declaration`, {
      method: 'POST',
      body: { disclosures, declarationAccepted: formData.get('declarationAccepted') === 'on' },
    });
    return { status: 'success', data: quote };
  } catch (error) {
    return toErrorState(error);
  }
}

export interface CheckoutSuccess {
  quote: Quote;
  policy: PolicyView;
}

/**
 * Step 3 - pay and bind. The key is minted client side and posted with the
 * form, so a retry of the same attempt reuses it. PaymentPanel decides when it
 * is rotated.
 */
export async function checkoutAction(
  _prevState: ActionState<CheckoutSuccess>,
  formData: FormData,
): Promise<ActionState<CheckoutSuccess>> {
  const quoteId = String(formData.get('quoteId') ?? '');
  const paymentToken = String(formData.get('paymentToken') ?? '');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '');

  try {
    const result = await apiFetch<CheckoutSuccess>('/api/v1/insurance/checkout', {
      method: 'POST',
      body: { quoteId, paymentToken },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return { status: 'success', data: result };
  } catch (error) {
    return toErrorState(error);
  }
}

/** Re-read a quote from the server - the authority on whether it has expired. */
export async function refreshQuoteAction(quoteId: string): Promise<ActionState<Quote>> {
  try {
    const quote = await apiFetch<Quote>(`/api/v1/insurance/quote/${quoteId}`);
    return { status: 'success', data: quote };
  } catch (error) {
    return toErrorState(error);
  }
}
