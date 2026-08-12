import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletError } from '../../wallet/domain/wallet-errors';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    REFERRAL_WELCOME_OPERATION_KIND,
    parseReferralMillilitres,
} from '../domain/referral-types';

import {
    REFERRAL_RECOVERY_BATCH_SIZE,
    REFERRAL_RECOVERY_LEASE_MS,
    REFERRAL_RECOVERY_MAX_BACKOFF_MS,
    REFERRAL_RECOVERY_MIN_BACKOFF_MS,
    ReferralRecoveryService,
} from './referral-recovery.service';

import type {
    ReferralBonusDelivery,
    ReferralBonusDeliveryRepository,
    ReferralEntitlement,
} from './ports/referral.repository';
import type { ReferralFeatureStateService } from './referral-feature-state.service';

const ENTITLEMENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_OWNER = '33333333-3333-4333-8333-333333333333';
const OCCURRED_AT = new Date('2026-08-07T10:00:00.000Z');

function entitlement(overrides: Partial<ReferralEntitlement> = {}): ReferralEntitlement {
    return {
        id: ENTITLEMENT_ID as ReferralEntitlement['id'],
        beneficiaryUserId: USER_ID,
        kind: 'INVITER',
        amountMl: parseReferralMillilitres(10_000n),
        walletBusinessEventKey: `referral_bonus:${ENTITLEMENT_ID}`,
        walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
        walletSource: REFERRAL_WALLET_SOURCE,
        occurredAt: OCCURRED_AT,
        status: 'PROCESSING',
        walletLedgerEntryId: null,
        attemptCount: 1,
        leaseOwner: LEASE_OWNER,
        ...overrides,
    };
}

