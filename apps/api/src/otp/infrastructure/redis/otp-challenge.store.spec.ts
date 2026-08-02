import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OtpChallengeStore, OtpStoreError } from './otp-challenge.store';
import { createOtpRedisTestContext } from './otp-redis-test';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('OtpChallengeStore Redis state machine', () => {
    let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
    let store: OtpChallengeStore;

    beforeEach(async () => {
        context = await createOtpRedisTestContext();
        store = new OtpChallengeStore(context.redis, context.runner);
    });
    afterEach(() => context.close());

    it('uses immutable absolute expiry, cooldown, promo updates, and USED tombstones', async () => {
        const now = Date.now();
        await store.prepare({
            challengeId: 'challenge-a',
            phoneE164: '+221771234567',
            digest: 'a'.repeat(64),
            keyVersion: 'v1',
            attempts: 5,
            createdAt: now,
            expiresAt: now + 300_000,
            installationFingerprint: 'installation',
            pendingPromoCode: 'FIRST',
        });
        expect(await store.activate('challenge-a', '+221771234567', 'accepted', now + 2_000, 60_000)).toBe('active');
        expect(await store.cooldownRemaining('+221771234567')).toBeGreaterThan(55_000);
        await store.updatePromo('challenge-a', { kind: 'replace', value: 'SECOND' });
        expect((await store.get('challenge-a', '+221771234567'))?.pendingPromoCode).toBe('SECOND');
        await store.updatePromo('challenge-a', { kind: 'remove' });
        expect((await store.get('challenge-a', '+221771234567'))?.pendingPromoCode).toBeUndefined();
        expect(await store.consume('challenge-a', '+221771234567')).toBe('used');
        await expect(store.get('challenge-a', '+221771234567')).rejects.toSatisfy(
            (error: unknown) => error instanceof OtpStoreError && error.code === 'OTP_USED',
        );
    });

    it('exhausts exactly after five incorrect attempts and replaces the old challenge', async () => {
        const now = Date.now();
        for (const id of ['old', 'new']) {
            await store.prepare({
                challengeId: id,
                phoneE164: '+221771234567',
                digest: id,
                keyVersion: 'v1',
                attempts: 5,
                createdAt: now,
                expiresAt: now + 300_000,
                installationFingerprint: 'installation',
            });
            await store.activate(id, '+221771234567', 'accepted', now, 60_000);
        }
        expect(await store.get('old', '+221771234567')).toBeUndefined();
        for (let attempt = 0; attempt < 4; attempt += 1) {
            expect(await store.rejectAttempt('new', '+221771234567')).toBe('invalid');
        }
        expect(await store.rejectAttempt('new', '+221771234567')).toBe('exhausted');
    });

    it('preserves absolute expiry across provider delay and rejects expired candidates', async () => {
        const now = Date.now();
        await store.prepare({
            challengeId: 'delayed',
            phoneE164: '+221771234567',
            digest: 'digest',
            keyVersion: 'v1',
            attempts: 5,
            createdAt: now,
            expiresAt: now + 500,
            installationFingerprint: 'installation',
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await store.activate('delayed', '+221771234567', 'accepted', Date.now(), 60_000)).toBe('active');
        const remaining = await context.redis.commandClient.pTTL('auth:otp:challenge:delayed');
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThan(450);

        await store.prepare({
            challengeId: 'expired',
            phoneE164: '+221781234567',
            digest: 'digest',
            keyVersion: 'v1',
            attempts: 5,
            createdAt: now,
            expiresAt: Date.now() + 20,
            installationFingerprint: 'installation',
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(await store.activate('expired', '+221781234567', 'accepted', Date.now(), 60_000)).toBe('missing');
        expect(await store.cooldownRemaining('+221781234567')).toBe(0);
    });
});
