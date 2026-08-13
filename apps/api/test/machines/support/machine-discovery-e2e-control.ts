import { timingSafeEqual } from 'node:crypto';

import { MACHINE_DISCOVERY_FIXTURES, seedMachineDiscovery } from '../../../prisma/seed-machine-discovery';
import { MachineFixtureHarness } from '../machine-fixture-harness';

import type { FixedClock } from '../../../src/common/testing/fixed-clock';
import type {
    MachineEvidenceState,
    MachineId,
    MachinePublicationState,
    MachineServiceMode,
} from '../../../src/machines/domain/machine.types';
import type { EmulatedMachineGateway } from '../../../src/machines/infrastructure/emulated-machine-gateway';
import type { PrismaClient } from '@prisma/client';

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

type FixtureCredentialProvenance = 'fixture-e2e' | 'production';
type FixtureEndpointProvenance = 'fixture' | 'production';

interface SessionCredentials {
    readonly accessToken: string;
    readonly accessExpiresAt: string;
    readonly refreshToken: string;
    readonly refreshExpiresAt: string;
}

interface E2EBuildDescriptor {
    readonly environment: string;
    readonly variant: string;
    readonly productionDistributable: boolean;
}

interface FixtureEndpoint {
    readonly origin: string;
    readonly provenance: FixtureEndpointProvenance;
}

export interface ControlCredential {
    readonly value: string;
    readonly provenance: FixtureCredentialProvenance;
}

interface FixtureEvidence {
    readonly state: MachineEvidenceState;
    readonly reachable: boolean;
    readonly readyToSell: boolean;
    readonly salesAllowed: boolean;
    readonly observedAt: string;
}

export interface MachineDiscoveryE2EScenario {
    readonly name:
        | 'E2E_MACHINE_IDENTIFICATION_SCENARIO'
        | 'E2E_MACHINE_SAFE_CURRENT_SCENARIO'
        | 'E2E_MACHINE_SELECTION_SCENARIO'
        | 'E2E_MACHINE_SESSION_SCENARIO';
    readonly value: string;
}

export interface FixtureSession {
    readonly credentialProvenance: FixtureCredentialProvenance;
    readonly credentials: SessionCredentials;
}

export interface MachineDiscoveryE2EControlOptions {
    readonly build: E2EBuildDescriptor;
    readonly allowedFixtureOrigins: readonly string[];
    readonly fixtureEndpoint: FixtureEndpoint;
    readonly controlCredential: ControlCredential;
    readonly fixtureAccountId: string;
    readonly fixtureCatalogId: string;
    readonly acceptanceTime: string;
    readonly prisma: PrismaClient;
    readonly clock: FixedClock;
    readonly gateway: EmulatedMachineGateway;
    readonly authenticateFixtureAccount: (accountId: string) => Promise<FixtureSession>;
}

export interface MachineDiscoveryE2EBootstrapResponse {
    readonly environmentMarker: 'machine-discovery-e2e';
    readonly fixtureCatalogId: string;
    readonly fixtureAccountId: string;
    readonly acceptanceTime: string;
    readonly machineApiOrigin: string;
    readonly credentialProvenance: 'fixture-e2e';
    readonly credentials: SessionCredentials;
}

export class MachineDiscoveryE2EControl {
    private readonly harness: MachineFixtureHarness;

    constructor(
        private readonly options: MachineDiscoveryE2EControlOptions,
        private readonly fixtureOrigin: string,
    ) {
        options.clock.set(new Date(options.acceptanceTime));
        this.harness = new MachineFixtureHarness(options.prisma, options.gateway, options.clock);
    }

    async bootstrap(input: {
        readonly acceptanceTime: string;
        readonly controlCredential: ControlCredential;
        readonly fixtureAccountId: string;
        readonly scenario?: MachineDiscoveryE2EScenario;
    }): Promise<MachineDiscoveryE2EBootstrapResponse> {
        this.authorize(input.controlCredential);
        if (
            input.fixtureAccountId !== this.options.fixtureAccountId ||
            input.acceptanceTime !== this.options.acceptanceTime
        ) {
            throw new Error('Machine discovery E2E control authorization rejected.');
        }
        if (input.scenario !== undefined) assertScenario(input.scenario);

        this.options.clock.set(new Date(this.options.acceptanceTime));
        await seedMachineDiscovery(this.options.prisma, { appEnv: 'test', fixtureMode: true });
        this.resetGatewayEvidence();

        const session = await this.options.authenticateFixtureAccount(this.options.fixtureAccountId);
        if (session.credentialProvenance !== 'fixture-e2e') {
            throw new Error('Machine discovery E2E control requires a fixture session.');
        }
        assertSessionCredentials(session.credentials);

        return {
            environmentMarker: 'machine-discovery-e2e',
            fixtureCatalogId: this.options.fixtureCatalogId,
            fixtureAccountId: this.options.fixtureAccountId,
            acceptanceTime: this.options.acceptanceTime,
            machineApiOrigin: this.fixtureOrigin,
            credentialProvenance: 'fixture-e2e',
            credentials: session.credentials,
        };
    }

