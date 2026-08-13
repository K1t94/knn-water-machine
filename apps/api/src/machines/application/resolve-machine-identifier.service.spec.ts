import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';
import { MachineAvailabilityProjector } from '../domain/availability-projector';

import { GetMachineDetailService } from './get-machine-detail.service';
import { ResolveMachineIdentifierService } from './resolve-machine-identifier.service';

import type { MachineGateway } from './ports/machine-gateway.port';
import type { MachineCatalogRecord, MachineRepository } from './ports/machine.repository';
import type { MachineId, MachineIdentifierInput } from '../domain/machine.types';

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
        selectionRevision: 21n,
        deletedAt: null,
        address: '12 Rue de Dakar',
        coordinates: { latitude: 14.7167, longitude: -17.4677 },
        price: { amountPerLiter: '125.0700', currency: 'XOF' },
        evidence: readyEvidence(),
        ...overrides,
    };
}

function createRepository(): MachineRepository {
    return {
        getCatalogRevision: vi.fn(),
        findLocated: vi.fn(),
        findByServiceArea: vi.fn(),
        findPublicByMachineId: vi.fn().mockResolvedValue(machineRecord()),
        findPublicByIdentifier: vi.fn().mockResolvedValue(machineRecord()),
    };
}

function setup(options: Readonly<{ legacyQrEnabled?: boolean }> = {}) {
    const clock = new FixedClock(NOW);
    const repository = createRepository();
    const gateway: MachineGateway = {
        refreshAvailability: vi.fn().mockReturnValue(of(readyEvidence())),
    };
    const projector = new MachineAvailabilityProjector(clock, {
        freshnessSeconds: 60,
        allowedClockSkewSeconds: 5,
        supportedCurrencies: new Set(['XOF']),
    });
    const detailService = new GetMachineDetailService(repository, gateway, projector, clock);

    return {
        gateway,
        repository,
        service: new ResolveMachineIdentifierService(repository, detailService, {
            legacyQrEnabled: options.legacyQrEnabled ?? false,
        }),
    };
}

async function expectApplicationError(
    operation: Promise<unknown>,
    code: 'MACHINE_CODE_INVALID' | 'MACHINE_NOT_FOUND',
): Promise<void> {
    try {
        await operation;
    } catch (error: unknown) {
        expect(error).toMatchObject({
            name: 'MachineApplicationError',
            code,
            message: 'Machine application request failed',
        });
        expect(error).toHaveProperty('internalDetails', undefined);
        return;
    }

    throw new Error(`Expected ${code}`);
}

