import { describe, expect, it } from 'vitest';

import { loadEnv, type AppEnv } from '../config/env';

import { createMachineDiscoveryConfig } from './machines.module';

const secret = (fill: number) => Buffer.alloc(32, fill).toString('base64url');
const localDefaultCursorSecret = Buffer.alloc(32).toString('base64url');

const safeProductionEnv: Record<string, string> = {
    NODE_ENV: 'test',
    APP_ENV: 'production',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'machine-production-gates',
    OTP_HMAC_KEY: secret(1),
    CREDENTIAL_HMAC_KEY: secret(2),
    FINGERPRINT_HMAC_KEY: secret(3),
    REGISTRATION_RESULT_ENCRYPTION_KEY: secret(4),
    JWT_ACCESS_SIGNING_KEY: secret(5),
    REFERRAL_INVITER_BONUS_ML: '5000',
    REFERRAL_OPERATIONS_TOKEN: secret(6),
    MACHINE_CURSOR_HMAC_KEY: secret(7),
    MACHINE_GATEWAY_MODE: 'disabled',
    MACHINE_FIXTURE_MODE: 'false',
    MACHINE_LEGACY_QR_ENABLED: 'false',
    SMS_PROVIDER: 'orange',
    FAKE_SMS_EXPOSE_OTP: 'false',
    ORANGE_SMS_CLIENT_ID: 'client',
    ORANGE_SMS_CLIENT_SECRET: 'orange-secret',
    ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
    ORANGE_SMS_SENDER_NAME: 'KAYNANN',
    ORANGE_SMS_API_URL: 'https://api.example.test/smsmessaging/v1',
    ORANGE_SMS_OAUTH_URL: 'https://api.example.test/oauth/v3/token',
};

function productionConfig(overrides: Partial<AppEnv> = {}): AppEnv {
    return {
        ...loadEnv(safeProductionEnv),
        ...overrides,
    };
}

describe('machine production startup gates', () => {
    it.each([
        ['MACHINE_GATEWAY_MODE', { MACHINE_GATEWAY_MODE: 'emulator' }],
        ['MACHINE_FIXTURE_MODE', { MACHINE_FIXTURE_MODE: true }],
        ['MACHINE_LEGACY_QR_ENABLED', { MACHINE_LEGACY_QR_ENABLED: true }],
    ] as const)('refuses %s in production', (field, overrides) => {
        const env = productionConfig(overrides);

        expect(() => createMachineDiscoveryConfig(env)).toThrow(field);
    });

    it('refuses the built-in local cursor secret in production', () => {
        const env = productionConfig({ MACHINE_CURSOR_HMAC_KEY: localDefaultCursorSecret });

        expect(() => createMachineDiscoveryConfig(env)).toThrow(/MACHINE_CURSOR_HMAC_KEY.*default/i);
    });

    it('refuses a cursor secret reused by another production purpose', () => {
        const env = productionConfig({ MACHINE_CURSOR_HMAC_KEY: safeProductionEnv.OTP_HMAC_KEY });

        expect(() => createMachineDiscoveryConfig(env)).toThrow(/MACHINE_CURSOR_HMAC_KEY.*OTP_HMAC_KEY/i);
    });

    it('accepts a dedicated non-default cursor secret in production', () => {
        const config = createMachineDiscoveryConfig(productionConfig());

        expect(config.cursorHmacKey).toBe(secret(7));
    });

    it('preserves the existing staging cursor policy', () => {
        const env = productionConfig({
            APP_ENV: 'staging',
            MACHINE_CURSOR_HMAC_KEY: localDefaultCursorSecret,
        });
        const config = createMachineDiscoveryConfig(env);

        expect(config.cursorHmacKey).toBe(localDefaultCursorSecret);
    });
});
