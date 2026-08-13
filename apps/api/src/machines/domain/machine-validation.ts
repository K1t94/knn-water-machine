import type {
    CurrencyCode,
    ExactMoneyString,
    MachineCoordinates,
    MachineId,
    MachineIdentifierInput,
    MachinePricePerLiter,
    MachineViewport,
} from './machine.types';

export type MachineValidationErrorCode =
    | 'INVALID_PRICE'
    | 'INVALID_CURRENCY'
    | 'INVALID_COORDINATES'
    | 'INVALID_VIEWPORT'
    | 'INVALID_SERVICE_AREA'
    | 'INVALID_MACHINE_ID'
    | 'INVALID_IDENTIFIER';

export class MachineValidationError extends Error {
    constructor(public readonly code: MachineValidationErrorCode) {
        super(code);
        this.name = 'MachineValidationError';
    }
}

const EXACT_MONEY_PATTERN = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;

function invalid(code: MachineValidationErrorCode): never {
    throw new MachineValidationError(code);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumberWithin(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function containsControlCharacter(value: string): boolean {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
}

export function parseExactMoneyString(value: unknown): ExactMoneyString {
    if (typeof value !== 'string' || !EXACT_MONEY_PATTERN.test(value) || /^0(?:\.0+)?$/.test(value)) {
        return invalid('INVALID_PRICE');
    }

    return value as ExactMoneyString;
}

export function parseCurrencyCode(value: unknown, supportedCurrencies: ReadonlySet<string>): CurrencyCode {
    if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value) || !supportedCurrencies.has(value)) {
        return invalid('INVALID_CURRENCY');
    }

    return value as CurrencyCode;
}

export function parseMachinePrice(value: unknown, supportedCurrencies: ReadonlySet<string>): MachinePricePerLiter {
    if (!isRecord(value)) return invalid('INVALID_PRICE');

    const amountPerLiter = parseExactMoneyString(value.amountPerLiter);
    const currency = parseCurrencyCode(value.currency, supportedCurrencies);

    return { amountPerLiter, currency };
}

export function parseCoordinates(value: unknown): MachineCoordinates | null {
    if (!isRecord(value)) return invalid('INVALID_COORDINATES');

    const { latitude, longitude } = value;
    if (latitude === undefined && longitude === undefined) return null;
    if (!isFiniteNumberWithin(latitude, -90, 90) || !isFiniteNumberWithin(longitude, -180, 180)) {
        return invalid('INVALID_COORDINATES');
    }

    return { latitude, longitude };
}

export function parseViewport(value: unknown): MachineViewport | null {
    if (!isRecord(value)) return invalid('INVALID_VIEWPORT');

    const { north, east, south, west } = value;
    if (north === undefined && east === undefined && south === undefined && west === undefined) return null;
    if (
        !isFiniteNumberWithin(north, -90, 90) ||
        !isFiniteNumberWithin(east, -180, 180) ||
        !isFiniteNumberWithin(south, -90, 90) ||
        !isFiniteNumberWithin(west, -180, 180) ||
        north <= south ||
        east <= west
    ) {
        return invalid('INVALID_VIEWPORT');
    }

    return { north, east, south, west };
}

export function parseServiceAreaCode(value: unknown): string {
    if (typeof value !== 'string') return invalid('INVALID_SERVICE_AREA');

    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 64 || containsControlCharacter(normalized)) {
        return invalid('INVALID_SERVICE_AREA');
    }

    return normalized;
}

export function parseMachineId(value: unknown): MachineId {
    if (typeof value !== 'string' || !MACHINE_ID_PATTERN.test(value)) {
        return invalid('INVALID_MACHINE_ID');
    }

    return value as MachineId;
}

export function parseMachineIdentifierInput(value: unknown): MachineIdentifierInput {
    if (!isRecord(value) || (value.source !== 'QR' && value.source !== 'MANUAL') || typeof value.value !== 'string') {
        return invalid('INVALID_IDENTIFIER');
    }

    const maximumLength = value.source === 'QR' ? 2048 : 256;
    if (
        value.value.length > maximumLength ||
        value.value.trim().length === 0 ||
        !PRINTABLE_ASCII_PATTERN.test(value.value)
    ) {
        return invalid('INVALID_IDENTIFIER');
    }

    return { source: value.source, value: value.value };
}
