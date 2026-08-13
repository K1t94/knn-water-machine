import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaMachineRepository } from '../../src/machines/infrastructure/postgres/prisma-machine.repository';

import type { MachineCoordinates, MachineId } from '../../src/machines/domain/machine.types';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../../..');
const prismaSchema = resolve(repositoryRoot, 'apps/api/prisma/schema.prisma');

const FIRST_MACHINE_ID = 'AAAAAAAAAAAAAAAAAAAAAA' as MachineId;
const SECOND_MACHINE_ID = 'BBBBBBBBBBBBBBBBBBBBBB' as MachineId;
const THIRD_MACHINE_ID = 'CCCCCCCCCCCCCCCCCCCCCC' as MachineId;
const OTHER_AREA_MACHINE_ID = 'DDDDDDDDDDDDDDDDDDDDDD' as MachineId;
const MISSING_COORDINATES_ID = 'EEEEEEEEEEEEEEEEEEEEEE' as MachineId;
const INVALID_COORDINATES_ID = 'FFFFFFFFFFFFFFFFFFFFFF' as MachineId;
const CASE_SENSITIVE_MACHINE_ID = 'GGGGGGGGGGGGGGGGGGGGGG' as MachineId;
const REQUEST_POSITION_MACHINE_ID = 'HHHHHHHHHHHHHHHHHHHHHH' as MachineId;

interface CatalogMachineInput {
    readonly machineId: MachineId;
    readonly serviceAreaCode?: string;
    readonly latitude?: number | null;
    readonly longitude?: number | null;
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

async function insertCatalogMachine(prisma: PrismaClient, input: CatalogMachineInput): Promise<void> {
    const internalId = randomUUID();

    await prisma.$executeRawUnsafe(
        `INSERT INTO "Machine" ("id", "machineId", "displayName", "publicationState", "updatedAt")
         VALUES ($1::uuid, $2, $3, 'PUBLISHED', NOW())`,
        internalId,
        input.machineId,
        `Machine ${input.machineId}`,
    );
    await prisma.$executeRawUnsafe(
        `INSERT INTO "MachineLocation"
            ("id", "machineInternalId", "address", "serviceAreaCode", "latitude", "longitude", "updatedAt")
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, NOW())`,
        randomUUID(),
        internalId,
        `Address ${input.machineId}`,
        input.serviceAreaCode ?? 'DKR-CENTRE',
        input.latitude === undefined ? 14.716677 : input.latitude,
        input.longitude === undefined ? -17.467686 : input.longitude,
    );
}

describePostgres('PrismaMachineRepository', () => {
    const schema = `prisma_machine_repository_${randomUUID().replaceAll('-', '')}`;
    const url = schemaUrl(databaseUrl ?? '', schema);
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const prisma = new PrismaClient({ datasourceUrl: url });
    const repository = new PrismaMachineRepository(prisma);

    beforeAll(async () => {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        deployMigrations(url);

        // Reads must fail closed for malformed legacy rows created before current constraints.
        await prisma.$executeRawUnsafe(
            `ALTER TABLE "MachineLocation"
             DROP CONSTRAINT "MachineLocation_coordinate_pair_check",
             DROP CONSTRAINT "MachineLocation_coordinate_range_check"`,
        );
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

    it('returns only valid coordinates in service-area machineId order and honors the page limit', async () => {
        await Promise.all([
            insertCatalogMachine(prisma, { machineId: THIRD_MACHINE_ID }),
            insertCatalogMachine(prisma, { machineId: FIRST_MACHINE_ID }),
            insertCatalogMachine(prisma, { machineId: SECOND_MACHINE_ID }),
            insertCatalogMachine(prisma, {
                machineId: OTHER_AREA_MACHINE_ID,
                serviceAreaCode: 'THIES-CENTRE',
            }),
            insertCatalogMachine(prisma, {
                machineId: MISSING_COORDINATES_ID,
                latitude: null,
                longitude: null,
            }),
            insertCatalogMachine(prisma, {
                machineId: INVALID_COORDINATES_ID,
                latitude: 91,
            }),
        ]);

        const page = await repository.findByServiceArea({
            serviceAreaCode: 'DKR-CENTRE',
            viewport: null,
            afterMachineId: null,
            limit: 2,
        });

        expect(page.items.map(({ machineId }) => machineId)).toEqual([FIRST_MACHINE_ID, SECOND_MACHINE_ID]);
        expect(page.items).toHaveLength(2);
        expect(page.hasMore).toBe(true);
    });

    it('uses a machineId keyset without duplicates or omissions across service-area pages', async () => {
        await Promise.all(
            [THIRD_MACHINE_ID, FIRST_MACHINE_ID, SECOND_MACHINE_ID].map((machineId) =>
                insertCatalogMachine(prisma, { machineId }),
            ),
        );

        const firstPage = await repository.findByServiceArea({
            serviceAreaCode: 'DKR-CENTRE',
            viewport: null,
            afterMachineId: null,
            limit: 2,
        });
        const secondPage = await repository.findByServiceArea({
            serviceAreaCode: 'DKR-CENTRE',
            viewport: null,
            afterMachineId: firstPage.items.at(-1)?.machineId ?? null,
            limit: 2,
        });
        const machineIds = [...firstPage.items, ...secondPage.items].map(({ machineId }) => machineId);

        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.hasMore).toBe(false);
        expect(machineIds).toEqual([FIRST_MACHINE_ID, SECOND_MACHINE_ID, THIRD_MACHINE_ID]);
        expect(new Set(machineIds).size).toBe(machineIds.length);
    });

    it('looks up public details by the exact public machineId', async () => {
        await insertCatalogMachine(prisma, { machineId: CASE_SENSITIVE_MACHINE_ID });

        const exact = await repository.findPublicByMachineId(CASE_SENSITIVE_MACHINE_ID);
        const differentCase = await repository.findPublicByMachineId(CASE_SENSITIVE_MACHINE_ID.toLowerCase());

        expect(exact?.machineId).toBe(CASE_SENSITIVE_MACHINE_ID);
        expect(differentCase).toBeNull();
    });

    it('never writes request-scoped coordinates to machine storage', async () => {
        const storedCoordinates: MachineCoordinates = { latitude: 14.716677, longitude: -17.467686 };
        const requestCoordinates: MachineCoordinates = { latitude: 14.764504, longitude: -17.366029 };
        await insertCatalogMachine(prisma, {
            machineId: REQUEST_POSITION_MACHINE_ID,
            latitude: storedCoordinates.latitude,
            longitude: storedCoordinates.longitude,
        });

        await repository.findLocated({
            position: requestCoordinates,
            viewport: null,
            after: null,
            limit: 20,
        });

        const [location] = await prisma.$queryRaw<
            Array<{ latitude: { toNumber(): number }; longitude: { toNumber(): number } }>
        >`SELECT l."latitude", l."longitude"
          FROM "MachineLocation" l
          JOIN "Machine" m ON m."id" = l."machineInternalId"
          WHERE m."machineId" = ${REQUEST_POSITION_MACHINE_ID}`;

        expect(location.latitude.toNumber()).toBe(storedCoordinates.latitude);
        expect(location.longitude.toNumber()).toBe(storedCoordinates.longitude);
    });
});
