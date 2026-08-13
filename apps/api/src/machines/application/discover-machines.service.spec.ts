import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';
import { MachineAvailabilityProjector } from '../domain/availability-projector';
import { CatalogOrderingRevisionMismatchError } from '../infrastructure/postgres/prisma-machine.repository';
import { SignedCatalogCursor } from '../infrastructure/signed-catalog-cursor';

import { DiscoverMachinesService } from './discover-machines.service';

import type { MachineRepository } from './ports/machine.repository';
import type { CatalogRevision, MachineDiscoveryContext, MachineId } from '../domain/machine.types';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const MACHINE_A = 'AbCdEfGhIjKlMnOpQrStUv' as MachineId;
const MACHINE_B = 'BcDeFgHiJkLmNoPqRsTuVw' as MachineId;
const MACHINE_C = 'CdEfGhIjKlMnOpQrStUvWx' as MachineId;
const CATALOG_REVISION = '41' as CatalogRevision;
const HMAC_KEY = Buffer.alloc(32, 7).toString('base64url');

const locatedContext: MachineDiscoveryContext = {
    mode: 'USER_LOCATION',
    position: { latitude: 14.7167, longitude: -17.4677 },
    viewport: { north: 14.8, east: -17.3, south: 14.6, west: -17.6 },
};

const serviceAreaContext: MachineDiscoveryContext = {
    mode: 'SERVICE_AREA',
    serviceAreaCode: 'dakar-central',
    viewport: null,
};

function readyEvidence(observedAt: Date = NOW): Readonly<Record<string, unknown>> {
    return {
        state: 'READY',
        reachable: true,
        readyToSell: true,
        salesAllowed: true,
        observedAt,
    };
}

function machineRecord(machineId: MachineId, overrides: Readonly<Record<string, unknown>> = {}) {
    return {
        machineId,
        displayName: 'Fontaine Plateau',
        publicationState: 'PUBLISHED' as const,
        serviceMode: 'NORMAL' as const,
        selectionRevision: 17n,
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
        getCatalogRevision: vi.fn().mockResolvedValue(CATALOG_REVISION),
        findLocated: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
        findByServiceArea: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
        findPublicByMachineId: vi.fn(),
        findPublicByIdentifier: vi.fn(),
    };
}

function createCursor(clock: FixedClock): SignedCatalogCursor {
    return new SignedCatalogCursor(clock, {
        MACHINE_CURSOR_HMAC_KEY: HMAC_KEY,
        MACHINE_CURSOR_TTL_SECONDS: 300,
    });
}

function setup() {
    const clock = new FixedClock(NOW);
    const repository = createRepository();
    const projector = new MachineAvailabilityProjector(clock, {
        freshnessSeconds: 60,
        allowedClockSkewSeconds: 5,
        supportedCurrencies: new Set(['XOF']),
    });
    const cursor = createCursor(clock);

    return {
        clock,
        cursor,
        repository,
        service: new DiscoverMachinesService(repository, projector, cursor),
    };
}

