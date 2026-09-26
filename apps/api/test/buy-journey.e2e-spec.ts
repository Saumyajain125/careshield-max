import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createHarness, resetDatabase, HEALTHY_DISCLOSURES, type Harness } from './app-harness';

const QUOTE_URL = '/api/v1/insurance/quote';
const CHECKOUT_URL = '/api/v1/insurance/checkout';

let harness: Harness;
const http = () => request(harness.app.getHttpServer());

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetDatabase(harness);
});

/** Step 1: create a locked quote. */
async function createQuote(age = 30, hasPreExistingConditions = false) {
  const res = await http().post(QUOTE_URL).send({ age, hasPreExistingConditions }).expect(201);
  return res.body;
}

/** Steps 1-2: a quote that has been underwritten and is ready to pay. */
async function createPayableQuote(overrides: Partial<typeof HEALTHY_DISCLOSURES> = {}, age = 30) {
  const quote = await createQuote(age, (overrides.diagnosedConditions ?? []).length > 0);

  await http()
    .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
    .send({ disclosures: { ...HEALTHY_DISCLOSURES, ...overrides }, declarationAccepted: true })
    .expect(200);

  return quote;
}

function checkout(quoteId: string, paymentToken = 'tok_visa_ok', idempotencyKey = randomUUID()) {
  return http()
    .post(CHECKOUT_URL)
    .set('Idempotency-Key', idempotencyKey)
    .send({ quoteId, paymentToken });
}

// ---------------------------------------------------------------------------
// Phase 2 - premium engine & quote lock
// ---------------------------------------------------------------------------

