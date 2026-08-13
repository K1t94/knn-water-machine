import { describe, expect, it } from 'vitest';

import {
    MachineValidationError,
    parseCoordinates,
    parseExactMoneyString,
    parseMachineId,
    parseMachineIdentifierInput,
    parseMachinePrice,
    parseServiceAreaCode,
    parseViewport,
} from './machine-validation';

function expectValidationError(operation: () => unknown, code: string): void {
    try {
        operation();
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(MachineValidationError);
        expect(error).toMatchObject({ code });
        return;
    }

    throw new Error(`Expected machine validation error ${code}`);
}

describe('machine boundary validation', () => {
    describe('exact price and currency', () => {
        it.each(['0.000001', '2.500000', '99999999999999.999999'])('accepts exact positive decimal %s', (value) => {
            expect(parseExactMoneyString(value)).toBe(value);
        });

        it.each([
            2.5,
            '0',
            '0.000000',
            '-1',
            '+1',
            '01',
            '.5',
            '1.',
            '1.0000000',
            '100000000000000',
            '1e2',
            ' 1.5 ',
            null,
        ])('rejects malformed, non-positive, or out-of-range decimal %s', (value) => {
            expectValidationError(() => parseExactMoneyString(value), 'INVALID_PRICE');
        });

        it('requires an explicitly supported uppercase ISO currency', () => {
            const supportedCurrencies = new Set(['XOF', 'RUB']);

            expect(parseMachinePrice({ amountPerLiter: '2.500000', currency: 'XOF' }, supportedCurrencies)).toEqual({
                amountPerLiter: '2.500000',
                currency: 'XOF',
            });
            for (const currency of ['xof', 'EURO', 'USD', '', 643]) {
                expectValidationError(
                    () => parseMachinePrice({ amountPerLiter: '2.500000', currency }, supportedCurrencies),
                    'INVALID_CURRENCY',
                );
            }
        });
    });

    describe('coordinates and viewport', () => {
        it('accepts an absent coordinate pair or a complete latitude-then-longitude pair', () => {
            expect(parseCoordinates({})).toBeNull();
            expect(parseCoordinates({ latitude: -90, longitude: 180 })).toEqual({ latitude: -90, longitude: 180 });
        });

        it.each([
            { latitude: 1 },
            { longitude: 1 },
            { latitude: -90.000001, longitude: 0 },
            { latitude: 0, longitude: 180.000001 },
            { latitude: Number.NaN, longitude: 0 },
            { latitude: 0, longitude: Number.POSITIVE_INFINITY },
            { latitude: '14.7', longitude: -17.4 },
            { latitude: null, longitude: null },
        ])('rejects an incomplete or invalid coordinate pair %#', (input) => {
            expectValidationError(() => parseCoordinates(input), 'INVALID_COORDINATES');
        });

        it('accepts an absent viewport or a bounded non-antimeridian rectangle', () => {
            expect(parseViewport({})).toBeNull();
            expect(parseViewport({ north: 56.1, east: 38.2, south: 55.4, west: 36.7 })).toEqual({
                north: 56.1,
                east: 38.2,
                south: 55.4,
                west: 36.7,
            });
        });

        it.each([
            { north: 1, east: 1, south: 0 },
            { north: 0, east: 1, south: 0, west: -1 },
            { north: 1, east: -1, south: 0, west: 1 },
            { north: 91, east: 1, south: 0, west: -1 },
            { north: 1, east: 181, south: 0, west: -1 },
            { north: 1, east: 1, south: Number.NaN, west: -1 },
        ])('rejects an incomplete, empty, reversed, or out-of-range viewport %#', (input) => {
            expectValidationError(() => parseViewport(input), 'INVALID_VIEWPORT');
        });
    });

    it('requires an explicit, trimmed service-area assignment within the storage limit', () => {
        expect(parseServiceAreaCode('  dakar-central  ')).toBe('dakar-central');
        expect(parseServiceAreaCode('a'.repeat(64))).toBe('a'.repeat(64));

        for (const value of [undefined, null, '', '   ', 'a'.repeat(65), 'area\u0000code']) {
            expectValidationError(() => parseServiceAreaCode(value), 'INVALID_SERVICE_AREA');
        }
    });

    it('accepts only an opaque 22-character base64url public machine ID', () => {
        expect(parseMachineId('7mQ3LJvR9Gf2xK8pNc4YAw')).toBe('7mQ3LJvR9Gf2xK8pNc4YAw');

        for (const value of [
            '7mQ3LJvR9Gf2xK8pNc4YA',
            '7mQ3LJvR9Gf2xK8pNc4YAwA',
            '7mQ3LJvR9Gf2xK8pNc4YA=',
            '7mQ3LJvR9Gf2xK8pNc4Y A',
            123,
        ]) {
            expectValidationError(() => parseMachineId(value), 'INVALID_MACHINE_ID');
        }
    });

    it('bounds identifier inputs and rejects non-printable or non-ASCII characters before normalization', () => {
        expect(parseMachineIdentifierInput({ source: 'QR', value: `kaynann://${'a'.repeat(2038)}` })).toEqual({
            source: 'QR',
            value: `kaynann://${'a'.repeat(2038)}`,
        });
        expect(parseMachineIdentifierInput({ source: 'MANUAL', value: ` ${'A'.repeat(254)} ` })).toEqual({
            source: 'MANUAL',
            value: ` ${'A'.repeat(254)} `,
        });

        for (const input of [
            { source: 'QR', value: 'a'.repeat(2049) },
            { source: 'MANUAL', value: 'a'.repeat(257) },
            { source: 'MANUAL', value: '   ' },
            { source: 'MANUAL', value: 'ABC\n123' },
            { source: 'MANUAL', value: 'АВС123' },
            { source: 'NFC', value: 'ABC123' },
            { source: 'QR', value: 123 },
        ]) {
            expectValidationError(() => parseMachineIdentifierInput(input), 'INVALID_IDENTIFIER');
        }
    });
});
