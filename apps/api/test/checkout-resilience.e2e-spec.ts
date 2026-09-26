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

async function createPayableQuote(age = 40) {
  const { body: quote } = await http()
    .post(QUOTE_URL)
    .send({ age, hasPreExistingConditions: false })
    .expect(201);

  await http()
    .post(`${QUOTE_URL}/${quote.id}/medical-declaration`)
    .send({ disclosures: HEALTHY_DISCLOSURES, declarationAccepted: true })
    .expect(200);

  return quote;
}

const checkout = (quoteId: string, paymentToken: string, idempotencyKey: string) =>
  http().post(CHECKOUT_URL).set('Idempotency-Key', idempotencyKey).send({ quoteId, paymentToken });

// ---------------------------------------------------------------------------
// Task 4.1 - atomic transactions and rollback
// ---------------------------------------------------------------------------

describe('checkout atomicity (Task 4.1)', () => {
  it('issues a policy and marks the quote converted', async () => {
    const quote = await createPayableQuote();

    const res = await checkout(quote.id, 'tok_visa_ok', randomUUID()).expect(201);

    expect(res.body.quote.status).toBe('POLICY_ISSUED');
    expect(res.body.policy.policyNumber).toMatch(/^CSM-\d{4}-[0-9A-F]{8}$/);
    expect(res.body.policy.premiumPaid).toBe(quote.premium.total);
    expect(res.body.policy.paymentReference).toMatch(/^ch_/);

    const stored = await harness.prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { policy: true },
    });
    expect(stored.status).toBe('POLICY_ISSUED');
    expect(stored.policy).not.toBeNull();
  });

  it('rolls the database back completely when issuance fails mid-transaction', async () => {
    const quote = await createPayableQuote();

    // tok_fail_issue_* captures the charge, then throws *after* the policy row
    // has been inserted inside the transaction.
    const res = await checkout(quote.id, 'tok_fail_issue_boom', randomUUID()).expect(500);
    expect(res.body.error).toBe('POLICY_ISSUANCE_FAILED');

    // Nothing from the failed transaction survived.
    expect(await harness.prisma.policy.count()).toBe(0);
    const after = await harness.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('MEDICAL_DECLARED');
  });

  it('never leaves a quote PREMIUM_PAID without a policy attached', async () => {
    const quote = await createPayableQuote();
    await checkout(quote.id, 'tok_fail_issue_boom', randomUUID()).expect(500);

    const orphans = await harness.prisma.quote.count({
      where: { status: { in: ['PREMIUM_PAID', 'POLICY_ISSUED'] }, policy: { is: null } },
    });
    expect(orphans).toBe(0);
  });

  it('voids the captured charge when issuance rolls back, so nobody is paid-but-uninsured', async () => {
    const quote = await createPayableQuote();
    await checkout(quote.id, 'tok_fail_issue_boom', randomUUID()).expect(500);

    // The compensating action ran against the gateway.
    const voided = harness.payments.getChargeLedger().filter((c) => c.voided);
    expect(voided).toHaveLength(1);
  });

  it('takes no money and writes nothing when the issuer declines', async () => {
    const quote = await createPayableQuote();

    const res = await checkout(quote.id, 'tok_decline_nsf', randomUUID()).expect(402);
    expect(res.body.error).toBe('PAYMENT_DECLINED');

    // The response tells the customer no money was taken, so assert it.
    expect(harness.payments.getChargeLedger()).toHaveLength(0);
    expect(await harness.prisma.policy.count()).toBe(0);
    const after = await harness.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('MEDICAL_DECLARED');
  });

  it('reports an unreachable gateway as a retryable 503', async () => {
    const quote = await createPayableQuote();

    const res = await checkout(quote.id, 'tok_error_timeout', randomUUID()).expect(503);
    expect(res.body.error).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    expect(harness.payments.getChargeLedger()).toHaveLength(0);
    expect(await harness.prisma.policy.count()).toBe(0);
  });

  it('says so in the response when the compensating void also fails', async () => {
    const quote = await createPayableQuote();

    const res = await checkout(quote.id, 'tok_fail_void_boom', randomUUID()).expect(500);

    expect(res.body.error).toBe('POLICY_ISSUANCE_FAILED');
    expect(res.body.message).not.toContain('No money has been taken');
    expect(harness.payments.getChargeLedger().filter((c) => c.voided)).toHaveLength(0);
    expect(await harness.prisma.policy.count()).toBe(0);
  });

  it('records the charge against the idempotency key before issuing', async () => {
    const quote = await createPayableQuote();
    const key = randomUUID();

    await checkout(quote.id, 'tok_visa_ok', key).expect(201);

    const record = await harness.prisma.idempotencyRecord.findUniqueOrThrow({ where: { key } });
    expect(record.chargeReference).toMatch(/^ch_/);
  });
});

// ---------------------------------------------------------------------------
// Task 4.2 - idempotency
// ---------------------------------------------------------------------------

