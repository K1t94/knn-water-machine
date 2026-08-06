import type {
    PromoCode,
    PurchaseBusinessEventKey,
    ReferralApplicationChannel,
    ReferralApplicationStatus,
    ReferralBonusKind,
    ReferralCursor,
    ReferralDeliveryStatus,
    ReferralEntitlementId,
    ReferralMillilitres,
    ReferralRelationshipId,
} from '../../domain/referral-types';

export const REFERRAL_REPOSITORY = Symbol('REFERRAL_REPOSITORY');

export interface ProvisionReferralUserInput {
    readonly userId: string;
    readonly createdAt: Date;
}

export interface ProvisionReferralUserResult {
    readonly promoCode: PromoCode;
    readonly created: boolean;
    readonly collisionCount: number;
}

export interface ReferralProvisioningCandidate {
    readonly userId: string;
    readonly createdAt: Date;
    readonly provisioned: boolean;
}

export interface ListReferralProvisioningCandidatesInput {
    readonly afterUserId: string | null;
    readonly limit: number;
}

export interface ApplyReferralCodeInput {
    readonly inviteeUserId: string;
    readonly promoCode: PromoCode;
    readonly channel: ReferralApplicationChannel;
    readonly inviterEntitlement: CreateInviterEntitlementInput;
}

export interface CreateInviterEntitlementInput {
    readonly id: ReferralEntitlementId;
    readonly amountMl: ReferralMillilitres;
    readonly walletBusinessEventKey: string;
    readonly walletOperationKind: 'REFERRAL_INVITER_BONUS';
    readonly walletSource: 'REFERRAL_PROGRAM';
    readonly occurredAt: Date;
}

export interface CreateWelcomeEntitlementInput {
    readonly id: ReferralEntitlementId;
    readonly beneficiaryUserId: string;
    readonly amountMl: ReferralMillilitres;
    readonly walletBusinessEventKey: string;
    readonly walletOperationKind: 'REFERRAL_WELCOME_BONUS';
    readonly walletSource: 'REFERRAL_PROGRAM';
    readonly occurredAt: Date;
}

export interface CreateWelcomeEntitlementResult {
    readonly entitlementId: ReferralEntitlementId;
    readonly created: boolean;
}

export interface ApplyReferralCodeResult {
    readonly status: ReferralApplicationStatus;
    readonly canonicalPromoCode: PromoCode;
    readonly appliedAt: Date;
    readonly relationshipId: ReferralRelationshipId;
    readonly inviterEntitlementId: ReferralEntitlementId;
}

export interface CloseReferralEligibilityInput {
    readonly userId: string;
    readonly purchaseBusinessEventKey: PurchaseBusinessEventKey;
    readonly succeededAt: Date;
}

export type CloseReferralEligibilityResult =
    | Readonly<{ status: 'CLOSED'; closedAt: Date }>
    | Readonly<{ status: 'ALREADY_CLOSED'; closedAt: Date }>
    | Readonly<{ status: 'ALREADY_ATTACHED' }>;

export interface ReferralEntitlement {
    readonly id: ReferralEntitlementId;
    readonly beneficiaryUserId: string;
    readonly kind: ReferralBonusKind;
    readonly amountMl: ReferralMillilitres;
    readonly walletBusinessEventKey: string;
    readonly walletOperationKind: 'REFERRAL_WELCOME_BONUS' | 'REFERRAL_INVITER_BONUS';
    readonly walletSource: 'REFERRAL_PROGRAM';
    readonly occurredAt: Date;
    readonly status: ReferralDeliveryStatus;
    readonly walletLedgerEntryId: string | null;
    readonly attemptCount: number;
    readonly leaseOwner: string | null;
}

export interface ClaimReferralEntitlementsInput {
    readonly workerId: string;
    readonly now: Date;
    readonly leaseDurationMs: number;
    readonly limit: number;
}

