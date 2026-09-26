# CareShield Max - D2C health insurance buy journey

Buy a health policy online: calculate and lock a premium, fill in a medical
declaration, then pay and get a policy issued.

    Next.js 15 (App Router, RSC + Server Actions, Tailwind v4)
       |  server-side fetch only
    NestJS 10 (controllers, validation pipes, services)
       |  Prisma 5
    PostgreSQL 16 (NUMERIC(10,2), row locks, transactions)

## Running it

You need Node 20.11+ (.nvmrc pins 22) and Docker.

```bash
npm run setup
```

That installs dependencies, starts a Postgres container and applies the
migrations. Then:

```bash
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000 (health check on /health)

Defaults live in `apps/api/.env.example` and `apps/web/.env.example`. The setup
script works without copying them; copy them to `.env` / `.env.local` if you
want to change anything.

### Tests

```bash
npm test         # unit    - premium engine, underwriting rules
npm run test:e2e # e2e     - the whole journey against a real database
```

The e2e suite needs the database up (`npm run db:up`). It exercises the
rollback and idempotency paths for real, so the stack traces it prints on the
fault-injection tests are expected.

## The journey

| # | Step | Endpoint | Quote status after |
|---|------|----------|--------------------|
| 1 | Premium calculation and quote lock | `POST /api/v1/insurance/quote` | QUOTE_GENERATED |
| 2 | Medical declaration | `POST /api/v1/insurance/quote/:id/medical-declaration` | MEDICAL_DECLARED |
| 3 | Pay and issue | `POST /api/v1/insurance/checkout` | PREMIUM_PAID -> POLICY_ISSUED |

`GET /api/v1/insurance/quote/:id` re-reads a quote (the UI uses it to rehydrate
the countdown) and `GET /api/v1/insurance/rate-card` publishes the pricing
rules the UI explains.

### Rate card

| Component | Rule | Amount |
|-----------|------|--------|
| Base premium | always | Rs 10,000.00 |
| Age loading | age > 45 | +50% of base (Rs 5,000.00) |
| Pre-existing condition loading | hasPreExistingConditions | +Rs 5,000.00 flat |

A 50-year-old with pre-existing conditions pays Rs 20,000.00. The calculation
in `apps/api/src/insurance/engines/premium.engine.ts` is a pure function, which
is what makes a 15-minute lock mean something.

## Notes on the design

### Money is never a float

Every rupee value is NUMERIC(10, 2) in Postgres, a `Decimal` in the service
layer (`apps/api/src/common/money.ts`) and a fixed-scale string on the wire.
JSON numbers are doubles, so sending a premium as a number would put back the
imprecision the column type is there to avoid. One e2e test reads
`total_premium::text` out of Postgres to prove the stored value is `20000.00`.

### The quote lock is enforced server side

`created_at` and `expires_at` come from one clock in one statement. Letting
`created_at` default to the database's `now()` while computing `expires_at` in
Node makes the window drift by the round-trip time.

The countdown in the browser is advisory, and it is anchored on the
`expiresInSeconds` the server sends rather than on the local clock - otherwise
a machine running fast shows a valid quote as expired and the customer can
never pay. Checkout rejects a late payment with 410 regardless.

### Payment happens outside the database transaction

Holding a transaction (and a row lock) open across a call to a payment gateway
is how you exhaust a connection pool when the gateway slows down. So:

1. Validate the quote (status, expiry, eligibility).
2. Capture the charge, with no transaction open.
3. One transaction: re-read the quote and the declaration FOR UPDATE,
   re-validate both, mark the quote PREMIUM_PAID, insert the Policy, advance to
   POLICY_ISSUED, and store the idempotent response.

Step 3 re-checks the underwriting decision as well as the status, because a
declaration can be corrected while the quote sits in MEDICAL_DECLARED - a
correction disclosing something uninsurable must not bind a policy.

The trade-off is that a captured charge can outlive a failed issuance. A
rollback cannot un-move money, so the failure path voids the charge, and says
in the response whether the void actually worked. The gateway gets a
quote-derived idempotency key, so two tabs paying for the same quote collapse
into one authorisation instead of one charge plus one refund.

### Idempotency

Keyed on a required `Idempotency-Key` header
(`apps/api/src/common/idempotency/idempotency.service.ts`):

1. An IN_PROGRESS row is inserted before any side effect. The primary key is
   the lock - simultaneous requests race on the same INSERT and the database
   picks the winner.
2. The loser reads the row: COMPLETED replays the stored response,
   IN_PROGRESS gets a 409 because the original is still running.
3. On success the status and body are stored inside the issuance transaction,
   so replays are identical and a bookkeeping failure cannot release a key
   whose payment already succeeded.
4. Terminal failures are remembered too. A decline is a final answer, so a
   retried double-click gets the same decline rather than another issuer call.
5. Retryable failures release the key, so a client can retry with it after a
   gateway timeout.

Reusing a key with a different payload gives a 422. Responses carry an
`Idempotency-Replayed` header, and failures carry a `keyDisposition` field
(`released` / `held` / `completed` / `invalid`) so the client knows whether to
reuse the key or mint a new one instead of keeping its own copy of these rules.

### Why the forms are controlled

React 19 resets an uncontrolled form once its action settles. On the medical
declaration that would discard seven answers every time the server rejected a
submission, so every field is controlled.

The pay button disables on `isPending` with `aria-busy`, which stops human
double-clicks. It does not stop programmatic clicks fired before React
re-renders, which is why the server-side key is the real guarantee.

## Sandbox payments

The mock gateway keys off the token prefix, and all four are selectable in the
UI:

| Token | Behaviour | HTTP | Key released? |
|-------|-----------|------|---------------|
| `tok_visa_4242` | captured | 201 | n/a |
| `tok_decline_nsf` | issuer decline | 402 | no - remembered |
| `tok_error_timeout` | gateway unreachable, nothing written | 503 | yes - safe to retry |
| `tok_fail_issue_*` | charge succeeds, then issuance fails | 500 | yes |
| `tok_fail_void_*` | as above, and the compensating void fails too | 500 | yes |

The last two need `ALLOW_PAYMENT_FAULT_INJECTION=true`. They throw inside the
transaction after both writes, which is what proves the rollback and the void.

```bash
# A whole journey from the shell
QUOTE=$(curl -s localhost:4000/api/v1/insurance/quote \
  -H 'content-type: application/json' \
  -d '{"age":50,"hasPreExistingConditions":false}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

curl -s "localhost:4000/api/v1/insurance/quote/$QUOTE/medical-declaration" \
  -H 'content-type: application/json' \
  -d '{"declarationAccepted":true,"disclosures":{"smoker":false,"alcoholUnitsPerWeek":2,"heightCm":175,"weightKg":72,"hospitalisedInLast12Months":false,"onRegularMedication":false,"diagnosedConditions":[]}}' > /dev/null

# Same request twice under one key: the second is a replay, not a second
# charge. Use a fresh key per run - a key cannot be reused for another quote.
KEY="demo-$(uuidgen)"
for i in 1 2; do
  curl -s -D- -o/dev/null localhost:4000/api/v1/insurance/checkout \
    -H 'content-type: application/json' -H "Idempotency-Key: $KEY" \
    -d "{\"quoteId\":\"$QUOTE\",\"paymentToken\":\"tok_visa_4242\"}" | grep -iE '^HTTP/|Idempotency-Replayed'
done
```

## Layout

```
apps/api/
  prisma/schema.prisma            # FSM, NUMERIC(10,2), idempotency table
  src/common/money.ts             # Decimal helpers
  src/common/idempotency/         # the Idempotency-Key protocol
  src/payments/                   # mock PSP: capture, void, fault injection
  src/insurance/
    engines/premium.engine.ts     # pure rating (+ unit tests)
    engines/underwriting.engine.ts# eligibility rules (+ unit tests)
    checkout.service.ts           # atomic bind, rollback, compensation
  test/                           # e2e against the real database

apps/web/
  src/globals.css                 # Tailwind entry (see the note in the file)
  src/app/actions.ts              # Server Actions - the browser never calls the API
  src/components/
    CountdownTimer.tsx            # anchored on the server's remaining seconds
    PaymentPanel.tsx              # expiry gate, pending state, key lifecycle
```

One Tailwind gotcha worth knowing: its scanner honours `.gitignore` files in
parent directories, so a stray `~/.gitignore` containing `*` (some Python venv
versions write one) kills directory scanning for any project under your home
folder unless the project is a git repo. This one is, so it is fine.

## Out of scope / known gaps

- Auth, customer accounts and KYC. A quote is addressed by its unguessable
  UUID; a real build would scope quotes to a signed-in customer.
- The payment client is a mock. The service only ever sees an opaque token,
  which keeps it out of PCI scope.
- Idempotency records are never pruned. Production wants a TTL sweep, or a
  partitioned table, so the table does not grow without bound.
- The charge reference is written to the idempotency row before the issuance
  transaction, so a crash mid-flight leaves something to reconcile against -
  but there is no reconciliation job to do it.
- Underwriting rules are illustrative, not an actual insurer's appetite.
- No frontend tests yet, though the client holds half the idempotency contract.