    async setPrice(input: {
        readonly controlCredential: ControlCredential;
        readonly machineId: string;
        readonly price: { readonly amountPerLiter: string; readonly currency: string };
    }): Promise<void> {
        this.authorize(input.controlCredential);
        await this.harness.setExactPrice(input.machineId as MachineId, input.price);
    }

    async setStatus(input: {
        readonly controlCredential: ControlCredential;
        readonly machineId: string;
        readonly publicationState?: MachinePublicationState;
        readonly serviceMode?: MachineServiceMode;
    }): Promise<void> {
        this.authorize(input.controlCredential);
        if (input.publicationState === undefined && input.serviceMode === undefined) {
            throw new Error('Machine discovery E2E control requires a status transition.');
        }
        if (input.publicationState !== undefined) {
            await this.harness.setPublicationState(input.machineId as MachineId, input.publicationState);
        }
        if (input.serviceMode !== undefined) {
            await this.harness.setServiceMode(input.machineId as MachineId, input.serviceMode);
        }
    }

    async setEvidence(input: {
        readonly controlCredential: ControlCredential;
        readonly machineId: string;
        readonly evidence: FixtureEvidence;
    }): Promise<void> {
        this.authorize(input.controlCredential);
        const observedAt = new Date(input.evidence.observedAt);
        if (!Number.isFinite(observedAt.getTime())) {
            throw new Error('Machine discovery E2E control requires valid fixture evidence.');
        }
        this.harness.setAvailabilityEvidence(input.machineId as MachineId, { ...input.evidence, observedAt });
    }

    async advanceTime(input: {
        readonly controlCredential: ControlCredential;
        readonly milliseconds: number;
    }): Promise<void> {
        this.authorize(input.controlCredential);
        if (!Number.isSafeInteger(input.milliseconds) || input.milliseconds < 0) {
            throw new Error('Machine discovery E2E control requires a non-negative clock advance.');
        }
        this.harness.advanceTime(input.milliseconds);
    }

    private authorize(credential: ControlCredential): void {
        if (
            credential.provenance !== 'fixture-e2e' ||
            !safeCredentialEqual(credential.value, this.options.controlCredential.value)
        ) {
            throw new Error('Machine discovery E2E control authorization rejected.');
        }
    }

    private resetGatewayEvidence(): void {
        for (const fixture of MACHINE_DISCOVERY_FIXTURES) {
            this.options.gateway.setResponseDelay(fixture.machineId as MachineId, 0);
            this.options.gateway.setEvidence(fixture.machineId as MachineId, { ...fixture.evidence });
        }
    }
}

export function registerMachineDiscoveryE2EControl(
    options: MachineDiscoveryE2EControlOptions,
): MachineDiscoveryE2EControl {
    assertE2EBuild(options.build);
    assertFixtureCredential(options.controlCredential);
    parseAcceptanceTime(options.acceptanceTime);

    const allowedOrigins = new Set(options.allowedFixtureOrigins.map((origin) => normalizeOrigin(origin)));
    const fixtureOrigin = normalizeOrigin(options.fixtureEndpoint.origin);
    if (options.fixtureEndpoint.provenance !== 'fixture' || !allowedOrigins.has(fixtureOrigin)) {
        throw new Error('Machine discovery E2E control requires an allowlisted fixture endpoint.');
    }

    return new MachineDiscoveryE2EControl(options, fixtureOrigin);
}

function assertE2EBuild(build: E2EBuildDescriptor): void {
    if (
        !['test', 'e2e'].includes(build.environment) ||
        build.variant !== 'machine-discovery-e2e' ||
        build.productionDistributable
    ) {
        throw new Error('Machine discovery E2E control can register only in a non-distributable test/E2E build.');
    }
}

function assertFixtureCredential(credential: ControlCredential): void {
    if (credential.provenance !== 'fixture-e2e' || credential.value.trim() === '') {
        throw new Error('Machine discovery E2E control requires a fixture credential.');
    }
}

function normalizeOrigin(value: string): string {
    try {
        const parsed = new URL(value);
        if (
            parsed.username !== '' ||
            parsed.password !== '' ||
            parsed.pathname !== '/' ||
            parsed.search !== '' ||
            parsed.hash !== ''
        ) {
            throw new Error('not an origin');
        }
        return parsed.origin;
    } catch {
        throw new Error('Machine discovery E2E control rejected the fixture endpoint.');
    }
}

function parseAcceptanceTime(value: string): number {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error('Machine discovery E2E control requires a valid acceptance time.');
    return timestamp;
}

function safeCredentialEqual(actual: string, expected: string): boolean {
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function assertSessionCredentials(credentials: SessionCredentials): void {
    if (
        credentials.accessToken.trim() === '' ||
        credentials.refreshToken.trim() === '' ||
        !Number.isFinite(Date.parse(credentials.accessExpiresAt)) ||
        !Number.isFinite(Date.parse(credentials.refreshExpiresAt))
    ) {
        throw new Error('Machine discovery E2E control rejected the fixture session.');
    }
}

function assertScenario(scenario: MachineDiscoveryE2EScenario): void {
    const allowed = scenarioValues[scenario.name] as readonly string[];
    if (!allowed.includes(scenario.value)) {
        throw new Error('Machine discovery E2E control rejected the scenario argument.');
    }
}
