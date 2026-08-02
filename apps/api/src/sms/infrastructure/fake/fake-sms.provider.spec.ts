import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSmsOutbox } from './fake-sms.outbox';
import { FakeSmsProvider } from './fake-sms.provider';

const recipient = '+221771234567';
const command = {
    recipientE164: recipient,
    message: 'KAYNANN code: 123456. Valid for 5 minutes.',
    correlationId: '00000000-0000-4000-8000-000000000001',
};
const secret = Buffer.alloc(32, 9).toString('base64url');

function configureFakeEnvironment(overrides: Record<string, string> = {}): void {
    const baseline = {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'fake-sms-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        SMS_PROVIDER: 'fake',
        FAKE_SMS_EXPOSE_OTP: 'false',
        FAKE_SMS_TEST_NUMBERS: recipient,
        ...overrides,
    };
    for (const [key, value] of Object.entries(baseline)) {
        vi.stubEnv(key, value);
    }
}

beforeEach(() => configureFakeEnvironment());
afterEach(() => vi.unstubAllEnvs());

describe('FakeSmsProvider local inspection', () => {
    it('exposes OTP only for an allowlisted number in local/test mode', async () => {
        configureFakeEnvironment({ FAKE_SMS_EXPOSE_OTP: 'true' });
        const outbox = new FakeSmsOutbox();
        const provider = new FakeSmsProvider(outbox);

        const response = await provider.send(command);

        expect(outbox.latestFor(recipient)).toEqual({
            recipientE164: recipient,
            otp: '123456',
            correlationId: command.correlationId,
        });
        expect(response).not.toHaveProperty('otp');
        expect(JSON.stringify(response)).not.toContain('123456');
    });

    it('does not expose OTP for a number outside the allowlist', async () => {
        configureFakeEnvironment({
            FAKE_SMS_EXPOSE_OTP: 'true',
            FAKE_SMS_TEST_NUMBERS: '+221781111111',
        });
        const outbox = new FakeSmsOutbox();
        await new FakeSmsProvider(outbox).send(command);

        expect(outbox.latestFor(recipient)).toBeUndefined();
    });

    it.each(['staging', 'production'])('rejects direct use in %s', (appEnv) => {
        configureFakeEnvironment({ APP_ENV: appEnv });
        expect(() => new FakeSmsProvider(new FakeSmsOutbox())).toThrow(/Invalid environment configuration/);
    });
});
