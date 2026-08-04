-- CreateEnum
CREATE TYPE "WalletDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "WaterWallet" (
    "userId" UUID NOT NULL,
    "balanceMl" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaterWallet_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "WaterWallet_balance_nonnegative_check" CHECK ("balanceMl" >= 0)
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "walletUserId" UUID NOT NULL,
    "businessEventKey" VARCHAR(200) NOT NULL,
    "direction" "WalletDirection" NOT NULL,
    "amountMl" BIGINT NOT NULL,
    "operationKind" VARCHAR(64) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "balanceAfterMl" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "compensatesEntryId" UUID,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletLedgerEntry_amount_positive_check" CHECK ("amountMl" > 0),
    CONSTRAINT "WalletLedgerEntry_balance_after_nonnegative_check" CHECK ("balanceAfterMl" >= 0),
    CONSTRAINT "WalletLedgerEntry_business_event_key_format_check" CHECK (
        "businessEventKey" ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._~-]{1,167}$'
    ),
    CONSTRAINT "WalletLedgerEntry_operation_kind_format_check" CHECK (
        "operationKind" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    ),
    CONSTRAINT "WalletLedgerEntry_source_format_check" CHECK (
        "source" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    ),
    CONSTRAINT "WalletLedgerEntry_compensation_shape_check" CHECK (
        ("operationKind" = 'COMPENSATION' AND "direction" = 'CREDIT' AND "compensatesEntryId" IS NOT NULL)
        OR
        ("operationKind" <> 'COMPENSATION' AND "compensatesEntryId" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_sequence_key" ON "WalletLedgerEntry"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_businessEventKey_key" ON "WalletLedgerEntry"("businessEventKey");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_walletUserId_sequence_idx" ON "WalletLedgerEntry"("walletUserId", "sequence" DESC);

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_compensatesEntryId_idx" ON "WalletLedgerEntry"("compensatesEntryId");

-- AddForeignKey
ALTER TABLE "WaterWallet" ADD CONSTRAINT "WaterWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_walletUserId_fkey" FOREIGN KEY ("walletUserId") REFERENCES "WaterWallet"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_compensatesEntryId_fkey" FOREIGN KEY ("compensatesEntryId") REFERENCES "WalletLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger entries are accounting facts and must never be mutated in place.
CREATE FUNCTION reject_wallet_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'wallet_ledger_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "WalletLedgerEntry_immutable"
BEFORE UPDATE OR DELETE ON "WalletLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION reject_wallet_ledger_mutation();
