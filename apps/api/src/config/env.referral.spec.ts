import { describe, expect, it } from 'vitest';

import { MAX_REFERRAL_MILLILITRES } from '../referral/domain/referral-types';

import { loadEnv } from './env';

const secret32 = Buffer.alloc(32, 7).toString('base64url');

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'test-client',
        OTP_HMAC_KEY: secret32,
        CREDENTIAL_HMAC_KEY: secret32,
        FINGERPRINT_HMAC_KEY: secret32,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret32,
        JWT_ACCESS_SIGNING_KEY: secret32,
        ...overrides,
    };
}

function restrictedEnv(appEnv: 'staging' | 'production', overrides: Record<string, string | undefined> = {}) {
    return validEnv({
        APP_ENV: appEnv,
        SMS_PROVIDER: 'orange',
        ORANGE_SMS_CLIENT_ID: 'client',
        ORANGE_SMS_CLIENT_SECRET: 'secret',
        ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
        ORANGE_SMS_SENDER_NAME: 'KAYNANN',
        ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
        ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
        REFERRAL_WELCOME_BONUS_ML: '10000',
        REFERRAL_INVITER_BONUS_ML: '5000',
        ...overrides,
    });
}

describe('referral bonus environment', () => {
    it.each(['development', 'test'] as const)('uses exact bigint defaults in %s', (appEnv) => {
        const env = loadEnv(validEnv({ APP_ENV: appEnv }));

        expect(env.REFERRAL_WELCOME_BONUS_ML).toBe(10_000n);
        expect(env.REFERRAL_INVITER_BONUS_ML).toBe(5_000n);
    });

    it.each(['staging', 'production'] as const)('requires both values in %s', (appEnv) => {
        expect(() =>
            loadEnv(
                restrictedEnv(appEnv, {
                    REFERRAL_WELCOME_BONUS_ML: undefined,
                    REFERRAL_INVITER_BONUS_ML: undefined,
                }),
            ),
        ).toThrow(/REFERRAL_WELCOME_BONUS_ML.*REFERRAL_INVITER_BONUS_ML/);
    });

    it('accepts explicit exact values in restricted environments', () => {
        const env = loadEnv(
            restrictedEnv('production', {
                REFERRAL_WELCOME_BONUS_ML: '12000',
                REFERRAL_INVITER_BONUS_ML: '6000',
            }),
        );

        expect(env.REFERRAL_WELCOME_BONUS_ML).toBe(12_000n);
        expect(env.REFERRAL_INVITER_BONUS_ML).toBe(6_000n);
    });

    it.each(['0', '-1', '1.5', '1e4', `${MAX_REFERRAL_MILLILITRES + 1n}`])(
        'rejects invalid welcome amount %s',
        (value) => {
            expect(() => loadEnv(validEnv({ REFERRAL_WELCOME_BONUS_ML: value }))).toThrow(/REFERRAL_WELCOME_BONUS_ML/);
        },
    );

    it.each(['0', '-1', '1.5', '1e4', `${MAX_REFERRAL_MILLILITRES + 1n}`])(
        'rejects invalid inviter amount %s',
        (value) => {
            expect(() => loadEnv(validEnv({ REFERRAL_INVITER_BONUS_ML: value }))).toThrow(/REFERRAL_INVITER_BONUS_ML/);
        },
    );
});