describe('POST /api/v1/insurance/quote', () => {
  it.each([
    [30, false, '10000.00', '0.00', '0.00'],
    [46, false, '15000.00', '5000.00', '0.00'],
    [30, true, '15000.00', '0.00', '5000.00'],
    [46, true, '20000.00', '5000.00', '5000.00'],
    [45, false, '10000.00', '0.00', '0.00'],
  ])(
    'rates age %i / pre-existing %s at Rs %s',
    async (age, hasPreExisting, total, ageLoading, conditionLoading) => {
      const quote = await createQuote(age as number, hasPreExisting as boolean);

      expect(quote.premium).toMatchObject({
        base: '10000.00',
        ageLoading,
        conditionLoading,
        total,
        currency: 'INR',
      });
      expect(quote.status).toBe('QUOTE_GENERATED');
    },
  );

  it('returns money as fixed-scale strings, never JSON numbers', async () => {
    const quote = await createQuote(46, true);

    expect(typeof quote.premium.total).toBe('string');
    expect(quote.premium.total).toBe('20000.00');
  });

  it('persists the premium as NUMERIC(10,2), not a float', async () => {
    const quote = await createQuote(46, true);

    const [row] = await harness.prisma.$queryRaw<Array<{ total_premium: string }>>`
      SELECT total_premium::text FROM quotes WHERE id = ${quote.id}::uuid
    `;
    expect(row.total_premium).toBe('20000.00');
  });

  it('locks the quote for exactly 15 minutes', async () => {
    const quote = await createQuote();

    const lockMs = new Date(quote.expiresAt).getTime() - new Date(quote.createdAt).getTime();
    expect(lockMs).toBe(15 * 60 * 1000);
    expect(quote.expiresInSeconds).toBeGreaterThan(14 * 60);
    expect(quote.isExpired).toBe(false);
  });

  it('is deterministic - identical inputs always produce an identical premium', async () => {
    const totals = await Promise.all(
      Array.from({ length: 5 }, () => createQuote(46, true).then((q) => q.premium.total)),
    );

    expect(new Set(totals)).toEqual(new Set(['20000.00']));
  });

  it.each([
    ['a non-integer age', { age: 30.5, hasPreExistingConditions: false }],
    ['an age below 18', { age: 17, hasPreExistingConditions: false }],
    ['an age above 80', { age: 81, hasPreExistingConditions: false }],
    ['a missing flag', { age: 30 }],
  ])('rejects %s with 400', async (_label, payload) => {
    await http().post(QUOTE_URL).send(payload).expect(400);
  });

  it('refuses a client-supplied premium rather than trusting it', async () => {
    await http()
      .post(QUOTE_URL)
      .send({ age: 70, hasPreExistingConditions: true, totalPremium: '1.00' })
      .expect(400);
  });

  // A form post sends booleans as strings. class-transformer's implicit
  // conversion used to run Boolean("false") -> true ahead of our own
  // transform, which quietly loaded the premium by Rs 5,000.
  it('reads the string "false" as false, not as a truthy string', async () => {
    const res = await http()
      .post(QUOTE_URL)
      .send({ age: 30, hasPreExistingConditions: 'false' })
      .expect(201);

    expect(res.body.premium.total).toBe('10000.00');
    expect(res.body.applicant.hasPreExistingConditions).toBe(false);
  });

  it('rejects a flag that is neither a boolean nor "true"/"false"', async () => {
    await http().post(QUOTE_URL).send({ age: 30, hasPreExistingConditions: 'maybe' }).expect(400);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 - the finite state machine
// ---------------------------------------------------------------------------

describe('quote state machine', () => {
  it('walks QUOTE_GENERATED -> MEDICAL_DECLARED -> POLICY_ISSUED', async () => {
    const quote = await createQuote();
    expect(quote.status).toBe('QUOTE_GENERATED');

    const declared = await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({ disclosures: HEALTHY_DISCLOSURES, declarationAccepted: true })
      .expect(200);
    expect(declared.body.status).toBe('MEDICAL_DECLARED');
    expect(declared.body.medicalDeclaration.decision).toBe('ELIGIBLE');

    const paid = await checkout(quote.id).expect(201);
    expect(paid.body.quote.status).toBe('POLICY_ISSUED');
  });

  it('will not take payment before the medical declaration', async () => {
    const quote = await createQuote();

    const res = await checkout(quote.id).expect(409);
    expect(res.body.error).toBe('MEDICAL_DECLARATION_REQUIRED');
  });

  it('will not take payment twice for the same quote', async () => {
    const quote = await createPayableQuote();
    await checkout(quote.id).expect(201);

    // A *different* idempotency key, so this is the state machine talking,
    // not the idempotency store.
    const res = await checkout(quote.id, 'tok_visa_ok', randomUUID()).expect(409);
    expect(res.body.error).toBe('ALREADY_PAID');
  });
});

// ---------------------------------------------------------------------------
// Phase 2/3 - the expiry gate
// ---------------------------------------------------------------------------

describe('quote expiry gate', () => {
  /** Age a quote past its lock without waiting 15 real minutes. */
  async function expire(quoteId: string) {
    await harness.prisma.quote.update({
      where: { id: quoteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }

  it('reports an expired quote as expired on read', async () => {
    const quote = await createQuote();
    await expire(quote.id);

    const res = await http().get(`${QUOTE_URL}/${quote.id}`).expect(200);
    expect(res.body.isExpired).toBe(true);
    expect(res.body.expiresInSeconds).toBe(0);
  });

  it('refuses payment on an expired quote with 410 Gone', async () => {
    const quote = await createPayableQuote();
    await expire(quote.id);

    const res = await checkout(quote.id).expect(410);
    expect(res.body.error).toBe('QUOTE_EXPIRED');
  });

  it('does not charge the customer when the quote has expired', async () => {
    const quote = await createPayableQuote();
    await expire(quote.id);
    await checkout(quote.id).expect(410);

    expect(await harness.prisma.policy.count()).toBe(0);
    const after = await harness.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('MEDICAL_DECLARED');
  });

  it('refuses a medical declaration on an expired quote', async () => {
    const quote = await createQuote();
    await expire(quote.id);

    await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({ disclosures: HEALTHY_DISCLOSURES, declarationAccepted: true })
      .expect(410);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 - medical declaration & underwriting
// ---------------------------------------------------------------------------

describe('POST /api/v1/insurance/quote/:id/medical-declaration', () => {
  it('declines an uninsurable condition and blocks payment', async () => {
    const quote = await createQuote(40, true);

    const declared = await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({
        disclosures: { ...HEALTHY_DISCLOSURES, diagnosedConditions: ['CANCER'] },
        declarationAccepted: true,
      })
      .expect(200);

    expect(declared.body.medicalDeclaration.decision).toBe('DECLINED');
    expect(declared.body.medicalDeclaration.canProceedToPayment).toBe(false);

    const res = await checkout(quote.id).expect(422);
    expect(res.body.error).toBe('NOT_ELIGIBLE_FOR_INSTANT_ISSUE');
  });

  it('refers a borderline case to an underwriter and blocks instant issue', async () => {
    const quote = await createQuote(40, false);

    const declared = await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({
        disclosures: { ...HEALTHY_DISCLOSURES, hospitalisedInLast12Months: true },
        declarationAccepted: true,
      })
      .expect(200);

    expect(declared.body.medicalDeclaration.decision).toBe('REFERRED');
    await checkout(quote.id).expect(422);
  });

  it('rejects a declaration that contradicts the quoted risk', async () => {
    const quote = await createQuote(40, false);

    const res = await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({
        disclosures: { ...HEALTHY_DISCLOSURES, diagnosedConditions: ['DIABETES'] },
        declarationAccepted: true,
      })
      .expect(422);

    expect(res.body.error).toBe('DECLARATION_CONTRADICTS_QUOTE');
  });

  it('requires the applicant to accept the declaration', async () => {
    const quote = await createQuote();

    await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({ disclosures: HEALTHY_DISCLOSURES, declarationAccepted: false })
      .expect(400);
  });

  // The attestation is the contractual basis for the policy, so "false" must
  // not sneak past @IsIn([true]) as a truthy string.
  it('refuses the string "false" as an acceptance', async () => {
    const quote = await createQuote();

    await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({ disclosures: HEALTHY_DISCLOSURES, declarationAccepted: 'false' })
      .expect(400);
  });

  it.each([
    ['omitted disclosures', { declarationAccepted: true }],
    ['disclosures as an array', { disclosures: [HEALTHY_DISCLOSURES], declarationAccepted: true }],
    ['a disclosure flag that is not a boolean', {
      disclosures: { ...HEALTHY_DISCLOSURES, smoker: 'sometimes' },
      declarationAccepted: true,
    }],
  ])('rejects %s with 400 rather than 500', async (_label, payload) => {
    const quote = await createQuote();

    await http().post(`${QUOTE_URL}/${quote.id}/medical-declaration`).send(payload).expect(400);
  });

  it('rejects an unknown condition code', async () => {
    const quote = await createQuote(40, true);

    await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send({
        disclosures: { ...HEALTHY_DISCLOSURES, diagnosedConditions: ['MADE_UP_ILLNESS'] },
        declarationAccepted: true,
      })
      .expect(400);
  });

  it('lets a customer correct their answers without losing the locked premium', async () => {
    const quote = await createQuote(40, true);
    const body = (conditions: string[]) => ({
      disclosures: { ...HEALTHY_DISCLOSURES, diagnosedConditions: conditions },
      declarationAccepted: true,
    });

    await http().post(`${QUOTE_URL}/${quote.id}/medical-declaration`).send(body(['CANCER'])).expect(200);
    const corrected = await http()
      .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
      .send(body(['DIABETES']))
      .expect(200);

    expect(corrected.body.medicalDeclaration.decision).toBe('ELIGIBLE');
    expect(corrected.body.premium.total).toBe(quote.premium.total);
    expect(corrected.body.expiresAt).toBe(quote.expiresAt);
    expect(await harness.prisma.medicalDeclaration.count()).toBe(1);
  });
});
