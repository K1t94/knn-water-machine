import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';
import { MachineAvailabilityProjector } from '../domain/availability-projector';

import { GetMachineDetailService } from './get-machine-detail.service';

import type { MachineGateway } from './ports/machine-gateway.port';
import type { MachineCatalogRecord, MachineRepository } from './ports/machine.repository';
import type { MachineId } from '../domain/machine.types';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv' as MachineId;

function readyEvidence(): Readonly<Record<string, unknown>> {
    return {
        state: 'READY',
        reachable: true,
        readyToSell: true,
        salesAllowed: true,
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
        evidence: { state: 'OFFLINE', observedAt: NOW },
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
        service: new GetMachineDetailService(repository, gateway, projector, clock),
    };
}

describe('GetMachineDetailService', () => {
    it('refreshes availability and assembles a current read-only public detail', async () => {
        const { gateway, repository, service } = setup();

        const result = await service.execute(MACHINE_ID);

        expect(repository.findPublicByMachineId).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(gateway.refreshAvailability).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(result).toEqual({
            machineId: MACHINE_ID,
            displayName: 'Fontaine Plateau',
            address: '12 Rue de Dakar',
            coordinates: { latitude: 14.7167, longitude: -17.4677 },
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
            status: 'ONLINE',
            machineRevision: '18',
            selectable: true,
            refreshedAt: NOW.toISOString(),
        });
        expect(result).not.toHaveProperty('evidence');
        expect(result).not.toHaveProperty('selectionRevision');
        expect(repository.getCatalogRevision).not.toHaveBeenCalled();
        expect(repository.findLocated).not.toHaveBeenCalled();
        expect(repository.findByServiceArea).not.toHaveBeenCalled();
        expect(repository.findPublicByIdentifier).not.toHaveBeenCalled();
    });

    it('refreshes current price, publication, and gateway evidence whenever the card opens', async () => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId)
            .mockResolvedValueOnce(machineRecord())
            .mockResolvedValueOnce(
                machineRecord({
                    price: { amountPerLiter: '130.125000', currency: 'XOF' },
                    selectionRevision: 19n,
                }),
            )
            .mockResolvedValueOnce(machineRecord({ publicationState: 'HIDDEN', selectionRevision: 20n }));
        vi.mocked(gateway.refreshAvailability)
            .mockReturnValueOnce(of(readyEvidence()))
            .mockReturnValueOnce(
                of({
                    state: 'OFFLINE',
                    reachable: false,
                    readyToSell: false,
                    salesAllowed: false,
                    observedAt: NOW,
                }),
            );

        await expect(service.execute(MACHINE_ID)).resolves.toMatchObject({
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
            status: 'ONLINE',
            machineRevision: '18',
            selectable: true,
        });
        await expect(service.execute(MACHINE_ID)).resolves.toMatchObject({
            price: { amountPerLiter: '130.125000', currency: 'XOF' },
            status: 'OFFLINE',
            machineRevision: '19',
            selectable: false,
        });
        await expect(service.execute(MACHINE_ID)).rejects.toMatchObject({ code: 'MACHINE_NOT_FOUND' });

        expect(repository.findPublicByMachineId).toHaveBeenCalledTimes(3);
        expect(gateway.refreshAvailability).toHaveBeenCalledTimes(2);
    });

    it.each([null, '   '])('uses a safe generic display name for %j customer copy', async (displayName) => {
        const { repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(machineRecord({ displayName }));

        await expect(service.execute(MACHINE_ID)).resolves.toMatchObject({ displayName: 'Water machine' });
    });

    it('preserves the exact current decimal price without converting it to a number', async () => {
        const { repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(
            machineRecord({ price: { amountPerLiter: '99999999999999.123456', currency: 'XOF' } }),
        );

        await expect(service.execute(MACHINE_ID)).resolves.toMatchObject({
            price: { amountPerLiter: '99999999999999.123456', currency: 'XOF' },
        });
    });

    it.each([
        ['ONLINE', 'NORMAL', readyEvidence(), true],
        ['SERVICE', 'SERVICE', readyEvidence(), false],
        [
            'OFFLINE',
            'NORMAL',
            {
                state: 'OFFLINE',
                reachable: false,
                readyToSell: false,
                salesAllowed: false,
                observedAt: NOW,
            },
            false,
        ],
    ] as const)(
        'projects refreshed evidence as %s with matching selection eligibility',
        async (status, serviceMode, evidence, selectable) => {
            const { gateway, repository, service } = setup();
            vi.mocked(repository.findPublicByMachineId).mockResolvedValue(machineRecord({ serviceMode }));
            vi.mocked(gateway.refreshAvailability).mockReturnValue(of(evidence));

            await expect(service.execute(MACHINE_ID)).resolves.toMatchObject({ status, selectable });
        },
    );

    it('returns the aggregate revision as an exact opaque string without internal selection fields', async () => {
        const { repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(
            machineRecord({ selectionRevision: 900719925474099312345n }),
        );

        const result = await service.execute(MACHINE_ID);

        expect(result.machineRevision).toBe('900719925474099312345');
        expect(result.machineRevision).toMatch(/^[1-9][0-9]*$/);
        expect(result).not.toHaveProperty('selectionRevision');
        expect(result).not.toHaveProperty('evidence');
    });

    it.each([
        ['absent', null],
        ['hidden', machineRecord({ publicationState: 'HIDDEN' })],
        ['archived', machineRecord({ publicationState: 'ARCHIVED' })],
        ['deleted', machineRecord({ deletedAt: NOW })],
    ] as const)('returns the same safe not-found result for an %s machine', async (_case, record) => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(record);

        await expect(service.execute(MACHINE_ID)).rejects.toMatchObject({ code: 'MACHINE_NOT_FOUND' });
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });
});