describe('checkout idempotency (Task 4.2)', () => {
  it('requires an Idempotency-Key header', async () => {
    const quote = await createPayableQuote();

    const res = await http()
      .post(CHECKOUT_URL)
      .send({ quoteId: quote.id, paymentToken: 'tok_visa_ok' })
      .expect(400);

    expect(res.body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects a malformed idempotency key', async () => {
    const quote = await createPayableQuote();

    const res = await checkout(quote.id, 'tok_visa_ok', 'short').expect(400);
    expect(res.body.error).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('replays the original response for a repeated key instead of charging again', async () => {
    const quote = await createPayableQuote();
    const key = randomUUID();

    const first = await checkout(quote.id, 'tok_visa_ok', key).expect(201);
    const second = await checkout(quote.id, 'tok_visa_ok', key).expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBe('false');

    // Exactly one policy, and exactly one charge at the gateway.
    expect(await harness.prisma.policy.count()).toBe(1);
    expect(harness.payments.getChargeLedger()).toHaveLength(1);
  });

  it('charges only once under a rapid burst of identical double-clicks', async () => {
    const quote = await createPayableQuote();
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => checkout(quote.id, 'tok_visa_ok', key)),
    );

    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    // Every request is accounted for: one does the work, the rest either
    // replay it or are told it is still in flight. None of them charge.
    expect(created.length + conflicts.length).toBe(8);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(harness.payments.getChargeLedger()).toHaveLength(1);
    expect(await harness.prisma.policy.count()).toBe(1);

    const policyNumbers = new Set(created.map((r) => r.body.policy.policyNumber));
    expect(policyNumbers.size).toBe(1);
  });

  it('rejects reuse of a key with a different payload', async () => {
    const first = await createPayableQuote();
    const second = await createPayableQuote();
    const key = randomUUID();

    await checkout(first.id, 'tok_visa_ok', key).expect(201);

    const res = await checkout(second.id, 'tok_visa_ok', key).expect(422);
    expect(res.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await harness.prisma.policy.count()).toBe(1);
  });

  it('remembers a decline, so a double-click does not re-hit the issuer', async () => {
    const quote = await createPayableQuote();
    const key = randomUUID();

    await checkout(quote.id, 'tok_decline_nsf', key).expect(402);
    const replay = await checkout(quote.id, 'tok_decline_nsf', key).expect(402);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.error).toBe('PAYMENT_DECLINED');
  });

  it('frees the key after a retryable failure so the same key can be retried', async () => {
    const quote = await createPayableQuote();
    const key = randomUUID();

    await checkout(quote.id, 'tok_error_timeout', key).expect(503);

    // The key was released rather than left IN_PROGRESS...
    expect(await harness.prisma.idempotencyRecord.count({ where: { key } })).toBe(0);

    // ...so the client's retry - same key, as the idempotency contract
    // intends - is executed afresh rather than 409-ing forever. A 409 here
    // would mean the key had been left locked by the failed attempt.
    await checkout(quote.id, 'tok_error_timeout', key).expect(503);

    // And once the gateway recovers, that same key still completes the buy.
    const recovered = await checkout(quote.id, 'tok_visa_ok', key).expect(201);
    expect(recovered.body.quote.status).toBe('POLICY_ISSUED');
  });

  it('charges once when two different keys race on the same quote', async () => {
    const quote = await createPayableQuote();

    // Two tabs, two keys, one quote: the idempotency table cannot help here,
    // so the gateway key derived from the quote is what stops a second
    // authorisation on the customer's card.
    const responses = await Promise.all([
      checkout(quote.id, 'tok_visa_ok', randomUUID()),
      checkout(quote.id, 'tok_visa_ok', randomUUID()),
    ]);

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(harness.payments.getChargeLedger()).toHaveLength(1);
    expect(await harness.prisma.policy.count()).toBe(1);
  });

  it('404s on an unknown quote without wedging the key', async () => {
    const key = randomUUID();
    const unknownQuoteId = randomUUID();

    const res = await checkout(unknownQuoteId, 'tok_visa_ok', key).expect(404);
    expect(res.body.error).toBe('QUOTE_NOT_FOUND');

    // The record must not hold a foreign key to a quote that never existed,
    // and the key must not be left IN_PROGRESS for ever.
    const record = await harness.prisma.idempotencyRecord.findUniqueOrThrow({ where: { key } });
    expect(record.state).toBe('COMPLETED');
    expect(record.quoteId).toBeNull();

    // A retry gets the same answer rather than a 409.
    await checkout(unknownQuoteId, 'tok_visa_ok', key).expect(404);
  });

  it('tells the client what became of the key on a failure', async () => {
    const quote = await createPayableQuote();

    const released = await checkout(quote.id, 'tok_error_timeout', randomUUID()).expect(503);
    expect(released.body.keyDisposition).toBe('released');

    const completed = await checkout(quote.id, 'tok_decline_nsf', randomUUID()).expect(402);
    expect(completed.body.keyDisposition).toBe('completed');
  });

  it('does not conflate two genuinely different requests', async () => {
    const first = await createPayableQuote();
    const second = await createPayableQuote();

    const a = await checkout(first.id, 'tok_visa_ok', randomUUID()).expect(201);
    const b = await checkout(second.id, 'tok_visa_ok', randomUUID()).expect(201);

    expect(a.body.policy.policyNumber).not.toBe(b.body.policy.policyNumber);
    expect(await harness.prisma.policy.count()).toBe(2);
  });
});
