import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SetReferralFeatureOperationDto, toReferralFeatureOperationResponse } from './referral-feature-operation.dto';

describe('referral feature operation DTO', () => {
    it.each([true, false])('accepts the boolean value %s', async (enabled) => {
        expect(await validate(plainToInstance(SetReferralFeatureOperationDto, { enabled }))).toHaveLength(0);
    });

    it.each(['true', 1, null, undefined])('rejects non-boolean input %s', async (enabled) => {
        expect(await validate(plainToInstance(SetReferralFeatureOperationDto, { enabled }))).not.toHaveLength(0);
    });

    it('serializes revision and timestamp without exposing bigint', () => {
        expect(
            toReferralFeatureOperationResponse({
                key: 'REFERRAL_PROGRAM',
                enabled: true,
                revision: 42n,
                updatedAt: new Date('2026-08-12T12:00:00.000Z'),
            }),
        ).toEqual({
            key: 'REFERRAL_PROGRAM',
            enabled: true,
            revision: '42',
            updatedAt: '2026-08-12T12:00:00.000Z',
        });
    });
});
