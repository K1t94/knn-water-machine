import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaMachineRepository } from '../../src/machines/infrastructure/postgres/prisma-machine.repository';

import type { ServiceAreaMachineCatalogQuery } from '../../src/machines/application/ports/machine.repository';
import type { CatalogRevision, MachineId } from '../../src/machines/domain/machine.types';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../../..');
const prismaSchema = resolve(repositoryRoot, 'apps/api/prisma/schema.prisma');

const FIRST_MACHINE_ID = 'AAAAAAAAAAAAAAAAAAAAAA' as MachineId;
const INSERTED_MACHINE_ID = 'BBBBBBBBBBBBBBBBBBBBBB' as MachineId;
const SECOND_MACHINE_ID = 'CCCCCCCCCCCCCCCCCCCCCC' as MachineId;
const THIRD_MACHINE_ID = 'DDDDDDDDDDDDDDDDDDDDDD' as MachineId;

interface RevisionBoundServiceAreaQuery extends ServiceAreaMachineCatalogQuery {
    readonly catalogRevision: CatalogRevision;
}

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

async function insertCatalogMachine(prisma: PrismaClient, machineId: MachineId): Promise<string> {
    const internalId = randomUUID();

    await prisma.$executeRawUnsafe(
        `INSERT INTO "Machine" ("id", "machineId", "displayName", "publicationState", "updatedAt")
         VALUES ($1::uuid, $2, $3, 'PUBLISHED', NOW())`,
        internalId,
        machineId,
        `Machine ${machineId}`,
    );
    await prisma.$executeRawUnsafe(
        `INSERT INTO "MachineLocation"
            ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "longitude", "updatedAt")
         VALUES ($1::uuid, $2::uuid, $3, 'DKR-CENTRE', 14.716677, -17.467686, NOW())`,
        randomUUID(),
        internalId,
        `Address ${machineId}`,
    );

    return internalId;
}

async function orderingRevision(prisma: PrismaClient): Promise<bigint> {
    const state = await prisma.machineCatalogState.findUniqueOrThrow({
        where: { singletonKey: 1 },
        select: { orderingRevision: true },
    });
    return state.orderingRevision;
}

describePostgres('machine catalog ordering revision', () => {
    const schema = `machine_catalog_revision_${randomUUID().replaceAll('-', '')}`;
    const url = schemaUrl(databaseUrl ?? '', schema);
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const prisma = new PrismaClient({ datasourceUrl: url });
    const repository = new PrismaMachineRepository(prisma);

    beforeAll(async () => {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        deployMigrations(url);
    }, 60_000);

    beforeEach(async () => {
        await prisma.$executeRawUnsafe(
            `TRUNCATE TABLE "MachineAvailabilityEvidence", "MachineIdentifierMapping", "MachinePrice",
             "MachineLocation", "Machine" CASCADE`,
        );
    });

    afterAll(async () => {
        await prisma.$disconnect();
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.$disconnect();
    });

    it('increments once for each ordering-relevant catalog change', async () => {
        const machineInternalId = await insertCatalogMachine(prisma, FIRST_MACHINE_ID);
        const before = await orderingRevision(prisma);

        await prisma.$executeRawUnsafe(
            `UPDATE "Machine"
             SET "publicationState" = 'HIDDEN', "updatedAt" = NOW()
             WHERE "id" = $1::uuid`,
            machineInternalId,
        );
        expect(await orderingRevision(prisma)).toBe(before + 1n);

        await prisma.$executeRawUnsafe(
            `UPDATE "MachineLocation"
             SET "address" = 'Changed address', "latitude" = 14.72, "updatedAt" = NOW()
             WHERE "machineInternalId" = $1::uuid`,
            machineInternalId,
        );
        expect(await orderingRevision(prisma)).toBe(before + 2n);
    });

    it('rejects a stale next-page revision instead of silently omitting newly ordered machines', async () => {
        for (const machineId of [FIRST_MACHINE_ID, SECOND_MACHINE_ID, THIRD_MACHINE_ID]) {
            await insertCatalogMachine(prisma, machineId);
        }

        const catalogRevision = await repository.getCatalogRevision();
        const firstPage = await repository.findByServiceArea({
            catalogRevision,
            serviceAreaCode: 'DKR-CENTRE',
            viewport: null,
            afterMachineId: null,
            limit: 2,
        } satisfies RevisionBoundServiceAreaQuery);
        expect(firstPage.items.map(({ machineId }) => machineId)).toEqual([FIRST_MACHINE_ID, SECOND_MACHINE_ID]);
        expect(firstPage.hasMore).toBe(true);

        await insertCatalogMachine(prisma, INSERTED_MACHINE_ID);
        expect(BigInt(await repository.getCatalogRevision())).toBeGreaterThan(BigInt(catalogRevision));

        await expect(
            repository.findByServiceArea({
                catalogRevision,
                serviceAreaCode: 'DKR-CENTRE',
                viewport: null,
                afterMachineId: SECOND_MACHINE_ID,
                limit: 2,
            } satisfies RevisionBoundServiceAreaQuery),
        ).rejects.toThrow();
    });
});
