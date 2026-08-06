import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { maskReferralPhone } from '../../domain/phone-mask';
import { PROMO_CODE_COLLISION_ATTEMPTS, generatePromoCode } from '../../domain/promo-code';
import { ReferralError, referralCodeUnavailable } from '../../domain/referral-errors';

import { decodeReferralCursor, encodeReferralCursor } from './referral-cursor';

import type {
    ApplyReferralCodeInput,
    ApplyReferralCodeResult,
    ClaimReferralEntitlementsByIdInput,
    ClaimReferralEntitlementsInput,
    CloseReferralEligibilityInput,
    CloseReferralEligibilityResult,
    CreateWelcomeEntitlementInput,
    CreateWelcomeEntitlementResult,
    ListReferralProvisioningCandidatesInput,
    ProvisionReferralUserInput,
    ProvisionReferralUserResult,
    ReferralEntitlement,
    ReferralInvitationPage,
    ReferralProvisioningCandidate,
    ReferralRepository,
    ReferralSummary,
} from '../../application/ports/referral.repository';
import type {
    PromoCode,
    ReferralCursor,
    ReferralEntitlementId,
    ReferralMillilitres,
    ReferralRelationshipId,
} from '../../domain/referral-types';

type PrismaHandle = PrismaClient | Prisma.TransactionClient;

interface ReferralEntitlementRow {
    readonly id: string;
    readonly beneficiaryUserId: string;
    readonly kind: string;
    readonly amountMl: bigint;
    readonly walletBusinessEventKey: string;
    readonly walletOperationKind: string;
    readonly walletSource: string;
    readonly occurredAt: Date;
    readonly status: string;
    readonly walletLedgerEntryId: string | null;
    readonly attemptCount: number;
    readonly leaseOwner: string | null;
}

