import {
    assertMachineDiscoveryE2EFixtureCredential,
    normalizeMachineDiscoveryE2EOrigin,
} from '../../api/machine-discovery-e2e-control-api';

import type { SessionCredentials } from '../../api/auth-api';
import type {
    FixtureEndpoint,
    FixtureEvidence,
    FixturePrice,
    FixtureStatus,
    MachineDiscoveryE2EControlCredential,
    MachineDiscoveryE2EControlTransport,
    MachineDiscoveryE2ESession,
} from '../../api/machine-discovery-e2e-control-api';
import type { MachineDiscoveryNavigationScope } from '../../navigation/MainNavigator';
import type { MachineDiscoveryCompositionRoot } from '../machine-discovery-composition-root';
import type { TimestampProvider } from 'rxjs';

export {
    FetchMachineDiscoveryE2EControlTransport,
    MACHINE_DISCOVERY_E2E_CONTROL_HEADER,
} from '../../api/machine-discovery-e2e-control-api';

export const MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME = '2026-08-13T12:00:00.000Z';

const scenarioValues = {
    E2E_MACHINE_IDENTIFICATION_SCENARIO: [
        'valid-versioned-qr',
        'manual',
        'arbitrary-url',
        'duplicate-valid-qr',
        'idle',
        'connectivity-once',
    ],
    E2E_MACHINE_SAFE_CURRENT_SCENARIO: [
        'delayed-obsolete-catalog',
        'stale-cursor-retry',
        'freshness-exact-boundary',
        'freshness-beyond-boundary',
        'public-field-redaction',
    ],
    E2E_MACHINE_SELECTION_SCENARIO: [
        'detail-price-refresh',
        'context-changed-service',
        'context-changed-offline',
        'delayed-stable-online',
    ],
    E2E_MACHINE_SESSION_SCENARIO: [
        'expiry-failed-renewal-delayed-results',
        'logout-delayed-results',
        'account-replacement-delayed-results',
    ],
} as const;

type MachineDiscoveryE2EScenarioName = keyof typeof scenarioValues;

export interface MachineDiscoveryE2EScenario {
    readonly name: MachineDiscoveryE2EScenarioName;
    readonly value: string;
}

export interface E2EBuildDescriptor {
    readonly environment: string;
    readonly variant: string;
    readonly productionDistributable: boolean;
}

export type {
    FixtureEndpoint,
    FixtureEvidence,
    FixturePrice,
    FixtureStatus,
    MachineDiscoveryE2EControlCredential,
    MachineDiscoveryE2EControlTransport,
    MachineDiscoveryE2ESession,
} from '../../api/machine-discovery-e2e-control-api';

export interface MachineDiscoveryE2EBootstrapOptions {
    readonly build: E2EBuildDescriptor;
    readonly allowedFixtureOrigins: readonly string[];
    readonly controlEndpoint: FixtureEndpoint;
    readonly controlCredential: MachineDiscoveryE2EControlCredential;
    readonly fixtureAccountId: string;
    readonly fixtureCatalogId: string;
    readonly acceptanceTime: string;
    readonly scenario?: MachineDiscoveryE2EScenario;
    readonly control: MachineDiscoveryE2EControlTransport;
    readonly acceptSession: (credentials: SessionCredentials) => void;
    readonly createMachineDiscoveryRoot: (input: {
        readonly clock: TimestampProvider;
        readonly machineApiOrigin: string;
    }) => MachineDiscoveryCompositionRoot;
    readonly injectMachineDiscoveryScope: (scope: MachineDiscoveryNavigationScope) => void;
}

class MachineDiscoveryE2EClock implements TimestampProvider {
    private current: number;

    constructor(acceptanceTime: string) {
        this.current = parseAcceptanceTime(acceptanceTime);
    }

    now(): number {
        return this.current;
    }

    set(acceptanceTime: string): void {
        this.current = parseAcceptanceTime(acceptanceTime);
    }

    advance(milliseconds: number): void {
        assertClockAdvance(milliseconds);
        this.current += milliseconds;
    }
}

export class MachineDiscoveryE2EBootstrap {
    readonly clock: MachineDiscoveryE2EClock;

    private scope: MachineDiscoveryNavigationScope | undefined;

    constructor(
        private readonly options: MachineDiscoveryE2EBootstrapOptions,
        private readonly fixtureOrigin: string,
    ) {
        this.clock = new MachineDiscoveryE2EClock(options.acceptanceTime);
    }

    async start(): Promise<MachineDiscoveryNavigationScope> {
        if (this.scope !== undefined) return this.scope;

        const session = await this.options.control.bootstrap({
            acceptanceTime: this.options.acceptanceTime,
            controlCredential: this.options.controlCredential,
            fixtureAccountId: this.options.fixtureAccountId,
            ...(this.options.scenario === undefined ? {} : { scenario: this.options.scenario }),
        });
        this.assertFixtureSession(session);

        this.clock.set(session.acceptanceTime);
        this.options.acceptSession(session.credentials);
        const root = this.options.createMachineDiscoveryRoot({
            clock: this.clock,
            machineApiOrigin: this.fixtureOrigin,
        });
        const scope = { accessToken: session.credentials.accessToken, root };

        try {
            this.options.injectMachineDiscoveryScope(scope);
            this.scope = scope;
            return scope;
        } catch (error: unknown) {
            root.dispose();
            throw error;
        }
    }

