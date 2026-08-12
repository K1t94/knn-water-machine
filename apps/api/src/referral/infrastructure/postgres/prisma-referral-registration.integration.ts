import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { loadEnv } from '../../../config/env';
import { ReferralFeatureStateService } from '../../application/referral-feature-state.service';
import { ReferralRecoveryService } from '../../application/referral-recovery.service';
import { canonicalizePromoCode } from '../../domain/promo-code';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    parseReferralMillilitres,
} from '../../domain/referral-types';

import { PrismaReferralRepository } from './prisma-referral.repository';

import type {
    CompleteReferralOnboardingInput,
    CompleteReferralOnboardingResult,
    ReferralRegistrationIntegration,
} from '../../application/referral-registration.integration';
import type { ReferralEntitlementId } from '../../domain/referral-types';
import type { Prisma } from '@prisma/client';

@Injectable()
export class PrismaReferralRegistrationIntegration implements ReferralRegistrationIntegration<Prisma.TransactionClient> {
    private readonly logger = new Logger(PrismaReferralRegistrationIntegration.name);

    constructor(
        @Inject(ReferralFeatureStateService) private readonly featureState: ReferralFeatureStateService,
        @Inject(ReferralRecoveryService) private readonly recovery: ReferralRecoveryService,
    ) {}

    async completeOnboarding(
        transaction: Prisma.TransactionClient,
        input: CompleteReferralOnboardingInput,
    ): Promise<CompleteReferralOnboardingResult> {
        const repository = new PrismaReferralRepository(transaction);
        const enabled = await this.featureState.isEnabledWithSharedLock(transaction);
        const provisioned = await repository.provisionUser({ userId: input.userId, createdAt: input.completedAt });
        const inviterEntitlementIds: ReferralEntitlementId[] = [];

        let relationshipCreated = false;
        if (enabled && input.pendingPromoCode !== null) {
            const promoCode = canonicalizePromoCode(input.pendingPromoCode);
            const entitlementId = randomUUID() as ReferralEntitlementId;
            const applied = await repository.attachDuringRegistration({
                inviteeUserId: input.userId,
                promoCode,
                inviterEntitlement: {
                    id: entitlementId,
                    amountMl: parseReferralMillilitres(loadEnv().REFERRAL_INVITER_BONUS_ML),
                    walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                    walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                    walletSource: REFERRAL_WALLET_SOURCE,
                    occurredAt: input.completedAt,
                },
            });
            relationshipCreated = applied.created;
            inviterEntitlementIds.push(applied.inviterEntitlementId);
        }

        this.logger.debug({
            event: 'referral_registration_onboarding_persisted',
            registrationCompletionId: input.registrationCompletionId,
            entitlementCount: inviterEntitlementIds.length,
        });
        return { promoCode: provisioned.promoCode, relationshipCreated, inviterEntitlementIds };
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