@Injectable()
export class PrismaReferralRepository implements ReferralRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaHandle) {}

    async listProvisioningCandidates(
        input: ListReferralProvisioningCandidatesInput,
    ): Promise<readonly ReferralProvisioningCandidate[]> {
        const users = await this.prisma.user.findMany({
            where: {
                ...(input.afterUserId === null ? {} : { id: { gt: input.afterUserId } }),
            },
            orderBy: { id: 'asc' },
            take: input.limit,
            select: {
                id: true,
                createdAt: true,
                referralPromoCode: { select: { userId: true } },
            },
        });

        return users.map((user) => ({
            userId: user.id,
            createdAt: user.createdAt,
            provisioned: user.referralPromoCode !== null,
        }));
    }

    async provisionUser(input: ProvisionReferralUserInput): Promise<ProvisionReferralUserResult> {
        return this.transaction((transaction) => this.provisionUserInternal(transaction, input));
    }

    async applyCode(input: ApplyReferralCodeInput): Promise<ApplyReferralCodeResult> {
        const initialOwner = await this.findActivePromoOwner(input.promoCode);
        if (initialOwner === null) throw referralCodeUnavailable();
        if (initialOwner.userId === input.inviteeUserId) {
            throw new ReferralError('REFERRAL_SELF_NOT_ALLOWED', 'A user cannot apply their own referral code');
        }

        return this.transaction(async (transaction) => {
            await this.provisionUserInternal(transaction, {
                userId: input.inviteeUserId,
                createdAt: input.inviterEntitlement.occurredAt,
            });
            await this.lockEligibility(transaction, input.inviteeUserId);

            const existing = await this.findRelationshipForInvitee(transaction, input.inviteeUserId);
            if (existing !== null) return this.resolveExistingRelationship(existing, input.promoCode);

            const eligibility = await transaction.referralEligibility.findUniqueOrThrow({
                where: { userId: input.inviteeUserId },
                select: { status: true, closedByEventKey: true },
            });
            if (eligibility.status === 'CLOSED') {
                throw new ReferralError('REFERRAL_ELIGIBILITY_CLOSED', 'Referral application eligibility is closed');
            }
            if (eligibility.status === 'ATTACHED') {
                throw new ReferralError('REFERRAL_ALREADY_ATTACHED', 'A referral code is already attached');
            }

            const owner = await this.findActivePromoOwner(input.promoCode, transaction);
            if (owner === null) throw referralCodeUnavailable();
            if (owner.userId === input.inviteeUserId) {
                throw new ReferralError('REFERRAL_SELF_NOT_ALLOWED', 'A user cannot apply their own referral code');
            }

            const relationship = await transaction.referralRelationship.create({
                data: {
                    inviterUserId: owner.userId,
                    inviteeUserId: input.inviteeUserId,
                    channel: input.channel,
                },
                select: { id: true, appliedAt: true },
            });

            const entitlement = await transaction.referralBonusEntitlement.create({
                data: {
                    id: input.inviterEntitlement.id,
                    kind: 'INVITER',
                    beneficiaryUserId: owner.userId,
                    relationshipId: relationship.id,
                    amountMl: input.inviterEntitlement.amountMl,
                    walletBusinessEventKey: input.inviterEntitlement.walletBusinessEventKey,
                    walletOperationKind: input.inviterEntitlement.walletOperationKind,
                    walletSource: input.inviterEntitlement.walletSource,
                    occurredAt: input.inviterEntitlement.occurredAt,
                    nextAttemptAt: input.inviterEntitlement.occurredAt,
                },
                select: { id: true },
            });

            await transaction.referralEligibility.update({
                where: { userId: input.inviteeUserId },
                data: { status: 'ATTACHED' },
            });

            return {
                status: 'ATTACHED',
                canonicalPromoCode: input.promoCode,
                appliedAt: relationship.appliedAt,
                relationshipId: relationship.id as ReferralRelationshipId,
                inviterEntitlementId: entitlement.id as ReferralEntitlementId,
            };
        });
    }

    async validatePromoCode(promoCode: PromoCode, inviteeUserId?: string): Promise<void> {
        const owner = await this.findActivePromoOwner(promoCode);
        if (owner === null) throw referralCodeUnavailable();
        if (inviteeUserId !== undefined && owner.userId === inviteeUserId) {
            throw new ReferralError('REFERRAL_SELF_NOT_ALLOWED', 'A user cannot apply their own referral code');
        }
    }

    async closeEligibility(input: CloseReferralEligibilityInput): Promise<CloseReferralEligibilityResult> {
        return this.transaction(async (transaction) => {
            await this.provisionUserInternal(transaction, {
                userId: input.userId,
                createdAt: input.succeededAt,
            });
            await this.lockEligibility(transaction, input.userId);

            const eligibility = await transaction.referralEligibility.findUniqueOrThrow({
                where: { userId: input.userId },
                select: { status: true, closedAt: true, closedByEventKey: true },
            });

            if (eligibility.status === 'ATTACHED') return { status: 'ALREADY_ATTACHED' };
            if (eligibility.status === 'CLOSED') {
                if (eligibility.closedByEventKey === input.purchaseBusinessEventKey) {
                    return { status: 'ALREADY_CLOSED', closedAt: eligibility.closedAt ?? input.succeededAt };
                }
                throw new ReferralError('REFERRAL_EVENT_CONFLICT', 'Referral eligibility was closed by another event');
            }

            const updated = await transaction.referralEligibility.update({
                where: { userId: input.userId },
                data: {
                    status: 'CLOSED',
                    closedByEventKey: input.purchaseBusinessEventKey,
                    closedAt: input.succeededAt,
                },
                select: { closedAt: true },
            });

            return { status: 'CLOSED', closedAt: updated.closedAt ?? input.succeededAt };
        });
    }

    async createWelcomeEntitlement(input: CreateWelcomeEntitlementInput): Promise<CreateWelcomeEntitlementResult> {
        return this.transaction(async (transaction) => {
            await this.provisionUserInternal(transaction, {
                userId: input.beneficiaryUserId,
                createdAt: input.occurredAt,
            });

            const existing = await transaction.referralBonusEntitlement.findFirst({
                where: {
                    beneficiaryUserId: input.beneficiaryUserId,
                    kind: 'WELCOME',
                },
                select: { id: true },
            });
            if (existing !== null) {
                return { entitlementId: existing.id as ReferralEntitlementId, created: false };
            }

            const inserted = await transaction.$queryRaw<readonly { id: string }[]>`
                INSERT INTO "ReferralBonusEntitlement" (
                    "id",
                    "kind",
                    "beneficiaryUserId",
                    "amountMl",
                    "walletBusinessEventKey",
                    "walletOperationKind",
                    "walletSource",
                    "occurredAt",
                    "nextAttemptAt",
                    "updatedAt"
                )
                VALUES (
                    ${input.id}::uuid,
                    'WELCOME'::"ReferralBonusKind",
                    ${input.beneficiaryUserId}::uuid,
                    ${input.amountMl},
                    ${input.walletBusinessEventKey},
                    ${input.walletOperationKind},
                    ${input.walletSource},
                    ${input.occurredAt},
                    ${input.occurredAt},
                    CURRENT_TIMESTAMP
                )
                ON CONFLICT DO NOTHING
                RETURNING "id"
            `;
            const created = inserted.at(0);
            if (created !== undefined) return { entitlementId: created.id as ReferralEntitlementId, created: true };

            const winner = await transaction.referralBonusEntitlement.findFirstOrThrow({
                where: {
                    beneficiaryUserId: input.beneficiaryUserId,
                    kind: 'WELCOME',
                },
                select: { id: true },
            });
            return { entitlementId: winner.id as ReferralEntitlementId, created: false };
        });
    }

    async claimEntitlements(input: ClaimReferralEntitlementsInput): Promise<readonly ReferralEntitlement[]> {
        const limit = Math.max(1, Math.min(input.limit, 100));
        const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
        const rows = await this.prisma.$queryRaw<ReferralEntitlementRow[]>`
            UPDATE "ReferralBonusEntitlement" entitlement
            SET
                "status" = 'PROCESSING'::"ReferralBonusDeliveryStatus",
                "leaseOwner" = ${input.workerId}::uuid,
                "leaseExpiresAt" = ${leaseExpiresAt},
                "attemptCount" = entitlement."attemptCount" + 1,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "id"
                FROM "ReferralBonusEntitlement"
                WHERE (
                    "status" = 'PENDING'::"ReferralBonusDeliveryStatus"
                    AND "nextAttemptAt" <= ${input.now}
                ) OR (
                    "status" = 'PROCESSING'::"ReferralBonusDeliveryStatus"
                    AND "leaseExpiresAt" <= ${input.now}
                )
                ORDER BY "nextAttemptAt" ASC, "createdAt" ASC, "id" ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            ) due
            WHERE entitlement."id" = due."id"
            RETURNING
                entitlement."id",
                entitlement."beneficiaryUserId",
                entitlement."kind"::text AS "kind",
                entitlement."amountMl",
                entitlement."walletBusinessEventKey",
                entitlement."walletOperationKind",
                entitlement."walletSource",
                entitlement."occurredAt",
                entitlement."status"::text AS "status",
                entitlement."walletLedgerEntryId",
                entitlement."attemptCount",
                entitlement."leaseOwner"::text AS "leaseOwner"
        `;

        return rows.map(mapReferralEntitlementRow);
    }

    async claimEntitlementsById(input: ClaimReferralEntitlementsByIdInput): Promise<readonly ReferralEntitlement[]> {
        if (input.entitlementIds.length === 0) return [];
        const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
        const ids = Prisma.join(input.entitlementIds.map((id) => Prisma.sql`${id}::uuid`));
        const rows = await this.prisma.$queryRaw<ReferralEntitlementRow[]>(Prisma.sql`
            UPDATE "ReferralBonusEntitlement" entitlement
            SET
                "status" = 'PROCESSING'::"ReferralBonusDeliveryStatus",
                "leaseOwner" = ${input.workerId}::uuid,
                "leaseExpiresAt" = ${leaseExpiresAt},
                "attemptCount" = entitlement."attemptCount" + 1,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "id"
                FROM "ReferralBonusEntitlement"
                WHERE "id" IN (${ids})
                  AND "status" = 'PENDING'::"ReferralBonusDeliveryStatus"
                  AND "nextAttemptAt" <= ${input.now}
                ORDER BY "createdAt" ASC, "id" ASC
                FOR UPDATE SKIP LOCKED
            ) due
            WHERE entitlement."id" = due."id"
            RETURNING
                entitlement."id",
                entitlement."beneficiaryUserId",
                entitlement."kind"::text AS "kind",
                entitlement."amountMl",
                entitlement."walletBusinessEventKey",
                entitlement."walletOperationKind",
                entitlement."walletSource",
                entitlement."occurredAt",
                entitlement."status"::text AS "status",
                entitlement."walletLedgerEntryId",
                entitlement."attemptCount",
                entitlement."leaseOwner"::text AS "leaseOwner"
        `);
        return rows.map(mapReferralEntitlementRow);
    }

    async getEntitlement(entitlementId: ReferralEntitlementId): Promise<ReferralEntitlement | null> {
        const entitlement = await this.prisma.referralBonusEntitlement.findUnique({
            where: { id: entitlementId },
        });
        if (entitlement === null) return null;

        return {
            id: entitlement.id as ReferralEntitlementId,
            beneficiaryUserId: entitlement.beneficiaryUserId,
            kind: entitlement.kind,
            amountMl: entitlement.amountMl as ReferralMillilitres,
            walletBusinessEventKey: entitlement.walletBusinessEventKey,
            walletOperationKind: entitlement.walletOperationKind as ReferralEntitlement['walletOperationKind'],
            walletSource: entitlement.walletSource as ReferralEntitlement['walletSource'],
            occurredAt: entitlement.occurredAt,
            status: entitlement.status,
            walletLedgerEntryId: entitlement.walletLedgerEntryId,
            attemptCount: entitlement.attemptCount,
            leaseOwner: entitlement.leaseOwner,
        };
    }

    async completeDelivery(
        entitlementId: ReferralEntitlementId,
        leaseOwner: string,
        walletLedgerEntryId: string,
        deliveredAt: Date,
    ): Promise<boolean> {
        const result = await this.prisma.referralBonusEntitlement.updateMany({
            where: {
                id: entitlementId,
                status: 'PROCESSING',
                leaseOwner,
            },
            data: {
                status: 'DELIVERED',
                walletLedgerEntryId,
                deliveredAt,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastErrorCode: null,
            },
        });

        return result.count === 1;
    }

    async recordDeliveryFailure(input: {
        entitlementId: ReferralEntitlementId;
        leaseOwner: string;
        errorCode: string;
        nextAttemptAt: Date | null;
        permanent: boolean;
    }): Promise<boolean> {
        const result = await this.prisma.referralBonusEntitlement.updateMany({
            where: {
                id: input.entitlementId,
                status: 'PROCESSING',
                leaseOwner: input.leaseOwner,
            },
            data: input.permanent
                ? {
                      status: 'PERMANENT_FAILURE',
                      leaseOwner: null,
                      leaseExpiresAt: null,
                      lastErrorCode: input.errorCode,
                  }
                : {
                      status: 'PENDING',
                      leaseOwner: null,
                      leaseExpiresAt: null,
                      lastErrorCode: input.errorCode,
                      nextAttemptAt: input.nextAttemptAt ?? new Date(),
                  },
        });

        return result.count === 1;
    }

    async countDueEntitlements(now: Date): Promise<number> {
        return this.prisma.referralBonusEntitlement.count({
            where: {
                OR: [
                    {
                        status: 'PENDING',
                        nextAttemptAt: { lte: now },
                    },
                    {
                        status: 'PROCESSING',
                        leaseExpiresAt: { lte: now },
                    },
                ],
            },
        });
    }

    async getMyReferral(userId: string): Promise<ReferralSummary> {
        await this.provisionUser({
            userId,
            createdAt: new Date(),
        });

        const [promo, eligibility, relationship, delivered] = await Promise.all([
            this.prisma.referralPromoCode.findUniqueOrThrow({
                where: { userId },
                select: { code: true },
            }),
            this.prisma.referralEligibility.findUniqueOrThrow({
                where: { userId },
                select: { status: true },
            }),
            this.prisma.referralRelationship.findUnique({
                where: { inviteeUserId: userId },
                select: { inviter: { select: { referralPromoCode: { select: { code: true } } } } },
            }),
            this.prisma.referralBonusEntitlement.aggregate({
                where: {
                    beneficiaryUserId: userId,
                    kind: 'INVITER',
                    status: 'DELIVERED',
                },
                _count: { id: true },
                _sum: { amountMl: true },
            }),
        ]);

        return {
            promoCode: promo.code as PromoCode,
            referralLink: `kaynann://register?promo=${promo.code}`,
            applicationStatus: eligibility.status,
            attachedPromoCode: (relationship?.inviter.referralPromoCode?.code as PromoCode | undefined) ?? null,
            deliveredInvitationCount: delivered._count.id,
            deliveredInviterBonusMl: delivered._sum.amountMl ?? 0n,
        };
    }

    async getInvitations(
        userId: string,
        limit: number,
        cursor: ReferralCursor | null,
    ): Promise<ReferralInvitationPage> {
        const beforeSequence = decodeReferralCursor(cursor);
        const rows = await this.prisma.referralRelationship.findMany({
            where: {
                inviterUserId: userId,
                ...(beforeSequence === null ? {} : { sequence: { lt: beforeSequence } }),
                inviterEntitlement: { is: { status: 'DELIVERED' } },
            },
            orderBy: { sequence: 'desc' },
            take: limit + 1,
            select: {
                id: true,
                sequence: true,
                appliedAt: true,
                invitee: { select: { phoneE164: true } },
                inviterEntitlement: { select: { amountMl: true } },
            },
        });
        const pageRows = rows.slice(0, limit);
        const nextRow = rows.at(limit);
        const lastPageRow = pageRows.at(-1);

        return {
            items: pageRows.map((row) => ({
                sequence: row.sequence,
                publicId: row.id,
                inviteeLabel: maskReferralPhone(row.invitee.phoneE164),
                appliedAt: row.appliedAt,
                creditedAmountMl: (row.inviterEntitlement?.amountMl ?? 0n) as ReferralMillilitres,
                status: 'CREDITED',
            })),
            nextCursor:
                nextRow === undefined || lastPageRow === undefined ? null : encodeReferralCursor(lastPageRow.sequence),
        };
    }

    private async provisionUserInternal(
        transaction: PrismaHandle,
        input: ProvisionReferralUserInput,
    ): Promise<ProvisionReferralUserResult> {
        const existing = await transaction.referralPromoCode.findUnique({
            where: { userId: input.userId },
            select: { code: true },
        });
        await transaction.$executeRaw`
            INSERT INTO "ReferralEligibility" ("userId", "updatedAt")
            VALUES (${input.userId}::uuid, CURRENT_TIMESTAMP)
            ON CONFLICT ("userId") DO NOTHING
        `;
        if (existing !== null) return { promoCode: existing.code as PromoCode, created: false, collisionCount: 0 };

        let collisionCount = 0;
        for (let attempt = 0; attempt < PROMO_CODE_COLLISION_ATTEMPTS; attempt += 1) {
            const code = generatePromoCode();
            const inserted = await transaction.$queryRaw<readonly { code: string }[]>`
                INSERT INTO "ReferralPromoCode" ("userId", "code", "createdAt")
                VALUES (${input.userId}::uuid, ${code}, ${input.createdAt})
                ON CONFLICT DO NOTHING
                RETURNING "code"
            `;
            const created = inserted.at(0);
            if (created !== undefined) return { promoCode: created.code as PromoCode, created: true, collisionCount };

            const winner = await transaction.referralPromoCode.findUnique({
                where: { userId: input.userId },
                select: { code: true },
            });
            if (winner !== null) {
                return { promoCode: winner.code as PromoCode, created: false, collisionCount };
            }
            collisionCount += 1;
        }

        throw new ReferralError('REFERRAL_SERVICE_UNAVAILABLE', 'Failed to provision a unique referral code');
    }

    private async lockEligibility(transaction: PrismaHandle, userId: string): Promise<void> {
        await transaction.$queryRaw`
            SELECT "userId"
            FROM "ReferralEligibility"
            WHERE "userId" = ${userId}::uuid
            FOR UPDATE
        `;
    }

    private async findActivePromoOwner(
        promoCode: PromoCode,
        transaction: PrismaHandle = this.prisma,
    ): Promise<{ userId: string } | null> {
        const row = await transaction.referralPromoCode.findUnique({
            where: { code: promoCode },
            select: {
                userId: true,
                user: { select: { status: true } },
            },
        });

        if (row === null || row.user.status !== 'ACTIVE') return null;
        return { userId: row.userId };
    }

    private async findRelationshipForInvitee(transaction: PrismaHandle, inviteeUserId: string) {
        return transaction.referralRelationship.findUnique({
            where: { inviteeUserId },
            select: {
                id: true,
                appliedAt: true,
                inviter: { select: { referralPromoCode: { select: { code: true } } } },
                inviterEntitlement: { select: { id: true } },
            },
        });
    }

    private resolveExistingRelationship(
        relationship: NonNullable<Awaited<ReturnType<PrismaReferralRepository['findRelationshipForInvitee']>>>,
        requestedCode: PromoCode,
    ): ApplyReferralCodeResult {
        const existingCode = relationship.inviter.referralPromoCode?.code;
        if (existingCode !== requestedCode) {
            throw new ReferralError('REFERRAL_ALREADY_ATTACHED', 'A different referral code is already attached');
        }
        if (relationship.inviterEntitlement === null) {
            throw new ReferralError(
                'REFERRAL_SERVICE_UNAVAILABLE',
                'Referral relationship is missing inviter entitlement',
            );
        }

        return {
            status: 'ALREADY_ATTACHED',
            canonicalPromoCode: requestedCode,
            appliedAt: relationship.appliedAt,
            relationshipId: relationship.id as ReferralRelationshipId,
            inviterEntitlementId: relationship.inviterEntitlement.id as ReferralEntitlementId,
        };
    }

    private async transaction<T>(action: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        if (hasRootTransaction(this.prisma)) {
            return this.prisma.$transaction(action);
        }

        return action(this.prisma);
    }
}

function hasRootTransaction(prisma: PrismaHandle): prisma is PrismaClient {
    return typeof (prisma as { $transaction?: unknown }).$transaction === 'function';
}

function mapReferralEntitlementRow(row: ReferralEntitlementRow): ReferralEntitlement {
    return {
        id: row.id as ReferralEntitlementId,
        beneficiaryUserId: row.beneficiaryUserId,
        kind: row.kind as ReferralEntitlement['kind'],
        amountMl: row.amountMl as ReferralMillilitres,
        walletBusinessEventKey: row.walletBusinessEventKey,
        walletOperationKind: row.walletOperationKind as ReferralEntitlement['walletOperationKind'],
        walletSource: row.walletSource as ReferralEntitlement['walletSource'],
        occurredAt: row.occurredAt,
        status: row.status as ReferralEntitlement['status'],
        walletLedgerEntryId: row.walletLedgerEntryId,
        attemptCount: row.attemptCount,
        leaseOwner: row.leaseOwner,
    };
}
