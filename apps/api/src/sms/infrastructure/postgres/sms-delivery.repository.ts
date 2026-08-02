import { Inject, Injectable } from '@nestjs/common';
import { SmsDeliveryStatus, SmsProviderKind } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import type { SmsErrorCategory } from '../../application/sms-error';

export interface PrepareSmsDelivery {
    challengeId: string;
    provider: 'fake' | 'orange';
    phoneFingerprint: string;
    requestedAt: Date;
}

export interface SmsDeliveryReceiptRecord {
    id: string;
    status: SmsDeliveryStatus;
    acceptedAt: Date | null;
}

@Injectable()
export class SmsDeliveryRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

    prepare(input: PrepareSmsDelivery) {
        return this.prisma.smsDelivery.create({
            data: {
                challengeId: input.challengeId,
                provider: providerKind(input.provider),
                phoneFingerprint: input.phoneFingerprint,
                requestedAt: input.requestedAt,
            },
        });
    }

    markAccepted(challengeId: string, providerMessageId: string | undefined, acceptedAt: Date, uncertain = false) {
        return this.prisma.smsDelivery.update({
            where: { challengeId },
            data: {
                ...(providerMessageId ? { providerMessageId } : {}),
                acceptedAt,
                status: uncertain ? SmsDeliveryStatus.UNCERTAIN : SmsDeliveryStatus.ACCEPTED,
            },
        });
    }

    markFailed(challengeId: string, category: SmsErrorCategory) {
        return this.prisma.smsDelivery.update({
            where: { challengeId },
            data: {
                status: SmsDeliveryStatus.FAILED,
                failureCategory: category,
            },
        });
    }

    findReceiptTarget(challengeId: string): Promise<SmsDeliveryReceiptRecord | null> {
        return this.prisma.smsDelivery.findUnique({
            where: { challengeId },
            select: { id: true, status: true, acceptedAt: true },
        });
    }

    transitionReceipt(
        id: string,
        expectedStatus: SmsDeliveryStatus,
        nextStatus: SmsDeliveryStatus,
        receivedAt: Date,
    ): Promise<{ count: number }> {
        return this.prisma.smsDelivery.updateMany({
            where: { id, status: expectedStatus },
            data: {
                status: nextStatus,
                lastReceiptAt: receivedAt,
                ...(nextStatus === SmsDeliveryStatus.DELIVERED ? { deliveredAt: receivedAt } : {}),
            },
        });
    }

    deleteExpired(now: Date): Promise<{ count: number }> {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
        return this.prisma.smsDelivery.deleteMany({
            where: { updatedAt: { lt: cutoff } },
        });
    }
}

function providerKind(provider: PrepareSmsDelivery['provider']): SmsProviderKind {
    return provider === 'fake' ? SmsProviderKind.FAKE : SmsProviderKind.ORANGE;
}
