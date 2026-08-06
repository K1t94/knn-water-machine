import { ReferralError } from './referral-errors';

declare const referralMillilitresBrand: unique symbol;
declare const promoCodeBrand: unique symbol;
declare const referralCursorBrand: unique symbol;
declare const relationshipIdBrand: unique symbol;
declare const entitlementIdBrand: unique symbol;
declare const purchaseBusinessEventKeyBrand: unique symbol;

export const MAX_REFERRAL_MILLILITRES = 9_223_372_036_854_775_807n;
export const REFERRAL_WALLET_SOURCE = 'REFERRAL_PROGRAM' as const;
export const REFERRAL_WELCOME_OPERATION_KIND = 'REFERRAL_WELCOME_BONUS' as const;
export const REFERRAL_INVITER_OPERATION_KIND = 'REFERRAL_INVITER_BONUS' as const;

export type ReferralMillilitres = bigint & { readonly [referralMillilitresBrand]: true };
export type PromoCode = string & { readonly [promoCodeBrand]: true };
export type ReferralCursor = string & { readonly [referralCursorBrand]: true };
export type ReferralRelationshipId = string & { readonly [relationshipIdBrand]: true };
export type ReferralEntitlementId = string & { readonly [entitlementIdBrand]: true };
export type PurchaseBusinessEventKey = string & { readonly [purchaseBusinessEventKeyBrand]: true };

export type ReferralApplicationChannel = 'REGISTRATION' | 'POST_REGISTRATION';
export type ReferralEligibilityStatus = 'OPEN' | 'ATTACHED' | 'CLOSED';
export type ReferralBonusKind = 'WELCOME' | 'INVITER';
export type ReferralDeliveryStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'PERMANENT_FAILURE';
export type ReferralApplicationStatus = 'ATTACHED' | 'ALREADY_ATTACHED';
export type ReferralInvitationStatus = 'CREDITED';

export interface ReferralHistoryCursor {
    readonly beforeSequence: bigint;
}

export function parseReferralMillilitres(value: unknown): ReferralMillilitres {
    if (typeof value !== 'bigint' || value <= 0n || value > MAX_REFERRAL_MILLILITRES) {
        throw new ReferralError('REFERRAL_INVALID_AMOUNT', 'Referral amount must be exact positive millilitres');
    }

    return value as ReferralMillilitres;
}

export function serializeReferralMillilitres(value: ReferralMillilitres): string {
    return value.toString(10);
}
