import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReferralBonusDeliveryService } from '../src/referral/application/referral-bonus-delivery.service';
import { ReferralFeatureStateService } from '../src/referral/application/referral-feature-state.service';
import { ReferralRecoveryService } from '../src/referral/application/referral-recovery.service';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    REFERRAL_WELCOME_OPERATION_KIND,
    parseReferralMillilitres,
    type ReferralEntitlementId,
} from '../src/referral/domain/referral-types';
import { PrismaReferralFeatureStateRepository } from '../src/referral/infrastructure/postgres/prisma-referral-feature-state.repository';
import { PrismaReferralRepository } from '../src/referral/infrastructure/postgres/prisma-referral.repository';
import { WalletCommandService } from '../src/wallet/application/wallet-command.service';
import { PrismaWalletRepository } from '../src/wallet/infrastructure/postgres/prisma-wallet.repository';

import {
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    insertReferralTestUser,
    referralPostgresEnabled,
    type ReferralPostgresSchema,
} from './referral-postgres.fixture';

import type { PrismaService } from '../src/prisma/prisma.service';

const describeIfPostgres = referralPostgresEnabled ? describe : describe.skip;
const OCCURRED_AT = new Date('2026-08-07T10:00:00.000Z');

describeIfPostgres('Referral bonus recovery', () => {
    let fixture: ReferralPostgresSchema | undefined;
    let repository: PrismaReferralRepository;
    let walletCommandService: WalletCommandService;
    let deliveryService: ReferralBonusDeliveryService;
    let featureState: ReferralFeatureStateService;
    let recoveryService: ReferralRecoveryService;

    beforeEach(async () => {
        fixture = await createReferralPostgresSchema('recovery');
        fixture.deploy();
        repository = new PrismaReferralRepository(fixture.prisma);
        walletCommandService = new WalletCommandService(
            new PrismaWalletRepository(fixture.prisma as unknown as PrismaService),
        );
        deliveryService = new ReferralBonusDeliveryService(repository, walletCommandService);
        featureState = new ReferralFeatureStateService(new PrismaReferralFeatureStateRepository(fixture.prisma));
        recoveryService = new ReferralRecoveryService(repository, deliveryService, featureState);
    });

    afterEach(async () => {
        await disposeReferralPostgresSchema(fixture);
        fixture = undefined;
    });

    it('claims due entitlements with a lease and reclaims expired processing rows', async () => {
        const entitlementId = await createInviterEntitlement('1001');
        const workerA = randomUUID();
        const workerB = randomUUID();
        const now = new Date('2026-08-07T11:00:00.000Z');

        const claimed = await repository.claimEntitlements({
            workerId: workerA,
            now,
            leaseDurationMs: 30_000,
            limit: 1,
        });

        expect(claimed.map((entitlement) => entitlement.id)).toEqual([entitlementId]);
        await expect(
            repository.claimEntitlements({ workerId: workerB, now, leaseDurationMs: 30_000, limit: 1 }),
        ).resolves.toHaveLength(0);
        await expect(repository.completeDelivery(entitlementId, workerB, randomUUID(), now)).resolves.toBe(false);

        await fixture?.prisma.referralBonusEntitlement.update({
            where: { id: entitlementId },
            data: { leaseExpiresAt: new Date('2026-08-07T10:59:59.000Z') },
        });

        const reclaimed = await repository.claimEntitlements({
            workerId: workerB,
            now,
            leaseDurationMs: 30_000,
            limit: 1,
        });

        expect(reclaimed.map((entitlement) => entitlement.id)).toEqual([entitlementId]);
        expect(reclaimed[0]?.attemptCount).toBe(2);
    });

    it('recovers after interruption between wallet credit and entitlement completion with one wallet effect', async () => {
        const entitlementId = await createInviterEntitlement('1002');
        const workerA = randomUUID();
        const workerB = randomUUID();
        const [claimed] = await repository.claimEntitlements({
            workerId: workerA,
            now: new Date('2026-08-07T11:00:00.000Z'),
            leaseDurationMs: 30_000,
            limit: 1,
        });

        await walletCommandService.credit({
            userId: claimed.beneficiaryUserId,
            businessEventKey: claimed.walletBusinessEventKey,
            amountMl: claimed.amountMl,
            operationKind: claimed.walletOperationKind,
            source: claimed.walletSource,
            occurredAt: claimed.occurredAt,
            ownerStatusPolicy: 'EXISTING_OWNER',
            featureGuard: 'REFERRAL_PROGRAM_ENABLED',
        });
        await fixture?.prisma.referralBonusEntitlement.update({
            where: { id: entitlementId },
            data: { leaseExpiresAt: new Date('2026-08-07T10:59:59.000Z') },
        });

        const result = await recoveryService.runOnce({ workerId: workerB, batchSize: 1 });
        const [entitlement, ledgerCount] = await Promise.all([
            fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
            fixture?.prisma.walletLedgerEntry.count({ where: { businessEventKey: claimed.walletBusinessEventKey } }),
        ]);

        expect(result).toMatchObject({ claimed: 1, delivered: 1, permanentFailure: 0 });
        expect(entitlement?.status).toBe('DELIVERED');
        expect(entitlement?.walletLedgerEntryId).not.toBeNull();
        expect(ledgerCount).toBe(1);
    });

    it('marks a conflicting wallet replay as permanent without duplicating ledger rows', async () => {
        const entitlementId = await createInviterEntitlement('1003');
        const entitlement = await repository.getEntitlement(entitlementId);
        if (entitlement === null) throw new Error('Expected a referral entitlement.');
        await walletCommandService.credit({
            userId: entitlement.beneficiaryUserId,
            businessEventKey: entitlement.walletBusinessEventKey,
            amountMl: parseReferralMillilitres(1n),
            operationKind: entitlement.walletOperationKind,
            source: entitlement.walletSource,
            occurredAt: entitlement.occurredAt,
            ownerStatusPolicy: 'EXISTING_OWNER',
            featureGuard: 'REFERRAL_PROGRAM_ENABLED',
        });

        const result = await recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 });
        const [stored, ledgerCount] = await Promise.all([
            fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
            fixture?.prisma.walletLedgerEntry.count({
                where: { businessEventKey: entitlement.walletBusinessEventKey },
            }),
        ]);

        expect(result).toMatchObject({ claimed: 1, permanentFailure: 1 });
        expect(stored?.status).toBe('PERMANENT_FAILURE');
        expect(stored?.lastErrorCode).toBe('WALLET_EVENT_CONFLICT');
        expect(ledgerCount).toBe(1);
    });

    it('retries a temporary wallet failure after beneficiary suspension with one wallet effect', async () => {
        const entitlementId = await createInviterEntitlement('1004');
        const entitlement = await repository.getEntitlement(entitlementId);
        if (entitlement === null) throw new Error('Expected a referral entitlement.');
        const unavailableWallet = {
            credit: async (): Promise<never> => {
                throw new Error('Simulated temporary wallet outage.');
            },
        } as unknown as WalletCommandService;
        const unavailableRecovery = new ReferralRecoveryService(
            repository,
            new ReferralBonusDeliveryService(repository, unavailableWallet),
            featureState,
        );

        const failedRun = await unavailableRecovery.runOnce({ workerId: randomUUID(), batchSize: 1 });
        const pending = await fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({
            where: { id: entitlementId },
        });

        expect(failedRun).toMatchObject({ claimed: 1, delivered: 0, retryScheduled: 1 });
        expect(pending?.status).toBe('PENDING');
        expect(pending?.lastErrorCode).toBe('REFERRAL_WALLET_TEMPORARY_FAILURE');

        await fixture?.prisma.$transaction([
            fixture.prisma.user.update({
                where: { id: entitlement.beneficiaryUserId },
                data: { status: 'SUSPENDED' },
            }),
            fixture.prisma.referralBonusEntitlement.update({
                where: { id: entitlementId },
                data: { nextAttemptAt: new Date(0) },
            }),
        ]);

        const recoveredRun = await recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 });
        const [delivered, ledgerCount] = await Promise.all([
            fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
            fixture?.prisma.walletLedgerEntry.count({
                where: { businessEventKey: entitlement.walletBusinessEventKey },
            }),
        ]);

        expect(recoveredRun).toMatchObject({ claimed: 1, delivered: 1, permanentFailure: 0 });
        expect(delivered?.status).toBe('DELIVERED');
        expect(delivered?.walletLedgerEntryId).not.toBeNull();
        expect(ledgerCount).toBe(1);
    });

    it('uses SKIP LOCKED so concurrent workers do not claim the same entitlements', async () => {
        const entitlementIds = await Promise.all(
            Array.from({ length: 30 }, (_value, index) =>
                createInviterEntitlement(`2${index.toString().padStart(3, '0')}`),
            ),
        );

        const [workerA, workerB] = await Promise.all([
            repository.claimEntitlements({
                workerId: randomUUID(),
                now: new Date('2026-08-07T11:00:00.000Z'),
                leaseDurationMs: 30_000,
                limit: 25,
            }),
            repository.claimEntitlements({
                workerId: randomUUID(),
                now: new Date('2026-08-07T11:00:00.000Z'),
                leaseDurationMs: 30_000,
                limit: 25,
            }),
        ]);
        const claimedIds = [...workerA, ...workerB].map((entitlement) => entitlement.id);

        expect(new Set(claimedIds).size).toBe(claimedIds.length);
        expect(claimedIds.sort()).toEqual([...entitlementIds].sort());
    });

    it('claims nothing while disabled and resumes a preserved inviter obligation once', async () => {
        const entitlementId = await createInviterEntitlement('3001');
        await featureState.setEnabled({ enabled: false });

        await expect(recoveryService.runOnce({ workerId: randomUUID() })).resolves.toMatchObject({
            claimed: 0,
            delivered: 0,
            remainingDue: 0,
        });
        await expect(
            fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
        ).resolves.toMatchObject({ status: 'PENDING', walletLedgerEntryId: null });

        await featureState.setEnabled({ enabled: true });
        await expect(recoveryService.runOnce({ workerId: randomUUID() })).resolves.toMatchObject({ delivered: 1 });
        await expect(recoveryService.runOnce({ workerId: randomUUID() })).resolves.toMatchObject({ delivered: 0 });
        await expect(
            fixture?.prisma.walletLedgerEntry.count({ where: { operationKind: REFERRAL_INVITER_OPERATION_KIND } }),
        ).resolves.toBe(1);
    });

    it('releases a claimed obligation when disable wins before the wallet transaction', async () => {
        const entitlementId = await createInviterEntitlement('3002');
        let toggled = false;
        const raceDelivery = {
            deliver: async (input: Parameters<ReferralBonusDeliveryService['deliver']>[0]) => {
                if (!toggled) {
                    toggled = true;
                    await featureState.setEnabled({ enabled: false });
                }
                return deliveryService.deliver(input);
            },
        };
        const racingRecovery = new ReferralRecoveryService(repository, raceDelivery, featureState);

        await expect(racingRecovery.runOnce({ workerId: randomUUID(), batchSize: 1 })).resolves.toMatchObject({
            claimed: 1,
            delivered: 0,
            retryScheduled: 1,
        });
        await expect(
            fixture?.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
        ).resolves.toMatchObject({ status: 'PENDING', lastErrorCode: 'FEATURE_DISABLED' });
        await expect(fixture?.prisma.walletLedgerEntry.count()).resolves.toBe(0);

        await featureState.setEnabled({ enabled: true });
        await expect(recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 })).resolves.toMatchObject({
            delivered: 1,
        });
        await expect(fixture?.prisma.walletLedgerEntry.count()).resolves.toBe(1);
    });

    it('preserves referral facts and delivers exactly once after 100 disable and re-enable cycles', async () => {
        const entitlementId = await createInviterEntitlement('3003');
        const before = await referralFactCounts();

        for (let cycle = 0; cycle < 100; cycle += 1) {
            await featureState.setEnabled({ enabled: false });
            await expect(recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 })).resolves.toMatchObject({
                claimed: 0,
            });
            await featureState.setEnabled({ enabled: true });
        }

        expect(await referralFactCounts()).toEqual(before);
        await expect(recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 })).resolves.toMatchObject({
            delivered: 1,
        });
        await expect(recoveryService.runOnce({ workerId: randomUUID(), batchSize: 1 })).resolves.toMatchObject({
            delivered: 0,
        });
        await expect(
            fixture?.prisma.walletLedgerEntry.count({ where: { businessEventKey: `referral_bonus:${entitlementId}` } }),
        ).resolves.toBe(1);
    }, 120_000);

    it('leaves historical welcome obligations inert', async () => {
        if (fixture === undefined) throw new Error('PostgreSQL fixture is not initialized.');
        const userId = await insertReferralTestUser(fixture.prisma, '7003004');
        const entitlementId = randomUUID() as ReferralEntitlementId;
        await fixture.prisma.referralBonusEntitlement.create({
            data: {
                id: entitlementId,
                kind: 'WELCOME',
                beneficiaryUserId: userId,
                amountMl: parseReferralMillilitres(10_000n),
                walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                walletOperationKind: REFERRAL_WELCOME_OPERATION_KIND,
                walletSource: REFERRAL_WALLET_SOURCE,
                occurredAt: OCCURRED_AT,
                nextAttemptAt: OCCURRED_AT,
            },
        });

        await expect(recoveryService.runOnce({ workerId: randomUUID() })).resolves.toMatchObject({ claimed: 0 });
        await expect(
            fixture.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
        ).resolves.toMatchObject({ status: 'PENDING', attemptCount: 0 });
        await expect(fixture.prisma.walletLedgerEntry.count()).resolves.toBe(0);
    });

    async function createInviterEntitlement(phoneSuffix: string): Promise<ReferralEntitlementId> {
        if (fixture === undefined) throw new Error('PostgreSQL fixture is not initialized.');
        const inviterUserId = await insertReferralTestUser(fixture.prisma, `5${phoneSuffix}`);
        const inviteeUserId = await insertReferralTestUser(fixture.prisma, `6${phoneSuffix}`);
        const relationship = await fixture.prisma.referralRelationship.create({
            data: { inviterUserId, inviteeUserId, channel: 'REGISTRATION' },
            select: { id: true },
        });
        const entitlementId = randomUUID() as ReferralEntitlementId;
        await fixture.prisma.referralBonusEntitlement.create({
            data: {
                id: entitlementId,
                kind: 'INVITER',
                beneficiaryUserId: inviterUserId,
                relationshipId: relationship.id,
                amountMl: parseReferralMillilitres(5_000n),
                walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                walletSource: REFERRAL_WALLET_SOURCE,
                occurredAt: OCCURRED_AT,
                nextAttemptAt: OCCURRED_AT,
            },
        });
        return entitlementId;
    }

    async function referralFactCounts(): Promise<{ promoCodes: number; relationships: number; entitlements: number }> {
        if (fixture === undefined) throw new Error('PostgreSQL fixture is not initialized.');
        const [promoCodes, relationships, entitlements] = await Promise.all([
            fixture.prisma.referralPromoCode.count(),
            fixture.prisma.referralRelationship.count(),
            fixture.prisma.referralBonusEntitlement.count(),
        ]);
        return { promoCodes, relationships, entitlements };
    }
});
