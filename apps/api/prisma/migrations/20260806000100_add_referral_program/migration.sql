CREATE TYPE "ReferralApplicationChannel" AS ENUM ('REGISTRATION', 'POST_REGISTRATION');
CREATE TYPE "ReferralEligibilityStatus" AS ENUM ('OPEN', 'ATTACHED', 'CLOSED');
CREATE TYPE "ReferralBonusKind" AS ENUM ('WELCOME', 'INVITER');
CREATE TYPE "ReferralBonusDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'PERMANENT_FAILURE');

CREATE TABLE "ReferralPromoCode" (
    "userId" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralPromoCode_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ReferralPromoCode_code_format_check"
        CHECK ("code" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$')
);

CREATE TABLE "ReferralEligibility" (
    "userId" UUID NOT NULL,
    "status" "ReferralEligibilityStatus" NOT NULL DEFAULT 'OPEN',
    "closedByEventKey" VARCHAR(200),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ReferralEligibility_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ReferralEligibility_closed_shape_check" CHECK (
        ("status" = 'CLOSED' AND "closedByEventKey" IS NOT NULL AND "closedAt" IS NOT NULL)
        OR
        ("status" IN ('OPEN', 'ATTACHED') AND "closedByEventKey" IS NULL AND "closedAt" IS NULL)
    )
);

CREATE TABLE "ReferralRelationship" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "inviterUserId" UUID NOT NULL,
    "inviteeUserId" UUID NOT NULL,
    "channel" "ReferralApplicationChannel" NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralRelationship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralRelationship_no_self_referral_check" CHECK ("inviterUserId" <> "inviteeUserId")
);

