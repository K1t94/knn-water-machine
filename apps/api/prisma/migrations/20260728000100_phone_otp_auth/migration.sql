CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "LegalDocumentKind" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY');
CREATE TYPE "UserSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'REPLAY', 'ADMIN', 'EXPIRED');
CREATE TYPE "RefreshTokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');
CREATE TYPE "SmsProviderKind" AS ENUM ('FAKE', 'ORANGE');
CREATE TYPE "SmsDeliveryStatus" AS ENUM ('PREPARED', 'ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'FAILED');
CREATE TYPE "SmsFailureCategory" AS ENUM (
  'INVALID_CONFIGURATION',
  'AUTHENTICATION_FAILED',
  'BALANCE_EXHAUSTED',
  'PROVIDER_RATE_LIMITED',
  'INVALID_RECIPIENT',
  'MESSAGE_REJECTED',
  'TIMEOUT',
  'TEMPORARY_PROVIDER_FAILURE'
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "phoneE164" VARCHAR(16) NOT NULL,
  "phoneConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_phoneE164_senegal_check" CHECK ("phoneE164" LIKE '+221%')
);

CREATE TABLE "LegalDocument" (
  "id" UUID NOT NULL,
  "kind" "LegalDocumentKind" NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "content" TEXT NOT NULL,
  "contentSha256" CHAR(64) NOT NULL,
  "mandatory" BOOLEAN NOT NULL,
  "isCurrent" BOOLEAN NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "retiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalAcceptance" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "legalDocumentId" UUID NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registrationFlowId" UUID NOT NULL,
  "ipFingerprint" CHAR(64),
  "installationFingerprint" CHAR(64),
  "userAgentFamily" VARCHAR(100),
  CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "installationFingerprint" CHAR(64) NOT NULL,
  "creationKeyDigest" CHAR(64) NOT NULL,
  "status" "UserSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastUsedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReason" "SessionRevokeReason",
  "replayDetectedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionRefreshToken" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "tokenDigest" CHAR(64) NOT NULL,
  "generation" INTEGER NOT NULL,
  "status" "RefreshTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "replacedById" UUID,
  CONSTRAINT "SessionRefreshToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionRefreshToken_generation_nonnegative_check" CHECK ("generation" >= 0)
);

CREATE TABLE "SmsDelivery" (
  "id" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "provider" "SmsProviderKind" NOT NULL,
  "providerMessageId" VARCHAR(255),
  "phoneFingerprint" CHAR(64) NOT NULL,
  "status" "SmsDeliveryStatus" NOT NULL DEFAULT 'PREPARED',
  "failureCategory" "SmsFailureCategory",
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3),
  "lastReceiptAt" TIMESTAMPTZ(3),
  "deliveredAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");
CREATE INDEX "User_status_id_idx" ON "User"("status", "id");
CREATE UNIQUE INDEX "LegalDocument_kind_version_locale_key" ON "LegalDocument"("kind", "version", "locale");
CREATE UNIQUE INDEX "LegalDocument_current_kind_locale_key"
  ON "LegalDocument"("kind", "locale") WHERE "isCurrent" = true;
CREATE INDEX "LegalDocument_mandatory_isCurrent_locale_idx" ON "LegalDocument"("mandatory", "isCurrent", "locale");
CREATE UNIQUE INDEX "LegalAcceptance_userId_legalDocumentId_key" ON "LegalAcceptance"("userId", "legalDocumentId");
CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx" ON "LegalAcceptance"("userId", "acceptedAt" DESC);
CREATE UNIQUE INDEX "UserSession_familyId_key" ON "UserSession"("familyId");
CREATE UNIQUE INDEX "UserSession_creationKeyDigest_key" ON "UserSession"("creationKeyDigest");
CREATE INDEX "UserSession_userId_status_idx" ON "UserSession"("userId", "status");
CREATE INDEX "UserSession_expiresAt_status_idx" ON "UserSession"("expiresAt", "status");
CREATE UNIQUE INDEX "SessionRefreshToken_tokenDigest_key" ON "SessionRefreshToken"("tokenDigest");
CREATE UNIQUE INDEX "SessionRefreshToken_replacedById_key" ON "SessionRefreshToken"("replacedById");
CREATE UNIQUE INDEX "SessionRefreshToken_sessionId_generation_key" ON "SessionRefreshToken"("sessionId", "generation");
CREATE UNIQUE INDEX "SessionRefreshToken_one_active_per_session_key"
  ON "SessionRefreshToken"("sessionId") WHERE "status" = 'ACTIVE';
CREATE INDEX "SessionRefreshToken_expiresAt_status_idx" ON "SessionRefreshToken"("expiresAt", "status");
CREATE UNIQUE INDEX "SmsDelivery_challengeId_key" ON "SmsDelivery"("challengeId");
CREATE UNIQUE INDEX "SmsDelivery_provider_providerMessageId_key"
  ON "SmsDelivery"("provider", "providerMessageId");
CREATE INDEX "SmsDelivery_status_updatedAt_idx" ON "SmsDelivery"("status", "updatedAt");

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_legalDocumentId_fkey"
  FOREIGN KEY ("legalDocumentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionRefreshToken"
  ADD CONSTRAINT "SessionRefreshToken_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionRefreshToken"
  ADD CONSTRAINT "SessionRefreshToken_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "SessionRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
