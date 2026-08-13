import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    FetchMachineDiscoveryE2EControlTransport,
    MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
    registerMachineDiscoveryE2EBootstrap,
    resolveMachineDiscoveryE2EScenario,
} from './machine-discovery-e2e-bootstrap';

import type {
    MachineDiscoveryE2EControlTransport,
    MachineDiscoveryE2ESession,
} from './machine-discovery-e2e-bootstrap';
import type { MachineDiscoveryCompositionRoot } from '../machine-discovery-composition-root';
import type { TimestampProvider } from 'rxjs';

const FIXTURE_ORIGIN = 'http://127.0.0.1:3000';
const FIXTURE_ACCOUNT_ID = 'machine-discovery-acceptance';
const FIXTURE_CATALOG_ID = 'machine-discovery-v1';
const CONTROL_CREDENTIAL = { value: 'fixture-control-secret', provenance: 'fixture-e2e' as const };

describe('machine discovery E2E bootstrap', () => {
    it('resets fixtures, authenticates the deterministic account, fixes time, and injects the scope', async () => {
        const events: string[] = [];
        const control = createControl({ events });
        const root = { dispose: vi.fn() } as unknown as MachineDiscoveryCompositionRoot;
        const acceptSession = vi.fn(() => events.push('accept-session'));
        const injectMachineDiscoveryScope = vi.fn(() => events.push('inject-scope'));
        const createMachineDiscoveryRoot = vi.fn(
            ({ clock }: { readonly clock: TimestampProvider; readonly machineApiOrigin: string }) => {
                events.push(`create-root:${clock.now()}`);
                return root;
            },
        );
        const bootstrap = registerMachineDiscoveryE2EBootstrap({
            build: e2eBuild(),
            allowedFixtureOrigins: [FIXTURE_ORIGIN],
            controlEndpoint: { origin: FIXTURE_ORIGIN, provenance: 'fixture' },
            controlCredential: CONTROL_CREDENTIAL,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
            fixtureCatalogId: FIXTURE_CATALOG_ID,
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            control,
            acceptSession,
            createMachineDiscoveryRoot,
            injectMachineDiscoveryScope,
        });

        const scope = await bootstrap.start();

        expect(events).toEqual([
            'control-bootstrap',
            'accept-session',
            `create-root:${Date.parse(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME)}`,
            'inject-scope',
        ]);
        expect(control.bootstrap).toHaveBeenCalledWith({
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            controlCredential: CONTROL_CREDENTIAL,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
        });
        expect(acceptSession).toHaveBeenCalledWith(fixtureSession().credentials);
        expect(createMachineDiscoveryRoot).toHaveBeenCalledWith({
            clock: bootstrap.clock,
            machineApiOrigin: FIXTURE_ORIGIN,
        });
        expect(scope).toEqual({ accessToken: 'fixture-access-token', root });
        expect(injectMachineDiscoveryScope).toHaveBeenCalledWith(scope);
    });

    it('delegates fixture transitions and keeps the local clock aligned with the API clock', async () => {
        const control = createControl();
        const bootstrap = createBootstrap(control);
        await bootstrap.start();

        await bootstrap.setPrice('kdBu6l4X0dCVSatmsocVsQ', { amountPerLiter: '40.000000', currency: 'XOF' });
        await bootstrap.setStatus('kdBu6l4X0dCVSatmsocVsQ', { serviceMode: 'SERVICE' });
        await bootstrap.setEvidence('kdBu6l4X0dCVSatmsocVsQ', {
            state: 'OFFLINE',
            reachable: false,
            readyToSell: false,
            salesAllowed: false,
            observedAt: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
        });
        await bootstrap.advanceTime(45_001);

        expect(control.setPrice).toHaveBeenCalledWith({
            controlCredential: CONTROL_CREDENTIAL,
            machineId: 'kdBu6l4X0dCVSatmsocVsQ',
            price: { amountPerLiter: '40.000000', currency: 'XOF' },
        });
        expect(control.setStatus).toHaveBeenCalledWith({
            controlCredential: CONTROL_CREDENTIAL,
            machineId: 'kdBu6l4X0dCVSatmsocVsQ',
            serviceMode: 'SERVICE',
        });
        expect(control.setEvidence).toHaveBeenCalledWith({
            controlCredential: CONTROL_CREDENTIAL,
            evidence: {
                observedAt: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
                reachable: false,
                readyToSell: false,
                salesAllowed: false,
                state: 'OFFLINE',
            },
            machineId: 'kdBu6l4X0dCVSatmsocVsQ',
        });
        expect(control.advanceTime).toHaveBeenCalledWith({
            controlCredential: CONTROL_CREDENTIAL,
            milliseconds: 45_001,
        });
        expect(bootstrap.clock.now()).toBe(Date.parse(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME) + 45_001);
    });

    it.each([
        [{ environment: 'production', variant: 'production', productionDistributable: true }, 'test/E2E'],
        [{ environment: 'development', variant: 'machine-discovery-e2e', productionDistributable: false }, 'test/E2E'],
        [{ environment: 'e2e', variant: 'production', productionDistributable: false }, 'test/E2E'],
    ] as const)('refuses registration for build %o', (build, message) => {
        expect(() => createBootstrap(createControl(), { build })).toThrow(message);
    });

    it('refuses production credentials and non-fixture endpoints before contacting the transport', () => {
        const control = createControl();

        expect(() =>
            createBootstrap(control, {
                controlCredential: { value: 'production-token', provenance: 'production' },
            }),
        ).toThrow('fixture credential');
        expect(() =>
            createBootstrap(control, {
                controlEndpoint: { origin: 'https://api.kaynann.example', provenance: 'production' },
            }),
        ).toThrow('fixture endpoint');
        expect(control.bootstrap).not.toHaveBeenCalled();
    });

    it.each([
        [{ ...fixtureSession(), credentialProvenance: 'production' as const }, 'fixture session'],
        [{ ...fixtureSession(), machineApiOrigin: 'https://api.kaynann.example' }, 'fixture endpoint'],
        [{ ...fixtureSession(), environmentMarker: 'production' }, 'environment marker'],
    ])('rejects an unattested bootstrap response', async (response, message) => {
        const control = createControl({ response: response });
        const acceptSession = vi.fn();
        const injectMachineDiscoveryScope = vi.fn();
        const bootstrap = createBootstrap(control, { acceptSession, injectMachineDiscoveryScope });

        await expect(bootstrap.start()).rejects.toThrow(message);
        expect(acceptSession).not.toHaveBeenCalled();
        expect(injectMachineDiscoveryScope).not.toHaveBeenCalled();
    });

    it('sends fixture controls over the isolated HTTP transport without putting the secret in the body', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(fixtureSession()), {
                headers: { 'content-type': 'application/json' },
                status: 200,
            }),
        );
        const transport = new FetchMachineDiscoveryE2EControlTransport(FIXTURE_ORIGIN, fetcher);

        await transport.bootstrap({
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            controlCredential: CONTROL_CREDENTIAL,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
            scenario: { name: 'E2E_MACHINE_IDENTIFICATION_SCENARIO', value: 'manual' },
        });

        expect(fetcher.mock.calls[0][0]).toBe(`${FIXTURE_ORIGIN}/__e2e/machine-discovery/bootstrap`);
        const request = fetcher.mock.calls[0][1];
        if (request === undefined || typeof request.body !== 'string') {
            throw new Error('Expected the E2E control request to contain a JSON body.');
        }
        expect(request.headers).toEqual({
            'content-type': 'application/json',
            'x-kaynann-e2e-control': CONTROL_CREDENTIAL.value,
        });
        expect(request.method).toBe('POST');
        expect(request.redirect).toBe('error');
        expect(request.body).not.toContain(CONTROL_CREDENTIAL.value);
        expect(JSON.parse(request.body)).toEqual({
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
            scenario: { name: 'E2E_MACHINE_IDENTIFICATION_SCENARIO', value: 'manual' },
        });
    });

    it('accepts only one allowlisted Maestro launch scenario', () => {
        expect(resolveMachineDiscoveryE2EScenario({ E2E_MACHINE_SELECTION_SCENARIO: 'detail-price-refresh' })).toEqual({
            name: 'E2E_MACHINE_SELECTION_SCENARIO',
            value: 'detail-price-refresh',
        });
        expect(() => resolveMachineDiscoveryE2EScenario({ E2E_MACHINE_SELECTION_SCENARIO: 'unknown' })).toThrow(
            'scenario argument',
        );
        expect(() =>
            resolveMachineDiscoveryE2EScenario({
                E2E_MACHINE_IDENTIFICATION_SCENARIO: 'manual',
                E2E_MACHINE_SELECTION_SCENARIO: 'detail-price-refresh',
            }),
        ).toThrow('only one');
    });

    it('keeps the bootstrap and launch-argument native module out of the production entrypoint', () => {
        const mobileRoot = resolve(__dirname, '../../..');
        const productionEntry = readFileSync(resolve(mobileRoot, 'index.ts'), 'utf8');
        const e2eEntry = readFileSync(resolve(mobileRoot, 'index.e2e.ts'), 'utf8');
        const nativeConfig = readFileSync(resolve(mobileRoot, 'react-native.config.js'), 'utf8');
        const entrySelector = readFileSync(resolve(mobileRoot, 'scripts/select-machine-discovery-entry.cjs'), 'utf8');
        const manifest = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8')) as {
            main: string;
            scripts: Record<string, string>;
        };
        const eas = JSON.parse(readFileSync(resolve(mobileRoot, 'eas.json'), 'utf8')) as {
            build: {
                'machine-discovery-e2e': { env: Record<string, string> };
                production: { env?: Record<string, string> };
            };
        };

        expect(productionEntry).not.toMatch(/MachineDiscoveryE2E|react-native-launch-arguments/);
        expect(e2eEntry).toContain('MachineDiscoveryE2EApp');
        expect(manifest.main).toBe('index.ts');
        expect(manifest.scripts['eas-build-pre-install']).toContain('select-machine-discovery-entry.cjs');
        expect(eas.build['machine-discovery-e2e'].env.ENTRY_FILE).toBeUndefined();
        expect(eas.build.production.env).toBeUndefined();
        expect(entrySelector).toContain("env.EAS_BUILD_PROFILE !== 'machine-discovery-e2e'");
        expect(entrySelector).toContain("return 'index.e2e.ts'");
        expect(entrySelector).toContain("return 'index.ts'");
        expect(nativeConfig).toContain("process.env.EAS_BUILD_PROFILE === 'machine-discovery-e2e'");
        expect(nativeConfig).toContain("process.env.APP_ENV === 'e2e'");
        expect(nativeConfig).toContain('android: null');
        expect(nativeConfig).toContain('ios: null');
    });
});

