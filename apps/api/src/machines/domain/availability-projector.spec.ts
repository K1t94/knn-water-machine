import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';

import { MachineAvailabilityProjector, type AvailabilityProjectionInput } from './availability-projector';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const SUPPORTED_CURRENCIES = new Set(['XOF']);

function readyEvidence(observedAt: Date = NOW): Readonly<Record<string, unknown>> {
    return {
        state: 'READY',
        reachable: true,
        readyToSell: true,
        salesAllowed: true,
        observedAt,
    };
}

function publishedMachine(overrides: Partial<AvailabilityProjectionInput> = {}): AvailabilityProjectionInput {
    return {
        publicationState: 'PUBLISHED',
        deletedAt: null,
        serviceMode: 'NORMAL',
        price: { amountPerLiter: '2.500000', currency: 'XOF' },
        evidence: readyEvidence(),
        ...overrides,
    };
}

function createProjector(clock = new FixedClock(NOW)): MachineAvailabilityProjector {
    return new MachineAvailabilityProjector(clock, {
        freshnessSeconds: 60,
        allowedClockSkewSeconds: 5,
        supportedCurrencies: SUPPORTED_CURRENCIES,
    });
}

describe('MachineAvailabilityProjector', () => {
    it.each([
        ['current evidence', NOW],
        ['the exact freshness boundary', new Date(NOW.getTime() - 60_000)],
        ['the exact allowed future-skew boundary', new Date(NOW.getTime() + 5_000)],
    ])('projects ONLINE for %s', (_case, observedAt) => {
        expect(createProjector().project(publishedMachine({ evidence: readyEvidence(observedAt) }))).toEqual({
            status: 'ONLINE',
            selectable: true,
            publiclyVisible: true,
        });
    });

    it('projects SERVICE ahead of missing evidence and invalid price for a published machine', () => {
        expect(
            createProjector().project(
                publishedMachine({
                    serviceMode: 'SERVICE',
                    price: { amountPerLiter: '0', currency: 'USD' },
                    evidence: null,
                }),
            ),
        ).toEqual({ status: 'SERVICE', selectable: false, publiclyVisible: true });
    });

    it.each<[string, Partial<AvailabilityProjectionInput>]>([
        ['missing evidence', { evidence: null }],
        ['unknown evidence', { evidence: { ...readyEvidence(), state: 'UNKNOWN' } }],
        [
            'explicit offline evidence that conflicts with ready flags',
            { evidence: { ...readyEvidence(), state: 'OFFLINE' } },
        ],
        ['evidence beyond the freshness boundary', { evidence: readyEvidence(new Date(NOW.getTime() - 60_001)) }],
        ['evidence beyond allowed future skew', { evidence: readyEvidence(new Date(NOW.getTime() + 5_001)) }],
        ['unreachable evidence', { evidence: { ...readyEvidence(), reachable: false } }],
        ['not-ready evidence', { evidence: { ...readyEvidence(), readyToSell: false } }],
        ['sales-disabled evidence', { evidence: { ...readyEvidence(), salesAllowed: false } }],
        ['malformed evidence state', { evidence: { ...readyEvidence(), state: 'BROKEN' } }],
        ['malformed evidence flag', { evidence: { ...readyEvidence(), reachable: 'true' } }],
        ['malformed evidence timestamp', { evidence: { ...readyEvidence(), observedAt: new Date('invalid') } }],
        ['missing price', { price: null }],
        ['non-positive price', { price: { amountPerLiter: '0', currency: 'XOF' } }],
        ['unsupported currency', { price: { amountPerLiter: '2.500000', currency: 'USD' } }],
    ])('fails closed to OFFLINE for %s', (_case, overrides) => {
        expect(createProjector().project(publishedMachine(overrides))).toEqual({
            status: 'OFFLINE',
            selectable: false,
            publiclyVisible: true,
        });
    });

    it.each<[string, Partial<AvailabilityProjectionInput>]>([
        ['hidden publication', { publicationState: 'HIDDEN' }],
        ['archived publication', { publicationState: 'ARCHIVED' }],
        ['soft-deleted publication', { deletedAt: NOW }],
    ])('keeps %s out of public results', (_case, overrides) => {
        expect(createProjector().project(publishedMachine(overrides))).toEqual({
            status: 'OFFLINE',
            selectable: false,
            publiclyVisible: false,
        });
    });

    it('recomputes freshness from the injected clock without an evidence write', () => {
        const clock = new FixedClock(NOW);
        const projector = createProjector(clock);
        const input = publishedMachine();

        expect(projector.project(input).status).toBe('ONLINE');
        clock.advance(60_001);
        expect(projector.project(input)).toEqual({
            status: 'OFFLINE',
            selectable: false,
            publiclyVisible: true,
        });
    });
});
