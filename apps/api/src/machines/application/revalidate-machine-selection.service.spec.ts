import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';
import { MachineAvailabilityProjector } from '../domain/availability-projector';

import { RevalidateMachineSelectionService } from './revalidate-machine-selection.service';

import type { MachineGateway } from './ports/machine-gateway.port';
import type { MachineCatalogRecord, MachineRepository } from './ports/machine.repository';
import type { MachineId, MachineRevision } from '../domain/machine.types';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv' as MachineId;
const EXPECTED_REVISION = '18' as MachineRevision;

function readyEvidence(): Readonly<Record<string, unknown>> {
    return {
        state: 'READY',
        reachable: true,
        readyToSell: true,
        salesAllowed: true,
        observedAt: NOW,
    };
}

function offlineEvidence(): Readonly<Record<string, unknown>> {
    return {
        state: 'OFFLINE',
        reachable: false,
        readyToSell: false,
        salesAllowed: false,
        observedAt: NOW,
    };
}

function machineRecord(overrides: Partial<MachineCatalogRecord> = {}): MachineCatalogRecord {
    return {
        machineId: MACHINE_ID,
        displayName: 'Fontaine Plateau',
        publicationState: 'PUBLISHED',
        serviceMode: 'NORMAL',
        selectionRevision: 18n,
        deletedAt: null,
        address: '12 Rue de Dakar',
        coordinates: { latitude: 14.7167, longitude: -17.4677 },
        price: { amountPerLiter: '125.0700', currency: 'XOF' },
        evidence: offlineEvidence(),
        ...overrides,
    };
}

function setup() {
    const clock = new FixedClock(NOW);
    const repository: MachineRepository = {
        getCatalogRevision: vi.fn(),
        findLocated: vi.fn(),
        findByServiceArea: vi.fn(),
        findPublicByMachineId: vi.fn().mockResolvedValue(machineRecord()),
        findPublicByIdentifier: vi.fn(),
    };
    const gateway: MachineGateway = {
        refreshAvailability: vi.fn().mockReturnValue(of(readyEvidence())),
    };
    const projector = new MachineAvailabilityProjector(clock, {
        freshnessSeconds: 60,
        allowedClockSkewSeconds: 5,
        supportedCurrencies: new Set(['XOF']),
    });

    return {
        gateway,
        repository,
        service: new RevalidateMachineSelectionService(repository, gateway, projector, clock),
    };
}

async function expectApplicationError(operation: Promise<unknown>, code: string): Promise<unknown> {
    try {
        await operation;
    } catch (error: unknown) {
        expect(error).toMatchObject({
            name: 'MachineApplicationError',
            code,
            message: 'Machine application request failed',
        });
        return error;
    }

    throw new Error(`Expected ${code}`);
}

describe('RevalidateMachineSelectionService', () => {
    it('refreshes the authoritative record and availability before creating an ONLINE-only handoff', async () => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(
            machineRecord({
                price: { amountPerLiter: '130.125000', currency: 'XOF' },
                evidence: offlineEvidence(),
            }),
        );

        const result = await service.execute(MACHINE_ID, EXPECTED_REVISION);

        expect(repository.findPublicByMachineId).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(gateway.refreshAvailability).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(result).toEqual({
            machineId: MACHINE_ID,
            machineRevision: EXPECTED_REVISION,
            price: { amountPerLiter: '130.125000', currency: 'XOF' },
            availability: 'ONLINE',
            validatedAt: NOW.toISOString(),
        });
        expect(result).not.toHaveProperty('displayName');
        expect(result).not.toHaveProperty('evidence');
        expect(result).not.toHaveProperty('selectionRevision');
    });

    it('rejects a changed revision with a fresh safe card instead of producing a handoff', async () => {
        const { repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(
            machineRecord({
                displayName: '  Fontaine Medina  ',
                selectionRevision: 19n,
                price: { amountPerLiter: '140.2500', currency: 'XOF' },
                evidence: { privateGatewayState: 'must-not-leak' },
            }),
        );

        const error = await expectApplicationError(
            service.execute(MACHINE_ID, EXPECTED_REVISION),
            'MACHINE_CONTEXT_CHANGED',
        );

        expect(error).toMatchObject({
            currentMachine: {
                machineId: MACHINE_ID,
                displayName: 'Fontaine Medina',
                address: '12 Rue de Dakar',
                coordinates: { latitude: 14.7167, longitude: -17.4677 },
                price: { amountPerLiter: '140.2500', currency: 'XOF' },
                status: 'ONLINE',
                machineRevision: '19',
                selectable: true,
                refreshedAt: NOW.toISOString(),
            },
        });
        expect(JSON.stringify(error)).not.toMatch(/privateGatewayState|evidence|selectionRevision/i);
    });

    it.each([
        ['SERVICE', machineRecord({ serviceMode: 'SERVICE' }), readyEvidence()],
        ['OFFLINE', machineRecord(), offlineEvidence()],
        ['missing price', machineRecord({ price: null }), readyEvidence()],
        [
            'invalid currency',
            machineRecord({ price: { amountPerLiter: '125.0700', currency: 'EUR' } }),
            readyEvidence(),
        ],
    ] as const)('rejects a current but non-selectable machine in %s state', async (_case, record, evidence) => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(record);
        vi.mocked(gateway.refreshAvailability).mockReturnValue(of(evidence));

        await expectApplicationError(service.execute(MACHINE_ID, EXPECTED_REVISION), 'MACHINE_NOT_SELECTABLE');
    });

    it.each([
        ['absent', null],
        ['hidden', machineRecord({ publicationState: 'HIDDEN' })],
        ['archived', machineRecord({ publicationState: 'ARCHIVED' })],
        ['deleted', machineRecord({ deletedAt: NOW })],
    ] as const)('returns the same safe not-found result for an %s machine', async (_case, record) => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(record);

        await expectApplicationError(service.execute(MACHINE_ID, EXPECTED_REVISION), 'MACHINE_NOT_FOUND');
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });

    it('uses only read ports and creates no purchase, reservation, debit, dispense, or catalog side effect', async () => {
        const { gateway, repository, service } = setup();

        await service.execute(MACHINE_ID, EXPECTED_REVISION);

        expect(repository.findPublicByMachineId).toHaveBeenCalledTimes(1);
        expect(gateway.refreshAvailability).toHaveBeenCalledTimes(1);
        expect(repository.getCatalogRevision).not.toHaveBeenCalled();
        expect(repository.findLocated).not.toHaveBeenCalled();
        expect(repository.findByServiceArea).not.toHaveBeenCalled();
        expect(repository.findPublicByIdentifier).not.toHaveBeenCalled();
        expect(Object.keys(repository).sort()).toEqual([
            'findByServiceArea',
            'findLocated',
            'findPublicByIdentifier',
            'findPublicByMachineId',
            'getCatalogRevision',
        ]);
        expect(Object.keys(gateway)).toEqual(['refreshAvailability']);
    });
});
