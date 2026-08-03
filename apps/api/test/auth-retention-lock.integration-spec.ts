import { randomUUID } from 'node:crypto';

import { PrismaClient, SmsProviderKind } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthRetentionService } from '../src/auth/application/auth-retention.service';

const RETENTION_LOCK_ID = 4_210_022_007;
const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;

describePostgres('AuthRetentionService PostgreSQL lock', () => {
    const lockOwner = new PrismaClient();
    const cleanupClient = new PrismaClient();
    const challengeId = randomUUID();

    beforeAll(async () => {
        await Promise.all([lockOwner.$connect(), cleanupClient.$connect()]);
    });

    afterAll(async () => {
        await cleanupClient.smsDelivery.deleteMany({ where: { challengeId } });
        await Promise.all([lockOwner.$disconnect(), cleanupClient.$disconnect()]);
    });

    it('skips without the lock, cleans inside the successful transaction, and releases the lock', async () => {
        const now = new Date('2030-04-01T03:00:00.000Z');
        const old = new Date('2029-01-01T00:00:00.000Z');
        await cleanupClient.smsDelivery.create({
            data: {
                challengeId,
                provider: SmsProviderKind.FAKE,
                phoneFingerprint: 'f'.repeat(64),
                requestedAt: old,
                updatedAt: old,
            },
        });

        let releaseLock!: () => void;
        let reportAcquired!: () => void;
        const acquired = new Promise<void>((resolve) => {
            reportAcquired = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        const holder = lockOwner.$transaction(
            async (transaction) => {
                const [row] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS acquired
      `;
                expect(row.acquired).toBe(true);
                reportAcquired();
                await release;
            },
            { timeout: 10_000 },
        );
        await acquired;

        const service = new AuthRetentionService(cleanupClient as never);
        await expect(service.run(now)).resolves.toEqual({
            acquired: false,
            sessionsDeleted: 0,
            smsDeliveriesDeleted: 0,
        });
        await expect(cleanupClient.smsDelivery.count({ where: { challengeId } })).resolves.toBe(1);

        releaseLock();
        await holder;
        const cleaned = await service.run(now);
        expect(cleaned.acquired).toBe(true);
        expect(cleaned.smsDeliveriesDeleted).toBeGreaterThanOrEqual(1);
        await expect(cleanupClient.smsDelivery.count({ where: { challengeId } })).resolves.toBe(0);

        const lockAvailable = await cleanupClient.$transaction(async (transaction) => {
            const [row] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS acquired
      `;
            return row.acquired;
        });
        expect(lockAvailable).toBe(true);
    });
});
