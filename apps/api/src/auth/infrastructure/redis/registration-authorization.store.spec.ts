import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { CredentialCryptoService } from '../../../common/security/credential-crypto.service';
import { createOtpRedisTestContext } from '../../../otp/infrastructure/redis/otp-redis-test';
import {
  RegistrationAuthorizationError,
  RegistrationAuthorizationStore,
} from './registration-authorization.store';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('RegistrationAuthorizationStore', () => {
  let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
  let store: RegistrationAuthorizationStore;

  beforeAll(async () => {
    context = await createOtpRedisTestContext();
    store = new RegistrationAuthorizationStore(
      context.redis,
      context.runner,
      new CredentialCryptoService(),
    );
  });

  beforeEach(async () => {
    const keys = await context.redis.commandClient.keys('auth:registration:*');
    if (keys.length > 0) await context.redis.commandClient.del(keys);
  });

  afterAll(async () => context?.close());

  it('stores only an opaque digest key with a 15-minute absolute TTL', async () => {
    const issued = await issue('+221771234567', 'installation-0001');
    const keys = await context.redis.commandClient.keys('auth:registration:*');
    const ttl = await context.redis.commandClient.pTTL(keys[0]!);
    const values = await context.redis.commandClient.hGetAll(keys[0]!);

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(issued.token);
    expect(JSON.stringify(values)).not.toContain(issued.token);
    expect(ttl).toBeGreaterThan(899_000);
    expect(ttl).toBeLessThanOrEqual(900_000);
  });

  it('preserves the original expiry while editing and removing promo context', async () => {
    const issued = await store.issue({
      challengeId: randomUUID(),
      phoneE164: '+221771234568',
      phoneConfirmedAt: new Date('2030-01-01T00:00:00.000Z'),
      installationId: 'installation-0002',
      pendingPromoCode: 'FIRST',
    });

    await store.updatePromo(issued.token, 'SECOND');
    const edited = await store.requireActive(issued.token);
    await store.updatePromo(issued.token, null);
    const removed = await store.requireActive(issued.token);

    expect(edited.pendingPromoCode).toBe('SECOND');
    expect(edited.expiresAt).toEqual(issued.expiresAt);
    expect(removed.pendingPromoCode).toBeUndefined();
    expect(removed.expiresAt).toEqual(issued.expiresAt);
    expect(removed.installationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(removed)).not.toContain('installation-0002');
  });

  it('keeps one completion owner and deterministic IDs for the same key', async () => {
    const issued = await issue('+221771234569', 'installation-0003');
    const first = await store.beginCompletion(issued.token, 'same-key');
    const second = await store.beginCompletion(issued.token, 'same-key');

    expect(first.status).toBe('started');
    expect(second).toMatchObject({
      status: 'existing',
      owner: first.owner,
      userId: first.userId,
      sessionId: first.sessionId,
      familyId: first.familyId,
      completionKeyDigest: first.completionKeyDigest,
    });
    await expect(
      store.beginCompletion(issued.token, 'different-key'),
    ).rejects.toBeInstanceOf(RegistrationAuthorizationError);
  });

  it('allows same-key lease takeover only before a result is prepared', async () => {
    const issued = await issue('+221771234575', 'installation-0009');
    const first = await store.beginCompletion(issued.token, 'same-key');
    await context.redis.commandClient.hSet(redisKey(issued.token), {
      leaseExpiresAt: (Date.now() - 1).toString(),
    });

    const resumed = await store.beginCompletion(issued.token, 'same-key');

    expect(resumed).toMatchObject({
      status: 'started',
      userId: first.userId,
      sessionId: first.sessionId,
      familyId: first.familyId,
    });
    expect(resumed.owner).not.toBe(first.owner);
  });

  it('does not expose a prepared result before the committed terminal state', async () => {
    const issued = await issue('+221771234570', 'installation-0004');
    const completion = await store.beginCompletion(issued.token, 'same-key');
    const result = completionResult();
    await store.prepareResult(issued.token, completion, result);

    await expect(
      store.recoverResult(issued.token, 'same-key'),
    ).rejects.toBeInstanceOf(RegistrationAuthorizationError);
    expect((await store.inspect(issued.token)).state).toBe('COMPLETING');
  });

  it('atomically repairs COMPLETING and returns the identical sealed result', async () => {
    const issued = await issue('+221771234571', 'installation-0005');
    const completion = await store.beginCompletion(issued.token, 'same-key');
    const result = completionResult();
    await store.prepareResult(issued.token, completion, result);

    const resumed = await store.beginCompletion(issued.token, 'same-key');
    expect(resumed.status).toBe('existing');
    await expect(
      store.readPreparedResult(issued.token, resumed),
    ).resolves.toEqual(result);
    await store.complete(issued.token, resumed);

    const first = await store.recoverResult(issued.token, 'same-key');
    const second = await store.recoverResult(issued.token, 'same-key');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    await expect(store.requireActive(issued.token)).rejects.toBeInstanceOf(
      RegistrationAuthorizationError,
    );
  });

  it('rejects AES-GCM result substitution across authorization flows', async () => {
    const firstIssued = await issue('+221771234572', 'installation-0006');
    const first = await store.beginCompletion(firstIssued.token, 'same-key');
    await store.prepareResult(
      firstIssued.token,
      first,
      completionResult('first'),
    );

    const secondIssued = await issue('+221771234573', 'installation-0007');
    const second = await store.beginCompletion(secondIssued.token, 'same-key');
    await store.prepareResult(
      secondIssued.token,
      second,
      completionResult('second'),
    );
    const [firstKey, secondKey] = [
      redisKey(firstIssued.token),
      redisKey(secondIssued.token),
    ];
    const sealed = await context.redis.commandClient.hmGet(firstKey, [
      'resultKeyVersion',
      'resultCiphertext',
      'resultNonce',
      'resultAuthenticationTag',
    ]);
    await context.redis.commandClient.hSet(secondKey, {
      resultKeyVersion: sealed[0]!,
      resultCiphertext: sealed[1]!,
      resultNonce: sealed[2]!,
      resultAuthenticationTag: sealed[3]!,
    });
    await store.complete(secondIssued.token, second);

    await expect(
      store.recoverResult(secondIssued.token, 'same-key'),
    ).rejects.toThrow();
  });

  it('rejects invalid and expired authorizations', async () => {
    await expect(store.inspect('unknown-opaque-token')).rejects
      .toBeInstanceOf(RegistrationAuthorizationError);
    const issued = await issue('+221771234574', 'installation-0008');
    await context.redis.commandClient.pExpire(redisKey(issued.token), 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(store.inspect(issued.token)).rejects.toBeInstanceOf(
      RegistrationAuthorizationError,
    );
  });

  function issue(phoneE164: string, installationId: string) {
    return store.issue({
      challengeId: randomUUID(),
      phoneE164,
      phoneConfirmedAt: new Date(),
      installationId,
    });
  }

  function redisKey(token: string): string {
    const digest = new CredentialCryptoService().digest('credential', [
      'registration-authorization',
      token,
    ]).digest;
    return `auth:registration:${digest}`;
  }

  function completionResult(prefix = '') {
    return {
      accessToken: `${prefix}access`,
      accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      refreshToken: `${prefix}refresh`,
      refreshExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
  }
});
