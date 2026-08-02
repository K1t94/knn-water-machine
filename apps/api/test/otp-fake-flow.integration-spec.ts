import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CredentialCryptoService } from '../src/common/security/credential-crypto.service';
import { OtpApplicationError, OtpService } from '../src/otp/application/otp.service';
import { OtpCrypto } from '../src/otp/domain/otp-crypto';
import { OtpAbuseGuard } from '../src/otp/infrastructure/redis/otp-abuse-guard';
import { OtpChallengeStore } from '../src/otp/infrastructure/redis/otp-challenge.store';
import { createOtpRedisTestContext } from '../src/otp/infrastructure/redis/otp-redis-test';
import { FakeSmsOutbox } from '../src/sms/infrastructure/fake/fake-sms.outbox';
import { FakeSmsProvider } from '../src/sms/infrastructure/fake/fake-sms.provider';

import type { RandomSource } from '../src/auth/application/ports';

const enabled = process.env.RUN_REDIS_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const integration = enabled ? describe : describe.skip;

integration('US1 fake-provider checkpoint', () => {
    const phone = '+221771234567';
    const installationId = 'integration-installation-0001';
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    let redis: Awaited<ReturnType<typeof createOtpRedisTestContext>>;
    let service: OtpService;
    let outbox: FakeSmsOutbox;
    let usersBefore: number;
    let sessionsBefore: number;

    beforeAll(async () => {
        Object.assign(process.env, {
            SMS_PROVIDER: 'fake',
            FAKE_SMS_EXPOSE_OTP: 'true',
            FAKE_SMS_TEST_NUMBERS: phone,
        });
        redis = await createOtpRedisTestContext();
        const credentials = new CredentialCryptoService();
        const random: RandomSource = {
            bytes: randomBytes,
            integer: randomInt,
            uuid: randomUUID,
        };
        outbox = new FakeSmsOutbox();
        service = new OtpService(
            new FakeSmsProvider(outbox),
            { now: () => new Date() },
            random,
            new OtpCrypto(credentials),
            credentials,
            new OtpChallengeStore(redis.redis, redis.runner),
            new OtpAbuseGuard(redis.runner, credentials),
        );
        [usersBefore, sessionsBefore] = await Promise.all([prisma.user.count(), prisma.userSession.count()]);
    });

    afterAll(async () => {
        await redis?.close();
        await prisma.$disconnect();
    });

    it('confirms a phone exactly once without creating a user or session', async () => {
        const issued = await service.request({
            phone,
            installationId,
            ipAddress: '192.0.2.100',
            pendingPromoCode: 'PENDING',
        });
        const inspection = outbox.latestFor(phone);
        expect(inspection?.correlationId).toBe(issued.challengeId);
        expect(inspection?.otp).toMatch(/^\d{6}$/);

        await expect(
            service.resend({
                phone,
                installationId,
                ipAddress: '192.0.2.100',
                previousChallengeId: issued.challengeId,
            }),
        ).rejects.toSatisfy((error: unknown) => error instanceof OtpApplicationError && error.code === 'RATE_LIMITED');

        await expect(
            service.verify({
                phone,
                installationId,
                ipAddress: '192.0.2.100',
                challengeId: issued.challengeId,
                code: inspection?.otp ?? '',
            }),
        ).resolves.toMatchObject({
            phoneE164: phone,
            pendingPromoCode: 'PENDING',
        });
        await expect(
            service.verify({
                phone,
                installationId,
                ipAddress: '192.0.2.100',
                challengeId: issued.challengeId,
                code: inspection?.otp ?? '',
            }),
        ).rejects.toSatisfy((error: unknown) => error instanceof OtpApplicationError && error.code === 'OTP_USED');

        await expect(Promise.all([prisma.user.count(), prisma.userSession.count()])).resolves.toEqual([
            usersBefore,
            sessionsBefore,
        ]);
    });
});
