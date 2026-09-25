-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('QUOTE_GENERATED', 'MEDICAL_DECLARED', 'PREMIUM_PAID', 'POLICY_ISSUED');

-- CreateEnum
CREATE TYPE "EligibilityDecision" AS ENUM ('ELIGIBLE', 'REFERRED', 'DECLINED');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'QUOTE_GENERATED',
    "age" INTEGER NOT NULL,
    "has_pre_existing_conditions" BOOLEAN NOT NULL,
    "base_premium" DECIMAL(10,2) NOT NULL,
    "age_loading" DECIMAL(10,2) NOT NULL,
    "condition_loading" DECIMAL(10,2) NOT NULL,
    "total_premium" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_declarations" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "disclosures" JSONB NOT NULL,
    "decision" "EligibilityDecision" NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "declared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL DEFAULT 'CARESHIELD_MAX',
    "premium_paid" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "payment_reference" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cover_start" TIMESTAMPTZ(3) NOT NULL,
    "cover_end" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "quote_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "quotes_status_expires_at_idx" ON "quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "medical_declarations_quote_id_key" ON "medical_declarations"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_quote_id_key" ON "policies"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_policy_number_key" ON "policies"("policy_number");

-- CreateIndex
CREATE INDEX "idempotency_records_endpoint_created_at_idx" ON "idempotency_records"("endpoint", "created_at");

-- AddForeignKey
ALTER TABLE "medical_declarations" ADD CONSTRAINT "medical_declarations_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
