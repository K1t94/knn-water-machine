import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OtpChallengeStore } from './otp-challenge.store';
import { createOtpRedisTestContext } from './otp-redis-test';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('OTP verify concurrency', () => {
  let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
  let store: OtpChallengeStore;
  beforeEach(async () => {
    context = await createOtpRedisTestContext();
    store = new OtpChallengeStore(context.redis, context.runner);
  });
  afterEach(() => context.close());

  async function active(id: string, attempts = 5): Promise<void> {
    const now = Date.now();
    await store.prepare({
      challengeId: id, phoneE164: '+221771234567', digest: 'digest',
      keyVersion: 'v1', attempts, createdAt: now, expiresAt: now + 300_000,
      installationFingerprint: 'installation',
    });
    await store.activate(id, '+221771234567', 'accepted', now, 60_000);
  }

  it('allows one of two simultaneous correct consumes', async () => {
    await active('verify-race');
    const results = await Promise.all([
      store.consume('verify-race', '+221771234567'),
      store.consume('verify-race', '+221771234567'),
    ]);
    expect(results.filter((result) => result === 'used')).toHaveLength(1);
  });

  it('never decrements attempts below zero', async () => {
    await active('attempt-race', 1);
    const results = await Promise.all([
      store.rejectAttempt('attempt-race', '+221771234567'),
      store.rejectAttempt('attempt-race', '+221771234567'),
    ]);
    expect(results.filter((result) => result === 'exhausted')).toHaveLength(1);
  });
});
