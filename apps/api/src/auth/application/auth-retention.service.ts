import { Inject, Injectable } from '@nestjs/common';
import { UserSessionStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const SESSION_RETENTION_DAYS = 90;
const SMS_RETENTION_DAYS = 30;
const RETENTION_LOCK_ID = 4_210_022_007;

export interface RetentionResult {
    acquired: boolean;
    sessionsDeleted: number;
    smsDeliveriesDeleted: number;
}

@Injectable()
export class AuthRetentionService {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

    run(now = new Date()): Promise<RetentionResult> {
        const sessionCutoff = subtractDays(now, SESSION_RETENTION_DAYS);
        const smsCutoff = subtractDays(now, SMS_RETENTION_DAYS);
        return this.prisma.$transaction(async (transaction) => {
            const [{ acquired }] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS acquired
      `;
            if (!acquired) return { acquired: false, sessionsDeleted: 0, smsDeliveriesDeleted: 0 };
            const sessions = await transaction.userSession.deleteMany({
                where: {
                    status: { in: [UserSessionStatus.REVOKED, UserSessionStatus.EXPIRED] },
                    updatedAt: { lt: sessionCutoff },
                },
            });
            const deliveries = await transaction.smsDelivery.deleteMany({
                where: { updatedAt: { lt: smsCutoff } },
            });
            return {
                acquired: true,
                sessionsDeleted: sessions.count,
                smsDeliveriesDeleted: deliveries.count,
            };
        });
    }
}

export function subtractDays(now: Date, days: number): Date {
    return new Date(now.getTime() - days * 86_400_000);
}

export type AuthRetentionTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'userSession' | 'smsDelivery'>;
