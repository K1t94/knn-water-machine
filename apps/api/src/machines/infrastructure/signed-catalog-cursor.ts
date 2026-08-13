import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AppEnv } from '../../config/env';
import type { ClockPort } from '../application/ports/clock.port';
import type {
    CatalogCursor,
    CatalogRevision,
    MachineDiscoveryContext,
    MachineId,
    MachineViewport,
} from '../domain/machine.types';

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 2048;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CATALOG_REVISION_PATTERN = /^[1-9][0-9]*$/;

export type CatalogCursorErrorReason = 'INVALID' | 'EXPIRED' | 'QUERY_MISMATCH' | 'ORDERING_REVISION_MISMATCH';

export class CatalogCursorError extends Error {
    constructor(public readonly reason: CatalogCursorErrorReason) {
        super(reason);
        this.name = 'CatalogCursorError';
    }
}

export interface CatalogCursorQuery {
    readonly context: MachineDiscoveryContext;
    readonly catalogRevision: CatalogRevision;
}

export type CatalogCursorSortKey =
    | Readonly<{ mode: 'DISTANCE'; distanceMeters: number; machineId: MachineId }>
    | Readonly<{ mode: 'MACHINE_ID'; machineId: MachineId }>;

export type CatalogCursorConfig = Pick<AppEnv, 'MACHINE_CURSOR_HMAC_KEY' | 'MACHINE_CURSOR_TTL_SECONDS'>;

interface CatalogCursorPayload {
    readonly v: typeof CURSOR_VERSION;
    readonly query: CatalogCursorQuery;
    readonly sortKey: CatalogCursorSortKey;
    readonly issuedAt: number;
    readonly expiresAt: number;
}

export class SignedCatalogCursor {
    private readonly hmacKey: Buffer;
    private readonly ttlMilliseconds: number;

    constructor(
        private readonly clock: ClockPort,
        config: CatalogCursorConfig,
    ) {
        this.hmacKey = Buffer.from(config.MACHINE_CURSOR_HMAC_KEY, 'base64url');
        this.ttlMilliseconds = config.MACHINE_CURSOR_TTL_SECONDS * 1_000;

        if (this.hmacKey.byteLength < 32 || !Number.isSafeInteger(this.ttlMilliseconds) || this.ttlMilliseconds < 1) {
            throw new CatalogCursorError('INVALID');
        }
    }

    encode(query: CatalogCursorQuery, sortKey: CatalogCursorSortKey): CatalogCursor {
        if (!isQuery(query) || !isSortKeyForQuery(sortKey, query)) throw new CatalogCursorError('INVALID');

        const issuedAt = this.nowMilliseconds();
        const payload: CatalogCursorPayload = {
            v: CURSOR_VERSION,
            query,
            sortKey,
            issuedAt,
            expiresAt: issuedAt + this.ttlMilliseconds,
        };
        const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const signature = this.sign(encodedPayload);

        return `${encodedPayload}.${signature}` as CatalogCursor;
    }

    decode(cursor: CatalogCursor, expectedQuery: CatalogCursorQuery): CatalogCursorSortKey {
        if (!isQuery(expectedQuery)) throw new CatalogCursorError('INVALID');

        const payload = this.decodePayload(cursor);
        const now = this.nowMilliseconds();
        if (payload.expiresAt <= now) throw new CatalogCursorError('EXPIRED');
        if (payload.query.catalogRevision !== expectedQuery.catalogRevision) {
            throw new CatalogCursorError('ORDERING_REVISION_MISMATCH');
        }
        if (!sameDiscoveryContext(payload.query.context, expectedQuery.context)) {
            throw new CatalogCursorError('QUERY_MISMATCH');
        }

        return payload.sortKey;
    }

    private decodePayload(cursor: CatalogCursor): CatalogCursorPayload {
        if (typeof cursor !== 'string' || cursor.length < 16 || cursor.length > MAX_CURSOR_LENGTH) {
            throw new CatalogCursorError('INVALID');
        }

        const parts = cursor.split('.');
        if (parts.length !== 2) throw new CatalogCursorError('INVALID');
        const [encodedPayload, encodedSignature] = parts;
        if (!isCanonicalBase64Url(encodedPayload) || !isCanonicalBase64Url(encodedSignature)) {
            throw new CatalogCursorError('INVALID');
        }

        const expectedSignature = Buffer.from(this.sign(encodedPayload), 'base64url');
        const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
        if (
            suppliedSignature.byteLength !== expectedSignature.byteLength ||
            !timingSafeEqual(suppliedSignature, expectedSignature)
        ) {
            throw new CatalogCursorError('INVALID');
        }

        try {
            const candidate: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
            if (!isPayload(candidate) || !isSortKeyForQuery(candidate.sortKey, candidate.query)) {
                throw new CatalogCursorError('INVALID');
            }
            return candidate;
        } catch (error: unknown) {
            if (error instanceof CatalogCursorError) throw error;
            throw new CatalogCursorError('INVALID');
        }
    }

