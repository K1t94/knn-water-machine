import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../../..');
const prismaSchema = resolve(repositoryRoot, 'apps/api/prisma/schema.prisma');

function schemaUrl(url: string, schema: string): string {
    const parsed = new URL(url);
    parsed.searchParams.set('schema', schema);
    return parsed.toString();
}

function deployMigrations(url: string): void {
    execFileSync(
        'pnpm',
        ['--filter', '@kaynann/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', prismaSchema],
        {
            cwd: repositoryRoot,
            env: { ...process.env, DATABASE_URL: url },
            stdio: 'pipe',
        },
    );
}

function opaqueMachineId(): string {
    return randomBytes(16).toString('base64url');
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message} ${JSON.stringify(error)}` : String(error);
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

async function insertMachine(prisma: PrismaClient, machineId = opaqueMachineId()): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `INSERT INTO "Machine" ("id", "machineId", "updatedAt") VALUES ($1::uuid, $2, NOW())`,
        id,
        machineId,
    );
    return id;
}

async function insertLocation(prisma: PrismaClient, machineInternalId: string, address: string): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `INSERT INTO "MachineLocation" ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "longitude", "updatedAt")
         VALUES ($1::uuid, $2::uuid, $3, 'DKR-CENTRE', 14.716677, -17.467686, NOW())`,
        id,
        machineInternalId,
        address,
    );
    return id;
}

describePostgres('machine catalog migration invariants', () => {
    const schema = `machine_catalog_${randomUUID().replaceAll('-', '')}`;
    const url = schemaUrl(databaseUrl ?? '', schema);
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const prisma = new PrismaClient({ datasourceUrl: url });

    beforeAll(async () => {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        deployMigrations(url);
    }, 60_000);

    afterAll(async () => {
        await prisma.$disconnect();
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.$disconnect();
    });

    it('accepts only immutable 22-character base64url public machine IDs', async () => {
        const machineId = opaqueMachineId();
        const machineInternalId = await insertMachine(prisma, machineId);

        expect(machineId).toMatch(/^[A-Za-z0-9_-]{22}$/);
        await expectDatabaseError(insertMachine(prisma, 'too-short'), 'Machine_machineId_format_check');
        await expectDatabaseError(insertMachine(prisma, '++++++++++++++++++++++'), 'Machine_machineId_format_check');
        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `UPDATE "Machine" SET "machineId" = $1, "updatedAt" = NOW() WHERE "id" = $2::uuid`,
                opaqueMachineId(),
                machineInternalId,
            ),
            'Machine_machineId_immutable',
        );
    });

    it('rejects current and legacy identifier collisions within their exact kind', async () => {
        const currentMachineId = await insertMachine(prisma);
        const legacyMachineId = await insertMachine(prisma);
        const currentValue = `CURRENT-${randomUUID()}`;
        const legacyValue = `LEGACY-${randomUUID()}`;

        await prisma.$executeRawUnsafe(
            `INSERT INTO "MachineIdentifierMapping" ("id", "machineInternalId", "kind", "normalizedValue")
             VALUES ($1::uuid, $2::uuid, 'CURRENT_MANUAL', $3)`,
            randomUUID(),
            currentMachineId,
            currentValue,
        );
        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `INSERT INTO "MachineIdentifierMapping" ("id", "machineInternalId", "kind", "normalizedValue")
                 VALUES ($1::uuid, $2::uuid, 'CURRENT_MANUAL', $3)`,
                randomUUID(),
                legacyMachineId,
                currentValue,
            ),
            '23505',
        );

        await prisma.$executeRawUnsafe(
            `INSERT INTO "MachineIdentifierMapping" ("id", "machineInternalId", "kind", "normalizedValue")
             VALUES ($1::uuid, $2::uuid, 'LEGACY_MANUAL', $3)`,
            randomUUID(),
            legacyMachineId,
            legacyValue,
        );
        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `INSERT INTO "MachineIdentifierMapping" ("id", "machineInternalId", "kind", "normalizedValue")
                 VALUES ($1::uuid, $2::uuid, 'LEGACY_MANUAL', $3)`,
                randomUUID(),
                currentMachineId,
                legacyValue,
            ),
            '23505',
        );
    });

    it('enforces complete coordinates, explicit service areas, and exact decimal round trips', async () => {
        const machineInternalId = await insertMachine(prisma);

        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `INSERT INTO "MachineLocation" ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "updatedAt")
                 VALUES ($1::uuid, $2::uuid, 'Dakar', 'DKR-CENTRE', 14.716677, NOW())`,
                randomUUID(),
                machineInternalId,
            ),
            'MachineLocation_coordinate_pair_check',
        );
        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `INSERT INTO "MachineLocation" ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "longitude", "updatedAt")
                 VALUES ($1::uuid, $2::uuid, 'Dakar', ' ', 14.716677, -17.467686, NOW())`,
                randomUUID(),
                machineInternalId,
            ),
            'MachineLocation_serviceAreaCode_nonblank_check',
        );
        await expectDatabaseError(
            prisma.$executeRawUnsafe(
                `INSERT INTO "MachineLocation" ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "longitude", "updatedAt")
                 VALUES ($1::uuid, $2::uuid, 'Dakar', 'DKR-CENTRE', 91, -181, NOW())`,
                randomUUID(),
                machineInternalId,
            ),
            'MachineLocation_coordinate_range_check',
        );

        await insertLocation(prisma, machineInternalId, 'Dakar Plateau');
        await prisma.$executeRawUnsafe(
            `INSERT INTO "MachinePrice" ("id", "machineInternalId", "amountPerLiter", "currency", "updatedAt")
             VALUES ($1::uuid, $2::uuid, 12345678901234.123456, 'XOF', NOW())`,
            randomUUID(),
            machineInternalId,
        );

        const [row] = await prisma.$queryRawUnsafe<
            Array<{
                latitude: { toString(): string };
                longitude: { toString(): string };
                amount: { toString(): string };
            }>
        >(
            `SELECT l."latitude", l."longitude", p."amountPerLiter" AS "amount"
             FROM "MachineLocation" l
             JOIN "MachinePrice" p ON p."machineInternalId" = l."machineInternalId"
             WHERE l."machineInternalId" = $1::uuid`,
            machineInternalId,
        );

        expect(row.latitude.toString()).toBe('14.716677');
        expect(row.longitude.toString()).toBe('-17.467686');
        expect(row.amount.toString()).toBe('12345678901234.123456');
    });

    it('serializes ordering revision bumps and rolls them back with catalog changes', async () => {
        const firstMachine = await insertMachine(prisma);
        const secondMachine = await insertMachine(prisma);
        const firstLocation = await insertLocation(prisma, firstMachine, 'First address');
        const secondLocation = await insertLocation(prisma, secondMachine, 'Second address');
        const concurrent = new PrismaClient({ datasourceUrl: url });

        const [{ orderingRevision: before }] = await prisma.$queryRawUnsafe<Array<{ orderingRevision: bigint }>>(
            `SELECT "orderingRevision" FROM "MachineCatalogState" WHERE "singletonKey" = 1`,
        );

        try {
            await Promise.all([
                prisma.$executeRawUnsafe(
                    `UPDATE "MachineLocation" SET "address" = 'First changed', "updatedAt" = NOW() WHERE "id" = $1::uuid`,
                    firstLocation,
                ),
                concurrent.$executeRawUnsafe(
                    `UPDATE "MachineLocation" SET "address" = 'Second changed', "updatedAt" = NOW() WHERE "id" = $1::uuid`,
                    secondLocation,
                ),
            ]);
        } finally {
            await concurrent.$disconnect();
        }

        const [{ orderingRevision: after }] = await prisma.$queryRawUnsafe<Array<{ orderingRevision: bigint }>>(
            `SELECT "orderingRevision" FROM "MachineCatalogState" WHERE "singletonKey" = 1`,
        );
        expect(after).toBe(before + 2n);

        await expect(
            prisma.$transaction(async (transaction) => {
                await transaction.$executeRawUnsafe(
                    `UPDATE "MachineLocation" SET "address" = 'Rolled back', "updatedAt" = NOW() WHERE "id" = $1::uuid`,
                    firstLocation,
                );
                throw new Error('force rollback');
            }),
        ).rejects.toThrow('force rollback');

        const [rolledBack] = await prisma.$queryRawUnsafe<Array<{ orderingRevision: bigint; address: string }>>(
            `SELECT c."orderingRevision", l."address"
             FROM "MachineCatalogState" c
             JOIN "MachineLocation" l ON l."id" = $1::uuid
             WHERE c."singletonKey" = 1`,
            firstLocation,
        );
        expect(rolledBack).toEqual({ orderingRevision: after, address: 'First changed' });
    });
});
