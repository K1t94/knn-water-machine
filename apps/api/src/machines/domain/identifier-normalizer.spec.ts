import { describe, expect, it } from 'vitest';

import { normalizeMachineIdentifier } from './identifier-normalizer';
import { MachineValidationError } from './machine-validation';

function expectInvalidIdentifier(operation: () => unknown): void {
    try {
        operation();
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(MachineValidationError);
        expect(error).toMatchObject({ code: 'INVALID_IDENTIFIER' });
        return;
    }

    throw new Error('Expected INVALID_IDENTIFIER');
}

describe('normalizeMachineIdentifier', () => {
    it.each([
        ['current code', '  dkr-plateau-01  ', 'CURRENT_MANUAL', 'DKR-PLATEAU-01'],
        ['legacy code', ' wm-0001 ', 'LEGACY_MANUAL', 'WM-0001'],
    ] as const)('normalizes an exact %s with ASCII trim and uppercase', (_case, value, kind, normalizedValue) => {
        expect(normalizeMachineIdentifier({ source: 'MANUAL', value }, { legacyQrEnabled: false })).toEqual({
            kind,
            normalizedValue,
        });
    });

    it('parses only the supported versioned customer QR grammar', () => {
        expect(
            normalizeMachineIdentifier(
                { source: 'QR', value: 'kaynann://machine/v1/kdBu6l4X0dCVSatmsocVsQ' },
                { legacyQrEnabled: false },
            ),
        ).toEqual({
            kind: 'CURRENT_QR',
            normalizedValue: 'kdBu6l4X0dCVSatmsocVsQ',
        });
    });

    it('keeps the fixture legacy QR scheme disabled unless explicitly enabled', () => {
        const input = { source: 'QR', value: 'KNNLEGACY:0001' } as const;

        expectInvalidIdentifier(() => normalizeMachineIdentifier(input, { legacyQrEnabled: false }));
        expect(normalizeMachineIdentifier(input, { legacyQrEnabled: true })).toEqual({
            kind: 'LEGACY_QR',
            normalizedValue: 'KNNLEGACY:0001',
        });
    });

    it.each(['', 'DKR PLATEAU 01', 'DKR_PLATEAU_01', 'DKR--PLATEAU-01', 'DKR-PLATEAU-01!', '\u0414KR-PLATEAU-01'])(
        'rejects malformed manual payload %j',
        (value) => {
            expectInvalidIdentifier(() =>
                normalizeMachineIdentifier({ source: 'MANUAL', value }, { legacyQrEnabled: false }),
            );
        },
    );

    it.each([
        'kaynann://machine/v2/kdBu6l4X0dCVSatmsocVsQ',
        'KAYNANN://machine/v1/kdBu6l4X0dCVSatmsocVsQ',
        'kaynann://machine/v1/kdBu6l4X0dCVSatmsocVsQ/',
        'kaynann://machine/v1/kdBu6l4X0dCVSatmsocVsQ?next=https://example.test',
        'kaynann://machine/v1/not-a-machine-id',
        ' https://example.test/machine/kdBu6l4X0dCVSatmsocVsQ ',
        'wave://merchant/qr/12345',
        'orange-money://merchant/payment/12345',
        'KNNLEGACY:00001',
    ])('rejects malformed, untrusted, or payment-provider QR payload %j', (value) => {
        expectInvalidIdentifier(() => normalizeMachineIdentifier({ source: 'QR', value }, { legacyQrEnabled: true }));
    });
});
