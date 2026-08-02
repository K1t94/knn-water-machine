import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../src/common/security/credential-crypto.service';
import { OtpAbuseError, OtpAbuseGuard } from '../src/otp/infrastructure/redis/otp-abuse-guard';
import { createOtpRedisTestContext } from '../src/otp/infrastructure/redis/otp-redis-test';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('SMS pumping defenses', () => {
    let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
    beforeEach(async () => {
        context = await createOtpRedisTestContext();
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await context.close();
    });

    it('checks actor limits before budgets and keeps a fixed-window expiry', async () => {
        const guard = configuredGuard(context, {
            OTP_SENDS_PER_PHONE_HOUR: '1',
            SMS_DAILY_COUNT_LIMIT: '1',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        const command = actor();
        await guard.reserve(command);
        await guard.release(command);
        const [phoneKey] = await context.redis.commandClient.keys('auth:otp:rate:phone:*:h:*');
        const firstTtl = await context.redis.commandClient.pTTL(phoneKey);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await expect(guard.reserve(command)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(await context.redis.commandClient.pTTL(phoneKey)).toBeLessThan(firstTtl);
    });

    it('refunds only count and cost after a definitive no-send failure', async () => {
        const guard = configuredGuard(context, { SMS_MAX_SENDS_PER_SECOND: '100' });
        const command = actor();
        await guard.reserve(command);
        await guard.refundDefinitiveFailure(command);
        await guard.release(command);
        const actorKeys = await context.redis.commandClient.keys('auth:otp:rate:phone:*');
        expect(await context.redis.commandClient.get(actorKeys[0])).toBe('1');
        const day = command.now.toISOString().slice(0, 10);
        expect(await context.redis.commandClient.get(`auth:otp:budget:count:${day}`)).toBe('0');
        expect(await context.redis.commandClient.get(`auth:otp:budget:xof:${day}`)).toBe('0');
    });

    it('retains the budget reservation for an uncertain send', async () => {
        const guard = configuredGuard(context, { SMS_MAX_SENDS_PER_SECOND: '100' });
        const command = actor();
        await guard.reserve(command);
        await guard.release(command);
        const day = command.now.toISOString().slice(0, 10);
        expect(await context.redis.commandClient.get(`auth:otp:budget:count:${day}`)).toBe('1');
        expect(await context.redis.commandClient.get(`auth:otp:budget:xof:${day}`)).toBe('20');
    });

    it('enforces provider throughput independently of the global semaphore', async () => {
        const guard = configuredGuard(context, {
            SMS_MAX_SENDS_PER_SECOND: '1',
            OTP_MAX_PARALLEL_SENDS_GLOBAL: '10',
        });
        const first = actor();
        await guard.reserve(first);
        await guard.release(first);
        await expect(guard.reserve({ ...first, phoneE164: '+221781234567' })).rejects.toSatisfy(
            (error: unknown) => error instanceof OtpAbuseError && error.retryAfterSeconds === 1,
        );
    });

    it('recovers capacity after a leaked semaphore expires', async () => {
        const guard = configuredGuard(context, {
            SMS_MAX_SENDS_PER_SECOND: '100',
            OTP_MAX_PARALLEL_SENDS_GLOBAL: '1',
        });
        await context.redis.commandClient.set('auth:otp:parallel', '1', { PX: 25 });
        await expect(guard.reserve(actor())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        await new Promise((resolve) => setTimeout(resolve, 35));
        await expect(guard.reserve(actor())).resolves.toBeUndefined();
    });
});

function configuredGuard(
    context: Awaited<ReturnType<typeof createOtpRedisTestContext>>,
    overrides: Record<string, string>,
): OtpAbuseGuard {
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
    return new OtpAbuseGuard(context.runner, new CredentialCryptoService());
}

function actor() {
    return {
        phoneE164: '+221771234567',
        ipAddress: '192.0.2.10',
        installationId: 'sms-pumping-test-installation',
        now: new Date('2030-01-02T12:34:56.000Z'),
    };
}
