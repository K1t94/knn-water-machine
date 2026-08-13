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
        MACHINE_CURSOR_HMAC_KEY: secret32,
        ...overrides,
    };
}

function restrictedEnv(
    appEnv: 'staging' | 'production',
    overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
    return validEnv({
        APP_ENV: appEnv,
        SMS_PROVIDER: 'orange',
        ORANGE_SMS_CLIENT_ID: 'client',
        ORANGE_SMS_CLIENT_SECRET: 'secret',
        ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
        ORANGE_SMS_SENDER_NAME: 'KAYNANN',
        ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
        ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
        ...overrides,
    });
}

describe('machine discovery environment', () => {
    it('exposes typed safe defaults', () => {
        const env = loadEnv(validEnv());

        expect(env).toMatchObject({
            MACHINE_CURSOR_HMAC_KEY: secret32,
            MACHINE_CURSOR_TTL_SECONDS: 300,
            MACHINE_AVAILABILITY_FRESHNESS_SECONDS: 60,
            MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS: 5,
            MACHINE_SERVICE_AREA_NORTH: 56.1,
            MACHINE_SERVICE_AREA_EAST: 38.2,
            MACHINE_SERVICE_AREA_SOUTH: 55.4,
            MACHINE_SERVICE_AREA_WEST: 36.7,
            MACHINE_GATEWAY_MODE: 'disabled',
            MACHINE_FIXTURE_MODE: false,
            MACHINE_LEGACY_QR_ENABLED: false,
        });
    });

    it('parses explicit local emulator and fixture settings', () => {
        const env = loadEnv(
            validEnv({
                MACHINE_GATEWAY_MODE: 'emulator',
                MACHINE_FIXTURE_MODE: 'true',
                MACHINE_CURSOR_TTL_SECONDS: '120',
                MACHINE_AVAILABILITY_FRESHNESS_SECONDS: '45',
                MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS: '3',
            }),
        );

        expect(env.MACHINE_GATEWAY_MODE).toBe('emulator');
        expect(env.MACHINE_FIXTURE_MODE).toBe(true);
        expect(env.MACHINE_CURSOR_TTL_SECONDS).toBe(120);
        expect(env.MACHINE_AVAILABILITY_FRESHNESS_SECONDS).toBe(45);
        expect(env.MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS).toBe(3);
    });

    it.each(['short', 'not+base64url', Buffer.alloc(31, 1).toString('base64url')])(
        'rejects an invalid cursor secret %s',
        (value) => {
            expect(() => loadEnv(validEnv({ MACHINE_CURSOR_HMAC_KEY: value }))).toThrow(/MACHINE_CURSOR_HMAC_KEY/);
        },
    );

    it.each([
        ['MACHINE_CURSOR_TTL_SECONDS', '0'],
        ['MACHINE_AVAILABILITY_FRESHNESS_SECONDS', '0'],
        ['MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS', '-1'],
        ['MACHINE_SERVICE_AREA_NORTH', '91'],
        ['MACHINE_SERVICE_AREA_EAST', '181'],
        ['MACHINE_SERVICE_AREA_SOUTH', '-91'],
        ['MACHINE_SERVICE_AREA_WEST', '-181'],
    ])('rejects invalid %s', (field, value) => {
        expect(() => loadEnv(validEnv({ [field]: value }))).toThrow(field);
    });

    it.each([
        {
            MACHINE_SERVICE_AREA_NORTH: '55.4',
            MACHINE_SERVICE_AREA_SOUTH: '56.1',
        },
        {
            MACHINE_SERVICE_AREA_EAST: '36.7',
            MACHINE_SERVICE_AREA_WEST: '38.2',
        },
    ])('rejects an inverted default service area', (overrides) => {
        expect(() => loadEnv(validEnv(overrides))).toThrow(/MACHINE_SERVICE_AREA_(NORTH|WEST)/);
    });

    it.each([
        ['MACHINE_GATEWAY_MODE', 'emulator'],
        ['MACHINE_FIXTURE_MODE', 'true'],
        ['MACHINE_LEGACY_QR_ENABLED', 'true'],
    ])('rejects %s in restricted environments', (field, value) => {
        expect(() => loadEnv(restrictedEnv('production', { [field]: value }))).toThrow(field);
    });

    it('keeps restricted machine discovery disabled by default', () => {
        const env = loadEnv(restrictedEnv('production'));

        expect(env.MACHINE_GATEWAY_MODE).toBe('disabled');
        expect(env.MACHINE_FIXTURE_MODE).toBe(false);
        expect(env.MACHINE_LEGACY_QR_ENABLED).toBe(false);
    });
});
