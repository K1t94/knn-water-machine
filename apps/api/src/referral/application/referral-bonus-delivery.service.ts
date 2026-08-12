import { Inject, Injectable, Logger } from '@nestjs/common';

import { WalletCommandService } from '../../wallet/application/wallet-command.service';
import { WalletError, type WalletErrorCode } from '../../wallet/domain/wallet-errors';

import {
    REFERRAL_REPOSITORY,
    type DeliverReferralEntitlementInput,
    type DeliverReferralEntitlementResult,
    type ReferralBonusDelivery,
    type ReferralBonusDeliveryRepository,
    type ReferralEntitlement,
} from './ports/referral.repository';

export interface ReferralDeliveryCounters {
    readonly attempted: number;
    readonly delivered: number;
    readonly idempotentReplay: number;
    readonly staleLease: number;
    readonly permanentFailure: number;
}

@Injectable()
export class ReferralBonusDeliveryService implements ReferralBonusDelivery {
    private readonly logger = new Logger(ReferralBonusDeliveryService.name);
    private readonly counters = {
        attempted: 0,
        delivered: 0,
        idempotentReplay: 0,
        staleLease: 0,
        permanentFailure: 0,
    };

    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralBonusDeliveryRepository,
        @Inject(WalletCommandService) private readonly walletCommandService: WalletCommandService,
    ) {}

    async deliver(input: DeliverReferralEntitlementInput): Promise<DeliverReferralEntitlementResult> {
        this.counters.attempted += 1;

        const entitlement = await this.repository.getEntitlement(input.entitlementId);
        if (entitlement === null) {
            this.counters.permanentFailure += 1;
            return { status: 'PERMANENT_FAILURE', errorCode: 'REFERRAL_ENTITLEMENT_NOT_FOUND' };
        }
        if (entitlement.kind !== 'INVITER') {
            this.counters.permanentFailure += 1;
            return { status: 'PERMANENT_FAILURE', errorCode: 'REFERRAL_ENTITLEMENT_KIND_UNSUPPORTED' };
        }
        if (!this.canUseLease(entitlement, input.expectedLeaseOwner)) {
            this.counters.staleLease += 1;
            return { status: 'STALE_LEASE' };
        }
        if (entitlement.status === 'DELIVERED' && entitlement.walletLedgerEntryId !== null) {
            return { status: 'DELIVERED', walletLedgerEntryId: entitlement.walletLedgerEntryId };
        }

        try {
            const walletResult = await this.walletCommandService.credit({
                userId: entitlement.beneficiaryUserId,
                businessEventKey: entitlement.walletBusinessEventKey,
                amountMl: entitlement.amountMl,
                operationKind: entitlement.walletOperationKind,
                source: entitlement.walletSource,
                occurredAt: entitlement.occurredAt,
                ownerStatusPolicy: 'EXISTING_OWNER',
                featureGuard: 'REFERRAL_PROGRAM_ENABLED',
            });
            const completed = await this.repository.completeDelivery(
                entitlement.id,
                input.expectedLeaseOwner ?? entitlement.leaseOwner ?? '',
                walletResult.entryId,
                new Date(),
            );
            if (!completed) {
                this.counters.staleLease += 1;
                return { status: 'STALE_LEASE' };
            }

            this.counters.delivered += 1;
            if (walletResult.idempotentReplay) this.counters.idempotentReplay += 1;
            this.logger.log({ event: 'referral_bonus_delivered', replay: walletResult.idempotentReplay });
            return { status: 'DELIVERED', walletLedgerEntryId: walletResult.entryId };
        } catch (error: unknown) {
            if (error instanceof WalletError && isPermanentWalletFailure(error.code)) {
                this.counters.permanentFailure += 1;
                return { status: 'PERMANENT_FAILURE', errorCode: error.code };
            }

            throw error;
        }
    }

    snapshotCounters(): ReferralDeliveryCounters {
        return { ...this.counters };
    }

    private canUseLease(entitlement: ReferralEntitlement, expectedLeaseOwner: string | undefined): boolean {
        if (entitlement.status === 'DELIVERED') return entitlement.walletLedgerEntryId !== null;
        if (entitlement.status !== 'PROCESSING') return false;
        if (expectedLeaseOwner === undefined) return entitlement.leaseOwner !== null;
        return entitlement.leaseOwner === expectedLeaseOwner;
    }
}

export function isPermanentWalletFailure(code: WalletErrorCode): boolean {
    return code === 'WALLET_EVENT_CONFLICT' || code === 'WALLET_INVALID_AMOUNT' || code === 'WALLET_INVALID_EVENT';
}