describe('ReferralRecoveryService', () => {
    let repository: ReferralBonusDeliveryRepository;
    let delivery: ReferralBonusDelivery;
    let featureState: ReferralFeatureStateService;
    let service: ReferralRecoveryService;

    beforeEach(() => {
        repository = {
            claimEntitlements: vi.fn(),
            claimEntitlementsById: vi.fn(),
            getEntitlement: vi.fn(),
            completeDelivery: vi.fn(),
            recordDeliveryFailure: vi.fn(),
            countDueEntitlements: vi.fn().mockResolvedValue(0),
        };
        delivery = { deliver: vi.fn() };
        featureState = {
            readAvailability: vi.fn().mockResolvedValue({
                key: 'REFERRAL_PROGRAM',
                enabled: true,
                revision: 1n,
                updatedAt: OCCURRED_AT,
            }),
        } as unknown as ReferralFeatureStateService;
        service = new ReferralRecoveryService(repository, delivery, featureState);
    });

    it('claims a bounded batch with a 30 second lease and delivers each entitlement', async () => {
        vi.mocked(repository.claimEntitlements).mockResolvedValue([entitlement()]);
        vi.mocked(delivery.deliver).mockResolvedValue({ status: 'DELIVERED', walletLedgerEntryId: 'ledger-1' });

        const result = await service.runOnce({ workerId: LEASE_OWNER });
        const claim = vi.mocked(repository.claimEntitlements).mock.calls[0][0];

        expect(claim.now).toBeInstanceOf(Date);
        expect(claim).toMatchObject({
            workerId: LEASE_OWNER,
            leaseDurationMs: REFERRAL_RECOVERY_LEASE_MS,
            limit: REFERRAL_RECOVERY_BATCH_SIZE,
        });
        expect(delivery.deliver).toHaveBeenCalledWith({
            entitlementId: ENTITLEMENT_ID,
            expectedLeaseOwner: LEASE_OWNER,
        });
        expect(result).toMatchObject({ claimed: 1, delivered: 1, retryScheduled: 0, permanentFailure: 0 });
    });

    it('claims only the entitlement IDs returned by a committed registration', async () => {
        vi.mocked(repository.claimEntitlementsById).mockResolvedValue([entitlement()]);
        vi.mocked(delivery.deliver).mockResolvedValue({ status: 'DELIVERED', walletLedgerEntryId: 'ledger-1' });

        const result = await service.runEntitlements([ENTITLEMENT_ID as ReferralEntitlement['id']]);

        expect(repository.claimEntitlementsById).toHaveBeenCalledWith(
            expect.objectContaining({
                entitlementIds: [ENTITLEMENT_ID],
                leaseDurationMs: REFERRAL_RECOVERY_LEASE_MS,
            }),
        );
        expect(repository.claimEntitlements).not.toHaveBeenCalled();
        expect(result).toMatchObject({ claimed: 1, delivered: 1, remainingDue: 0 });
    });

    it('records transient failures with bounded retry backoff', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-07T12:00:00.000Z'));
        vi.mocked(repository.claimEntitlements).mockResolvedValue([entitlement({ attemptCount: 2 })]);
        vi.mocked(delivery.deliver).mockRejectedValue(new WalletError('WALLET_TEMPORARILY_UNAVAILABLE', 'temporary'));
        vi.mocked(repository.recordDeliveryFailure).mockResolvedValue(true);

        const result = await service.runOnce({ workerId: LEASE_OWNER, batchSize: 1 });

        const failure = vi.mocked(repository.recordDeliveryFailure).mock.calls[0][0];
        const nextAttemptAt = failure.nextAttemptAt;
        if (nextAttemptAt === null) throw new Error('Expected retry to be scheduled.');
        expect(failure).toMatchObject({
            entitlementId: ENTITLEMENT_ID,
            leaseOwner: LEASE_OWNER,
            errorCode: 'WALLET_TEMPORARILY_UNAVAILABLE',
            permanent: false,
        });
        expect(nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + REFERRAL_RECOVERY_MIN_BACKOFF_MS);
        expect(nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + REFERRAL_RECOVERY_MAX_BACKOFF_MS);
        expect(result.retryScheduled).toBe(1);
        vi.useRealTimers();
    });

    it('records permanent wallet conflicts without scheduling another retry', async () => {
        vi.mocked(repository.claimEntitlements).mockResolvedValue([entitlement()]);
        vi.mocked(delivery.deliver).mockResolvedValue({
            status: 'PERMANENT_FAILURE',
            errorCode: 'WALLET_EVENT_CONFLICT',
        });
        vi.mocked(repository.recordDeliveryFailure).mockResolvedValue(true);

        const result = await service.runOnce({ workerId: LEASE_OWNER });

        expect(repository.recordDeliveryFailure).toHaveBeenCalledWith({
            entitlementId: ENTITLEMENT_ID,
            leaseOwner: LEASE_OWNER,
            errorCode: 'WALLET_EVENT_CONFLICT',
            nextAttemptAt: null,
            permanent: true,
        });
        expect(result.permanentFailure).toBe(1);
    });

    it('does not mark stale leases as failures', async () => {
        vi.mocked(repository.claimEntitlements).mockResolvedValue([entitlement()]);
        vi.mocked(delivery.deliver).mockResolvedValue({ status: 'STALE_LEASE' });

        const result = await service.runOnce({ workerId: LEASE_OWNER });

        expect(repository.recordDeliveryFailure).not.toHaveBeenCalled();
        expect(result.staleLease).toBe(1);
    });

    it.each(['runOnce', 'runEntitlements'] as const)('claims zero rows while disabled through %s', async (method) => {
        vi.mocked(featureState.readAvailability).mockResolvedValue({
            key: 'REFERRAL_PROGRAM',
            enabled: false,
            revision: 2n,
            updatedAt: OCCURRED_AT,
        });

        const result =
            method === 'runOnce'
                ? await service.runOnce({ workerId: LEASE_OWNER })
                : await service.runEntitlements([ENTITLEMENT_ID as ReferralEntitlement['id']]);

        expect(result).toMatchObject({ claimed: 0, delivered: 0, remainingDue: 0 });
        expect(repository.claimEntitlements).not.toHaveBeenCalled();
        expect(repository.claimEntitlementsById).not.toHaveBeenCalled();
        expect(delivery.deliver).not.toHaveBeenCalled();
    });

    it('releases a claim immediately when the wallet guard observes disabled state', async () => {
        vi.mocked(repository.claimEntitlements).mockResolvedValue([entitlement()]);
        vi.mocked(delivery.deliver).mockRejectedValue(
            new WalletError('WALLET_FEATURE_DISABLED', 'The guarded wallet feature is disabled.'),
        );
        vi.mocked(repository.recordDeliveryFailure).mockResolvedValue(true);

        const result = await service.runOnce({ workerId: LEASE_OWNER });
        const failureNextAttemptAt = vi.mocked(repository.recordDeliveryFailure).mock.calls[0][0].nextAttemptAt;

        expect(repository.recordDeliveryFailure).toHaveBeenCalledWith({
            entitlementId: ENTITLEMENT_ID,
            leaseOwner: LEASE_OWNER,
            errorCode: 'FEATURE_DISABLED',
            nextAttemptAt: failureNextAttemptAt,
            permanent: false,
        });
        expect(failureNextAttemptAt).toBeInstanceOf(Date);
        expect(result).toMatchObject({ claimed: 1, delivered: 0, retryScheduled: 1 });
    });

    it('never delivers a legacy welcome entitlement returned by a faulty claim adapter', async () => {
        vi.mocked(repository.claimEntitlements).mockResolvedValue([
            entitlement({ kind: 'WELCOME', walletOperationKind: REFERRAL_WELCOME_OPERATION_KIND }),
        ]);

        const result = await service.runOnce({ workerId: LEASE_OWNER });

        expect(delivery.deliver).not.toHaveBeenCalled();
        expect(result).toMatchObject({ claimed: 0, delivered: 0 });
    });

    it('resumes after re-enable and relies on the delivery boundary for idempotent replay', async () => {
        vi.mocked(featureState.readAvailability)
            .mockResolvedValueOnce({
                key: 'REFERRAL_PROGRAM',
                enabled: false,
                revision: 2n,
                updatedAt: OCCURRED_AT,
            })
            .mockResolvedValue({
                key: 'REFERRAL_PROGRAM',
                enabled: true,
                revision: 3n,
                updatedAt: OCCURRED_AT,
            });
        vi.mocked(repository.claimEntitlements).mockResolvedValueOnce([entitlement()]).mockResolvedValueOnce([]);
        vi.mocked(delivery.deliver).mockResolvedValue({ status: 'DELIVERED', walletLedgerEntryId: 'ledger-1' });

        await expect(service.runOnce({ workerId: LEASE_OWNER })).resolves.toMatchObject({ claimed: 0 });
        await expect(service.runOnce({ workerId: LEASE_OWNER })).resolves.toMatchObject({ delivered: 1 });
        await expect(service.runOnce({ workerId: LEASE_OWNER })).resolves.toMatchObject({ delivered: 0 });

        expect(delivery.deliver).toHaveBeenCalledTimes(1);
    });
});
