import { Inject, Injectable, Logger } from '@nestjs/common';

import { REFERRAL_REPOSITORY, type ReferralRelationshipRepository } from '../../application/ports/referral.repository';
import { ReferralApplicationService } from '../../application/referral-application.service';
import { ReferralRecoveryService } from '../../application/referral-recovery.service';
import { canonicalizePromoCode } from '../../domain/promo-code';

import { PrismaReferralRepository } from './prisma-referral.repository';

import type {
    CompleteReferralOnboardingInput,
    CompleteReferralOnboardingResult,
    ReferralRegistrationIntegration,
} from '../../application/referral-registration.integration';
import type { PromoCode, ReferralEntitlementId } from '../../domain/referral-types';
import type { Prisma } from '@prisma/client';

@Injectable()
export class PrismaReferralRegistrationIntegration implements ReferralRegistrationIntegration<Prisma.TransactionClient> {
    private readonly logger = new Logger(PrismaReferralRegistrationIntegration.name);

    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralRelationshipRepository,
        @Inject(ReferralRecoveryService) private readonly recovery: ReferralRecoveryService,
    ) {}

    async prevalidatePendingPromo(pendingPromoCode: string | null, inviteeUserId?: string): Promise<PromoCode | null> {
        if (pendingPromoCode === null) return null;
        const promoCode = canonicalizePromoCode(pendingPromoCode);
        await this.repository.validatePromoCode(promoCode, inviteeUserId);
        return promoCode;
    }

    async completeOnboarding(
        transaction: Prisma.TransactionClient,
        input: CompleteReferralOnboardingInput,
    ): Promise<CompleteReferralOnboardingResult> {
        const repository = new PrismaReferralRepository(transaction);
        const application = new ReferralApplicationService(repository);
        const provisioned = await repository.provisionUser({ userId: input.userId, createdAt: input.completedAt });
        const entitlementIds: ReferralEntitlementId[] = [];

        if (input.isNewUser) {
            const welcome = await application.createWelcomeEntitlement({
                userId: input.userId,
                occurredAt: input.completedAt,
            });
            entitlementIds.push(welcome.entitlementId);
        }

        let relationshipCreated = false;
        if (input.pendingPromoCode !== null) {
            const applied = await application.applyInternal({
                inviteeUserId: input.userId,
                promoCode: input.pendingPromoCode,
                channel: 'REGISTRATION',
            });
            relationshipCreated = applied.status === 'ATTACHED';
            entitlementIds.push(applied.inviterEntitlementId);
        }

        this.logger.debug({
            event: 'referral_registration_onboarding_persisted',
            registrationCompletionId: input.registrationCompletionId,
            entitlementCount: entitlementIds.length,
        });
        return { promoCode: provisioned.promoCode, relationshipCreated, entitlementIds };
    }

    async deliverAfterCommit(entitlementIds: readonly ReferralEntitlementId[]): Promise<void> {
        if (entitlementIds.length === 0) return;
        try {
            await this.recovery.runEntitlements(entitlementIds);
        } catch (error: unknown) {
            this.logger.warn({
                event: 'referral_registration_inline_delivery_failed',
                entitlementCount: entitlementIds.length,
                error: error instanceof Error ? error.name : 'unknown',
            });
        }
    }
}