CREATE TABLE "ReferralBonusEntitlement" (
    "id" UUID NOT NULL,
    "kind" "ReferralBonusKind" NOT NULL,
    "beneficiaryUserId" UUID NOT NULL,
    "relationshipId" UUID,
    "amountMl" BIGINT NOT NULL,
    "walletBusinessEventKey" VARCHAR(200) NOT NULL,
    "walletOperationKind" VARCHAR(64) NOT NULL,
    "walletSource" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReferralBonusDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "walletLedgerEntryId" UUID,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseOwner" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(64),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ReferralBonusEntitlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralBonusEntitlement_amount_positive_check" CHECK ("amountMl" > 0),
    CONSTRAINT "ReferralBonusEntitlement_attempt_count_nonnegative_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "ReferralBonusEntitlement_wallet_key_check" CHECK (
        "walletBusinessEventKey" = 'referral_bonus:' || "id"::text
    ),
    CONSTRAINT "ReferralBonusEntitlement_kind_shape_check" CHECK (
        ("kind" = 'WELCOME' AND "relationshipId" IS NULL AND "walletOperationKind" = 'REFERRAL_WELCOME_BONUS')
        OR
        ("kind" = 'INVITER' AND "relationshipId" IS NOT NULL AND "walletOperationKind" = 'REFERRAL_INVITER_BONUS')
    ),
    CONSTRAINT "ReferralBonusEntitlement_source_check" CHECK ("walletSource" = 'REFERRAL_PROGRAM'),
    CONSTRAINT "ReferralBonusEntitlement_lease_pair_check" CHECK (
        ("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL)
    ),
    CONSTRAINT "ReferralBonusEntitlement_delivery_shape_check" CHECK (
        ("status" = 'PENDING' AND "walletLedgerEntryId" IS NULL AND "deliveredAt" IS NULL AND "leaseOwner" IS NULL)
        OR
        ("status" = 'PROCESSING' AND "walletLedgerEntryId" IS NULL AND "deliveredAt" IS NULL AND "leaseOwner" IS NOT NULL)
        OR
        ("status" = 'DELIVERED' AND "walletLedgerEntryId" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "leaseOwner" IS NULL)
        OR
        ("status" = 'PERMANENT_FAILURE' AND "walletLedgerEntryId" IS NULL AND "deliveredAt" IS NULL AND "leaseOwner" IS NULL AND "lastErrorCode" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "ReferralPromoCode_code_key" ON "ReferralPromoCode"("code");
CREATE UNIQUE INDEX "ReferralEligibility_closedByEventKey_key" ON "ReferralEligibility"("closedByEventKey");
CREATE UNIQUE INDEX "ReferralRelationship_sequence_key" ON "ReferralRelationship"("sequence");
CREATE UNIQUE INDEX "ReferralRelationship_inviteeUserId_key" ON "ReferralRelationship"("inviteeUserId");
CREATE INDEX "ReferralRelationship_inviterUserId_sequence_idx"
    ON "ReferralRelationship"("inviterUserId", "sequence" DESC);
CREATE UNIQUE INDEX "ReferralBonusEntitlement_relationshipId_key"
    ON "ReferralBonusEntitlement"("relationshipId");
CREATE UNIQUE INDEX "ReferralBonusEntitlement_walletBusinessEventKey_key"
    ON "ReferralBonusEntitlement"("walletBusinessEventKey");
CREATE UNIQUE INDEX "ReferralBonusEntitlement_walletLedgerEntryId_key"
    ON "ReferralBonusEntitlement"("walletLedgerEntryId");
CREATE UNIQUE INDEX "ReferralBonusEntitlement_one_welcome_per_user_key"
    ON "ReferralBonusEntitlement"("beneficiaryUserId") WHERE "kind" = 'WELCOME';
CREATE INDEX "ReferralBonusEntitlement_status_nextAttemptAt_idx"
    ON "ReferralBonusEntitlement"("status", "nextAttemptAt");
CREATE INDEX "ReferralBonusEntitlement_beneficiaryUserId_createdAt_idx"
    ON "ReferralBonusEntitlement"("beneficiaryUserId", "createdAt" DESC);

ALTER TABLE "ReferralPromoCode" ADD CONSTRAINT "ReferralPromoCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralEligibility" ADD CONSTRAINT "ReferralEligibility_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralRelationship" ADD CONSTRAINT "ReferralRelationship_inviterUserId_fkey"
    FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralRelationship" ADD CONSTRAINT "ReferralRelationship_inviteeUserId_fkey"
    FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralBonusEntitlement" ADD CONSTRAINT "ReferralBonusEntitlement_beneficiaryUserId_fkey"
    FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralBonusEntitlement" ADD CONSTRAINT "ReferralBonusEntitlement_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "ReferralRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralBonusEntitlement" ADD CONSTRAINT "ReferralBonusEntitlement_walletLedgerEntryId_fkey"
    FOREIGN KEY ("walletLedgerEntryId") REFERENCES "WalletLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_referral_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'referral_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ReferralPromoCode_immutable"
BEFORE UPDATE OR DELETE ON "ReferralPromoCode"
FOR EACH ROW EXECUTE FUNCTION reject_referral_immutable_row_mutation();

CREATE TRIGGER "ReferralRelationship_immutable"
BEFORE UPDATE OR DELETE ON "ReferralRelationship"
FOR EACH ROW EXECUTE FUNCTION reject_referral_immutable_row_mutation();

CREATE FUNCTION enforce_referral_eligibility_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
        RAISE EXCEPTION 'referral_eligibility_immutable_identity' USING ERRCODE = '55000';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status"
       AND NOT (OLD."status" = 'OPEN' AND NEW."status" IN ('ATTACHED', 'CLOSED')) THEN
        RAISE EXCEPTION 'referral_eligibility_invalid_transition' USING ERRCODE = '55000';
    END IF;

    IF NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND (NEW."closedByEventKey" IS DISTINCT FROM OLD."closedByEventKey"
            OR NEW."closedAt" IS DISTINCT FROM OLD."closedAt") THEN
        RAISE EXCEPTION 'referral_eligibility_immutable_closure' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ReferralEligibility_transition_guard"
BEFORE UPDATE OR DELETE ON "ReferralEligibility"
FOR EACH ROW EXECUTE FUNCTION enforce_referral_eligibility_transition();

CREATE FUNCTION enforce_referral_entitlement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'referral_entitlement_immutable' USING ERRCODE = '55000';
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."beneficiaryUserId" IS DISTINCT FROM OLD."beneficiaryUserId"
       OR NEW."relationshipId" IS DISTINCT FROM OLD."relationshipId"
       OR NEW."amountMl" IS DISTINCT FROM OLD."amountMl"
       OR NEW."walletBusinessEventKey" IS DISTINCT FROM OLD."walletBusinessEventKey"
       OR NEW."walletOperationKind" IS DISTINCT FROM OLD."walletOperationKind"
       OR NEW."walletSource" IS DISTINCT FROM OLD."walletSource"
       OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'referral_entitlement_immutable_facts' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ReferralBonusEntitlement_immutable_facts"
BEFORE UPDATE OR DELETE ON "ReferralBonusEntitlement"
FOR EACH ROW EXECUTE FUNCTION enforce_referral_entitlement_mutation();
