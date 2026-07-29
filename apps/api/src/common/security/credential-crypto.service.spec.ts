import { beforeAll, describe, expect, it } from 'vitest';

import { CredentialCryptoService } from './credential-crypto.service';

const secret = Buffer.alloc(32, 7).toString('base64url');

describe('CredentialCryptoService', () => {
  beforeAll(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      MQTT_URL: 'mqtt://localhost:1883',
      MQTT_CLIENT_ID: 'crypto-test',
      OTP_HMAC_KEY: secret,
      CREDENTIAL_HMAC_KEY: secret,
      FINGERPRINT_HMAC_KEY: secret,
      REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
      JWT_ACCESS_SIGNING_KEY: secret,
    });
  });

  it('creates scoped versioned digests and compares fixed-size values', () => {
    const service = new CredentialCryptoService();
    const phone = service.fingerprintPhone('+221771234567');
    const ip = service.fingerprintIp('+221771234567');

    expect(phone.keyVersion).toBe('v1');
    expect(phone.digest).toHaveLength(64);
    expect(phone.digest).not.toBe(ip.digest);
    expect(service.compareDigests(phone.digest, phone.digest)).toBe(true);
    expect(service.compareDigests(phone.digest, ip.digest)).toBe(false);
    expect(service.compareDigests('not-hex', phone.digest)).toBe(false);
  });

  it('seals with random nonces and authenticates caller-supplied AAD', () => {
    const service = new CredentialCryptoService();
    const plaintext = Buffer.from('refresh-credential');
    const aad = Buffer.from('flow:key:session');
    const first = service.seal(plaintext, aad);
    const second = service.seal(plaintext, aad);

    expect(first.nonce).not.toBe(second.nonce);
    expect(Buffer.from(first.nonce, 'base64url')).toHaveLength(12);
    expect(service.open(first, aad)).toEqual(plaintext);
    expect(() => service.open(first, Buffer.from('other'))).toThrow();
  });

  it('generates opaque credentials with at least 256 bits', () => {
    const service = new CredentialCryptoService();
    const credential = service.generateOpaqueCredential();

    expect(Buffer.from(credential, 'base64url')).toHaveLength(32);
    expect(credential).not.toBe(service.generateOpaqueCredential());
  });
});
