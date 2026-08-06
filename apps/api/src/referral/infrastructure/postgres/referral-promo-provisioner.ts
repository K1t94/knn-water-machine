import { Prisma } from '@prisma/client';

import { generatePromoCode, PROMO_CODE_COLLISION_ATTEMPTS } from '../../domain/promo-code';
import { ReferralError } from '../../domain/referral-errors';

import type { PrismaService } from '../../../prisma/prisma.service';
import type {
    ListReferralProvisioningCandidatesInput,
    ProvisionReferralUserInput,
    ProvisionReferralUserResult,
    ReferralProvisioningCandidate,
    ReferralProvisioningRepository,
} from '../../application/ports/referral.repository';
import type { PromoCode } from '../../domain/referral-types';

export class ReferralPromoProvisioner implements ReferralProvisioningRepository {
    constructor(private readonly prisma: PrismaService) {}

    async listProvisioningCandidates(
        input: ListReferralProvisioningCandidatesInput,
    ): Promise<readonly ReferralProvisioningCandidate[]> {
        const users = await this.prisma.user.findMany({
            where: input.afterUserId === null ? undefined : { id: { gt: input.afterUserId } },
            orderBy: { id: 'asc' },
            take: input.limit,
            select: {
                id: true,
                createdAt: true,
                referralPromoCode: { select: { userId: true } },
                referralEligibility: { select: { userId: true } },
            },
        });

        return users.map((user) => ({
            userId: user.id,
            createdAt: user.createdAt,
            provisioned: user.referralPromoCode !== null && user.referralEligibility !== null,
        }));
    }

    async provisionUser(input: ProvisionReferralUserInput): Promise<ProvisionReferralUserResult> {
        let collisionCount = 0;

        for (let attempt = 0; attempt < PROMO_CODE_COLLISION_ATTEMPTS; attempt += 1) {
            const existing = await this.findExistingCode(input.userId);
            if (existing !== null) {
                await this.ensureEligibility(input.userId);
                return { promoCode: existing, created: false, collisionCount };
            }

            const candidate = generatePromoCode();
            try {
                await this.prisma.$transaction(async (transaction) => {
                    await transaction.referralPromoCode.create({
                        data: { userId: input.userId, code: candidate },
                    });
                    await transaction.referralEligibility.upsert({
                        where: { userId: input.userId },
                        create: { userId: input.userId, updatedAt: new Date() },
                        update: {},
                    });
                });
                return { promoCode: candidate, created: true, collisionCount };
            } catch (error: unknown) {
                if (!isUniqueConstraintError(error)) throw error;

                const concurrentCode = await this.findExistingCode(input.userId);
                if (concurrentCode !== null) {
                    await this.ensureEligibility(input.userId);
                    return { promoCode: concurrentCode, created: false, collisionCount };
                }
                collisionCount += 1;
            }
        }

        throw new ReferralError('REFERRAL_PROMO_CODE_COLLISION_EXHAUSTED', 'Unable to allocate a unique referral code');
    }

    private async findExistingCode(userId: string): Promise<PromoCode | null> {
        const existing = await this.prisma.referralPromoCode.findUnique({
            where: { userId },
            select: { code: true },
        });
        return (existing?.code as PromoCode | undefined) ?? null;
    }

    private async ensureEligibility(userId: string): Promise<void> {
        await this.prisma.referralEligibility.upsert({
            where: { userId },
            create: { userId, updatedAt: new Date() },
            update: {},
        });
    }
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
