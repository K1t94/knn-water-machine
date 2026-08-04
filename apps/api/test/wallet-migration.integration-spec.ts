import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../..');
const apiPrismaDirectory = join(repositoryRoot, 'apps/api/prisma');

function schemaUrl(url: string, schema: string): string {
    const parsed = new URL(url);
    parsed.searchParams.set('schema', schema);
    return parsed.toString();
}

function deployMigrations(url: string, schemaPath: string): void {
    execFileSync('pnpm', ['--filter', '@kaynann/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
        cwd: repositoryRoot,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
}

function createFeatureTwoPrismaDirectory(): string {
    const root = mkdtempSync(join(tmpdir(), 'wallet-feature-two-'));
    const prismaDirectory = join(root, 'prisma');
    const migrationsDirectory = join(prismaDirectory, 'migrations');
    mkdirSync(migrationsDirectory, { recursive: true });
    writeFileSync(join(prismaDirectory, 'schema.prisma'), readFileSync(join(apiPrismaDirectory, 'schema.prisma')));

    for (const migrationName of ['20260722000000_bootstrap_connectivity', '20260728000100_phone_otp_auth']) {
        cpSync(join(apiPrismaDirectory, 'migrations', migrationName), join(migrationsDirectory, migrationName), {
            recursive: true,
        });
    }

    return root;
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message} ${JSON.stringify(error)}`;
    }
    return String(error);
}

async function expectDatabaseError(operation: Promise<unknown>, marker: string): Promise<void> {
    try {
        await operation;
    } catch (error: unknown) {
        expect(errorText(error)).toContain(marker);
        return;
    }
    throw new Error(`Expected database operation to fail with ${marker}`);
}

describePostgres('wallet migration invariants', () => {
    const suffix = randomUUID().replaceAll('-', '');
    const freshSchema = `wallet_fresh_${suffix}`;
    const upgradeSchema = `wallet_upgrade_${suffix}`;
    const ownerId = randomUUID();
    const secondOwnerId = randomUUID();
    const preservedSessionId = randomUUID();
    const originEntryId = randomUUID();
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const fresh = new PrismaClient({ datasourceUrl: schemaUrl(databaseUrl ?? '', freshSchema) });
    const upgrade = new PrismaClient({ datasourceUrl: schemaUrl(databaseUrl ?? '', upgradeSchema) });
    let featureTwoDirectory = '';

    beforeAll(async () => {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${freshSchema}"`);
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${upgradeSchema}"`);

        deployMigrations(schemaUrl(databaseUrl ?? '', freshSchema), join(apiPrismaDirectory, 'schema.prisma'));

        featureTwoDirectory = createFeatureTwoPrismaDirectory();
        deployMigrations(
            schemaUrl(databaseUrl ?? '', upgradeSchema),
            join(featureTwoDirectory, 'prisma/schema.prisma'),
        );

        await upgrade.$executeRawUnsafe(
            `INSERT INTO "User" ("id", "phoneE164", "phoneConfirmedAt", "updatedAt") VALUES ($1::uuid, $2, NOW(), NOW())`,
            ownerId,
            `+22177${suffix.slice(0, 7)}`,
        );
        await upgrade.$executeRawUnsafe(
            `INSERT INTO "User" ("id", "phoneE164", "phoneConfirmedAt", "updatedAt") VALUES ($1::uuid, $2, NOW(), NOW())`,
            secondOwnerId,
            `+22176${suffix.slice(7, 14)}`,
        );
        await upgrade.$executeRawUnsafe(
            `INSERT INTO "UserSession" ("id", "userId", "familyId", "installationFingerprint", "creationKeyDigest", "expiresAt", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NOW() + INTERVAL '1 hour', NOW())`,
            preservedSessionId,
            ownerId,
            randomUUID(),
            suffix.padEnd(64, 'a'),
            suffix.padEnd(64, 'b'),
        );

        deployMigrations(schemaUrl(databaseUrl ?? '', upgradeSchema), join(apiPrismaDirectory, 'schema.prisma'));
    }, 60_000);

    afterAll(async () => {
        await fresh.$disconnect();
        await upgrade.$disconnect();
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`);
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
        await admin.$disconnect();
        if (featureTwoDirectory) {
            rmSync(featureTwoDirectory, { recursive: true, force: true });
        }
    });

    it('applies to a fresh database and upgrades feature-002 data without eager wallets', async () => {
        const freshTables = await fresh.$queryRawUnsafe<Array<{ tableName: string }>>(
            `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('WaterWallet', 'WalletLedgerEntry') ORDER BY table_name`,
            freshSchema,
        );
        expect(freshTables.map(({ tableName }) => tableName)).toEqual(['WalletLedgerEntry', 'WaterWallet']);

        const preserved = await upgrade.$queryRawUnsafe<Array<{ sessionId: string; walletCount: bigint }>>(
            `SELECT s."id" AS "sessionId", (SELECT COUNT(*) FROM "WaterWallet") AS "walletCount" FROM "UserSession" s WHERE s."id" = $1::uuid`,
            preservedSessionId,
        );
        expect(preserved).toEqual([{ sessionId: preservedSessionId, walletCount: 0n }]);
    });

    it('enforces owner foreign keys and non-negative projection balances', async () => {
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WaterWallet" ("userId", "balanceMl", "updatedAt") VALUES ($1::uuid, 0, NOW())`,
                randomUUID(),
            ),
            'WaterWallet_userId_fkey',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WaterWallet" ("userId", "balanceMl", "updatedAt") VALUES ($1::uuid, -1, NOW())`,
                ownerId,
            ),
            'WaterWallet_balance_nonnegative_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WaterWallet" ("userId", "balanceMl", "updatedAt") VALUES ($1::uuid, 9223372036854775808, NOW())`,
                ownerId,
            ),
            'out of range',
        );
    });

    it('enforces positive amounts, bounded classifiers, and global business keys', async () => {
        await upgrade.$executeRawUnsafe(
            `INSERT INTO "WaterWallet" ("userId", "balanceMl", "updatedAt") VALUES ($1::uuid, 1000, NOW()), ($2::uuid, 1000, NOW())`,
            ownerId,
            secondOwnerId,
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:zero', 'CREDIT', 0, 'TEST_CREDIT', 'TEST', 1000, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_amount_positive_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'INVALID', 'CREDIT', 1, 'TEST_CREDIT', 'TEST', 1001, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_business_event_key_format_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:bad-kind', 'CREDIT', 1, 'bad', 'TEST', 1001, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_operation_kind_format_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:bad-source', 'CREDIT', 1, 'TEST_CREDIT', 'bad', 1001, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_source_format_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:negative-result', 'DEBIT', 1, 'TEST_DEBIT', 'TEST', -1, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_balance_after_nonnegative_check',
        );
        await upgrade.$executeRawUnsafe(
            `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:global-key', 'DEBIT', 1, 'TEST_DEBIT', 'TEST', 999, NOW())`,
            originEntryId,
            ownerId,
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:global-key', 'CREDIT', 1, 'TEST_CREDIT', 'TEST', 1001, NOW())`,
                randomUUID(),
                secondOwnerId,
            ),
            '23505',
        );
    });

    it('enforces compensation shape and origin foreign keys', async () => {
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt") VALUES ($1::uuid, $2::uuid, 'test:bad-compensation', 'DEBIT', 1, 'COMPENSATION', 'TEST', 999, NOW())`,
                randomUUID(),
                ownerId,
            ),
            'WalletLedgerEntry_compensation_shape_check',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt", "compensatesEntryId") VALUES ($1::uuid, $2::uuid, 'test:missing-origin', 'CREDIT', 1, 'COMPENSATION', 'TEST', 1001, NOW(), $3::uuid)`,
                randomUUID(),
                ownerId,
                randomUUID(),
            ),
            'WalletLedgerEntry_compensatesEntryId_fkey',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `INSERT INTO "WalletLedgerEntry" ("id", "walletUserId", "businessEventKey", "direction", "amountMl", "operationKind", "source", "balanceAfterMl", "occurredAt", "compensatesEntryId") VALUES ($1::uuid, $2::uuid, 'test:unexpected-origin', 'CREDIT', 1, 'TEST_CREDIT', 'TEST', 1001, NOW(), $3::uuid)`,
                randomUUID(),
                ownerId,
                originEntryId,
            ),
            'WalletLedgerEntry_compensation_shape_check',
        );
    });

    it('derives signed ledger arithmetic solely from direction and positive magnitude', async () => {
        const rows = await upgrade.$queryRawUnsafe<Array<{ signedTotal: bigint }>>(
            `SELECT COALESCE(SUM(CASE "direction" WHEN 'CREDIT' THEN "amountMl" ELSE -"amountMl" END), 0)::bigint AS "signedTotal" FROM "WalletLedgerEntry" WHERE "walletUserId" = $1::uuid`,
            ownerId,
        );
        expect(rows).toEqual([{ signedTotal: -1n }]);
    });

    it('rejects ledger UPDATE and DELETE with a deterministic trigger error', async () => {
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(
                `UPDATE "WalletLedgerEntry" SET "amountMl" = 2 WHERE "id" = $1::uuid`,
                originEntryId,
            ),
            'wallet_ledger_immutable',
        );
        await expectDatabaseError(
            upgrade.$executeRawUnsafe(`DELETE FROM "WalletLedgerEntry" WHERE "id" = $1::uuid`, originEntryId),
            'wallet_ledger_immutable',
        );
    });

    it('creates deterministic pagination and compensation indexes', async () => {
        const indexes = await upgrade.$queryRawUnsafe<Array<{ indexname: string }>>(
            `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'WalletLedgerEntry'`,
            upgradeSchema,
        );
        expect(indexes.map(({ indexname }) => indexname).sort()).toEqual(
            expect.arrayContaining([
                'WalletLedgerEntry_businessEventKey_key',
                'WalletLedgerEntry_compensatesEntryId_idx',
                'WalletLedgerEntry_sequence_key',
                'WalletLedgerEntry_walletUserId_sequence_idx',
            ]),
        );
    });
});
