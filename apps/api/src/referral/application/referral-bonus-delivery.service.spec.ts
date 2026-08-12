import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletError } from '../../wallet/domain/wallet-errors';
import { parseWalletBalance } from '../../wallet/domain/water-amount';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    REFERRAL_WELCOME_OPERATION_KIND,
    parseReferralMillilitres,
    type ReferralEntitlementId,
} from '../domain/referral-types';

import { ReferralBonusDeliveryService } from './referral-bonus-delivery.service';

import type { ReferralBonusDeliveryRepository, ReferralEntitlement } from './ports/referral.repository';
import type { WalletCommandService } from '../../wallet/application/wallet-command.service';

const ENTITLEMENT_ID = '11111111-1111-4111-8111-111111111111' as ReferralEntitlementId;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const LEDGER_ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_OWNER = '44444444-4444-4444-8444-444444444444';
const OCCURRED_AT = new Date('2026-08-07T10:00:00.000Z');

function entitlement(overrides: Partial<ReferralEntitlement> = {}): ReferralEntitlement {
    return {
        id: ENTITLEMENT_ID,
        beneficiaryUserId: USER_ID,
        kind: 'INVITER',
        amountMl: parseReferralMillilitres(5_000n),
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

describe('ReferralBonusDeliveryService', () => {
    let repository: ReferralBonusDeliveryRepository;
    let walletCommandService: Pick<WalletCommandService, 'credit'>;
    let service: ReferralBonusDeliveryService;

    beforeEach(() => {
        repository = {
            claimEntitlements: vi.fn(),
            claimEntitlementsById: vi.fn(),
            getEntitlement: vi.fn(),
            completeDelivery: vi.fn(),
            recordDeliveryFailure: vi.fn(),
            countDueEntitlements: vi.fn(),
        };
        walletCommandService = { credit: vi.fn() };
        service = new ReferralBonusDeliveryService(repository, walletCommandService as WalletCommandService);
    });

    it('delivers an inviter entitlement through wallet with its stored immutable amount', async () => {
        const amountMl = 5_000n;
        vi.mocked(repository.getEntitlement).mockResolvedValue(
            entitlement({
                amountMl: parseReferralMillilitres(amountMl),
            }),
        );
        vi.mocked(walletCommandService.credit).mockResolvedValue({
            entryId: LEDGER_ENTRY_ID,
            balanceAfterMl: parseWalletBalance(amountMl),
            idempotentReplay: false,
        });
        vi.mocked(repository.completeDelivery).mockResolvedValue(true);

        await expect(
            service.deliver({ entitlementId: ENTITLEMENT_ID, expectedLeaseOwner: LEASE_OWNER }),
        ).resolves.toEqual({
            status: 'DELIVERED',
            walletLedgerEntryId: LEDGER_ENTRY_ID,
        });

        expect(walletCommandService.credit).toHaveBeenCalledWith({
            userId: USER_ID,
            businessEventKey: `referral_bonus:${ENTITLEMENT_ID}`,
            amountMl,
            operationKind: REFERRAL_INVITER_OPERATION_KIND,
            source: REFERRAL_WALLET_SOURCE,
            occurredAt: OCCURRED_AT,
            ownerStatusPolicy: 'EXISTING_OWNER',
            featureGuard: 'REFERRAL_PROGRAM_ENABLED',
        });
        expect(repository.completeDelivery).toHaveBeenCalledWith(
            ENTITLEMENT_ID,
            LEASE_OWNER,
            LEDGER_ENTRY_ID,
            expect.any(Date),
        );
    });

    it('keeps a legacy welcome entitlement inert', async () => {
        vi.mocked(repository.getEntitlement).mockResolvedValue(
            entitlement({ kind: 'WELCOME', walletOperationKind: REFERRAL_WELCOME_OPERATION_KIND }),
        );

        await expect(
            service.deliver({ entitlementId: ENTITLEMENT_ID, expectedLeaseOwner: LEASE_OWNER }),
        ).resolves.toEqual({
            status: 'PERMANENT_FAILURE',
            errorCode: 'REFERRAL_ENTITLEMENT_KIND_UNSUPPORTED',
        });
        expect(walletCommandService.credit).not.toHaveBeenCalled();
        expect(repository.completeDelivery).not.toHaveBeenCalled();
    });

    it('completes delivery after a wallet idempotent replay without creating a second effect', async () => {
        vi.mocked(repository.getEntitlement).mockResolvedValue(entitlement());
        vi.mocked(walletCommandService.credit).mockResolvedValue({
            entryId: LEDGER_ENTRY_ID,
            balanceAfterMl: parseWalletBalance(5_000n),
            idempotentReplay: true,
        });
        vi.mocked(repository.completeDelivery).mockResolvedValue(true);

        await service.deliver({ entitlementId: ENTITLEMENT_ID, expectedLeaseOwner: LEASE_OWNER });

        expect(service.snapshotCounters()).toMatchObject({ delivered: 1, idempotentReplay: 1 });
        expect(repository.completeDelivery).toHaveBeenCalledTimes(1);
    });

    it('does not complete delivery when the lease is stale', async () => {
        vi.mocked(repository.getEntitlement).mockResolvedValue(entitlement({ leaseOwner: LEASE_OWNER }));

        await expect(
            service.deliver({
                entitlementId: ENTITLEMENT_ID,
                expectedLeaseOwner: '55555555-5555-4555-8555-555555555555',
            }),
        ).resolves.toEqual({ status: 'STALE_LEASE' });

        expect(walletCommandService.credit).not.toHaveBeenCalled();
        expect(repository.completeDelivery).not.toHaveBeenCalled();
    });

    it('classifies conflicting wallet facts as a permanent failure', async () => {
        vi.mocked(repository.getEntitlement).mockResolvedValue(entitlement());
        vi.mocked(walletCommandService.credit).mockRejectedValue(new WalletError('WALLET_EVENT_CONFLICT', 'conflict'));

        await expect(
            service.deliver({ entitlementId: ENTITLEMENT_ID, expectedLeaseOwner: LEASE_OWNER }),
        ).resolves.toEqual({
            status: 'PERMANENT_FAILURE',
            errorCode: 'WALLET_EVENT_CONFLICT',
        });
        expect(repository.completeDelivery).not.toHaveBeenCalled();
    });
});
