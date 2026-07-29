import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: redisMocks.createClient,
}));

import { RedisService } from './redis.service';

const secret = Buffer.alloc(32, 4).toString('base64url');

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'redis-service-test',
    OTP_HMAC_KEY: secret,
    CREDENTIAL_HMAC_KEY: secret,
    FINGERPRINT_HMAC_KEY: secret,
    REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
    JWT_ACCESS_SIGNING_KEY: secret,
  });
});

afterEach(() => vi.clearAllMocks());

describe('RedisService', () => {
  it('connects and verifies readiness during module initialization', async () => {
    const client = createClientDouble();
    redisMocks.createClient.mockReturnValue(client);
    const service = new RedisService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.ping).toHaveBeenCalledOnce();
  });

  it('fails startup closed and disconnects after a failed readiness probe', async () => {
    const client = createClientDouble();
    client.ping.mockRejectedValue(new Error('unavailable'));
    redisMocks.createClient.mockReturnValue(client);
    const service = new RedisService();

    await expect(service.onModuleInit()).rejects.toMatchObject({
      status: 503,
    });
    expect(client.quit).toHaveBeenCalledOnce();
  });
});

function createClientDouble() {
  return {
    isOpen: true,
    isReady: true,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
}
