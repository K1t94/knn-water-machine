import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { loadEnv } from '../../config/env';
import { canonicalizePromoCode } from '../domain/promo-code';
import {
    REFERRAL_WELCOME_OPERATION_KIND,
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    type ReferralApplicationChannel,
    type ReferralApplicationStatus,
    type ReferralEntitlementId,
    type PromoCode,
    parseReferralMillilitres,
} from '../domain/referral-types';

import {
    REFERRAL_REPOSITORY,
    type ApplyReferralCodeResult,
    type CreateWelcomeEntitlementResult,
    type ReferralRelationshipRepository,
} from './ports/referral.repository';

export interface ApplyReferralCodeCommand {
    readonly inviteeUserId: string;
    readonly promoCode: unknown;
    readonly channel?: ReferralApplicationChannel;
}

export interface ApplyReferralCodeView {
    readonly status: ReferralApplicationStatus;
    readonly promoCode: PromoCode;
    readonly appliedAt: Date;
}

export interface CreateWelcomeEntitlementCommand {
    readonly userId: string;
    readonly occurredAt?: Date;
}

@Injectable()
export class ReferralApplicationService {
    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralRelationshipRepository,
    ) {}

    async apply(command: ApplyReferralCodeCommand): Promise<ApplyReferralCodeView> {
        const result = await this.applyInternal(command);
        return {
            status: result.status,
            promoCode: result.canonicalPromoCode,
            appliedAt: result.appliedAt,
        };
    }

    async applyInternal(command: ApplyReferralCodeCommand): Promise<ApplyReferralCodeResult> {
        const now = new Date();
        const entitlementId = randomUUID() as ReferralEntitlementId;
        const amountMl = parseReferralMillilitres(loadEnv().REFERRAL_INVITER_BONUS_ML);

        return this.repository.applyCode({
            inviteeUserId: command.inviteeUserId,
            promoCode: canonicalizePromoCode(command.promoCode),
            channel: command.channel ?? 'POST_REGISTRATION',
            inviterEntitlement: {
                id: entitlementId,
                amountMl,
                walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                walletSource: REFERRAL_WALLET_SOURCE,
                occurredAt: now,
            },
        });
    }

    async createWelcomeEntitlement(command: CreateWelcomeEntitlementCommand): Promise<CreateWelcomeEntitlementResult> {
        const now = command.occurredAt ?? new Date();
        const entitlementId = randomUUID() as ReferralEntitlementId;
        const amountMl = parseReferralMillilitres(loadEnv().REFERRAL_WELCOME_BONUS_ML);

        return this.repository.createWelcomeEntitlement({
            id: entitlementId,
            beneficiaryUserId: command.userId,
            amountMl,
            walletBusinessEventKey: `referral_bonus:${entitlementId}`,
            walletOperationKind: REFERRAL_WELCOME_OPERATION_KIND,
            walletSource: REFERRAL_WALLET_SOURCE,
            occurredAt: now,
        });
    }
}
