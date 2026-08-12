import { describe, expect, it } from 'vitest';

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
        REFERRAL_INVITER_BONUS_ML: '5000',
        REFERRAL_OPERATIONS_TOKEN: secret32,
        ...overrides,
    };
}

describe('authentication environment', () => {
    it('rejects unsupported APP_ENV values', () => {
        expect(() => loadEnv(validEnv({ APP_ENV: 'preview' }))).toThrow(/APP_ENV/);
    });

    it('keeps APP_ENV independent from NODE_ENV', () => {
        const env = loadEnv(validEnv({ NODE_ENV: 'production', APP_ENV: 'test' }));

        expect(env.NODE_ENV).toBe('production');
        expect(env.APP_ENV).toBe('test');
        expect(env.SMS_PROVIDER).toBe('fake');
    });

    it.each(['staging', 'production'])('rejects fake SMS in %s based on APP_ENV', (appEnv) => {
        expect(() =>
            loadEnv(
                validEnv({
                    NODE_ENV: 'development',
                    APP_ENV: appEnv,
                    SMS_PROVIDER: 'fake',
                }),
            ),
        ).toThrow(/SMS_PROVIDER/);
    });

    it('requires an exact 32-byte registration-result key and retains its version', () => {
        expect(() =>
            loadEnv(
                validEnv({
                    REGISTRATION_RESULT_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64url'),
                }),
            ),
        ).toThrow(/REGISTRATION_RESULT_ENCRYPTION_KEY/);

        expect(
            loadEnv(
                validEnv({
                    REGISTRATION_RESULT_KEY_VERSION: 'v7',
                }),
            ).REGISTRATION_RESULT_KEY_VERSION,
        ).toBe('v7');
    });

    it.each(['OTP_HMAC_KEY', 'CREDENTIAL_HMAC_KEY', 'FINGERPRINT_HMAC_KEY', 'JWT_ACCESS_SIGNING_KEY'])(
        'rejects invalid or undersized %s',
        (field) => {
            expect(() => loadEnv(validEnv({ [field]: 'not+base64url' }))).toThrow(field);
        },
    );

    it('applies alert defaults and rejects invalid ordering or ranges', () => {
        const env = loadEnv(validEnv());
        expect([
            env.SMS_DAILY_COUNT_WARNING_PERCENT,
            env.SMS_DAILY_COUNT_CRITICAL_PERCENT,
            env.SMS_DAILY_XOF_WARNING_PERCENT,
            env.SMS_DAILY_XOF_CRITICAL_PERCENT,
        ]).toEqual([80, 95, 80, 95]);

        expect(() =>
            loadEnv(
                validEnv({
                    SMS_DAILY_COUNT_WARNING_PERCENT: '95',
                    SMS_DAILY_COUNT_CRITICAL_PERCENT: '95',
                }),
            ),
        ).toThrow(/SMS_DAILY_COUNT_WARNING_PERCENT/);
        expect(() =>
            loadEnv(
                validEnv({
                    SMS_DAILY_XOF_WARNING_PERCENT: '0',
                }),
            ),
        ).toThrow(/SMS_DAILY_XOF_WARNING_PERCENT/);
        expect(() =>
            loadEnv(
                validEnv({
                    SMS_DAILY_XOF_CRITICAL_PERCENT: '100',
                }),
            ),
        ).toThrow(/SMS_DAILY_XOF_WARNING_PERCENT/);
    });

    it('requires Orange server settings only for the Orange provider', () => {
        expect(() => loadEnv(validEnv({ SMS_PROVIDER: 'orange' }))).toThrow(/ORANGE_SMS_CLIENT_ID/);

        expect(
            loadEnv(
                validEnv({
                    SMS_PROVIDER: 'orange',
                    ORANGE_SMS_CLIENT_ID: 'client',
                    ORANGE_SMS_CLIENT_SECRET: 'secret',
                    ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
                    ORANGE_SMS_SENDER_NAME: 'KAYNANN',
                    ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
                    ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
                }),
            ).SMS_PROVIDER,
        ).toBe('orange');
    });

    it('requires both the callback URL and source allowlist when receipts are enabled', () => {
        expect(() => loadEnv(validEnv({ ORANGE_SMS_DR_ENABLED: 'true' }))).toThrow(/ORANGE_SMS_DR_CALLBACK_URL/);
        expect(() =>
            loadEnv(
                validEnv({
                    ORANGE_SMS_DR_ENABLED: 'true',
                    ORANGE_SMS_DR_CALLBACK_URL: 'https://callback.example.test/receipts',
                }),
            ),
        ).toThrow(/ORANGE_SMS_DR_ALLOWED_IPS/);
        expect(
            loadEnv(
                validEnv({
                    ORANGE_SMS_DR_ENABLED: 'true',
                    ORANGE_SMS_DR_CALLBACK_URL: 'https://callback.example.test/receipts',
                    ORANGE_SMS_DR_ALLOWED_IPS: '127.0.0.1',
                }),
            ).ORANGE_SMS_DR_ENABLED,
        ).toBe(true);
    });

    it('allows disabled metrics without a token', () => {
        expect(
            loadEnv(
                validEnv({
                    APP_ENV: 'production',
                    SMS_PROVIDER: 'orange',
                    ORANGE_SMS_CLIENT_ID: 'client',
                    ORANGE_SMS_CLIENT_SECRET: 'secret',
                    ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
                    ORANGE_SMS_SENDER_NAME: 'KAYNANN',
                    ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
                    ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
                    INTERNAL_METRICS_ENABLED: 'false',
                }),
            ).INTERNAL_METRICS_TOKEN,
        ).toBeUndefined();
    });

    it.each(['staging', 'production'])('requires a valid metrics token when enabled in %s', (appEnv) => {
        const base = {
            APP_ENV: appEnv,
            SMS_PROVIDER: 'orange',
            ORANGE_SMS_CLIENT_ID: 'client',
            ORANGE_SMS_CLIENT_SECRET: 'secret',
            ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
            ORANGE_SMS_SENDER_NAME: 'KAYNANN',
            ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
            ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
            INTERNAL_METRICS_ENABLED: 'true',
        };
        expect(() => loadEnv(validEnv(base))).toThrow(/INTERNAL_METRICS_TOKEN/);
        expect(() =>
            loadEnv(
                validEnv({
                    ...base,
                    INTERNAL_METRICS_TOKEN: secret32,
                }),
            ),
        ).not.toThrow();
    });
});
