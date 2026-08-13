import type { SessionCredentials } from './auth-api';

export const MACHINE_DISCOVERY_E2E_CONTROL_HEADER = 'x-kaynann-e2e-control';

type FixtureCredentialProvenance = 'fixture-e2e' | 'production';
type FixtureEndpointProvenance = 'fixture' | 'production';

export interface FixtureEndpoint {
    readonly origin: string;
    readonly provenance: FixtureEndpointProvenance;
}

export interface MachineDiscoveryE2EControlCredential {
    readonly value: string;
    readonly provenance: FixtureCredentialProvenance;
}

export interface FixturePrice {
    readonly amountPerLiter: string;
    readonly currency: string;
}

export interface FixtureStatus {
    readonly publicationState?: 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
    readonly serviceMode?: 'NORMAL' | 'SERVICE';
}

export interface FixtureEvidence {
    readonly state: 'READY' | 'OFFLINE' | 'UNKNOWN';
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

export interface MachineDiscoveryE2ESession {
    readonly environmentMarker: string;
    readonly fixtureCatalogId: string;
    readonly fixtureAccountId: string;
    readonly acceptanceTime: string;
    readonly machineApiOrigin: string;
    readonly credentialProvenance: FixtureCredentialProvenance;
    readonly credentials: SessionCredentials;
}

export interface MachineDiscoveryE2EControlTransport {
    bootstrap(input: {
        readonly acceptanceTime: string;
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly fixtureAccountId: string;
        readonly scenario?: MachineDiscoveryE2EScenario;
    }): Promise<MachineDiscoveryE2ESession>;
    setPrice(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly price: FixturePrice;
    }): Promise<void>;
    setStatus(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly publicationState?: FixtureStatus['publicationState'];
        readonly serviceMode?: FixtureStatus['serviceMode'];
    }): Promise<void>;
    setEvidence(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly evidence: FixtureEvidence;
    }): Promise<void>;
    advanceTime(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly milliseconds: number;
    }): Promise<void>;
}

export class FetchMachineDiscoveryE2EControlTransport implements MachineDiscoveryE2EControlTransport {
    private readonly origin: string;

    constructor(
        origin: string,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {
        this.origin = normalizeMachineDiscoveryE2EOrigin(origin, 'control endpoint');
    }

    async bootstrap(input: {
        readonly acceptanceTime: string;
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly fixtureAccountId: string;
        readonly scenario?: MachineDiscoveryE2EScenario;
    }): Promise<MachineDiscoveryE2ESession> {
        const payload = await this.send('/bootstrap', input.controlCredential, {
            acceptanceTime: input.acceptanceTime,
            fixtureAccountId: input.fixtureAccountId,
            ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
        });
        return parseBootstrapResponse(payload);
    }

    async setPrice(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly price: FixturePrice;
    }): Promise<void> {
        await this.send('/price', input.controlCredential, { machineId: input.machineId, price: input.price });
    }

    async setStatus(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly publicationState?: FixtureStatus['publicationState'];
        readonly serviceMode?: FixtureStatus['serviceMode'];
    }): Promise<void> {
        await this.send('/status', input.controlCredential, {
            machineId: input.machineId,
            ...(input.publicationState === undefined ? {} : { publicationState: input.publicationState }),
            ...(input.serviceMode === undefined ? {} : { serviceMode: input.serviceMode }),
        });
    }

    async setEvidence(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly machineId: string;
        readonly evidence: FixtureEvidence;
    }): Promise<void> {
        await this.send('/evidence', input.controlCredential, { machineId: input.machineId, evidence: input.evidence });
    }

    async advanceTime(input: {
        readonly controlCredential: MachineDiscoveryE2EControlCredential;
        readonly milliseconds: number;
    }): Promise<void> {
        await this.send('/time', input.controlCredential, { milliseconds: input.milliseconds });
    }

    private async send(path: string, credential: MachineDiscoveryE2EControlCredential, body: object): Promise<unknown> {
        assertMachineDiscoveryE2EFixtureCredential(credential);
        const response = await this.fetcher(`${this.origin}/__e2e/machine-discovery${path}`, {
            body: JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                [MACHINE_DISCOVERY_E2E_CONTROL_HEADER]: credential.value,
            },
            method: 'POST',
            redirect: 'error',
        });
        if (!response.ok) {
            throw new Error(`Machine discovery E2E control request failed with status ${response.status}.`);
        }
        if (response.status === 204) return undefined;
        return response.json() as Promise<unknown>;
    }
}

export function assertMachineDiscoveryE2EFixtureCredential(credential: MachineDiscoveryE2EControlCredential): void {
    if (credential.provenance !== 'fixture-e2e' || credential.value.trim() === '') {
        throw new Error('Machine discovery E2E bootstrap requires a fixture credential.');
    }
}

export function normalizeMachineDiscoveryE2EOrigin(value: string, label: string): string {
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
        throw new Error(`Machine discovery E2E bootstrap rejected the ${label}.`);
    }
}

function parseBootstrapResponse(value: unknown): MachineDiscoveryE2ESession {
    if (!isRecord(value) || !isRecord(value.credentials)) {
        throw new Error('Machine discovery E2E control returned an invalid bootstrap response.');
    }
    const credentials = value.credentials;
    if (
        typeof value.environmentMarker !== 'string' ||
        typeof value.fixtureCatalogId !== 'string' ||
        typeof value.fixtureAccountId !== 'string' ||
        typeof value.acceptanceTime !== 'string' ||
        typeof value.machineApiOrigin !== 'string' ||
        (value.credentialProvenance !== 'fixture-e2e' && value.credentialProvenance !== 'production') ||
        typeof credentials.accessToken !== 'string' ||
        typeof credentials.accessExpiresAt !== 'string' ||
        typeof credentials.refreshToken !== 'string' ||
        typeof credentials.refreshExpiresAt !== 'string'
    ) {
        throw new Error('Machine discovery E2E control returned an invalid bootstrap response.');
    }
    return {
        environmentMarker: value.environmentMarker,
        fixtureCatalogId: value.fixtureCatalogId,
        fixtureAccountId: value.fixtureAccountId,
        acceptanceTime: value.acceptanceTime,
        machineApiOrigin: value.machineApiOrigin,
        credentialProvenance: value.credentialProvenance,
        credentials: {
            accessToken: credentials.accessToken,
            accessExpiresAt: credentials.accessExpiresAt,
            refreshToken: credentials.refreshToken,
            refreshExpiresAt: credentials.refreshExpiresAt,
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
