import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDistanceRepository } from '../../src/machines/infrastructure/postgres/postgres-distance.repository';

import type { MachineCoordinates, MachineId, MachineViewport } from '../../src/machines/domain/machine.types';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../../..');
const prismaSchema = resolve(repositoryRoot, 'apps/api/prisma/schema.prisma');

const ORIGIN_MACHINE_ID = 'AAAAAAAAAAAAAAAAAAAAAA' as MachineId;
const FAR_MACHINE_ID = 'BBBBBBBBBBBBBBBBBBBBBB' as MachineId;
const INSIDE_MACHINE_ID = 'CCCCCCCCCCCCCCCCCCCCCC' as MachineId;
const OUTSIDE_MACHINE_ID = 'DDDDDDDDDDDDDDDDDDDDDD' as MachineId;
const MISSING_MACHINE_ID = 'EEEEEEEEEEEEEEEEEEEEEE' as MachineId;
const INVALID_MACHINE_ID = 'FFFFFFFFFFFFFFFFFFFFFF' as MachineId;
const TIE_FIRST_MACHINE_ID = 'GGGGGGGGGGGGGGGGGGGGGG' as MachineId;
const TIE_SECOND_MACHINE_ID = 'HHHHHHHHHHHHHHHHHHHHHH' as MachineId;

interface CapturedQuery {
    readonly query: string;
    readonly params: string;
}

interface CatalogMachineInput {
    readonly machineId: MachineId;
    readonly latitude: number | null;
    readonly longitude: number | null;
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
         VALUES ($1::uuid, $2::uuid, $3, 'DKR-CENTRE', $4, $5, NOW())`,
        randomUUID(),
        internalId,
        `Address ${input.machineId}`,
        input.latitude,
        input.longitude,
    );
}

describePostgres('PostgresDistanceRepository', () => {
    const schema = `machine_distance_${randomUUID().replaceAll('-', '')}`;
    const url = schemaUrl(databaseUrl ?? '', schema);
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const prisma = new PrismaClient({
        datasourceUrl: url,
        log: [{ emit: 'event', level: 'query' }],
    });
    const capturedQueries: CapturedQuery[] = [];
    const repository = new PostgresDistanceRepository(prisma);

    beforeAll(async () => {
        prisma.$on('query', ({ query, params }) => capturedQueries.push({ query, params }));
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        deployMigrations(url);

        // Legacy invalid rows can predate the current database constraints. Reads must still fail closed.
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
        capturedQueries.length = 0;
    });

    afterAll(async () => {
        await prisma.$disconnect();
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.$disconnect();
    });

    it('uses parameterized Haversine distance with latitude bound before longitude', async () => {
        const position: MachineCoordinates = { latitude: 14.716677, longitude: -17.467686 };
        await insertCatalogMachine(prisma, {
            machineId: ORIGIN_MACHINE_ID,
            latitude: position.latitude,
            longitude: position.longitude,
        });
        await insertCatalogMachine(prisma, {
            machineId: FAR_MACHINE_ID,
            latitude: 14.764504,
            longitude: -17.366029,
        });

        const page = await repository.findLocated({ position, viewport: null, after: null, limit: 10 });

        expect(page.items.map(({ machineId }) => machineId)).toEqual([ORIGIN_MACHINE_ID, FAR_MACHINE_ID]);
        expect(page.items[0]?.distanceMeters).toBeCloseTo(0, 6);
        expect(page.items[1]?.distanceMeters).toBeGreaterThan(0);

        const distanceQuery = capturedQueries.find(({ query }) => /(?:ACOS|ASIN).*RADIANS/is.test(query));
        expect(distanceQuery).toBeDefined();
        expect(distanceQuery?.query).not.toContain(String(position.latitude));
        expect(distanceQuery?.query).not.toContain(String(position.longitude));
        expect(distanceQuery?.params).toContain(String(position.latitude));
        expect(distanceQuery?.params).toContain(String(position.longitude));

        const parameters = JSON.parse(distanceQuery?.params ?? '[]') as unknown[];
        expect(parameters.indexOf(position.latitude)).toBeLessThan(parameters.indexOf(position.longitude));
    });

    it('applies the viewport and excludes missing or invalid coordinates from the shared map/list catalog', async () => {
        const position: MachineCoordinates = { latitude: 14.716677, longitude: -17.467686 };
        const viewport: MachineViewport = {
            north: 14.75,
            east: -17.42,
            south: 14.68,
            west: -17.51,
        };

        await Promise.all([
            insertCatalogMachine(prisma, {
                machineId: INSIDE_MACHINE_ID,
                latitude: 14.72,
                longitude: -17.46,
            }),
            insertCatalogMachine(prisma, {
                machineId: OUTSIDE_MACHINE_ID,
                latitude: 14.8,
                longitude: -17.3,
            }),
            insertCatalogMachine(prisma, {
                machineId: MISSING_MACHINE_ID,
                latitude: null,
                longitude: null,
            }),
            insertCatalogMachine(prisma, {
                machineId: INVALID_MACHINE_ID,
                latitude: 91,
                longitude: -17.46,
            }),
        ]);

        const unbounded = await repository.findLocated({ position, viewport: null, after: null, limit: 10 });
        const bounded = await repository.findLocated({ position, viewport, after: null, limit: 10 });

        expect(unbounded.items.map(({ machineId }) => machineId)).toEqual([INSIDE_MACHINE_ID, OUTSIDE_MACHINE_ID]);
        expect(bounded.items.map(({ machineId }) => machineId)).toEqual([INSIDE_MACHINE_ID]);
    });

    it('breaks equal-distance ties by ascending public machineId', async () => {
        const position: MachineCoordinates = { latitude: 14.716677, longitude: -17.467686 };
        const coordinates = { latitude: 14.75, longitude: -17.45 };

        await insertCatalogMachine(prisma, { machineId: TIE_SECOND_MACHINE_ID, ...coordinates });
        await insertCatalogMachine(prisma, { machineId: TIE_FIRST_MACHINE_ID, ...coordinates });

        const page = await repository.findLocated({ position, viewport: null, after: null, limit: 10 });

        expect(page.items).toHaveLength(2);
        expect(page.items[0]?.distanceMeters).toBeCloseTo(page.items[1]?.distanceMeters ?? -1, 9);
        expect(page.items.map(({ machineId }) => machineId)).toEqual([TIE_FIRST_MACHINE_ID, TIE_SECOND_MACHINE_ID]);
    });
});
