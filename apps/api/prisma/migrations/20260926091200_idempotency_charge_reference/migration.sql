-- Durable link between an idempotency key and a gateway charge captured under
-- it. Written before the issuance transaction opens, so a crash between the
-- capture and the commit still leaves something to reconcile against.
ALTER TABLE "idempotency_records" ADD COLUMN "charge_reference" TEXT;
