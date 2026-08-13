import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MACHINE_DISCOVERY_FIXTURES, seedMachineDiscovery } from '../../prisma/seed-machine-discovery';

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const describePostgres = runPostgres ? describe : describe.skip;
const repositoryRoot = resolve(__dirname, '../../../..');
const prismaSchema = resolve(repositoryRoot, 'apps/api/prisma/schema.prisma');

const expectedFixtures = [
    {
        machineId: 'kdBu6l4X0dCVSatmsocVsQ',
        qrPayload: 'kaynann://machine/v1/kdBu6l4X0dCVSatmsocVsQ',
        displayName: 'Plateau Water 01',
        publicationState: 'PUBLISHED',
        serviceMode: 'NORMAL',
        address: 'Avenue Nelson Mandela, Dakar-Plateau',
        serviceAreaCode: 'DKR-CENTRE',
        latitude: '14.668420',
        longitude: '-17.437180',
        amountPerLiter: '25.000000',
        currency: 'XOF',
        identifiers: [
            ['CURRENT_MANUAL', 'DKR-PLATEAU-01', true],
            ['LEGACY_MANUAL', 'WM-0001', true],
            ['LEGACY_QR', 'KNNLEGACY:0001', true],
        ],
        evidence: ['READY', true, true, true],
    },
    {
        machineId: 'nHqwT5B_eojbUe1cWZHHvw',
        qrPayload: 'kaynann://machine/v1/nHqwT5B_eojbUe1cWZHHvw',
        displayName: 'Medina Water 02',
        publicationState: 'PUBLISHED',
        serviceMode: 'SERVICE',
        address: 'Avenue Blaise Diagne, Medina',
        serviceAreaCode: 'DKR-CENTRE',
        latitude: '14.685210',
        longitude: '-17.446620',
        amountPerLiter: '30.500000',
        currency: 'XOF',
        identifiers: [['CURRENT_MANUAL', 'DKR-MEDINA-02', true]],
        evidence: ['OFFLINE', false, false, false],
    },
    {
        machineId: 'y4_EoD0MblZ4i7CHp4NnXw',
        qrPayload: 'kaynann://machine/v1/y4_EoD0MblZ4i7CHp4NnXw',
        displayName: 'Yoff Water 03',
        publicationState: 'HIDDEN',
        serviceMode: 'NORMAL',
        address: 'Route de l Aeroport, Yoff',
        serviceAreaCode: 'DKR-NORD',
        latitude: '14.746150',
        longitude: '-17.490320',
        amountPerLiter: '40.000000',
        currency: 'XOF',
        identifiers: [['CURRENT_MANUAL', 'DKR-YOFF-03', false]],
        evidence: ['UNKNOWN', true, false, false],
    },
    {
        machineId: 'XvQj8R0W3mlJwJtkYNFbqg',
        qrPayload: 'kaynann://machine/v1/XvQj8R0W3mlJwJtkYNFbqg',
        displayName: 'Ouakam Water 04',
        publicationState: 'ARCHIVED',
        serviceMode: 'NORMAL',
        address: 'Route de la Corniche Ouest, Ouakam',
        serviceAreaCode: 'DKR-OUEST',
        latitude: '14.723710',
        longitude: '-17.494670',
        amountPerLiter: '35.250000',
        currency: 'XOF',
        identifiers: [['LEGACY_MANUAL', 'WM-0004', true]],
        evidence: ['READY', true, true, true],
    },
] as const;

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

function fixtureSnapshot() {
    return MACHINE_DISCOVERY_FIXTURES.map((fixture) => ({
        machineId: fixture.machineId,
        qrPayload: fixture.qrPayload,
        displayName: fixture.displayName,
        publicationState: fixture.publicationState,
        serviceMode: fixture.serviceMode,
        address: fixture.location.address,
        serviceAreaCode: fixture.location.serviceAreaCode,
        latitude: fixture.location.latitude,
        longitude: fixture.location.longitude,
        amountPerLiter: fixture.price.amountPerLiter,
        currency: fixture.price.currency,
        identifiers: fixture.identifiers.map((identifier) => [
            identifier.kind,
            identifier.normalizedValue,
            identifier.enabled,
        ]),
        evidence: [
            fixture.evidence.state,
            fixture.evidence.reachable,
            fixture.evidence.readyToSell,
            fixture.evidence.salesAllowed,
        ],
    }));
}

