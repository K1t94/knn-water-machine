import type {
    CatalogCursor,
    CatalogRevision,
    CurrencyCode,
    ExactMoneyString,
    MachineAvailability,
    MachineCatalogPage,
    MachineCoordinates,
    MachineDetail,
    MachineId,
    MachinePricePerLiter,
    MachineRevision,
    MachineSelectionHandoff,
    MachineSummary,
} from '../machine-discovery/machine-discovery.types';

export interface MachineProblem {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly correlationId: string;
}

export interface MachineValidationProblem extends MachineProblem {
    readonly code: 'VALIDATION_ERROR';
    readonly retryable: false;
    readonly fields?: readonly Readonly<{ field: string; code: string }>[];
}

export interface MachineContextChangedProblem extends MachineProblem {
    readonly code: 'MACHINE_CONTEXT_CHANGED';
    readonly retryable: false;
    readonly currentMachine: MachineDetail;
}

export type MachineDiscoveryProblem = MachineProblem | MachineValidationProblem | MachineContextChangedProblem;

export class MachineDiscoveryContractError extends Error {
    constructor() {
        super('INVALID_MACHINE_DISCOVERY_RESPONSE');
        this.name = 'MachineDiscoveryContractError';
    }
}

const machineIdPattern = /^[A-Za-z0-9_-]{22}$/;
const revisionPattern = /^[1-9][0-9]*$/;
const exactMoneyPattern = /^[0-9]+(?:\.[0-9]{1,6})?$/;
const currencyPattern = /^[A-Z]{3}$/;
const problemCodePattern = /^[A-Z][A-Z0-9_]+$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function decodeMachineCatalogPage(payload: unknown): MachineCatalogPage {
    const value = exactObject(payload, ['items', 'hasMore', 'catalogRevision'], ['nextCursor']);
    if (!Array.isArray(value.items) || value.items.length > 100 || typeof value.hasMore !== 'boolean') {
        throw invalidContract();
    }

    return {
        items: value.items.map(decodeMachineSummary),
        ...(hasOwn(value, 'nextCursor') ? { nextCursor: decodeCursor(value.nextCursor) } : {}),
        hasMore: value.hasMore,
        catalogRevision: decodeCatalogRevision(value.catalogRevision),
    };
}

export function decodeMachineDetail(payload: unknown): MachineDetail {
    const value = machineObject(payload, ['selectable', 'refreshedAt']);
    if (typeof value.selectable !== 'boolean' || !isDateTime(value.refreshedAt)) throw invalidContract();

    return {
        ...decodeMachineFields(value),
        selectable: value.selectable,
        refreshedAt: value.refreshedAt,
    };
}

export function decodeMachineSelectionHandoff(payload: unknown): MachineSelectionHandoff {
    const value = exactObject(payload, ['machineId', 'machineRevision', 'price', 'availability', 'validatedAt']);
    if (value.availability !== 'ONLINE' || !isDateTime(value.validatedAt)) throw invalidContract();

    return {
        machineId: decodeMachineId(value.machineId),
        machineRevision: decodeMachineRevision(value.machineRevision),
        price: decodePrice(value.price),
        availability: value.availability,
        validatedAt: value.validatedAt,
    };
}

export function decodeMachineDiscoveryProblem(payload: unknown): MachineDiscoveryProblem {
    const candidate = record(payload);
    if (candidate.code === 'VALIDATION_ERROR') return decodeValidationProblem(payload);
    if (candidate.code === 'MACHINE_CONTEXT_CHANGED') return decodeContextChangedProblem(payload);

    const value = exactObject(payload, ['code', 'message', 'retryable', 'correlationId']);
    return decodeProblemFields(value);
}

function decodeMachineSummary(payload: unknown): MachineSummary {
    return decodeMachineFields(machineObject(payload));
}

function machineObject(payload: unknown, extraRequired: readonly string[] = []): Record<string, unknown> {
    return exactObject(
        payload,
        ['machineId', 'displayName', 'address', 'status', 'machineRevision', ...extraRequired],
        ['coordinates', 'distanceMeters', 'price'],
    );
}

function decodeMachineFields(value: Record<string, unknown>): MachineSummary {
    if (!isBoundedString(value.displayName, 1, 120) || !isBoundedString(value.address, 1, 300)) {
        throw invalidContract();
    }

    return {
        machineId: decodeMachineId(value.machineId),
        displayName: value.displayName,
        address: value.address,
        ...(hasOwn(value, 'coordinates') ? { coordinates: decodeCoordinates(value.coordinates) } : {}),
        ...(hasOwn(value, 'distanceMeters') ? { distanceMeters: decodeDistance(value.distanceMeters) } : {}),
        ...(hasOwn(value, 'price') ? { price: decodePrice(value.price) } : {}),
        status: decodeAvailability(value.status),
        machineRevision: decodeMachineRevision(value.machineRevision),
    };
}

