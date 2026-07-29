import { beforeAll, describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { OtpCrypto } from './otp-crypto';

const secret = Buffer.alloc(32, 9).toString('base64url');

beforeAll(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test');
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  vi.stubEnv('MQTT_URL', 'mqtt://localhost:1883');
  vi.stubEnv('MQTT_CLIENT_ID', 'otp-crypto-test');
  vi.stubEnv('OTP_HMAC_KEY', secret);
  vi.stubEnv('CREDENTIAL_HMAC_KEY', secret);
  vi.stubEnv('FINGERPRINT_HMAC_KEY', secret);
  vi.stubEnv('REGISTRATION_RESULT_ENCRYPTION_KEY', secret);
  vi.stubEnv('JWT_ACCESS_SIGNING_KEY', secret);
});

describe('OtpCrypto', () => {
  it('generates a zero-padded six digit code', () => {
    expect(new OtpCrypto(new CredentialCryptoService()).generateCode(() => 42)).toBe('000042');
  });

  it('persists only versioned HMAC material and verifies it safely', () => {
    const crypto = new OtpCrypto(new CredentialCryptoService());
    const material = crypto.material('challenge', '+221771234567', '123456');

    expect(material.keyVersion).toBe('v1');
    expect(material.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(material)).not.toContain('123456');
    expect(crypto.verify('challenge', '+221771234567', '123456', material)).toBe(true);
    expect(crypto.verify('challenge', '+221771234567', '123457', material)).toBe(false);
  });
});
