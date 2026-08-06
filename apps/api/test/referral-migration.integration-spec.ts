import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

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

describePostgres('referral migration invariants', () => {
    let fresh: ReferralPostgresSchema;
    let featureTwo: ReferralPostgresSchema;
    let featureFour: ReferralPostgresSchema;
    let featureTwoDirectory = '';
    let featureFourDirectory = '';
    let inviterId = '';
    let inviteeId = '';

    beforeAll(async () => {
        fresh = await createReferralPostgresSchema('migration_fresh');
        featureTwo = await createReferralPostgresSchema('migration_feature2');
        featureFour = await createReferralPostgresSchema('migration_feature4');
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

        inviterId = await insertReferralTestUser(fresh.prisma, '1000003');
        inviteeId = await insertReferralTestUser(fresh.prisma, '1000004');
        await fresh.prisma.referralPromoCode.create({ data: { userId: inviterId, code: '23456789ABCD' } });
        await fresh.prisma.referralEligibility.create({ data: { userId: inviteeId, updatedAt: new Date() } });
    }, 90_000);

    afterAll(async () => {
        await Promise.all([
            disposeReferralPostgresSchema(fresh),
            disposeReferralPostgresSchema(featureTwo),
            disposeReferralPostgresSchema(featureFour),
        ]);
        if (featureTwoDirectory) removeMigrationSubset(featureTwoDirectory);
        if (featureFourDirectory) removeMigrationSubset(featureFourDirectory);
    });

    it('applies to fresh, feature-002, and feature-004 schemas without data backfill', async () => {
        const tables = await fresh.prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
            `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'Referral%' ORDER BY table_name`,
            fresh.name,
        );
        expect(tables.map(({ tableName }) => tableName)).toEqual([
            'ReferralBonusEntitlement',
            'ReferralEligibility',
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

    it('allows only OPEN eligibility transitions', async () => {
        await fresh.prisma.referralEligibility.update({
            where: { userId: inviteeId },
            data: { status: 'ATTACHED' },
        });
        await expectPostgresError(
            fresh.prisma.referralEligibility.update({ where: { userId: inviteeId }, data: { status: 'OPEN' } }),
            'referral_eligibility_invalid_transition',
        );
        await expectPostgresError(
            fresh.prisma.referralEligibility.delete({ where: { userId: inviteeId } }),
            'referral_eligibility_immutable_identity',
        );
    });

    it('reports named constraints and rolls back partial writes', async () => {
        await expectPostgresError(
            fresh.prisma.referralPromoCode.create({ data: { userId: inviteeId, code: 'INVALID_CODE' } }),
            'ReferralPromoCode_code_format_check',
        );
        await expectPostgresError(
            fresh.prisma.$transaction(async (transaction) => {
                const userId = await insertReferralTestUser(transaction, '1000005');
                await transaction.referralPromoCode.create({ data: { userId, code: '3456789ABCDE' } });
                await transaction.referralEligibility.create({
                    data: { userId, status: 'CLOSED', updatedAt: new Date() },
                });
            }),
            'ReferralEligibility_closed_shape_check',
        );
        expect(await fresh.prisma.referralPromoCode.count({ where: { code: '3456789ABCDE' } })).toBe(0);
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