describe('DiscoverMachinesService', () => {
    it.each([
        ['a zero page limit', { context: locatedContext, limit: 0, cursor: null }],
        ['an oversized page limit', { context: locatedContext, limit: 101, cursor: null }],
        [
            'an invalid discovery context',
            {
                context: {
                    mode: 'USER_LOCATION',
                    position: { latitude: Number.NaN, longitude: -17.4677 },
                    viewport: null,
                },
                limit: 20,
                cursor: null,
            },
        ],
    ])('rejects %s before repository access', async (_case, input) => {
        const { repository, service } = setup();

        await expect(service.execute(input as Parameters<typeof service.execute>[0])).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(repository.getCatalogRevision).not.toHaveBeenCalled();
        expect(repository.findLocated).not.toHaveBeenCalled();
        expect(repository.findByServiceArea).not.toHaveBeenCalled();
    });

    it('uses the current ordering revision and signs the located next-page keyset', async () => {
        const { cursor, repository, service } = setup();
        vi.mocked(repository.findLocated).mockResolvedValue({
            items: [
                { ...machineRecord(MACHINE_A), distanceMeters: 1250 },
                { ...machineRecord(MACHINE_B), distanceMeters: 1250.4 },
            ],
            hasMore: true,
        });

        const result = await service.execute({ context: locatedContext, limit: 2, cursor: null });

        expect(repository.findLocated).toHaveBeenCalledExactlyOnceWith({
            position: locatedContext.position,
            viewport: locatedContext.viewport,
            after: null,
            limit: 2,
            catalogRevision: CATALOG_REVISION,
        });
        expect(result).toMatchObject({
            hasMore: true,
            catalogRevision: CATALOG_REVISION,
            items: [
                { machineId: MACHINE_A, distanceMeters: 1250, status: 'ONLINE', machineRevision: '17' },
                { machineId: MACHINE_B, distanceMeters: 1250, status: 'ONLINE', machineRevision: '17' },
            ],
        });
        expect(result.nextCursor).toBeDefined();
        expect(
            cursor.decode(result.nextCursor!, { context: locatedContext, catalogRevision: CATALOG_REVISION }),
        ).toEqual({ mode: 'DISTANCE', distanceMeters: 1250.4, machineId: MACHINE_B });
    });

    it('decodes a service-area cursor into the repository keyset', async () => {
        const { cursor, repository, service } = setup();
        const encoded = cursor.encode(
            { context: serviceAreaContext, catalogRevision: CATALOG_REVISION },
            { mode: 'MACHINE_ID', machineId: MACHINE_A },
        );

        await service.execute({ context: serviceAreaContext, limit: 20, cursor: encoded });

        expect(repository.findByServiceArea).toHaveBeenCalledExactlyOnceWith({
            serviceAreaCode: 'dakar-central',
            viewport: null,
            afterMachineId: MACHINE_A,
            limit: 20,
            catalogRevision: CATALOG_REVISION,
        });
    });

    it('maps a cursor for another context to a validation error without querying a page', async () => {
        const { cursor, repository, service } = setup();
        const encoded = cursor.encode(
            { context: locatedContext, catalogRevision: CATALOG_REVISION },
            { mode: 'DISTANCE', distanceMeters: 1250, machineId: MACHINE_A },
        );

        await expect(
            service.execute({ context: serviceAreaContext, limit: 20, cursor: encoded }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(repository.findLocated).not.toHaveBeenCalled();
        expect(repository.findByServiceArea).not.toHaveBeenCalled();
    });

    it('maps an expired cursor to a validation error without querying a page', async () => {
        const { clock, cursor, repository, service } = setup();
        const encoded = cursor.encode(
            { context: serviceAreaContext, catalogRevision: CATALOG_REVISION },
            { mode: 'MACHINE_ID', machineId: MACHINE_A },
        );
        clock.advance(300_000);

        await expect(
            service.execute({ context: serviceAreaContext, limit: 20, cursor: encoded }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(repository.findByServiceArea).not.toHaveBeenCalled();
    });

    it('rejects a superseded catalog ordering revision instead of returning a mixed page', async () => {
        const { cursor, repository, service } = setup();
        const encoded = cursor.encode(
            { context: locatedContext, catalogRevision: '40' as CatalogRevision },
            { mode: 'DISTANCE', distanceMeters: 1250, machineId: MACHINE_A },
        );

        await expect(service.execute({ context: locatedContext, limit: 20, cursor: encoded })).rejects.toMatchObject({
            code: 'DISCOVERY_CONTEXT_STALE',
        });
        expect(repository.findLocated).not.toHaveBeenCalled();
    });

    it('maps a revision change during the page read to a stale discovery context', async () => {
        const { repository, service } = setup();
        vi.mocked(repository.findByServiceArea).mockRejectedValue(new CatalogOrderingRevisionMismatchError());

        await expect(service.execute({ context: serviceAreaContext, limit: 20, cursor: null })).rejects.toMatchObject({
            code: 'DISCOVERY_CONTEXT_STALE',
        });
    });

    it('fails closed for availability and removes non-public records from discovery', async () => {
        const { repository, service } = setup();
        vi.mocked(repository.findByServiceArea).mockResolvedValue({
            items: [
                machineRecord(MACHINE_A, { publicationState: 'HIDDEN' }),
                machineRecord(MACHINE_B, { deletedAt: NOW }),
                machineRecord(MACHINE_C, { serviceMode: 'SERVICE', evidence: null }),
                machineRecord('DeFgHiJkLmNoPqRsTuVwXy' as MachineId, { evidence: null }),
            ],
            hasMore: false,
        });

        const result = await service.execute({ context: serviceAreaContext, limit: 20, cursor: null });

        expect(result.items).toEqual([
            expect.objectContaining({ machineId: MACHINE_C, status: 'SERVICE', machineRevision: '17' }),
            expect.objectContaining({
                machineId: 'DeFgHiJkLmNoPqRsTuVwXy',
                status: 'OFFLINE',
                machineRevision: '17',
            }),
        ]);
        expect(result).not.toHaveProperty('nextCursor');
    });
});