describe('ResolveMachineIdentifierService', () => {
    it('resolves an exact supported current QR through its authoritative public machineId', async () => {
        const { gateway, repository, service } = setup();

        const result = await service.execute({
            source: 'QR',
            value: `kaynann://machine/v1/${MACHINE_ID}`,
        });

        expect(repository.findPublicByMachineId).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(repository.findPublicByIdentifier).not.toHaveBeenCalled();
        expect(gateway.refreshAvailability).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
        expect(result).toEqual({
            machineId: MACHINE_ID,
            displayName: 'Fontaine Plateau',
            address: '12 Rue de Dakar',
            coordinates: { latitude: 14.7167, longitude: -17.4677 },
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
            status: 'ONLINE',
            machineRevision: '21',
            selectable: true,
            refreshedAt: NOW.toISOString(),
        });
        expect(result).not.toHaveProperty('identifierMappings');
        expect(result).not.toHaveProperty('normalizedValue');
        expect(result).not.toHaveProperty('evidence');
    });

    it.each([
        ['current manual', { source: 'MANUAL', value: '  dkr-plateau-01  ' }, 'CURRENT_MANUAL', 'DKR-PLATEAU-01'],
        ['legacy manual', { source: 'MANUAL', value: ' wm-0001 ' }, 'LEGACY_MANUAL', 'WM-0001'],
    ] as const)(
        'resolves an exact private %s mapping without exposing it',
        async (_case, input, kind, normalizedValue) => {
            const { repository, service } = setup();

            const result = await service.execute(input);

            expect(repository.findPublicByIdentifier).toHaveBeenCalledExactlyOnceWith({ kind, normalizedValue });
            expect(repository.findPublicByMachineId).toHaveBeenCalledExactlyOnceWith(MACHINE_ID);
            expect(result.machineId).toBe(MACHINE_ID);
            expect(result).not.toHaveProperty('identifier');
            expect(result).not.toHaveProperty('identifierMapping');
        },
    );

    it('resolves an approved legacy QR mapping only when the compatibility gate is enabled', async () => {
        const input = { source: 'QR', value: 'KNNLEGACY:0001' } as const;
        const disabled = setup();
        const enabled = setup({ legacyQrEnabled: true });

        await expectApplicationError(disabled.service.execute(input), 'MACHINE_CODE_INVALID');
        expect(disabled.repository.findPublicByIdentifier).not.toHaveBeenCalled();

        await expect(enabled.service.execute(input)).resolves.toMatchObject({ machineId: MACHINE_ID });
        expect(enabled.repository.findPublicByIdentifier).toHaveBeenCalledExactlyOnceWith({
            kind: 'LEGACY_QR',
            normalizedValue: 'KNNLEGACY:0001',
        });
    });

    it.each([
        'kaynann://machine/v2/AbCdEfGhIjKlMnOpQrStUv',
        'https://example.test/machine/AbCdEfGhIjKlMnOpQrStUv',
        'wave://merchant/qr/12345',
    ])('rejects unsupported QR syntax or version before repository lookup: %s', async (value) => {
        const { gateway, repository, service } = setup({ legacyQrEnabled: true });

        await expectApplicationError(service.execute({ source: 'QR', value }), 'MACHINE_CODE_INVALID');

        expect(repository.findPublicByMachineId).not.toHaveBeenCalled();
        expect(repository.findPublicByIdentifier).not.toHaveBeenCalled();
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });

    it('uses one exact kind/value lookup and never falls back across alias kinds or substrings', async () => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByIdentifier).mockResolvedValue(null);

        await expectApplicationError(
            service.execute({ source: 'MANUAL', value: 'DKR-PLATEAU-01' }),
            'MACHINE_NOT_FOUND',
        );

        expect(repository.findPublicByIdentifier).toHaveBeenCalledTimes(1);
        expect(repository.findPublicByIdentifier).toHaveBeenCalledWith({
            kind: 'CURRENT_MANUAL',
            normalizedValue: 'DKR-PLATEAU-01',
        });
        expect(repository.findPublicByMachineId).not.toHaveBeenCalled();
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown or disabled alias', { source: 'MANUAL', value: 'DKR-UNKNOWN-99' } as const, null],
        [
            'hidden alias owner',
            { source: 'MANUAL', value: 'DKR-HIDDEN-01' } as const,
            machineRecord({ publicationState: 'HIDDEN' }),
        ],
        [
            'archived alias owner',
            { source: 'MANUAL', value: 'WM-0004' } as const,
            machineRecord({ publicationState: 'ARCHIVED' }),
        ],
        [
            'deleted alias owner',
            { source: 'MANUAL', value: 'DKR-DELETED-01' } as const,
            machineRecord({ deletedAt: NOW }),
        ],
    ] as const)('returns the same safe not-found error for an %s', async (_case, input, record) => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByIdentifier).mockResolvedValue(record);

        await expectApplicationError(service.execute(input as MachineIdentifierInput), 'MACHINE_NOT_FOUND');

        expect(repository.findPublicByMachineId).not.toHaveBeenCalled();
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });

    it('returns the same safe not-found error when a current QR machine does not exist', async () => {
        const { gateway, repository, service } = setup();
        vi.mocked(repository.findPublicByMachineId).mockResolvedValue(null);

        await expectApplicationError(
            service.execute({ source: 'QR', value: `kaynann://machine/v1/${MACHINE_ID}` }),
            'MACHINE_NOT_FOUND',
        );

        expect(repository.findPublicByIdentifier).not.toHaveBeenCalled();
        expect(gateway.refreshAvailability).not.toHaveBeenCalled();
    });
});
