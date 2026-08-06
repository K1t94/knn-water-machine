import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { WalletError } from '../../wallet/domain/wallet-errors';

import {
    REFERRAL_BONUS_DELIVERY,
    REFERRAL_REPOSITORY,
    type ReferralBonusDelivery,
    type ReferralBonusDeliveryRepository,
    type ReferralEntitlement,
} from './ports/referral.repository';
import { isPermanentWalletFailure } from './referral-bonus-delivery.service';

import type { ReferralEntitlementId } from '../domain/referral-types';

export const REFERRAL_RECOVERY_BATCH_SIZE = 25;
export const REFERRAL_RECOVERY_LEASE_MS = 30_000;
export const REFERRAL_RECOVERY_INTERVAL_MS = 1_000;
export const REFERRAL_RECOVERY_MIN_BACKOFF_MS = 1_000;
export const REFERRAL_RECOVERY_MAX_BACKOFF_MS = 300_000;

export interface ReferralRecoveryRunOptions {
    readonly batchSize?: number;
    readonly workerId?: string;
}

export interface ReferralRecoveryRunResult {
    readonly workerId: string;
    readonly claimed: number;
    readonly delivered: number;
    readonly staleLease: number;
    readonly permanentFailure: number;
    readonly retryScheduled: number;
    readonly remainingDue: number;
}

@Injectable()
export class ReferralRecoveryService {
    private readonly logger = new Logger(ReferralRecoveryService.name);

    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralBonusDeliveryRepository,
        @Inject(REFERRAL_BONUS_DELIVERY)
        private readonly delivery: ReferralBonusDelivery,
    ) {}

    async runOnce(options: ReferralRecoveryRunOptions = {}): Promise<ReferralRecoveryRunResult> {
        const now = new Date();
        const workerId = options.workerId ?? randomUUID();
        const claimed = await this.repository.claimEntitlements({
            workerId,
            now,
            leaseDurationMs: REFERRAL_RECOVERY_LEASE_MS,
            limit: options.batchSize ?? REFERRAL_RECOVERY_BATCH_SIZE,
        });
        return this.processClaims(workerId, claimed, true);
    }

    async runEntitlements(entitlementIds: readonly ReferralEntitlementId[]): Promise<ReferralRecoveryRunResult> {
        const now = new Date();
        const workerId = randomUUID();
        const claimed = await this.repository.claimEntitlementsById({
            workerId,
            now,
            leaseDurationMs: REFERRAL_RECOVERY_LEASE_MS,
            entitlementIds: entitlementIds.slice(0, REFERRAL_RECOVERY_BATCH_SIZE),
        });
        return this.processClaims(workerId, claimed, false);
    }

    private async processClaims(
        workerId: string,
        claimed: readonly ReferralEntitlement[],
        countRemaining: boolean,
    ): Promise<ReferralRecoveryRunResult> {
        const result = {
            workerId,
            claimed: claimed.length,
            delivered: 0,
            staleLease: 0,
            permanentFailure: 0,
            retryScheduled: 0,
            remainingDue: 0,
        };

        for (const entitlement of claimed) {
            const deliveryResult = await this.deliverClaim(workerId, entitlement);
            if (deliveryResult === 'DELIVERED') result.delivered += 1;
            if (deliveryResult === 'STALE_LEASE') result.staleLease += 1;
            if (deliveryResult === 'PERMANENT_FAILURE') result.permanentFailure += 1;
            if (deliveryResult === 'RETRY_SCHEDULED') result.retryScheduled += 1;
        }

        result.remainingDue = countRemaining ? await this.repository.countDueEntitlements(new Date()) : 0;
        if (result.claimed > 0 || result.remainingDue > 0) {
            this.logger.log({
                event: 'referral_bonus_recovery_run',
                claimed: result.claimed,
                delivered: result.delivered,
                staleLease: result.staleLease,
                permanentFailure: result.permanentFailure,
                retryScheduled: result.retryScheduled,
                remainingDue: result.remainingDue,
            });
        }
        return result;
    }

    private async deliverClaim(
        workerId: string,
        entitlement: ReferralEntitlement,
    ): Promise<'DELIVERED' | 'STALE_LEASE' | 'PERMANENT_FAILURE' | 'RETRY_SCHEDULED'> {
        try {
            const result = await this.delivery.deliver({
                entitlementId: entitlement.id,
                expectedLeaseOwner: workerId,
            });
            if (result.status === 'DELIVERED' || result.status === 'STALE_LEASE') return result.status;
            if (result.status === 'PERMANENT_FAILURE') {
                await this.repository.recordDeliveryFailure({
                    entitlementId: entitlement.id,
                    leaseOwner: workerId,
                    errorCode: result.errorCode,
                    nextAttemptAt: null,
                    permanent: true,
                });
                return 'PERMANENT_FAILURE';
            }
            return 'RETRY_SCHEDULED';
        } catch (error: unknown) {
            const walletError = error instanceof WalletError ? error : null;
            const permanent = walletError !== null && isPermanentWalletFailure(walletError.code);
            await this.repository.recordDeliveryFailure({
                entitlementId: entitlement.id,
                leaseOwner: workerId,
                errorCode: walletError?.code ?? 'REFERRAL_WALLET_TEMPORARY_FAILURE',
                nextAttemptAt: permanent ? null : this.nextAttemptAt(entitlement.attemptCount),
                permanent,
            });
            return permanent ? 'PERMANENT_FAILURE' : 'RETRY_SCHEDULED';
        }
    }

    private nextAttemptAt(attemptCount: number): Date {
        const exponential = REFERRAL_RECOVERY_MIN_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1);
        const capped = Math.min(exponential, REFERRAL_RECOVERY_MAX_BACKOFF_MS);
        const jitter = randomInt(Math.floor(capped * 0.8), Math.floor(capped * 1.2) + 1);
        return new Date(Date.now() + Math.min(jitter, REFERRAL_RECOVERY_MAX_BACKOFF_MS));
    }
}