describe('machine discovery seed contract', () => {
    it('defines deterministic opaque identities and exact catalog facts', () => {
        expect(fixtureSnapshot()).toEqual(expectedFixtures);
        expect(MACHINE_DISCOVERY_FIXTURES).toHaveLength(4);

        for (const fixture of MACHINE_DISCOVERY_FIXTURES) {
            expect(fixture.machineId).toMatch(/^[A-Za-z0-9_-]{22}$/);
            expect(fixture.qrPayload).toBe(`kaynann://machine/v1/${fixture.machineId}`);
        }
    });

    it.each(['staging', 'production', 'preview'])(
        'refuses the %s environment before opening a transaction',
        async (appEnv) => {
            const transaction = vi.fn();
            const prisma = { $transaction: transaction } as unknown as PrismaClient;

            await expect(seedMachineDiscovery(prisma, { appEnv, fixtureMode: true })).rejects.toThrow(
                'development and test only',
            );
            expect(transaction).not.toHaveBeenCalled();
        },
    );

    it('requires explicit fixture mode in an allowed environment', async () => {
        const transaction = vi.fn();
        const prisma = { $transaction: transaction } as unknown as PrismaClient;

        await expect(seedMachineDiscovery(prisma, { appEnv: 'test', fixtureMode: false })).rejects.toThrow(
            'MACHINE_FIXTURE_MODE=true',
        );
        expect(transaction).not.toHaveBeenCalled();
    });
});

describePostgres('machine discovery seed persistence', () => {
    const schema = `machine_seed_${randomUUID().replaceAll('-', '')}`;
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

    it('resets only owned rows and persists the exact deterministic catalog', async () => {
        await seedMachineDiscovery(prisma, { appEnv: 'test', fixtureMode: true });
        await prisma.machine.update({
            where: { machineId: expectedFixtures[0].machineId },
            data: { displayName: 'drifted fixture' },
        });
        const unrelatedMachineId = 'UnrelatedMachineId0001';
        await prisma.machine.create({ data: { machineId: unrelatedMachineId } });

        await seedMachineDiscovery(prisma, { appEnv: 'test', fixtureMode: true });

        const machines = await prisma.machine.findMany({
            where: { machineId: { in: MACHINE_DISCOVERY_FIXTURES.map((fixture) => fixture.machineId) } },
            include: {
                location: true,
                price: true,
                identifierMappings: { orderBy: [{ kind: 'asc' }, { normalizedValue: 'asc' }] },
                availabilityEvidence: true,
            },
            orderBy: { machineId: 'asc' },
        });
        const persisted = machines.map((machine) => ({
            machineId: machine.machineId,
            qrPayload: `kaynann://machine/v1/${machine.machineId}`,
            displayName: machine.displayName,
            publicationState: machine.publicationState,
            serviceMode: machine.serviceMode,
            address: machine.location?.address,
            serviceAreaCode: machine.location?.serviceAreaCode,
            latitude: machine.location?.latitude?.toFixed(6),
            longitude: machine.location?.longitude?.toFixed(6),
            amountPerLiter: machine.price?.amountPerLiter.toFixed(6),
            currency: machine.price?.currency,
            identifiers: machine.identifierMappings.map((identifier) => [
                identifier.kind,
                identifier.normalizedValue,
                identifier.enabled,
            ]),
            evidence: machine.availabilityEvidence
                ? [
                      machine.availabilityEvidence.state,
                      machine.availabilityEvidence.reachable,
                      machine.availabilityEvidence.readyToSell,
                      machine.availabilityEvidence.salesAllowed,
                  ]
                : undefined,
        }));

        expect(persisted).toEqual(
            [...expectedFixtures].sort((left, right) =>
                left.machineId < right.machineId ? -1 : left.machineId > right.machineId ? 1 : 0,
            ),
        );
        await expect(
            prisma.machine.findUniqueOrThrow({ where: { machineId: unrelatedMachineId } }),
        ).resolves.toBeDefined();
    }, 60_000);
});
