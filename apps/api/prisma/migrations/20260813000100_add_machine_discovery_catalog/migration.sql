CREATE TYPE "MachinePublicationState" AS ENUM ('PUBLISHED', 'HIDDEN', 'ARCHIVED');
CREATE TYPE "MachineServiceMode" AS ENUM ('NORMAL', 'SERVICE');
CREATE TYPE "MachineEvidenceState" AS ENUM ('READY', 'OFFLINE', 'UNKNOWN');
CREATE TYPE "MachineIdentifierKind" AS ENUM ('CURRENT_MANUAL', 'LEGACY_MANUAL', 'LEGACY_QR');

CREATE TABLE "Machine" (
    "id" UUID NOT NULL,
    "machineId" VARCHAR(22) NOT NULL,
    "displayName" VARCHAR(120),
    "publicationState" "MachinePublicationState" NOT NULL DEFAULT 'HIDDEN',
    "serviceMode" "MachineServiceMode" NOT NULL DEFAULT 'SERVICE',
    "selectionRevision" BIGINT NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Machine_machineId_format_check" CHECK ("machineId" ~ '^[A-Za-z0-9_-]{22}$'),
    CONSTRAINT "Machine_displayName_nonblank_check"
        CHECK ("displayName" IS NULL OR BTRIM("displayName") <> ''),
    CONSTRAINT "Machine_selectionRevision_positive_check" CHECK ("selectionRevision" > 0)
);

