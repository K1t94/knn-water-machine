import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OtpChallengeStore } from './otp-challenge.store';
import { createOtpRedisTestContext } from './otp-redis-test';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('OTP send concurrency', () => {
    let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
    let store: OtpChallengeStore;
    beforeEach(async () => {
        context = await createOtpRedisTestContext();
        store = new OtpChallengeStore(context.redis, context.runner);
    });
    afterEach(() => context.close());

    it('allows one owner and only owner release', async () => {
        const results = await Promise.all(
            Array.from({ length: 8 }, (_, index) => store.acquirePhoneLock('phone', `owner-${index}`)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        const owner = `owner-${results.indexOf(true)}`;
        expect(await store.releasePhoneLock('phone', 'other')).toBe(false);
        expect(await store.acquirePhoneLock('phone', 'next')).toBe(false);
        expect(await store.releasePhoneLock('phone', owner)).toBe(true);
        expect(await store.acquirePhoneLock('phone', 'next')).toBe(true);
    });

    it('removes a failed PREPARED reservation without replacing current', async () => {
        const now = Date.now();
        await store.prepare({
            challengeId: 'candidate',
            phoneE164: '+221771234567',
            digest: 'digest',
            keyVersion: 'v1',
            attempts: 5,
            createdAt: now,
            expiresAt: now + 300_000,
            installationFingerprint: 'installation',
        });
        expect(await store.failPreparation('candidate')).toBe(true);
        expect(await store.get('candidate', '+221771234567')).toBeUndefined();
    });
});
