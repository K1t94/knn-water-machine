CREATE TYPE "ReferralFeatureKey" AS ENUM ('REFERRAL_PROGRAM');

CREATE TABLE "ReferralFeatureState" (
    "key" "ReferralFeatureKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralFeatureState_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "ReferralFeatureState_revision_positive_check" CHECK ("revision" > 0)
);

INSERT INTO "ReferralFeatureState" ("key", "enabled", "revision", "updatedAt")
VALUES ('REFERRAL_PROGRAM', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
