import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';

import {
    CatalogCursorError,
    SignedCatalogCursor,
    type CatalogCursorQuery,
    type CatalogCursorSortKey,
} from './signed-catalog-cursor';

import type { CatalogCursor, CatalogRevision, MachineDiscoveryContext, MachineId } from '../domain/machine.types';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const HMAC_KEY = Buffer.alloc(32, 7).toString('base64url');
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const CATALOG_REVISION = '12' as CatalogRevision;

type LocatedDiscoveryContext = Extract<MachineDiscoveryContext, { mode: 'USER_LOCATION' }>;
type ServiceAreaDiscoveryContext = Extract<MachineDiscoveryContext, { mode: 'SERVICE_AREA' }>;

const locatedQuery: CatalogCursorQuery & { readonly context: LocatedDiscoveryContext } = {
    context: {
        mode: 'USER_LOCATION',
        position: { latitude: 55.751244, longitude: 37.618423 },
        viewport: { north: 55.9, east: 37.8, south: 55.6, west: 37.4 },
    },
    catalogRevision: CATALOG_REVISION,
};

const serviceAreaQuery: CatalogCursorQuery & { readonly context: ServiceAreaDiscoveryContext } = {
    context: {
        mode: 'SERVICE_AREA',
        serviceAreaCode: 'moscow-central',
        viewport: null,
    },
    catalogRevision: CATALOG_REVISION,
};

const locatedSortKey: CatalogCursorSortKey = {
    mode: 'DISTANCE',
    distanceMeters: 1234.5,
    machineId: MACHINE_ID,
};

function createCodec(clock = new FixedClock(NOW)): SignedCatalogCursor {
    return new SignedCatalogCursor(clock, {
        MACHINE_CURSOR_HMAC_KEY: HMAC_KEY,
        MACHINE_CURSOR_TTL_SECONDS: 300,
    });
}

describe('SignedCatalogCursor', () => {
    it('round-trips an opaque located keyset bound to its query', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);

        expect(cursor).not.toContain(MACHINE_ID);
        expect(codec.decode(cursor, locatedQuery)).toEqual(locatedSortKey);
    });

    it('round-trips the machine-id keyset used by a service-area query', () => {
        const codec = createCodec();
        const sortKey: CatalogCursorSortKey = { mode: 'MACHINE_ID', machineId: MACHINE_ID };

        expect(codec.decode(codec.encode(serviceAreaQuery, sortKey), serviceAreaQuery)).toEqual(sortKey);
    });

    it('rejects a cursor whose signed payload or signature was tampered with', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);
        const [payload, signature] = cursor.split('.');

        expectCursorError(
            () => codec.decode(`${payload.slice(0, -1)}A.${signature}` as CatalogCursor, locatedQuery),
            'INVALID',
        );
        expectCursorError(
            () => codec.decode(`${payload}.${signature.slice(0, -1)}A` as CatalogCursor, locatedQuery),
            'INVALID',
        );
    });

    it('rejects a cursor at and after its expiry using the injected clock', () => {
        const clock = new FixedClock(NOW);
        const codec = createCodec(clock);
        const cursor = codec.encode(locatedQuery, locatedSortKey);

        clock.advance(299_999);
        expect(codec.decode(cursor, locatedQuery)).toEqual(locatedSortKey);
        clock.advance(1);
        expectCursorError(() => codec.decode(cursor, locatedQuery), 'EXPIRED');
    });

    it('rejects a different query mode', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);

        expectCursorError(() => codec.decode(cursor, serviceAreaQuery), 'QUERY_MISMATCH');
    });

    it('rejects a changed service area', () => {
        const codec = createCodec();
        const cursor = codec.encode(serviceAreaQuery, { mode: 'MACHINE_ID', machineId: MACHINE_ID });
        const changed: CatalogCursorQuery = {
            ...serviceAreaQuery,
            context: { ...serviceAreaQuery.context, serviceAreaCode: 'moscow-north' },
        };

        expectCursorError(() => codec.decode(cursor, changed), 'QUERY_MISMATCH');
    });

    it('rejects a changed user position', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);
        const changed: CatalogCursorQuery = {
            ...locatedQuery,
            context: {
                ...locatedQuery.context,
                position: { ...locatedQuery.context.position, latitude: 55.751245 },
            },
        };

        expectCursorError(() => codec.decode(cursor, changed), 'QUERY_MISMATCH');
    });

    it('rejects a changed viewport', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);
        const changed: CatalogCursorQuery = {
            ...locatedQuery,
            context: {
                ...locatedQuery.context,
                viewport: { ...locatedQuery.context.viewport!, east: 37.9 },
            },
        };

        expectCursorError(() => codec.decode(cursor, changed), 'QUERY_MISMATCH');
    });

    it('reports an ordering-revision mismatch separately from an invalid cursor', () => {
        const codec = createCodec();
        const cursor = codec.encode(locatedQuery, locatedSortKey);

        expectCursorError(
            () => codec.decode(cursor, { ...locatedQuery, catalogRevision: '13' as CatalogRevision }),
            'ORDERING_REVISION_MISMATCH',
        );
    });

    it.each(['', 'not-a-cursor', 'a.b.c', `${Buffer.from('{}').toString('base64url')}.short`])(
        'rejects malformed outer cursor %s',
        (value) => {
            expectCursorError(() => createCodec().decode(value as CatalogCursor, locatedQuery), 'INVALID');
        },
    );

    it.each([
        {},
        { v: 2 },
        { v: 1, query: locatedQuery, sortKey: locatedSortKey, issuedAt: 1, expiresAt: 2, extra: true },
        { v: 1, query: locatedQuery, sortKey: locatedSortKey, issuedAt: 'now', expiresAt: 2 },
    ])('rejects a malformed signed payload', (payload) => {
        expectCursorError(() => createCodec().decode(signPayload(payload), locatedQuery), 'INVALID');
    });

    it.each<[CatalogCursorQuery, CatalogCursorSortKey]>([
        [locatedQuery, { mode: 'DISTANCE', distanceMeters: -1, machineId: MACHINE_ID }],
        [locatedQuery, { mode: 'DISTANCE', distanceMeters: Number.NaN, machineId: MACHINE_ID }],
        [locatedQuery, { mode: 'DISTANCE', distanceMeters: 1, machineId: 'bad' as MachineId }],
        [locatedQuery, { mode: 'MACHINE_ID', machineId: MACHINE_ID }],
        [serviceAreaQuery, locatedSortKey],
    ])('rejects an invalid or query-incompatible sort key', (query, sortKey) => {
        expectCursorError(() => createCodec().encode(query, sortKey), 'INVALID');
    });
});

function signPayload(payload: unknown): CatalogCursor {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', Buffer.from(HMAC_KEY, 'base64url')).update(encoded).digest('base64url');
    return `${encoded}.${signature}` as CatalogCursor;
}

function expectCursorError(action: () => unknown, reason: CatalogCursorError['reason']): void {
    try {
        action();
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(CatalogCursorError);
        expect(error).toMatchObject({ reason });
        return;
    }
    throw new Error(`Expected catalog cursor failure: ${reason}`);
}