    private sign(encodedPayload: string): string {
        return createHmac('sha256', this.hmacKey).update(encodedPayload, 'ascii').digest('base64url');
    }

    private nowMilliseconds(): number {
        const value = this.clock.now().getTime();
        if (!Number.isSafeInteger(value)) throw new CatalogCursorError('INVALID');
        return value;
    }
}

function isPayload(value: unknown): value is CatalogCursorPayload {
    if (!isRecordWithKeys(value, ['v', 'query', 'sortKey', 'issuedAt', 'expiresAt'])) return false;
    if (
        value.v !== CURSOR_VERSION ||
        !isQuery(value.query) ||
        !Number.isSafeInteger(value.issuedAt) ||
        !Number.isSafeInteger(value.expiresAt)
    ) {
        return false;
    }
    return (value.expiresAt as number) > (value.issuedAt as number);
}

function isQuery(value: unknown): value is CatalogCursorQuery {
    return (
        isRecordWithKeys(value, ['context', 'catalogRevision']) &&
        typeof value.catalogRevision === 'string' &&
        CATALOG_REVISION_PATTERN.test(value.catalogRevision) &&
        isDiscoveryContext(value.context)
    );
}

function isDiscoveryContext(value: unknown): value is MachineDiscoveryContext {
    if (!isRecord(value)) return false;
    if (value.mode === 'USER_LOCATION') {
        return (
            hasExactKeys(value, ['mode', 'position', 'viewport']) &&
            isCoordinates(value.position) &&
            isNullableViewport(value.viewport)
        );
    }
    if (value.mode === 'SERVICE_AREA') {
        return (
            hasExactKeys(value, ['mode', 'serviceAreaCode', 'viewport']) &&
            isServiceAreaCode(value.serviceAreaCode) &&
            isNullableViewport(value.viewport)
        );
    }
    return false;
}

function isSortKeyForQuery(value: unknown, query: CatalogCursorQuery): value is CatalogCursorSortKey {
    if (!isRecord(value) || typeof value.machineId !== 'string' || !MACHINE_ID_PATTERN.test(value.machineId)) {
        return false;
    }
    if (query.context.mode === 'USER_LOCATION') {
        return (
            hasExactKeys(value, ['mode', 'distanceMeters', 'machineId']) &&
            value.mode === 'DISTANCE' &&
            typeof value.distanceMeters === 'number' &&
            Number.isFinite(value.distanceMeters) &&
            value.distanceMeters >= 0
        );
    }
    return hasExactKeys(value, ['mode', 'machineId']) && value.mode === 'MACHINE_ID';
}

function sameDiscoveryContext(left: MachineDiscoveryContext, right: MachineDiscoveryContext): boolean {
    if (left.mode !== right.mode || !sameViewport(left.viewport, right.viewport)) return false;
    if (left.mode === 'USER_LOCATION' && right.mode === 'USER_LOCATION') {
        return (
            left.position.latitude === right.position.latitude && left.position.longitude === right.position.longitude
        );
    }
    return (
        left.mode === 'SERVICE_AREA' && right.mode === 'SERVICE_AREA' && left.serviceAreaCode === right.serviceAreaCode
    );
}

function sameViewport(left: MachineViewport | null, right: MachineViewport | null): boolean {
    if (left === null || right === null) return left === right;
    return (
        left.north === right.north && left.east === right.east && left.south === right.south && left.west === right.west
    );
}

function isCoordinates(value: unknown): boolean {
    return (
        isRecordWithKeys(value, ['latitude', 'longitude']) &&
        isFiniteWithin(value.latitude, -90, 90) &&
        isFiniteWithin(value.longitude, -180, 180)
    );
}

function isNullableViewport(value: unknown): value is MachineViewport | null {
    if (value === null) return true;
    return (
        isRecordWithKeys(value, ['north', 'east', 'south', 'west']) &&
        isFiniteWithin(value.north, -90, 90) &&
        isFiniteWithin(value.east, -180, 180) &&
        isFiniteWithin(value.south, -90, 90) &&
        isFiniteWithin(value.west, -180, 180) &&
        value.north > value.south &&
        value.east > value.west
    );
}

function isServiceAreaCode(value: unknown): boolean {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 64 &&
        value === value.trim() &&
        ![...value].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
        })
    );
}

function isFiniteWithin(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isRecordWithKeys<K extends string>(value: unknown, keys: readonly K[]): value is Readonly<Record<K, unknown>> {
    return isRecord(value) && hasExactKeys(value, keys);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isCanonicalBase64Url(value: string): boolean {
    if (value.length === 0 || !BASE64URL_PATTERN.test(value)) return false;
    return Buffer.from(value, 'base64url').toString('base64url') === value;
}
