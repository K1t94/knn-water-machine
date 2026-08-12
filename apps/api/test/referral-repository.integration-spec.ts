import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    parseReferralMillilitres,
    type ReferralCursor,
    type ReferralEntitlementId,
} from '../src/referral/domain/referral-types';
import { PrismaReferralRepository } from '../src/referral/infrastructure/postgres/prisma-referral.repository';

import {
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    insertReferralTestUser,
    referralPostgresEnabled,
    type ReferralPostgresSchema,
} from './referral-postgres.fixture';

import type { ReferralInvitation } from '../src/referral/application/ports/referral.repository';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;

describePostgres('PrismaReferralRepository registration-only contract', () => {
    let fixture: ReferralPostgresSchema;
    let repository: PrismaReferralRepository;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('repository');
        fixture.deploy();
        repository = new PrismaReferralRepository(fixture.prisma);
    }, 120_000);

    afterAll(async () => disposeReferralPostgresSchema(fixture));

    it('provisions one stable promo code without referral side effects', async () => {
        const userId = await insertReferralTestUser(fixture.prisma, '310001');
        const first = await repository.provisionUser({ userId, createdAt: new Date() });
        const replay = await repository.provisionUser({ userId, createdAt: new Date() });

        expect(replay.promoCode).toBe(first.promoCode);
        await expect(fixture.prisma.referralRelationship.count({ where: { inviterUserId: userId } })).resolves.toBe(0);
        await expect(
            fixture.prisma.referralBonusEntitlement.count({ where: { beneficiaryUserId: userId } }),
        ).resolves.toBe(0);
    });

    it('creates one immutable registration relationship and inviter entitlement', async () => {
        const inviterUserId = await insertReferralTestUser(fixture.prisma, '310002');
        const inviteeUserId = await insertReferralTestUser(fixture.prisma, '310003');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const entitlementId = randomUUID() as ReferralEntitlementId;
        const input = {
            inviteeUserId,
            promoCode: inviter.promoCode,
            inviterEntitlement: {
                id: entitlementId,
                amountMl: parseReferralMillilitres(5_000n),
                walletBusinessEventKey: `referral_bonus:${entitlementId}`,
                walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                walletSource: REFERRAL_WALLET_SOURCE,
                occurredAt: new Date(),
            },
        } as const;

        await expect(repository.attachDuringRegistration(input)).resolves.toMatchObject({ created: true });
        await expect(repository.attachDuringRegistration(input)).resolves.toMatchObject({ created: false });
        await expect(fixture.prisma.referralRelationship.count({ where: { inviteeUserId } })).resolves.toBe(1);
        await expect(
            fixture.prisma.referralBonusEntitlement.count({
                where: { beneficiaryUserId: inviterUserId, kind: 'INVITER', amountMl: 5_000n },
            }),
        ).resolves.toBe(1);
        await expect(
            fixture.prisma.referralBonusEntitlement.count({ where: { beneficiaryUserId: inviteeUserId } }),
        ).resolves.toBe(0);
    });

    it('keeps 250 owner-scoped credited rows stable across 100 disable and re-enable cycles', async () => {
        const inviterUserId = await insertReferralTestUser(fixture.prisma, '320001');
        const otherInviterUserId = await insertReferralTestUser(fixture.prisma, '320002');
        const invitees = Array.from({ length: 251 }, (_, index) => ({
            id: randomUUID(),
            phoneE164: `+22178${String(index).padStart(7, '0')}`,
            phoneConfirmedAt: new Date('2026-08-08T00:00:00.000Z'),
        }));
        await fixture.prisma.user.createMany({ data: invitees });

        const ownerRelationships = invitees.slice(0, 250).map((invitee, index) => ({
            id: randomUUID(),
            inviterUserId,
            inviteeUserId: invitee.id,
            channel: 'REGISTRATION' as const,
            appliedAt: new Date(1_700_000_000_000 + index),
        }));
        const otherRelationship = {
            id: randomUUID(),
            inviterUserId: otherInviterUserId,
            inviteeUserId: invitees[250].id,
            channel: 'REGISTRATION' as const,
            appliedAt: new Date('2026-08-08T12:00:00.000Z'),
        };
        await fixture.prisma.referralRelationship.createMany({
            data: [...ownerRelationships, otherRelationship],
        });

        const deliveredAt = new Date('2026-08-09T00:00:00.000Z');
        const ownerCredits = ownerRelationships.map((relationship) => {
            const entitlementId = randomUUID();
            return {
                relationship,
                entitlementId,
                ledgerEntryId: randomUUID(),
                eventKey: `referral_bonus:${entitlementId}`,
            };
        });
        const otherCredit = { entitlementId: randomUUID(), ledgerEntryId: randomUUID() };
        const welcomeCredit = { entitlementId: randomUUID(), ledgerEntryId: randomUUID() };
        const otherEventKey = `referral_bonus:${otherCredit.entitlementId}`;
        const welcomeEventKey = `referral_bonus:${welcomeCredit.entitlementId}`;
        await fixture.prisma.waterWallet.createMany({
            data: [
                { userId: inviterUserId, balanceMl: 1_257_000n },
                { userId: otherInviterUserId, balanceMl: 9_000n },
            ],
        });
        await fixture.prisma.walletLedgerEntry.createMany({
            data: [
                ...ownerCredits.map((credit, index) => ({
                    id: credit.ledgerEntryId,
                    walletUserId: inviterUserId,
                    businessEventKey: credit.eventKey,
                    direction: 'CREDIT' as const,
                    amountMl: 5_000n,
                    operationKind: REFERRAL_INVITER_OPERATION_KIND,
                    source: REFERRAL_WALLET_SOURCE,
                    balanceAfterMl: BigInt(index + 1) * 5_000n,
                    occurredAt: credit.relationship.appliedAt,
                })),
                {
                    id: otherCredit.ledgerEntryId,
                    walletUserId: otherInviterUserId,
                    businessEventKey: otherEventKey,
                    direction: 'CREDIT' as const,
                    amountMl: 9_000n,
                    operationKind: REFERRAL_INVITER_OPERATION_KIND,
                    source: REFERRAL_WALLET_SOURCE,
                    balanceAfterMl: 9_000n,
                    occurredAt: deliveredAt,
                },
                {
                    id: welcomeCredit.ledgerEntryId,
                    walletUserId: inviterUserId,
                    businessEventKey: welcomeEventKey,
                    direction: 'CREDIT' as const,
                    amountMl: 7_000n,
                    operationKind: 'REFERRAL_WELCOME_BONUS',
                    source: REFERRAL_WALLET_SOURCE,
                    balanceAfterMl: 1_257_000n,
                    occurredAt: deliveredAt,
                },
            ],
        });
        await fixture.prisma.referralBonusEntitlement.createMany({
            data: [
                ...ownerCredits.map((credit) => ({
                    id: credit.entitlementId,
                    kind: 'INVITER' as const,
                    beneficiaryUserId: inviterUserId,
                    relationshipId: credit.relationship.id,
                    amountMl: 5_000n,
                    walletBusinessEventKey: credit.eventKey,
                    walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                    walletSource: REFERRAL_WALLET_SOURCE,
                    occurredAt: credit.relationship.appliedAt,
                    status: 'DELIVERED' as const,
                    walletLedgerEntryId: credit.ledgerEntryId,
                    nextAttemptAt: credit.relationship.appliedAt,
                    deliveredAt,
                })),
                {
                    id: otherCredit.entitlementId,
                    kind: 'INVITER' as const,
                    beneficiaryUserId: otherInviterUserId,
                    relationshipId: otherRelationship.id,
                    amountMl: 9_000n,
                    walletBusinessEventKey: otherEventKey,
                    walletOperationKind: REFERRAL_INVITER_OPERATION_KIND,
                    walletSource: REFERRAL_WALLET_SOURCE,
                    occurredAt: deliveredAt,
                    status: 'DELIVERED' as const,
                    walletLedgerEntryId: otherCredit.ledgerEntryId,
                    nextAttemptAt: deliveredAt,
                    deliveredAt,
                },
                {
                    id: welcomeCredit.entitlementId,
                    kind: 'WELCOME' as const,
                    beneficiaryUserId: inviterUserId,
                    amountMl: 7_000n,
                    walletBusinessEventKey: welcomeEventKey,
                    walletOperationKind: 'REFERRAL_WELCOME_BONUS',
                    walletSource: REFERRAL_WALLET_SOURCE,
                    occurredAt: deliveredAt,
                    status: 'DELIVERED' as const,
                    walletLedgerEntryId: welcomeCredit.ledgerEntryId,
                    nextAttemptAt: deliveredAt,
                    deliveredAt,
                },
            ],
        });

        const summaryBefore = await repository.getMyReferral(inviterUserId);
        const historyBefore = await readAllInvitations(repository, inviterUserId, 73);
        const otherHistory = await readAllInvitations(repository, otherInviterUserId, 73);

        expect(summaryBefore).toMatchObject({
            deliveredInvitationCount: 250,
            deliveredInviterBonusMl: 1_250_000n,
        });
        expect(historyBefore).toHaveLength(250);
        expect(new Set(historyBefore.map(({ publicId }) => publicId)).size).toBe(250);
        expect(historyBefore.map(({ sequence }) => sequence)).toEqual(
            [...historyBefore.map(({ sequence }) => sequence)].sort((left, right) => (left > right ? -1 : 1)),
        );
        expect(historyBefore.every(({ inviteeLabel }) => /^\*\*\d{2}$/.test(inviteeLabel))).toBe(true);
        expect(otherHistory).toHaveLength(1);
        expect(historyBefore.some(({ publicId }) => publicId === otherRelationship.id)).toBe(false);

        for (let cycle = 0; cycle < 100; cycle += 1) {
            await fixture.prisma.referralFeatureState.update({
                where: { key: 'REFERRAL_PROGRAM' },
                data: { enabled: false, revision: { increment: 1n } },
            });
            await fixture.prisma.referralFeatureState.update({
                where: { key: 'REFERRAL_PROGRAM' },
                data: { enabled: true, revision: { increment: 1n } },
            });
        }

        const [summaryAfter, historyAfter, storedFacts] = await Promise.all([
            repository.getMyReferral(inviterUserId),
            readAllInvitations(repository, inviterUserId, 73),
            Promise.all([
                fixture.prisma.referralRelationship.count({ where: { inviterUserId } }),
                fixture.prisma.referralBonusEntitlement.count({ where: { beneficiaryUserId: inviterUserId } }),
            ]),
        ]);
        expect(summaryAfter).toEqual(summaryBefore);
        expect(historyAfter).toEqual(historyBefore);
        expect(storedFacts).toEqual([250, 251]);
    }, 120_000);
});

async function readAllInvitations(
    repository: PrismaReferralRepository,
    userId: string,
    limit: number,
): Promise<ReferralInvitation[]> {
    const items: ReferralInvitation[] = [];
    let cursor: ReferralCursor | null = null;
    do {
        const page = await repository.getInvitations(userId, limit, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
}
