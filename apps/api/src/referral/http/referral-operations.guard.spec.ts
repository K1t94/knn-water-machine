import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralOperationsGuard, safeTokenEqual } from './referral-operations.guard';

import type { ExecutionContext } from '@nestjs/common';

const token = Buffer.alloc(32, 7).toString('base64url');

describe('ReferralOperationsGuard', () => {
    beforeEach(() => {
        const values = {
            NODE_ENV: 'test',
            APP_ENV: 'test',
            DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            REDIS_URL: 'redis://localhost:6379',
            MQTT_URL: 'mqtt://localhost:1883',
            MQTT_CLIENT_ID: 'referral-operations-guard',
            SMS_PROVIDER: 'fake',
            OTP_HMAC_KEY: token,
            CREDENTIAL_HMAC_KEY: token,
            FINGERPRINT_HMAC_KEY: token,
            REGISTRATION_RESULT_ENCRYPTION_KEY: token,
            JWT_ACCESS_SIGNING_KEY: token,
            REFERRAL_OPERATIONS_TOKEN: token,
        };
        for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    });

    it('accepts only the configured bearer token', () => {
        const guard = new ReferralOperationsGuard();
        expect(guard.canActivate(contextWith(`Bearer ${token}`))).toBe(true);
        expect(() => guard.canActivate(contextWith('Bearer wrong'))).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(contextWith(undefined))).toThrow(UnauthorizedException);
    });

    it('compares fixed-size digests and rejects empty values', () => {
        expect(safeTokenEqual(token, token)).toBe(true);
        expect(safeTokenEqual(token, `${token}x`)).toBe(false);
        expect(safeTokenEqual('', '')).toBe(false);
    });
});

function contextWith(authorization: string | undefined): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ headers: { authorization } }),
        }),
    } as ExecutionContext;
}
