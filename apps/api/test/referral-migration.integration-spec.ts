import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    createMigrationSubset,
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    expectPostgresError,
    insertReferralTestUser,
    referralPostgresEnabled,
    removeMigrationSubset,
} from './referral-postgres.fixture';

import type { ReferralPostgresSchema } from './referral-postgres.fixture';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;
const featureTwoMigrations = ['20260722000000_bootstrap_connectivity', '20260728000100_phone_otp_auth'];
const featureFourMigrations = [...featureTwoMigrations, '20260804000100_water_wallet_ledger'];
const referralMigration = '20260806000100_add_referral_program';
const preFeatureStateMigrations = [...featureFourMigrations, referralMigration];
const featureStateMigration = '20260812000100_add_referral_feature_state';
const preContractMigrations = [...preFeatureStateMigrations, featureStateMigration];

interface PreservedRowCounts {
    readonly bonusEntitlements: number;
    readonly ledgerEntries: number;
    readonly promoCodes: number;
    readonly relationships: number;
    readonly users: number;
    readonly wallets: number;
}

async function readPreservedRowCounts(prisma: PrismaClient): Promise<PreservedRowCounts> {
    const [bonusEntitlements, ledgerEntries, promoCodes, relationships, users, wallets] = await Promise.all([
        prisma.referralBonusEntitlement.count(),
        prisma.walletLedgerEntry.count(),
        prisma.referralPromoCode.count(),
        prisma.referralRelationship.count(),
        prisma.user.count(),
        prisma.waterWallet.count(),
    ]);

    return { bonusEntitlements, ledgerEntries, promoCodes, relationships, users, wallets };
}