function decodeCoordinates(payload: unknown): MachineCoordinates {
    const value = exactObject(payload, ['latitude', 'longitude']);
    if (!isNumberInRange(value.latitude, -90, 90) || !isNumberInRange(value.longitude, -180, 180)) {
        throw invalidContract();
    }
    return { latitude: value.latitude, longitude: value.longitude };
}

function decodePrice(payload: unknown): MachinePricePerLiter {
    const value = exactObject(payload, ['amountPerLiter', 'currency']);
    if (!matches(value.amountPerLiter, exactMoneyPattern) || !matches(value.currency, currencyPattern)) {
        throw invalidContract();
    }
    return {
        amountPerLiter: value.amountPerLiter as ExactMoneyString,
        currency: value.currency as CurrencyCode,
    };
}

function decodeValidationProblem(payload: unknown): MachineValidationProblem {
    const value = exactObject(payload, ['code', 'message', 'retryable', 'correlationId'], ['fields']);
    if (value.code !== 'VALIDATION_ERROR' || value.retryable !== false) throw invalidContract();
    const common = decodeProblemFields(value);

    if (!hasOwn(value, 'fields')) return { ...common, code: value.code, retryable: value.retryable };
    if (!Array.isArray(value.fields) || value.fields.length > 20) throw invalidContract();

    return {
        ...common,
        code: value.code,
        retryable: value.retryable,
        fields: value.fields.map((field) => {
            const item = exactObject(field, ['field', 'code']);
            if (typeof item.field !== 'string' || typeof item.code !== 'string') throw invalidContract();
            return { field: item.field, code: item.code };
        }),
    };
}

function decodeContextChangedProblem(payload: unknown): MachineContextChangedProblem {
    const value = exactObject(payload, ['code', 'message', 'retryable', 'correlationId', 'currentMachine']);
    if (value.code !== 'MACHINE_CONTEXT_CHANGED' || value.retryable !== false) throw invalidContract();

    return {
        ...decodeProblemFields(value),
        code: value.code,
        retryable: value.retryable,
        currentMachine: decodeMachineDetail(value.currentMachine),
    };
}

function decodeProblemFields(value: Record<string, unknown>): MachineProblem {
    if (
        !matches(value.code, problemCodePattern) ||
        typeof value.message !== 'string' ||
        typeof value.retryable !== 'boolean' ||
        typeof value.correlationId !== 'string'
    ) {
        throw invalidContract();
    }
    return {
        code: value.code,
        message: value.message,
        retryable: value.retryable,
        correlationId: value.correlationId,
    };
}

function decodeMachineId(value: unknown): MachineId {
    if (!matches(value, machineIdPattern)) throw invalidContract();
    return value as MachineId;
}

function decodeMachineRevision(value: unknown): MachineRevision {
    if (!matches(value, revisionPattern)) throw invalidContract();
    return value as MachineRevision;
}

function decodeCatalogRevision(value: unknown): CatalogRevision {
    if (!matches(value, revisionPattern)) throw invalidContract();
    return value as CatalogRevision;
}

function decodeCursor(value: unknown): CatalogCursor {
    if (typeof value !== 'string') throw invalidContract();
    return value as CatalogCursor;
}

function decodeAvailability(value: unknown): MachineAvailability {
    if (value !== 'ONLINE' && value !== 'SERVICE' && value !== 'OFFLINE') throw invalidContract();
    return value;
}

function decodeDistance(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidContract();
    return value;
}

function exactObject(
    payload: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = [],
): Record<string, unknown> {
    const value = record(payload);
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    if (requiredKeys.some((key) => !hasOwn(value, key)) || Object.keys(value).some((key) => !allowedKeys.has(key))) {
        throw invalidContract();
    }
    return value;
}

function record(payload: unknown): Record<string, unknown> {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw invalidContract();
    return payload as Record<string, unknown>;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.test(value);
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
    return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isDateTime(value: unknown): value is string {
    return typeof value === 'string' && dateTimePattern.test(value) && Number.isFinite(Date.parse(value));
}

function invalidContract(): MachineDiscoveryContractError {
    return new MachineDiscoveryContractError();
}
