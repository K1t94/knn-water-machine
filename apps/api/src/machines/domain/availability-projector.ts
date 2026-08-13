import { MachineValidationError, parseMachinePrice } from './machine-validation';

import type { MachineAvailability, MachinePublicationState, MachineServiceMode } from './machine.types';

export interface AvailabilityClock {
    now(): Date;
}

export interface AvailabilityProjectionInput {
    readonly publicationState: MachinePublicationState;
    readonly deletedAt: Date | null;
    readonly serviceMode: MachineServiceMode;
    readonly price: unknown;
    readonly evidence: unknown;
}

export interface AvailabilityProjectionPolicy {
    readonly freshnessSeconds: number;
    readonly allowedClockSkewSeconds: number;
    readonly supportedCurrencies: ReadonlySet<string>;
}

export interface MachineAvailabilityProjection {
    readonly status: MachineAvailability;
    readonly selectable: boolean;
    readonly publiclyVisible: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

export class MachineAvailabilityProjector {
    constructor(
        private readonly clock: AvailabilityClock,
        private readonly policy: AvailabilityProjectionPolicy,
    ) {}

    project(input: AvailabilityProjectionInput): MachineAvailabilityProjection {
        if (input.publicationState !== 'PUBLISHED' || input.deletedAt !== null) {
            return { status: 'OFFLINE', selectable: false, publiclyVisible: false };
        }

        if (input.serviceMode === 'SERVICE') {
            return { status: 'SERVICE', selectable: false, publiclyVisible: true };
        }

        if (!this.hasValidPrice(input.price) || !this.hasCurrentReadyEvidence(input.evidence)) {
            return { status: 'OFFLINE', selectable: false, publiclyVisible: true };
        }

        return { status: 'ONLINE', selectable: true, publiclyVisible: true };
    }

    private hasValidPrice(price: unknown): boolean {
        try {
            parseMachinePrice(price, this.policy.supportedCurrencies);
            return true;
        } catch (error: unknown) {
            if (error instanceof MachineValidationError) return false;
            throw error;
        }
    }

    private hasCurrentReadyEvidence(evidence: unknown): boolean {
        if (
            !isRecord(evidence) ||
            evidence.state !== 'READY' ||
            evidence.reachable !== true ||
            evidence.readyToSell !== true ||
            evidence.salesAllowed !== true ||
            !(evidence.observedAt instanceof Date)
        ) {
            return false;
        }

        const now = this.clock.now().getTime();
        const observedAt = evidence.observedAt.getTime();
        if (!Number.isFinite(now) || !Number.isFinite(observedAt)) return false;

        const freshnessMilliseconds = this.policy.freshnessSeconds * 1_000;
        const allowedClockSkewMilliseconds = this.policy.allowedClockSkewSeconds * 1_000;

        return observedAt <= now + allowedClockSkewMilliseconds && now - observedAt <= freshnessMilliseconds;
    }
}