function createBootstrap(
    control: MachineDiscoveryE2EControlTransport,
    overrides: Partial<Parameters<typeof registerMachineDiscoveryE2EBootstrap>[0]> = {},
) {
    return registerMachineDiscoveryE2EBootstrap({
        build: e2eBuild(),
        allowedFixtureOrigins: [FIXTURE_ORIGIN],
        controlEndpoint: { origin: FIXTURE_ORIGIN, provenance: 'fixture' },
        controlCredential: CONTROL_CREDENTIAL,
        fixtureAccountId: FIXTURE_ACCOUNT_ID,
        fixtureCatalogId: FIXTURE_CATALOG_ID,
        acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
        control,
        acceptSession: vi.fn(),
        createMachineDiscoveryRoot: vi.fn(() => ({ dispose: vi.fn() }) as unknown as MachineDiscoveryCompositionRoot),
        injectMachineDiscoveryScope: vi.fn(),
        ...overrides,
    });
}

function createControl(options: { events?: string[]; response?: MachineDiscoveryE2ESession } = {}) {
    return {
        bootstrap: vi.fn(async () => {
            options.events?.push('control-bootstrap');
            return options.response ?? fixtureSession();
        }),
        setPrice: vi.fn(async () => undefined),
        setStatus: vi.fn(async () => undefined),
        setEvidence: vi.fn(async () => undefined),
        advanceTime: vi.fn(async () => undefined),
    } satisfies MachineDiscoveryE2EControlTransport;
}

function fixtureSession(): MachineDiscoveryE2ESession {
    return {
        environmentMarker: 'machine-discovery-e2e',
        fixtureCatalogId: FIXTURE_CATALOG_ID,
        fixtureAccountId: FIXTURE_ACCOUNT_ID,
        acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
        machineApiOrigin: FIXTURE_ORIGIN,
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
