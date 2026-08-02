import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { OtpAbuseError, OtpAbuseGuard } from '../infrastructure/redis/otp-abuse-guard';
import { createOtpRedisTestContext } from '../infrastructure/redis/otp-redis-test';

const integration = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;

integration('OtpAbuseGuard', () => {
    let context: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
    let guard: OtpAbuseGuard;
    beforeEach(async () => {
        context = await createOtpRedisTestContext();
        guard = new OtpAbuseGuard(context.runner, new CredentialCryptoService());
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await context.close();
    });

    function configuredGuard(overrides: Record<string, string>): OtpAbuseGuard {
        for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
        return new OtpAbuseGuard(context.runner, new CredentialCryptoService());
    }

    async function expectRateLimit(
        promise: Promise<unknown>,
        code: OtpAbuseError['code'] = 'RATE_LIMITED',
    ): Promise<void> {
        await expect(promise).rejects.toSatisfy(
            (error: unknown) => error instanceof OtpAbuseError && error.code === code,
        );
    }

    it('enforces phone windows without revealing whether a user exists', async () => {
        const command = {
            phoneE164: '+221771234567',
            ipAddress: '127.0.0.1',
            installationId: 'installation-0001',
            now: new Date(),
        };
        for (let index = 0; index < 3; index += 1) {
            await guard.reserve(command);
            await guard.release(command);
        }
        await expectRateLimit(guard.reserve(command));
    });

    it('blocks a phone after the configured number of exhausted challenges', async () => {
        const now = new Date();
        expect(await guard.recordExhaustion('+221771234567', now)).toBe(false);
        expect(await guard.recordExhaustion('+221771234567', now)).toBe(false);
        expect(await guard.recordExhaustion('+221771234567', now)).toBe(true);
        await expect(
            guard.reserve({
                phoneE164: '+221771234567',
                ipAddress: '127.0.0.2',
                installationId: 'installation-0002',
                now,
            }),
        ).rejects.toEqual(expect.objectContaining({ code: 'RATE_LIMITED' }));
    });

    it('enforces IP and installation windows independently of phone identity', async () => {
        guard = configuredGuard({
            OTP_SENDS_PER_IP_HOUR: '2',
            OTP_SENDS_PER_INSTALLATION_HOUR: '2',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        const now = new Date();
        for (let index = 0; index < 2; index += 1) {
            const request = {
                phoneE164: `+22177${String(1234567 + index)}`,
                ipAddress: '192.0.2.1',
                installationId: `different-installation-${index}`,
                now,
            };
            await guard.reserve(request);
            await guard.release(request);
        }
        await expectRateLimit(
            guard.reserve({
                phoneE164: '+221771234569',
                ipAddress: '192.0.2.1',
                installationId: 'different-installation-3',
                now,
            }),
        );

        context = await resetContext(context);
        guard = configuredGuard({
            OTP_SENDS_PER_IP_HOUR: '20',
            OTP_SENDS_PER_INSTALLATION_HOUR: '2',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        for (let index = 0; index < 2; index += 1) {
            const request = {
                phoneE164: `+22178${String(1234567 + index)}`,
                ipAddress: `192.0.2.${10 + index}`,
                installationId: 'shared-installation',
                now,
            };
            await guard.reserve(request);
            await guard.release(request);
        }
        await expectRateLimit(
            guard.reserve({
                phoneE164: '+221781234569',
                ipAddress: '192.0.2.12',
                installationId: 'shared-installation',
                now,
            }),
        );
    });

    it('enforces daily count, daily cost, and global concurrency budgets', async () => {
        const now = new Date();
        guard = configuredGuard({
            SMS_DAILY_COUNT_LIMIT: '1',
            SMS_DAILY_XOF_LIMIT: '1000',
            OTP_MAX_PARALLEL_SENDS_GLOBAL: '5',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        const first = {
            phoneE164: '+221771111111',
            ipAddress: '192.0.2.20',
            installationId: 'budget-count-1',
            now,
        };
        await guard.reserve(first);
        await guard.release(first);
        await expectRateLimit(
            guard.reserve({
                ...first,
                phoneE164: '+221772222222',
                installationId: 'budget-count-2',
            }),
            'SMS_BUDGET_EXHAUSTED',
        );

        context = await resetContext(context);
        guard = configuredGuard({
            SMS_DAILY_COUNT_LIMIT: '100',
            SMS_ESTIMATED_UNIT_COST_XOF: '20',
            SMS_DAILY_XOF_LIMIT: '30',
            OTP_MAX_PARALLEL_SENDS_GLOBAL: '5',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        await guard.reserve(first);
        await guard.release(first);
        await expectRateLimit(
            guard.reserve({
                ...first,
                phoneE164: '+221773333333',
                installationId: 'budget-cost-2',
            }),
            'SMS_BUDGET_EXHAUSTED',
        );

        context = await resetContext(context);
        guard = configuredGuard({
            SMS_DAILY_COUNT_LIMIT: '100',
            SMS_DAILY_XOF_LIMIT: '10000',
            OTP_MAX_PARALLEL_SENDS_GLOBAL: '1',
            SMS_MAX_SENDS_PER_SECOND: '100',
        });
        await guard.reserve(first);
        await expectRateLimit(
            guard.reserve({
                ...first,
                phoneE164: '+221774444444',
                installationId: 'parallel-2',
            }),
        );
    });
});

async function resetContext(
    current: Awaited<ReturnType<typeof createOtpRedisTestContext>>,
): Promise<Awaited<ReturnType<typeof createOtpRedisTestContext>>> {
    await current.close();
    return createOtpRedisTestContext();
}
