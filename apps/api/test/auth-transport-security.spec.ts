import { describe, expect, it, vi } from 'vitest';

import { authRequestContext } from '../src/auth/http/auth-request-context.middleware';
import { loadEnv } from '../src/config/env';

import type { NextFunction, Request, Response } from 'express';

describe('authentication transport boundary', () => {
    it.each(['/v1/auth/otp/requests', '/v1/integrations/orange/sms/delivery-receipts'])(
        'rejects insecure production request to %s despite spoofed proxy headers',
        (path) => {
            const response = responseMock();
            const next = vi.fn() as NextFunction;
            authRequestContext(env('production'))(requestMock(path, false), response, next);
            expect(response.status).toHaveBeenCalledWith(400);
            expect(next).not.toHaveBeenCalled();
        },
    );

    it('accepts a secure production request and extracts only bounded metadata', () => {
        const request = requestMock('/v1/auth/otp/requests', true);
        const response = responseMock();
        const next = vi.fn() as NextFunction;
        authRequestContext(env('production'))(request, response, next);
        expect(next).toHaveBeenCalledOnce();
        expect(request.authRequestMetadata).toMatchObject({ ipAddress: '127.0.0.1' });
        expect(request.authRequestMetadata?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('allows isolated local development over HTTP', () => {
        const response = responseMock();
        const next = vi.fn() as NextFunction;
        authRequestContext(env('development'))(requestMock('/v1/auth/otp/requests', false), response, next);
        expect(next).toHaveBeenCalledOnce();
    });
});

function requestMock(path: string, secure: boolean) {
    const headers = {
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-proto': 'https',
        'x-request-id': 'not-a-uuid',
    };
    return {
        path,
        secure,
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
        header(name: string) {
            return headers[name.toLowerCase() as keyof typeof headers];
        },
    } as unknown as Request & {
        authRequestMetadata?: { requestId: string; ipAddress: string; userAgent?: string };
    };
}

function responseMock() {
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);
    return response as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function env(appEnv: 'development' | 'production') {
    const secret = Buffer.alloc(32, 7).toString('base64url');
    return loadEnv({
        NODE_ENV: appEnv === 'production' ? 'production' : 'development',
        APP_ENV: appEnv,
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'transport-test',
        SMS_PROVIDER: 'orange',
        ORANGE_SMS_CLIENT_ID: 'client',
        ORANGE_SMS_CLIENT_SECRET: 'secret',
        ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
        ORANGE_SMS_SENDER_NAME: 'KAYNANN',
        ORANGE_SMS_API_URL: 'https://example.test/sms',
        ORANGE_SMS_OAUTH_URL: 'https://example.test/oauth',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        REFERRAL_INVITER_BONUS_ML: '5000',
        REFERRAL_OPERATIONS_TOKEN: secret,
    });
}