    async setPrice(machineId: string, price: FixturePrice): Promise<void> {
        await this.options.control.setPrice({
            controlCredential: this.options.controlCredential,
            machineId,
            price,
        });
    }

    async setStatus(machineId: string, status: FixtureStatus): Promise<void> {
        await this.options.control.setStatus({
            controlCredential: this.options.controlCredential,
            machineId,
            ...status,
        });
    }

    async setEvidence(machineId: string, evidence: FixtureEvidence): Promise<void> {
        await this.options.control.setEvidence({
            controlCredential: this.options.controlCredential,
            machineId,
            evidence,
        });
    }

    async advanceTime(milliseconds: number): Promise<void> {
        assertClockAdvance(milliseconds);
        await this.options.control.advanceTime({
            controlCredential: this.options.controlCredential,
            milliseconds,
        });
        this.clock.advance(milliseconds);
    }

    private assertFixtureSession(session: MachineDiscoveryE2ESession): void {
        if (session.environmentMarker !== 'machine-discovery-e2e') {
            throw new Error('Machine discovery E2E bootstrap rejected the environment marker.');
        }
        if (session.credentialProvenance !== 'fixture-e2e') {
            throw new Error('Machine discovery E2E bootstrap requires a fixture session.');
        }
        if (normalizeMachineDiscoveryE2EOrigin(session.machineApiOrigin, 'fixture endpoint') !== this.fixtureOrigin) {
            throw new Error('Machine discovery E2E bootstrap rejected the fixture endpoint.');
        }
        if (
            session.fixtureAccountId !== this.options.fixtureAccountId ||
            session.fixtureCatalogId !== this.options.fixtureCatalogId ||
            session.acceptanceTime !== this.options.acceptanceTime
        ) {
            throw new Error('Machine discovery E2E bootstrap rejected fixture attestation.');
        }
        assertSessionCredentials(session.credentials);
    }
}

export function resolveMachineDiscoveryE2EScenario(
    launchArguments: Readonly<Record<string, unknown>>,
): MachineDiscoveryE2EScenario | undefined {
    const supplied = Object.entries(scenarioValues).filter(([name]) => launchArguments[name] !== undefined);
    if (supplied.length > 1) {
        throw new Error('Machine discovery E2E bootstrap accepts only one scenario argument.');
    }
    if (supplied.length === 0) return undefined;

    const [name, allowedValues] = supplied[0];
    const value = launchArguments[name];
    if (typeof value !== 'string' || !(allowedValues as readonly string[]).includes(value)) {
        throw new Error('Machine discovery E2E bootstrap rejected the scenario argument.');
    }
    return { name: name as MachineDiscoveryE2EScenarioName, value };
}

export function registerMachineDiscoveryE2EBootstrap(
    options: MachineDiscoveryE2EBootstrapOptions,
): MachineDiscoveryE2EBootstrap {
    assertE2EBuild(options.build);
    assertMachineDiscoveryE2EFixtureCredential(options.controlCredential);
    parseAcceptanceTime(options.acceptanceTime);

    const allowedOrigins = new Set(
        options.allowedFixtureOrigins.map((origin) => normalizeMachineDiscoveryE2EOrigin(origin, 'fixture endpoint')),
    );
    const fixtureOrigin = normalizeMachineDiscoveryE2EOrigin(options.controlEndpoint.origin, 'fixture endpoint');
    if (options.controlEndpoint.provenance !== 'fixture' || !allowedOrigins.has(fixtureOrigin)) {
        throw new Error('Machine discovery E2E bootstrap requires an allowlisted fixture endpoint.');
    }

    return new MachineDiscoveryE2EBootstrap(options, fixtureOrigin);
}

function assertE2EBuild(build: E2EBuildDescriptor): void {
    if (
        !['test', 'e2e'].includes(build.environment) ||
        build.variant !== 'machine-discovery-e2e' ||
        build.productionDistributable
    ) {
        throw new Error('Machine discovery E2E bootstrap can register only in a non-distributable test/E2E build.');
    }
}

function parseAcceptanceTime(value: string): number {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp))
        throw new Error('Machine discovery E2E bootstrap requires a valid acceptance time.');
    return timestamp;
}

function assertClockAdvance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
        throw new Error('Machine discovery E2E bootstrap requires a non-negative clock advance.');
    }
}

function assertSessionCredentials(credentials: SessionCredentials): void {
    if (
        credentials.accessToken.trim() === '' ||
        credentials.refreshToken.trim() === '' ||
        !Number.isFinite(Date.parse(credentials.accessExpiresAt)) ||
        !Number.isFinite(Date.parse(credentials.refreshExpiresAt))
    ) {
        throw new Error('Machine discovery E2E bootstrap rejected the fixture session.');
    }
}
