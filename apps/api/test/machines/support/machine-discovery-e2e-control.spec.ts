import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../../src/common/testing/fixed-clock';
import { EmulatedMachineGateway } from '../../../src/machines/infrastructure/emulated-machine-gateway';

import {
    MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
    registerMachineDiscoveryE2EControl,
} from './machine-discovery-e2e-control';
import { loadMachineDiscoveryE2EHostConfig } from './machine-discovery-e2e-host';

import type { FixtureSession } from './machine-discovery-e2e-control';
import type { PrismaClient } from '@prisma/client';

const FIXTURE_ORIGIN = 'http://127.0.0.1:3000';
const FIXTURE_ACCOUNT_ID = 'machine-discovery-acceptance';
const FIXTURE_CATALOG_ID = 'machine-discovery-v1';
const CONTROL_CREDENTIAL = { value: 'fixture-control-secret', provenance: 'fixture-e2e' as const };
const MACHINE_ID = 'kdBu6l4X0dCVSatmsocVsQ';

describe('machine discovery E2E control', () => {
    it('resets deterministic PostgreSQL fixtures, fixes time, and authenticates the fixture account', async () => {
        const { control, prisma, gateway, authenticateFixtureAccount } = createControl();
        const setEvidence = vi.spyOn(gateway, 'setEvidence');

        const response = await control.bootstrap({
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            controlCredential: CONTROL_CREDENTIAL,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(authenticateFixtureAccount).toHaveBeenCalledWith(FIXTURE_ACCOUNT_ID);
        expect(setEvidence).toHaveBeenCalledTimes(4);
        expect(response).toEqual({
            environmentMarker: 'machine-discovery-e2e',
            fixtureCatalogId: FIXTURE_CATALOG_ID,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            machineApiOrigin: FIXTURE_ORIGIN,
            credentialProvenance: 'fixture-e2e',
            credentials: fixtureSession().credentials,
        });
    });

    it('applies exact price, status, evidence, and clock transitions through the fixture harness', async () => {
        const { control, prisma, gateway, clock } = createControl();
        const setEvidence = vi.spyOn(gateway, 'setEvidence');

        await control.setPrice({
            controlCredential: CONTROL_CREDENTIAL,
            machineId: MACHINE_ID,
            price: { amountPerLiter: '41.125000', currency: 'XOF' },
        });
        await control.setStatus({
            controlCredential: CONTROL_CREDENTIAL,
            machineId: MACHINE_ID,
            publicationState: 'PUBLISHED',
            serviceMode: 'SERVICE',
        });
        await control.setEvidence({
            controlCredential: CONTROL_CREDENTIAL,
            machineId: MACHINE_ID,
            evidence: {
                state: 'OFFLINE',
                reachable: false,
                readyToSell: false,
                salesAllowed: false,
                observedAt: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            },
        });
        await control.advanceTime({ controlCredential: CONTROL_CREDENTIAL, milliseconds: 45_001 });

        expect(prisma.machine.update).toHaveBeenNthCalledWith(1, {
            where: { machineId: MACHINE_ID },
            data: {
                price: { update: { amountPerLiter: '41.125000', currency: 'XOF' } },
                selectionRevision: { increment: 1 },
            },
        });
        expect(prisma.machine.update).toHaveBeenNthCalledWith(2, {
            where: { machineId: MACHINE_ID },
            data: { publicationState: 'PUBLISHED', selectionRevision: { increment: 1 } },
        });
        expect(prisma.machine.update).toHaveBeenNthCalledWith(3, {
            where: { machineId: MACHINE_ID },
            data: { serviceMode: 'SERVICE', selectionRevision: { increment: 1 } },
        });
        expect(setEvidence).toHaveBeenLastCalledWith(
            MACHINE_ID,
            expect.objectContaining({ state: 'OFFLINE', observedAt: new Date(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME) }),
        );
        expect(clock.now()).toEqual(new Date(Date.parse(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME) + 45_001));
    });

    it.each([
        [{ environment: 'production', variant: 'production', productionDistributable: true }, 'test/E2E'],
        [{ environment: 'development', variant: 'machine-discovery-e2e', productionDistributable: false }, 'test/E2E'],
        [{ environment: 'test', variant: 'production', productionDistributable: false }, 'test/E2E'],
    ] as const)('refuses registration for build %o', (build, message) => {
        expect(() => createControl({ build })).toThrow(message);
    });

    it('refuses production endpoints and credentials at registration', () => {
        expect(() =>
            createControl({ fixtureEndpoint: { origin: 'https://api.kaynann.example', provenance: 'production' } }),
        ).toThrow('fixture endpoint');
        expect(() =>
            createControl({ controlCredential: { value: 'production-token', provenance: 'production' } }),
        ).toThrow('fixture credential');
    });

    it('rejects an unknown transport credential without touching PostgreSQL', async () => {
        const { control, prisma } = createControl();

        await expect(
            control.bootstrap({
                acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
                controlCredential: { value: 'wrong-fixture-secret', provenance: 'fixture-e2e' },
                fixtureAccountId: FIXTURE_ACCOUNT_ID,
            }),
        ).rejects.toThrow('authorization rejected');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects production session credentials after reset and never returns them to the app', async () => {
        const { control } = createControl({
            authenticateFixtureAccount: vi.fn(async () => ({
                ...fixtureSession(),
                credentialProvenance: 'production' as const,
            })),
        });

        await expect(
            control.bootstrap({
                acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
                controlCredential: CONTROL_CREDENTIAL,
                fixtureAccountId: FIXTURE_ACCOUNT_ID,
            }),
        ).rejects.toThrow('fixture session');
    });

    it('fails closed unless the runnable host has explicit test fixture gates', () => {
        const valid = {
            API_PORT: '3000',
            APP_ENV: 'test',
            MACHINE_DISCOVERY_E2E_ALLOWED_ORIGINS: FIXTURE_ORIGIN,
            MACHINE_DISCOVERY_E2E_BUILD_VARIANT: 'machine-discovery-e2e',
            MACHINE_DISCOVERY_E2E_CONTROL_CREDENTIAL: CONTROL_CREDENTIAL.value,
            MACHINE_DISCOVERY_E2E_ORIGIN: FIXTURE_ORIGIN,
            MACHINE_DISCOVERY_E2E_PRODUCTION_DISTRIBUTABLE: 'false',
            MACHINE_FIXTURE_MODE: 'true',
            MACHINE_GATEWAY_MODE: 'emulator',
            NODE_ENV: 'test',
        } satisfies NodeJS.ProcessEnv;

        expect(loadMachineDiscoveryE2EHostConfig(valid)).toEqual({
            allowedFixtureOrigins: [FIXTURE_ORIGIN],
            controlCredential: CONTROL_CREDENTIAL.value,
            fixtureOrigin: FIXTURE_ORIGIN,
            port: 3000,
        });
        expect(() => loadMachineDiscoveryE2EHostConfig({ ...valid, APP_ENV: 'production' })).toThrow('non-production');
        expect(() =>
            loadMachineDiscoveryE2EHostConfig({ ...valid, MACHINE_DISCOVERY_E2E_PRODUCTION_DISTRIBUTABLE: 'true' }),
        ).toThrow('non-production');
    });

    it('keeps all E2E routes and modules outside the production API build graph', () => {
        const apiRoot = resolve(__dirname, '../../..');
        const appModule = readFileSync(resolve(apiRoot, 'src/app.module.ts'), 'utf8');
        const buildConfig = JSON.parse(readFileSync(resolve(apiRoot, 'tsconfig.build.json'), 'utf8')) as {
            exclude: string[];
        };
        const packageManifest = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };

        expect(appModule).not.toMatch(/machine-discovery-e2e|__e2e/);
        expect(buildConfig.exclude).toContain('test');
        expect(packageManifest.scripts.start).toBe('node dist/main.js');
        expect(packageManifest.scripts['machine-discovery:e2e']).toContain('test/machines/support');
    });
});

function createControl(overrides: Partial<Parameters<typeof registerMachineDiscoveryE2EControl>[0]> = {}) {
    const transaction = {
        machineAvailabilityEvidence: { deleteMany: vi.fn(async () => undefined) },
        machineIdentifierMapping: { deleteMany: vi.fn(async () => undefined) },
        machinePrice: { deleteMany: vi.fn(async () => undefined) },
        machineLocation: { deleteMany: vi.fn(async () => undefined) },
        machine: {
            deleteMany: vi.fn(async () => undefined),
            create: vi.fn(async () => undefined),
        },
    };
    const prisma = {
        $transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<void>) => operation(transaction)),
        machine: { update: vi.fn(async () => undefined) },
    } as unknown as PrismaClient;
    const clock = new FixedClock(new Date('2030-01-01T00:00:00.000Z'));
    const gateway = new EmulatedMachineGateway(clock);
    const authenticateFixtureAccount = vi.fn(async () => fixtureSession());
    const control = registerMachineDiscoveryE2EControl({
        build: e2eBuild(),
        allowedFixtureOrigins: [FIXTURE_ORIGIN],
        fixtureEndpoint: { origin: FIXTURE_ORIGIN, provenance: 'fixture' },
        controlCredential: CONTROL_CREDENTIAL,
        fixtureAccountId: FIXTURE_ACCOUNT_ID,
        fixtureCatalogId: FIXTURE_CATALOG_ID,
        acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
        prisma,
        clock,
        gateway,
        authenticateFixtureAccount,
        ...overrides,
    });
    return { control, prisma, clock, gateway, authenticateFixtureAccount };
}

function fixtureSession(): FixtureSession {
    return {
        credentialProvenance: 'fixture-e2e',
        credentials: {
            accessToken: 'fixture-access-token',
            accessExpiresAt: '2026-08-13T13:00:00.000Z',
            refreshToken: 'fixture-refresh-token',
            refreshExpiresAt: '2026-08-14T12:00:00.000Z',
        },
    };
}

function e2eBuild() {
    return {
        environment: 'e2e',
        variant: 'machine-discovery-e2e',
        productionDistributable: false,
    } as const;
}
