import { randomUUID } from 'node:crypto';

import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { ReferralError } from '../src/referral/domain/referral-errors';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    parseReferralMillilitres,
} from '../src/referral/domain/referral-types';
import { PrismaReferralRepository } from '../src/referral/infrastructure/postgres/prisma-referral.repository';

import {
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    insertReferralTestUser,
    referralPostgresEnabled,
    type ReferralPostgresSchema,
} from './referral-postgres.fixture';

import type { ReferralEntitlementId, PurchaseBusinessEventKey } from '../src/referral/domain/referral-types';
import type { PrismaClient } from '@prisma/client';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;
const concurrentAttempts = 100;
const bonusAmountMl = parseReferralMillilitres(5_000n);

describePostgres('PrismaReferralRepository concurrency', () => {
    let fixture: ReferralPostgresSchema;
    let prisma: PrismaClient;
    let repository: PrismaReferralRepository;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('concurrency');
        fixture.deploy();
        prisma = fixture.prisma;
        repository = new PrismaReferralRepository(prisma);
    }, 120_000);

    afterAll(async () => {
        await disposeReferralPostgresSchema(fixture);
    });

    it('keeps one relationship and one entitlement for 100 concurrent same-code attempts', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '200001');
        const inviteeUserId = await insertReferralTestUser(prisma, '200002');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });

        const results = await Promise.all(
            Array.from({ length: concurrentAttempts }, () =>
                repository.applyCode({
                    inviteeUserId,
                    promoCode: inviter.promoCode,
                    channel: 'POST_REGISTRATION',
                    inviterEntitlement: createInviterEntitlement(),
                }),
            ),
        );

        expect(results.filter((result) => result.status === 'ATTACHED')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'ALREADY_ATTACHED')).toHaveLength(concurrentAttempts - 1);
        await expect(prisma.referralRelationship.count({ where: { inviteeUserId } })).resolves.toBe(1);
        await expect(
            prisma.referralBonusEntitlement.count({ where: { beneficiaryUserId: inviterUserId } }),
        ).resolves.toBe(1);
    }, 120_000);

    it('chooses one committed code and rejects 99 competing concurrent codes', async () => {
        const inviteeUserId = await insertReferralTestUser(prisma, '200003');
        const promoCodes = await Promise.all(
            Array.from({ length: concurrentAttempts }, async (_, index) => {
                const userId = await insertReferralTestUser(prisma, `${210000 + index}`);
                return (await repository.provisionUser({ userId, createdAt: new Date() })).promoCode;
            }),
        );

        const results = await Promise.allSettled(
            promoCodes.map((promoCode) =>
                repository.applyCode({
                    inviteeUserId,
                    promoCode,
                    channel: 'POST_REGISTRATION',
                    inviterEntitlement: createInviterEntitlement(),
                }),
            ),
        );
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(concurrentAttempts - 1);
        expect(
            rejected.every(
                (result) =>
                    result.reason instanceof ReferralError && result.reason.code === 'REFERRAL_ALREADY_ATTACHED',
            ),
        ).toBe(true);
        await expect(prisma.referralRelationship.count({ where: { inviteeUserId } })).resolves.toBe(1);
    }, 120_000);

    it('allows 100 concurrent invitees for the same inviter without cross-user leakage', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '200004');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const inviteeUserIds = await Promise.all(
            Array.from({ length: concurrentAttempts }, (_, index) =>
                insertReferralTestUser(prisma, `${220000 + index}`),
            ),
        );

        await Promise.all(
            inviteeUserIds.map((inviteeUserId) =>
                repository.applyCode({
                    inviteeUserId,
                    promoCode: inviter.promoCode,
                    channel: 'POST_REGISTRATION',
                    inviterEntitlement: createInviterEntitlement(),
                }),
            ),
        );

        await expect(prisma.referralRelationship.count({ where: { inviterUserId } })).resolves.toBe(concurrentAttempts);
        await expect(
            prisma.referralBonusEntitlement.count({ where: { beneficiaryUserId: inviterUserId } }),
        ).resolves.toBe(concurrentAttempts);
    }, 120_000);

    it('uses commit order semantics when apply and eligibility close race', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '200005');
        const inviteeUserId = await insertReferralTestUser(prisma, '200006');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });

        const results = await Promise.allSettled([
            repository.applyCode({
                inviteeUserId,
                promoCode: inviter.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
            repository.closeEligibility({
                userId: inviteeUserId,
                purchaseBusinessEventKey: `purchase:${randomUUID()}` as PurchaseBusinessEventKey,
                succeededAt: new Date(),
            }),
        ]);
        const relationshipCount = await prisma.referralRelationship.count({ where: { inviteeUserId } });
        const eligibility = await prisma.referralEligibility.findUniqueOrThrow({
            where: { userId: inviteeUserId },
            select: { status: true },
        });

        expect(results).toHaveLength(2);
        expect(relationshipCount === 1 || eligibility.status === 'CLOSED').toBe(true);
        expect(relationshipCount === 1 && eligibility.status === 'CLOSED').toBe(false);
    });
});

function createInviterEntitlement() {
    const id = randomUUID() as ReferralEntitlementId;
    return {
        id,
        amountMl: bonusAmountMl,
        walletBusinessEventKey: `referral_bonus:${id}`,
        walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
        walletSource: REFERRAL_WALLET_SOURCE,
        occurredAt: new Date(),
    };
}