CREATE TABLE "MachineLocation" (
    "id" UUID NOT NULL,
    "machineInternalId" UUID NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "serviceAreaCode" VARCHAR(64) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "MachineLocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineLocation_address_nonblank_check" CHECK (BTRIM("address") <> ''),
    CONSTRAINT "MachineLocation_serviceAreaCode_nonblank_check" CHECK (BTRIM("serviceAreaCode") <> ''),
    CONSTRAINT "MachineLocation_coordinate_pair_check"
        CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
    CONSTRAINT "MachineLocation_coordinate_range_check"
        CHECK (("latitude" IS NULL AND "longitude" IS NULL)
            OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
);

CREATE TABLE "MachinePrice" (
    "id" UUID NOT NULL,
    "machineInternalId" UUID NOT NULL,
    "amountPerLiter" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "MachinePrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachinePrice_amount_positive_check" CHECK ("amountPerLiter" > 0),
    CONSTRAINT "MachinePrice_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "MachineIdentifierMapping" (
    "id" UUID NOT NULL,
    "machineInternalId" UUID NOT NULL,
    "kind" "MachineIdentifierKind" NOT NULL,
    "normalizedValue" VARCHAR(256) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineIdentifierMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineIdentifierMapping_normalizedValue_nonblank_check"
        CHECK (BTRIM("normalizedValue") <> '')
);

CREATE TABLE "MachineAvailabilityEvidence" (
    "machineInternalId" UUID NOT NULL,
    "state" "MachineEvidenceState" NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "readyToSell" BOOLEAN NOT NULL,
    "salesAllowed" BOOLEAN NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceRevision" VARCHAR(100),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "MachineAvailabilityEvidence_pkey" PRIMARY KEY ("machineInternalId")
);

CREATE TABLE "MachineCatalogState" (
    "singletonKey" SMALLINT NOT NULL DEFAULT 1,
    "orderingRevision" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineCatalogState_pkey" PRIMARY KEY ("singletonKey"),
    CONSTRAINT "MachineCatalogState_singleton_check" CHECK ("singletonKey" = 1),
    CONSTRAINT "MachineCatalogState_orderingRevision_positive_check" CHECK ("orderingRevision" > 0)
);

CREATE UNIQUE INDEX "Machine_machineId_key" ON "Machine"("machineId");
CREATE INDEX "Machine_publicationState_deletedAt_machineId_idx"
    ON "Machine"("publicationState", "deletedAt", "machineId");
CREATE INDEX "Machine_published_machineId_idx"
    ON "Machine"("machineId")
    WHERE "publicationState" = 'PUBLISHED' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "MachineLocation_machineInternalId_key" ON "MachineLocation"("machineInternalId");
CREATE INDEX "MachineLocation_serviceAreaCode_idx" ON "MachineLocation"("serviceAreaCode");
CREATE INDEX "MachineLocation_latitude_longitude_idx" ON "MachineLocation"("latitude", "longitude");

CREATE UNIQUE INDEX "MachinePrice_machineInternalId_key" ON "MachinePrice"("machineInternalId");

CREATE UNIQUE INDEX "MachineIdentifierMapping_kind_normalizedValue_key"
    ON "MachineIdentifierMapping"("kind", "normalizedValue");
CREATE INDEX "MachineIdentifierMapping_kind_normalizedValue_enabled_idx"
    ON "MachineIdentifierMapping"("kind", "normalizedValue", "enabled");

CREATE INDEX "MachineAvailabilityEvidence_observedAt_idx"
    ON "MachineAvailabilityEvidence"("observedAt");

ALTER TABLE "MachineLocation" ADD CONSTRAINT "MachineLocation_machineInternalId_fkey"
    FOREIGN KEY ("machineInternalId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MachinePrice" ADD CONSTRAINT "MachinePrice_machineInternalId_fkey"
    FOREIGN KEY ("machineInternalId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MachineIdentifierMapping" ADD CONSTRAINT "MachineIdentifierMapping_machineInternalId_fkey"
    FOREIGN KEY ("machineInternalId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MachineAvailabilityEvidence" ADD CONSTRAINT "MachineAvailabilityEvidence_machineInternalId_fkey"
    FOREIGN KEY ("machineInternalId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "MachineCatalogState" ("singletonKey", "orderingRevision", "updatedAt")
VALUES (1, 1, CURRENT_TIMESTAMP);

CREATE FUNCTION reject_machine_id_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."machineId" IS DISTINCT FROM OLD."machineId" THEN
        RAISE EXCEPTION 'Machine_machineId_immutable' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Machine_machineId_immutable"
BEFORE UPDATE OF "machineId" ON "Machine"
FOR EACH ROW EXECUTE FUNCTION reject_machine_id_mutation();

CREATE FUNCTION bump_machine_catalog_ordering_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE "MachineCatalogState"
    SET "orderingRevision" = "orderingRevision" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "singletonKey" = 1;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "Machine_catalog_insert_revision"
AFTER INSERT ON "Machine"
FOR EACH ROW EXECUTE FUNCTION bump_machine_catalog_ordering_revision();

CREATE TRIGGER "Machine_catalog_delete_revision"
AFTER DELETE ON "Machine"
FOR EACH ROW EXECUTE FUNCTION bump_machine_catalog_ordering_revision();

CREATE TRIGGER "Machine_catalog_update_revision"
AFTER UPDATE OF "machineId", "publicationState", "deletedAt" ON "Machine"
FOR EACH ROW
WHEN (OLD."machineId" IS DISTINCT FROM NEW."machineId"
    OR OLD."publicationState" IS DISTINCT FROM NEW."publicationState"
    OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt")
EXECUTE FUNCTION bump_machine_catalog_ordering_revision();

CREATE TRIGGER "MachineLocation_catalog_insert_revision"
AFTER INSERT ON "MachineLocation"
FOR EACH ROW EXECUTE FUNCTION bump_machine_catalog_ordering_revision();

CREATE TRIGGER "MachineLocation_catalog_delete_revision"
AFTER DELETE ON "MachineLocation"
FOR EACH ROW EXECUTE FUNCTION bump_machine_catalog_ordering_revision();

CREATE TRIGGER "MachineLocation_catalog_update_revision"
AFTER UPDATE OF "address", "serviceAreaCode", "latitude", "longitude" ON "MachineLocation"
FOR EACH ROW
WHEN (OLD."address" IS DISTINCT FROM NEW."address"
    OR OLD."serviceAreaCode" IS DISTINCT FROM NEW."serviceAreaCode"
    OR OLD."latitude" IS DISTINCT FROM NEW."latitude"
    OR OLD."longitude" IS DISTINCT FROM NEW."longitude")
EXECUTE FUNCTION bump_machine_catalog_ordering_revision();