describePostgres('referral migration invariants', () => {
    let fresh: ReferralPostgresSchema;
    let featureTwo: ReferralPostgresSchema;
    let featureFour: ReferralPostgresSchema;
    let referralUpgrade: ReferralPostgresSchema;
    let featureTwoDirectory = '';
    let featureFourDirectory = '';
    let referralUpgradeDirectory = '';
    let inviterId = '';
    let inviteeId = '';
    let preservedInviterId = '';
    let preservedInviteeId = '';
    let preservedRelationshipId = '';
    let preservedEntitlementId = '';
    let preservedRowCounts: PreservedRowCounts;
    let preservedEligibilityCount = 0n;

    beforeAll(async () => {
        fresh = await createReferralPostgresSchema('migration_fresh');
        featureTwo = await createReferralPostgresSchema('migration_feature2');
        featureFour = await createReferralPostgresSchema('migration_feature4');
        referralUpgrade = await createReferralPostgresSchema('migration_referral_upgrade');
        fresh.deploy();

        featureTwoDirectory = createMigrationSubset('feature2', featureTwoMigrations);
        featureTwo.deploy(join(featureTwoDirectory, 'prisma/schema.prisma'));
        const preservedFeatureTwoUser = await insertReferralTestUser(featureTwo.prisma, '1000001');
        await featureTwo.prisma.$executeRawUnsafe(
            `INSERT INTO "UserSession" ("id", "userId", "familyId", "installationFingerprint", "creationKeyDigest", "expiresAt", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NOW() + INTERVAL '1 hour', NOW())`,
            randomUUID(),
            preservedFeatureTwoUser,
            randomUUID(),
            'a'.repeat(64),
            'b'.repeat(64),
        );
        featureTwo.deploy();

        featureFourDirectory = createMigrationSubset('feature4', featureFourMigrations);
        featureFour.deploy(join(featureFourDirectory, 'prisma/schema.prisma'));
        const preservedFeatureFourUser = await insertReferralTestUser(featureFour.prisma, '1000002');
        await featureFour.prisma.waterWallet.create({ data: { userId: preservedFeatureFourUser } });
        featureFour.deploy();

        referralUpgradeDirectory = createMigrationSubset('referral-upgrade', preContractMigrations);
        referralUpgrade.deploy(join(referralUpgradeDirectory, 'prisma/schema.prisma'));
        preservedInviterId = await insertReferralTestUser(referralUpgrade.prisma, '1000006');
        preservedInviteeId = await insertReferralTestUser(referralUpgrade.prisma, '1000007');
        await referralUpgrade.prisma.waterWallet.create({ data: { userId: preservedInviterId, balanceMl: 100n } });
        await referralUpgrade.prisma.walletLedgerEntry.create({
            data: {
                walletUserId: preservedInviterId,
                businessEventKey: `migration-preserved:${randomUUID()}`,
                direction: 'CREDIT',
                amountMl: 100n,
                operationKind: 'MIGRATION_PRESERVATION_TEST',
                source: 'TEST',
                balanceAfterMl: 100n,
                occurredAt: new Date('2026-08-12T00:00:00.000Z'),
            },
        });
        await referralUpgrade.prisma.referralPromoCode.create({
            data: { userId: preservedInviterId, code: '3456789ABCDE' },
        });
        await referralUpgrade.prisma.$executeRawUnsafe(
            `INSERT INTO "ReferralEligibility" ("userId", "updatedAt") VALUES ($1::uuid, NOW())`,
            preservedInviteeId,
        );
        const preservedRelationship = await referralUpgrade.prisma.referralRelationship.create({
            data: {
                inviterUserId: preservedInviterId,
                inviteeUserId: preservedInviteeId,
                channel: 'REGISTRATION',
            },
        });
        preservedRelationshipId = preservedRelationship.id;
        preservedEntitlementId = randomUUID();
        await referralUpgrade.prisma.referralBonusEntitlement.create({
            data: {
                id: preservedEntitlementId,
                kind: 'INVITER',
                beneficiaryUserId: preservedInviterId,
                relationshipId: preservedRelationship.id,
                amountMl: 5_000n,
                walletBusinessEventKey: `referral_bonus:${preservedEntitlementId}`,
                walletOperationKind: 'REFERRAL_INVITER_BONUS',
                walletSource: 'REFERRAL_PROGRAM',
                occurredAt: new Date('2026-08-12T00:00:00.000Z'),
                nextAttemptAt: new Date('2026-08-12T00:00:00.000Z'),
            },
        });
        preservedRowCounts = await readPreservedRowCounts(referralUpgrade.prisma);
        [{ count: preservedEligibilityCount }] = await referralUpgrade.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count FROM "ReferralEligibility"`,
        );
        referralUpgrade.deploy();

        inviterId = await insertReferralTestUser(fresh.prisma, '1000003');
        inviteeId = await insertReferralTestUser(fresh.prisma, '1000004');
        await fresh.prisma.referralPromoCode.create({ data: { userId: inviterId, code: '23456789ABCD' } });
    }, 90_000);

    afterAll(async () => {
        await Promise.all([
            disposeReferralPostgresSchema(fresh),
            disposeReferralPostgresSchema(featureTwo),
            disposeReferralPostgresSchema(featureFour),
            disposeReferralPostgresSchema(referralUpgrade),
        ]);
        if (featureTwoDirectory) removeMigrationSubset(featureTwoDirectory);
        if (featureFourDirectory) removeMigrationSubset(featureFourDirectory);
        if (referralUpgradeDirectory) removeMigrationSubset(referralUpgradeDirectory);
    });

    it('applies to fresh, feature-002, and feature-004 schemas without data backfill', async () => {
        const tables = await fresh.prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
            `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'Referral%' ORDER BY table_name`,
            fresh.name,
        );
        expect(tables.map(({ tableName }) => tableName)).toEqual([
            'ReferralBonusEntitlement',
            'ReferralFeatureState',
            'ReferralPromoCode',
            'ReferralRelationship',
        ]);
        expect(await featureTwo.prisma.user.count()).toBe(1);
        expect(await featureTwo.prisma.userSession.count()).toBe(1);
        expect(await featureFour.prisma.user.count()).toBe(1);
        expect(await featureFour.prisma.waterWallet.count()).toBe(1);
        expect(await featureFour.prisma.referralPromoCode.count()).toBe(0);
        expect(await featureFour.prisma.referralBonusEntitlement.count()).toBe(0);
    });

    it('contracts eligibility without changing users, referral facts, wallets, or ledger rows', async () => {
        expect(preservedEligibilityCount).toBe(1n);
        expect(await readPreservedRowCounts(referralUpgrade.prisma)).toEqual(preservedRowCounts);
        expect(await referralUpgrade.prisma.referralFeatureState.findMany()).toEqual([
            expect.objectContaining({ key: 'REFERRAL_PROGRAM', enabled: true, revision: 1n }),
        ]);
        await expect(
            referralUpgrade.prisma.user.findMany({ where: { id: { in: [preservedInviterId, preservedInviteeId] } } }),
        ).resolves.toHaveLength(2);
        await expect(
            referralUpgrade.prisma.referralRelationship.findUniqueOrThrow({ where: { id: preservedRelationshipId } }),
        ).resolves.toMatchObject({ inviterUserId: preservedInviterId, inviteeUserId: preservedInviteeId });
        await expect(
            referralUpgrade.prisma.referralBonusEntitlement.findUniqueOrThrow({
                where: { id: preservedEntitlementId },
            }),
        ).resolves.toMatchObject({ beneficiaryUserId: preservedInviterId, relationshipId: preservedRelationshipId });
    });

    it('removes eligibility storage and its generated Prisma client delegate', async () => {
        const tables = await referralUpgrade.prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
            `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ReferralEligibility'`,
            referralUpgrade.name,
        );
        const databaseObjects = await referralUpgrade.prisma.$queryRawUnsafe<Array<{ name: string }>>(
            `SELECT typname AS name FROM pg_type JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace WHERE pg_namespace.nspname = $1 AND typname = 'ReferralEligibilityStatus'
             UNION ALL
             SELECT proname AS name FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE pg_namespace.nspname = $1 AND proname = 'enforce_referral_eligibility_transition'`,
            referralUpgrade.name,
        );

        expect(tables).toEqual([]);
        expect(databaseObjects).toEqual([]);
        expect('referralEligibility' in referralUpgrade.prisma).toBe(false);
    });

    it('keeps the seed idempotent and enforces a positive revision', async () => {
        await referralUpgrade.prisma.$executeRawUnsafe(`
            INSERT INTO "ReferralFeatureState" ("key", "enabled", "revision", "updatedAt")
            VALUES ('REFERRAL_PROGRAM', true, 1, CURRENT_TIMESTAMP)
            ON CONFLICT ("key") DO NOTHING
        `);
        expect(await referralUpgrade.prisma.referralFeatureState.count()).toBe(1);
        await expectPostgresError(
            referralUpgrade.prisma.referralFeatureState.update({
                where: { key: 'REFERRAL_PROGRAM' },
                data: { revision: 0n },
            }),
            'ReferralFeatureState_revision_positive_check',
        );
    });

    it('retains an authoritative state change across a new Prisma connection', async () => {
        await referralUpgrade.prisma.referralFeatureState.update({
            where: { key: 'REFERRAL_PROGRAM' },
            data: { enabled: false, revision: 2n },
        });

        const restartedClient = new PrismaClient({ datasourceUrl: referralUpgrade.url });
        try {
            await restartedClient.$connect();
            await expect(
                restartedClient.referralFeatureState.findUniqueOrThrow({ where: { key: 'REFERRAL_PROGRAM' } }),
            ).resolves.toEqual(expect.objectContaining({ enabled: false, revision: 2n }));
        } finally {
            await restartedClient.$disconnect();
        }
    });

    it('assigns appliedAt and monotonic sequence in PostgreSQL', async () => {
        const relationshipId = randomUUID();
        await fresh.prisma.$executeRawUnsafe(
            `INSERT INTO "ReferralRelationship" ("id", "inviterUserId", "inviteeUserId", "channel") VALUES ($1::uuid, $2::uuid, $3::uuid, 'POST_REGISTRATION')`,
            relationshipId,
            inviterId,
            inviteeId,
        );
        const relationship = await fresh.prisma.referralRelationship.findUniqueOrThrow({
            where: { id: relationshipId },
        });
        expect(relationship.appliedAt).toBeInstanceOf(Date);
        expect(relationship.sequence).toBeGreaterThan(0n);
    });

    it('rejects promo and relationship updates and deletes', async () => {
        const relationship = await fresh.prisma.referralRelationship.findUniqueOrThrow({
            where: { inviteeUserId: inviteeId },
        });
        await expectPostgresError(
            fresh.prisma.referralPromoCode.update({ where: { userId: inviterId }, data: { code: '3456789ABCDE' } }),
            'referral_immutable',
        );
        await expectPostgresError(
            fresh.prisma.referralPromoCode.delete({ where: { userId: inviterId } }),
            'referral_immutable',
        );
        await expectPostgresError(
            fresh.prisma.referralRelationship.update({
                where: { id: relationship.id },
                data: { channel: 'REGISTRATION' },
            }),
            'referral_immutable',
        );
        await expectPostgresError(
            fresh.prisma.referralRelationship.delete({ where: { id: relationship.id } }),
            'referral_immutable',
        );
    });

    it('allows delivery metadata changes but rejects entitlement fact mutation and delete', async () => {
        const entitlementId = randomUUID();
        await fresh.prisma.referralBonusEntitlement.create({
            data: {
                id: entitlementId,
                kind: 'WELCOME',
                beneficiaryUserId: inviteeId,
                amountMl: 10_000n,
                walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                walletOperationKind: 'REFERRAL_WELCOME_BONUS',
                walletSource: 'REFERRAL_PROGRAM',
                occurredAt: new Date(),
                nextAttemptAt: new Date(),
            },
        });
        const leaseOwner = randomUUID();
        await fresh.prisma.referralBonusEntitlement.update({
            where: { id: entitlementId },
            data: { status: 'PROCESSING', leaseOwner, leaseExpiresAt: new Date(Date.now() + 30_000), attemptCount: 1 },
        });
        await fresh.prisma.referralBonusEntitlement.update({
            where: { id: entitlementId },
            data: { status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date() },
        });
        await expectPostgresError(
            fresh.prisma.referralBonusEntitlement.update({ where: { id: entitlementId }, data: { amountMl: 5_000n } }),
            'referral_entitlement_immutable_facts',
        );
        await expectPostgresError(
            fresh.prisma.referralBonusEntitlement.delete({ where: { id: entitlementId } }),
            'referral_entitlement_immutable',
        );
    });

    it('reports named constraints and rolls back partial writes', async () => {
        await expectPostgresError(
            fresh.prisma.referralPromoCode.create({ data: { userId: inviteeId, code: 'INVALID_CODE' } }),
            'ReferralPromoCode_code_format_check',
        );
        const userCountBefore = await fresh.prisma.user.count();
        await expectPostgresError(
            fresh.prisma.$transaction(async (transaction) => {
                const userId = await insertReferralTestUser(transaction, '1000005');
                await transaction.referralPromoCode.create({ data: { userId, code: '3456789ABCDE' } });
                await transaction.referralRelationship.create({
                    data: { inviterUserId: userId, inviteeUserId: userId, channel: 'REGISTRATION' },
                });
            }),
            'ReferralRelationship_no_self_referral_check',
        );
        expect(await fresh.prisma.referralPromoCode.count({ where: { code: '3456789ABCDE' } })).toBe(0);
        expect(await fresh.prisma.user.count()).toBe(userCountBefore);
    });

    it('rolls back all referral DDL when the migration fails', async () => {
        const failedMigration = await createReferralPostgresSchema('migration_failure');
        const failedMigrationDirectory = createMigrationSubset('failed', [...featureFourMigrations, referralMigration]);
        appendFileSync(
            join(failedMigrationDirectory, 'prisma/migrations', referralMigration, 'migration.sql'),
            '\nSELECT referral_intentional_migration_failure();\n',
        );

        try {
            expect(() => failedMigration.deploy(join(failedMigrationDirectory, 'prisma/schema.prisma'))).toThrow();
            const referralTables = await failedMigration.prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
                `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'Referral%'`,
                failedMigration.name,
            );
            expect(referralTables).toEqual([]);
        } finally {
            removeMigrationSubset(failedMigrationDirectory);
            await disposeReferralPostgresSchema(failedMigration);
        }
    });

    it('creates the expected history, welcome, and recovery indexes', async () => {
        const indexes = await fresh.prisma.$queryRawUnsafe<Array<{ indexName: string }>>(
            `SELECT indexname AS "indexName" FROM pg_indexes WHERE schemaname = $1 AND tablename IN ('ReferralRelationship', 'ReferralBonusEntitlement')`,
            fresh.name,
        );
        expect(indexes.map(({ indexName }) => indexName)).toEqual(
            expect.arrayContaining([
                'ReferralRelationship_inviterUserId_sequence_idx',
                'ReferralBonusEntitlement_one_welcome_per_user_key',
                'ReferralBonusEntitlement_status_nextAttemptAt_idx',
            ]),
        );
    });
});