export interface ClaimReferralEntitlementsByIdInput {
    readonly workerId: string;
    readonly now: Date;
    readonly leaseDurationMs: number;
    readonly entitlementIds: readonly ReferralEntitlementId[];
}

export type DeliverReferralEntitlementResult =
    | Readonly<{ status: 'DELIVERED'; walletLedgerEntryId: string }>
    | Readonly<{ status: 'RETRY_SCHEDULED'; nextAttemptAt: Date }>
    | Readonly<{ status: 'PERMANENT_FAILURE'; errorCode: string }>
    | Readonly<{ status: 'STALE_LEASE' }>;

export interface DeliverReferralEntitlementInput {
    readonly entitlementId: ReferralEntitlementId;
    readonly expectedLeaseOwner?: string;
}

export interface RecordReferralDeliveryFailureInput {
    readonly entitlementId: ReferralEntitlementId;
    readonly leaseOwner: string;
    readonly errorCode: string;
    readonly nextAttemptAt: Date | null;
    readonly permanent: boolean;
}

export const REFERRAL_BONUS_DELIVERY = Symbol('REFERRAL_BONUS_DELIVERY');

export interface ReferralBonusDelivery {
    deliver(input: DeliverReferralEntitlementInput): Promise<DeliverReferralEntitlementResult>;
}

export interface ReferralSummary {
    readonly promoCode: PromoCode;
    readonly referralLink: string;
    readonly applicationStatus: 'OPEN' | 'ATTACHED' | 'CLOSED';
    readonly attachedPromoCode: PromoCode | null;
    readonly deliveredInvitationCount: number;
    readonly deliveredInviterBonusMl: bigint;
}

export interface ReferralInvitation {
    readonly sequence: bigint;
    readonly publicId: string;
    readonly inviteeLabel: string;
    readonly appliedAt: Date;
    readonly creditedAmountMl: ReferralMillilitres;
    readonly status: 'CREDITED';
}

export interface ReferralInvitationPage {
    readonly items: readonly ReferralInvitation[];
    readonly nextCursor: ReferralCursor | null;
}

export interface ReferralProvisioningRepository {
    listProvisioningCandidates(
        input: ListReferralProvisioningCandidatesInput,
    ): Promise<readonly ReferralProvisioningCandidate[]>;
    provisionUser(input: ProvisionReferralUserInput): Promise<ProvisionReferralUserResult>;
}

export interface ReferralRelationshipRepository {
    validatePromoCode(promoCode: PromoCode, inviteeUserId?: string): Promise<void>;
    applyCode(input: ApplyReferralCodeInput): Promise<ApplyReferralCodeResult>;
    closeEligibility(input: CloseReferralEligibilityInput): Promise<CloseReferralEligibilityResult>;
    createWelcomeEntitlement(input: CreateWelcomeEntitlementInput): Promise<CreateWelcomeEntitlementResult>;
}

export interface ReferralBonusDeliveryRepository {
    claimEntitlements(input: ClaimReferralEntitlementsInput): Promise<readonly ReferralEntitlement[]>;
    claimEntitlementsById(input: ClaimReferralEntitlementsByIdInput): Promise<readonly ReferralEntitlement[]>;
    getEntitlement(entitlementId: ReferralEntitlementId): Promise<ReferralEntitlement | null>;
    completeDelivery(
        entitlementId: ReferralEntitlementId,
        leaseOwner: string,
        walletLedgerEntryId: string,
        deliveredAt: Date,
    ): Promise<boolean>;
    recordDeliveryFailure(input: RecordReferralDeliveryFailureInput): Promise<boolean>;
    countDueEntitlements(now: Date): Promise<number>;
}

export interface ReferralQueryRepository {
    getMyReferral(userId: string): Promise<ReferralSummary>;
    getInvitations(userId: string, limit: number, cursor: ReferralCursor | null): Promise<ReferralInvitationPage>;
}

export interface ReferralRepository
    extends
        ReferralProvisioningRepository,
        ReferralRelationshipRepository,
        ReferralBonusDeliveryRepository,
        ReferralQueryRepository {}
