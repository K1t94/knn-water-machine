import { SmsProviderError } from '../../application/sms-error';
import { smsProviderContract } from '../../testing/sms-provider.contract';
import { FakeSmsOutbox } from './fake-sms.outbox';
import { FakeSmsProvider } from './fake-sms.provider';
import { afterEach, beforeEach, vi } from 'vitest';

const command = {
  recipientE164: '+221771234567',
  message: 'KAYNANN code: 123456. Valid for 5 minutes.',
  correlationId: '00000000-0000-4000-8000-000000000001',
};
const secret = Buffer.alloc(32, 9).toString('base64url');

beforeEach(() => {
  const env = {
    NODE_ENV: 'test', APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379', MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'fake-contract', OTP_HMAC_KEY: secret,
    CREDENTIAL_HMAC_KEY: secret, FINGERPRINT_HMAC_KEY: secret,
    REGISTRATION_RESULT_ENCRYPTION_KEY: secret, JWT_ACCESS_SIGNING_KEY: secret,
    SMS_PROVIDER: 'fake',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

smsProviderContract('Fake', () => {
  const outbox = new FakeSmsOutbox();
  const provider = new FakeSmsProvider(outbox, () => new Date('2026-07-29T12:00:00Z'));
  return {
    provider,
    command,
    expectedName: 'fake',
    deliverySupported: false,
    arrangeStableFailure: () => {
      const error = new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
      outbox.failNext(command.recipientE164, error);
      return error;
    },
  };
});
