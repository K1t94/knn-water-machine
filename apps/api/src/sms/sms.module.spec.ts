import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SMS_PROVIDER,
  type SmsProvider,
} from './application/ports/sms-provider';
import { SmsModule } from './sms.module';

const secret = Buffer.alloc(32, 5).toString('base64url');

@Module({
  imports: [SmsModule],
})
class ConsumerModule {}

function configureEnvironment(overrides: Record<string, string> = {}): void {
  const baseline = {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'sms-module-test',
    OTP_HMAC_KEY: secret,
    CREDENTIAL_HMAC_KEY: secret,
    FINGERPRINT_HMAC_KEY: secret,
    REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
    JWT_ACCESS_SIGNING_KEY: secret,
    SMS_PROVIDER: 'fake',
    ...overrides,
  };
  for (const [key, value] of Object.entries(baseline)) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => configureEnvironment());
afterEach(() => vi.unstubAllEnvs());

describe('SmsModule', () => {
  it('exports the provider-neutral token to consumers', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [ConsumerModule],
    }).compile();

    const provider = testingModule.get<SmsProvider>(SMS_PROVIDER);
    expect(provider.name).toBe('fake');
    expect(Reflect.getMetadata('exports', SmsModule)).toEqual([SMS_PROVIDER]);
    await testingModule.close();
  });

  it.each(['staging', 'production'])(
    'fails closed for fake provider in %s',
    async (appEnv) => {
      configureEnvironment({ APP_ENV: appEnv });
      await expect(
        Test.createTestingModule({ imports: [SmsModule] }).compile(),
      ).rejects.toThrow(/Invalid environment configuration/);
    },
  );

  it('selects the private Orange adapter behind the neutral token', async () => {
    configureEnvironment({
      SMS_PROVIDER: 'orange',
      ORANGE_SMS_CLIENT_ID: 'client',
      ORANGE_SMS_CLIENT_SECRET: 'secret',
      ORANGE_SMS_SENDER_ADDRESS: 'tel:+2210000',
      ORANGE_SMS_SENDER_NAME: 'KAYNANN',
      ORANGE_SMS_API_URL: 'https://example.test/sms',
      ORANGE_SMS_OAUTH_URL: 'https://example.test/oauth',
    });

    const testingModule = await Test.createTestingModule({ imports: [SmsModule] }).compile();
    expect(testingModule.get<SmsProvider>(SMS_PROVIDER).name).toBe('orange');
    expect(Reflect.getMetadata('exports', SmsModule)).toEqual([SMS_PROVIDER]);
    await testingModule.close();
  });
});
