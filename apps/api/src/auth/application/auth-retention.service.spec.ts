import { UserSessionStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AuthRetentionService, subtractDays } from './auth-retention.service';

describe('AuthRetentionService', () => {
    it('calculates UTC-independent cutoffs', () => {
        const now = new Date('2030-04-01T03:00:00.000Z');
        expect(subtractDays(now, 90).toISOString()).toBe('2030-01-01T03:00:00.000Z');
        expect(subtractDays(now, 30).toISOString()).toBe('2030-03-02T03:00:00.000Z');
    });

    it('deletes only terminal session history and 30-day delivery records after locking', async () => {
        const transaction = transactionMock(true);
        const prisma = { $transaction: vi.fn((work) => work(transaction)) };
        const service = new AuthRetentionService(prisma as never);
        const result = await service.run(new Date('2030-04-01T03:00:00.000Z'));
        expect(transaction.userSession.deleteMany).toHaveBeenCalledWith({
            where: {
                status: { in: [UserSessionStatus.REVOKED, UserSessionStatus.EXPIRED] },
                updatedAt: { lt: new Date('2030-01-01T03:00:00.000Z') },
            },
        });
        expect(transaction.smsDelivery.deleteMany).toHaveBeenCalledWith({
            where: { updatedAt: { lt: new Date('2030-03-02T03:00:00.000Z') } },
        });
        expect(result).toEqual({ acquired: true, sessionsDeleted: 2, smsDeliveriesDeleted: 3 });
    });

    it('performs no deletion when the PostgreSQL lock is unavailable', async () => {
        const transaction = transactionMock(false);
        const service = new AuthRetentionService({
            $transaction: vi.fn((work) => work(transaction)),
        } as never);
        await expect(service.run()).resolves.toEqual({
            acquired: false,
            sessionsDeleted: 0,
            smsDeliveriesDeleted: 0,
        });
        expect(transaction.userSession.deleteMany).not.toHaveBeenCalled();
        expect(transaction.smsDelivery.deleteMany).not.toHaveBeenCalled();
    });
});

function transactionMock(acquired: boolean) {
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ acquired }]),
        userSession: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
        smsDelivery: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    };
}
