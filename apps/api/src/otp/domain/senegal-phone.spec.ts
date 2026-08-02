import { describe, expect, it } from 'vitest';

import { normalizeSenegalPhone, PhoneValidationError } from './senegal-phone';

describe('normalizeSenegalPhone', () => {
    it.each([
        ['77 123 45 67', '+221771234567'],
        ['771234567', '+221771234567'],
        ['+221 77 123 45 67', '+221771234567'],
        ['00221 77 123 45 67', '+221771234567'],
    ])('normalizes %s to E.164', (input, expected) => {
        expect(normalizeSenegalPhone(input)).toBe(expected);
    });

    it.each(['77123', 'not-a-phone', '+2217712345678'])('rejects invalid input %s', (input) => {
        expect(() => normalizeSenegalPhone(input)).toThrow(PhoneValidationError);
    });

    it('rejects a valid number from another country', () => {
        try {
            normalizeSenegalPhone('+33612345678');
            throw new Error('Expected phone validation to fail');
        } catch (error: unknown) {
            expect(error).toMatchObject({ code: 'UNSUPPORTED_COUNTRY' });
        }
    });
});
