import { randomBytes, randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { SecurityModule } from '../src/common/security/security.module';
import { ReferralRecoveryScheduler } from '../src/referral/composition/referral-recovery.scheduler';
import {
    REFERRAL_INVITER_OPERATION_KIND,
    REFERRAL_WALLET_SOURCE,
    parseReferralMillilitres,
} from '../src/referral/domain/referral-types';
import { PrismaReferralRepository } from '../src/referral/infrastructure/postgres/prisma-referral.repository';
import { ReferralModule } from '../src/referral/referral.module';
import { SessionsService } from '../src/sessions/application/sessions.service';

import {
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    expectPostgresError,
    insertReferralTestUser,
    referralPostgresEnabled,
    type ReferralPostgresSchema,
} from './referral-postgres.fixture';

import type { PromoCode, ReferralEntitlementId, PurchaseBusinessEventKey } from '../src/referral/domain/referral-types';
import type {
    MyReferralResponseDto,
    ReferralInvitationPageResponseDto,
} from '../src/referral/http/dto/referral-response.dto';
import type { WalletBalanceResponseDto } from '../src/wallet/http/dto/wallet-response.dto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;
const bonusAmountMl = parseReferralMillilitres(5_000n);

describePostgres('PrismaReferralRepository', () => {
    let fixture: ReferralPostgresSchema;
    let prisma: PrismaClient;
    let repository: PrismaReferralRepository;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('repository');
        fixture.deploy();
        prisma = fixture.prisma;
        repository = new PrismaReferralRepository(prisma);
    }, 120_000);

    afterAll(async () => {
        await disposeReferralPostgresSchema(fixture);
    });

    it('applies a promo code once, replays the same code idempotently, and conflicts on another code', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '100001');
        const otherInviterUserId = await insertReferralTestUser(prisma, '100002');
        const inviteeUserId = await insertReferralTestUser(prisma, '100003');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const otherInviter = await repository.provisionUser({ userId: otherInviterUserId, createdAt: new Date() });

        const attached = await repository.applyCode({
            inviteeUserId,
            promoCode: inviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });
        const replay = await repository.applyCode({
            inviteeUserId,
            promoCode: inviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });

        await expect(
            repository.applyCode({
                inviteeUserId,
                promoCode: otherInviter.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_ALREADY_ATTACHED' });
        await expect(prisma.referralRelationship.count({ where: { inviteeUserId } })).resolves.toBe(1);
        await expect(
            prisma.referralBonusEntitlement.count({ where: { relationshipId: attached.relationshipId } }),
        ).resolves.toBe(1);
        expect(replay).toEqual({
            ...attached,
            status: 'ALREADY_ATTACHED',
        });
    });

    it('rejects unknown, inactive owner, self-referral, and closed eligibility cases safely', async () => {
        const ownerUserId = await insertReferralTestUser(prisma, '100004');
        const inviteeUserId = await insertReferralTestUser(prisma, '100005');
        const selfUserId = await insertReferralTestUser(prisma, '100006');
        const owner = await repository.provisionUser({ userId: ownerUserId, createdAt: new Date() });
        const self = await repository.provisionUser({ userId: selfUserId, createdAt: new Date() });

        await expect(
            repository.applyCode({
                inviteeUserId,
                promoCode: '222222222222' as PromoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_CODE_UNAVAILABLE' });

        await prisma.user.update({ where: { id: ownerUserId }, data: { status: 'SUSPENDED' } });
        await expect(
            repository.applyCode({
                inviteeUserId,
                promoCode: owner.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_CODE_UNAVAILABLE' });

        await expect(
            repository.applyCode({
                inviteeUserId: selfUserId,
                promoCode: self.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_SELF_NOT_ALLOWED' });

        await repository.closeEligibility({
            userId: inviteeUserId,
            purchaseBusinessEventKey: `purchase:${randomUUID()}` as PurchaseBusinessEventKey,
            succeededAt: new Date(),
        });
        await expect(
            repository.applyCode({
                inviteeUserId,
                promoCode: self.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: createInviterEntitlement(),
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_ELIGIBILITY_CLOSED' });
    });

    it('rolls back relationship and eligibility changes when entitlement creation fails', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '100007');
        const inviteeUserId = await insertReferralTestUser(prisma, '100008');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });

        await expect(
            repository.applyCode({
                inviteeUserId,
                promoCode: inviter.promoCode,
                channel: 'POST_REGISTRATION',
                inviterEntitlement: {
                    ...createInviterEntitlement(),
                    walletBusinessEventKey: `invalid:${randomUUID()}`,
                },
            }),
        ).rejects.toThrow();

        await expect(prisma.referralRelationship.count({ where: { inviteeUserId } })).resolves.toBe(0);
        await expect(prisma.referralEligibility.findUnique({ where: { userId: inviteeUserId } })).resolves.toBeNull();
    });

    it('closes eligibility idempotently and rejects conflicting close events', async () => {
        const userId = await insertReferralTestUser(prisma, '100009');
        const purchaseBusinessEventKey = `purchase:${randomUUID()}` as PurchaseBusinessEventKey;
        const succeededAt = new Date('2026-08-06T12:00:00.000Z');

        await expect(repository.closeEligibility({ userId, purchaseBusinessEventKey, succeededAt })).resolves.toEqual({
            status: 'CLOSED',
            closedAt: succeededAt,
        });
        await expect(repository.closeEligibility({ userId, purchaseBusinessEventKey, succeededAt })).resolves.toEqual({
            status: 'ALREADY_CLOSED',
            closedAt: succeededAt,
        });
        await expect(
            repository.closeEligibility({
                userId,
                purchaseBusinessEventKey: `purchase:${randomUUID()}` as PurchaseBusinessEventKey,
                succeededAt,
            }),
        ).rejects.toMatchObject({ code: 'REFERRAL_EVENT_CONFLICT' });
    });

    it('returns summary and deterministic credited history without leaking full invitee phones', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '100010');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const firstInviteeId = await insertReferralTestUser(prisma, '100011');
        const secondInviteeId = await insertReferralTestUser(prisma, '100012');

        const first = await repository.applyCode({
            inviteeUserId: firstInviteeId,
            promoCode: inviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });
        const second = await repository.applyCode({
            inviteeUserId: secondInviteeId,
            promoCode: inviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });
        await markEntitlementDelivered(prisma, inviterUserId, first.inviterEntitlementId, first.appliedAt);
        await markEntitlementDelivered(prisma, inviterUserId, second.inviterEntitlementId, second.appliedAt);

        const summary = await repository.getMyReferral(inviterUserId);
        const firstPage = await repository.getInvitations(inviterUserId, 1, null);
        const secondPage = await repository.getInvitations(inviterUserId, 1, firstPage.nextCursor);

        expect(summary.deliveredInvitationCount).toBe(2);
        expect(summary.deliveredInviterBonusMl).toBe(10_000n);
        expect(firstPage.items).toHaveLength(1);
        expect(secondPage.items).toHaveLength(1);
        expect(firstPage.items[0]?.sequence).toBeGreaterThan(secondPage.items[0]?.sequence ?? 0n);
        expect(firstPage.items[0]?.inviteeLabel).toMatch(/^\*\*\d{2}$/);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(secondPage.nextCursor).toBeNull();
    });

    it('traverses 250 credited invitations exactly once with stable owner-scoped cursors', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '300000');
        const otherInviterUserId = await insertReferralTestUser(prisma, '300001');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const otherInviter = await repository.provisionUser({ userId: otherInviterUserId, createdAt: new Date() });
        const inviteeUserIds = await Promise.all(
            Array.from({ length: 251 }, (_, index) => insertReferralTestUser(prisma, `${310000 + index}`)),
        );

        const relationships = [];
        for (const inviteeBatch of chunks(inviteeUserIds.slice(0, 250), 25)) {
            relationships.push(
                ...(await Promise.all(
                    inviteeBatch.map((inviteeUserId) =>
                        repository.applyCode({
                            inviteeUserId,
                            promoCode: inviter.promoCode,
                            channel: 'POST_REGISTRATION',
                            inviterEntitlement: createInviterEntitlement(),
                        }),
                    ),
                )),
            );
        }
        await repository.applyCode({
            inviteeUserId: inviteeUserIds[250],
            promoCode: otherInviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });
        await prisma.waterWallet.create({ data: { userId: inviterUserId } });
        for (const relationshipBatch of chunks(relationships, 25)) {
            await Promise.all(
                relationshipBatch.map((relationship) =>
                    markEntitlementDelivered(
                        prisma,
                        inviterUserId,
                        relationship.inviterEntitlementId,
                        relationship.appliedAt,
                    ),
                ),
            );
        }

        const seenIds = new Set<string>();
        const sequences: bigint[] = [];
        let cursor = null;
        do {
            const page = await repository.getInvitations(inviterUserId, 37, cursor);
            for (const item of page.items) {
                expect(item.inviteeLabel).toMatch(/^\*\*\d{2}$/);
                expect(seenIds.has(item.publicId)).toBe(false);
                seenIds.add(item.publicId);
                sequences.push(item.sequence);
            }
            cursor = page.nextCursor;
        } while (cursor !== null);

        expect(seenIds).toHaveLength(250);
        expect(sequences.every((sequence, index) => index === 0 || sequences[index - 1] > sequence)).toBe(true);
        await expect(repository.getInvitations(otherInviterUserId, 100, null)).resolves.toEqual({
            items: [],
            nextCursor: null,
        });
    }, 120_000);

    it('enforces immutable promo code and relationship rows through database triggers', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '100013');
        const inviteeUserId = await insertReferralTestUser(prisma, '100014');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        const attached = await repository.applyCode({
            inviteeUserId,
            promoCode: inviter.promoCode,
            channel: 'POST_REGISTRATION',
            inviterEntitlement: createInviterEntitlement(),
        });

        await expectPostgresError(
            prisma.referralPromoCode.update({
                where: { userId: inviterUserId },
                data: { code: '222222222222' },
            }),
            'referral_immutable',
        );
        await expectPostgresError(
            prisma.referralRelationship.delete({ where: { id: attached.relationshipId } }),
            'referral_immutable',
        );
    });

    it('SC-006 apply exposes the scheduler-delivered inviter effect through authenticated reads within 5 seconds', async () => {
        const inviterUserId = await insertReferralTestUser(prisma, '500001');
        const inviteeUserId = await insertReferralTestUser(prisma, '500002');
        const inviter = await repository.provisionUser({ userId: inviterUserId, createdAt: new Date() });
        await repository.provisionUser({ userId: inviteeUserId, createdAt: new Date() });
        const previousDatabaseUrl = process.env.DATABASE_URL;
        configureSchedulerTestEnvironment(fixture.url);

        let app: INestApplication | undefined;
        try {
            const module = await Test.createTestingModule({
                imports: [ScheduleModule.forRoot(), SecurityModule, ReferralModule],
            }).compile();
            app = module.createNestApplication();
            app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
            app.useGlobalFilters(new RedactedExceptionFilter());
            await app.init();

            const sessions = app.get(SessionsService);
            const inviterCredentials = await sessions.issueForUser({
                userId: inviterUserId,
                installationId: `sc006-inviter-${randomUUID()}`,
                creationContext: `sc006-inviter-${randomUUID()}`,
            });
            const inviteeCredentials = await sessions.issueForUser({
                userId: inviteeUserId,
                installationId: `sc006-invitee-${randomUUID()}`,
                creationContext: `sc006-invitee-${randomUUID()}`,
            });
            const server = app.getHttpServer() as Parameters<typeof request>[0];

            const applied = await request(server)
                .post('/v1/referrals/applications')
                .set('authorization', `Bearer ${inviteeCredentials.accessToken}`)
                .send({ promoCode: inviter.promoCode });
            expect(applied.status, applied.text).toBe(200);
            const startedAt = Date.now();

            await pollUntil(async () => {
                const [inviteeMe, inviterMe, invitations, inviterWallet] = await Promise.all([
                    authenticatedGet(server, '/v1/referrals/me', inviteeCredentials.accessToken),
                    authenticatedGet(server, '/v1/referrals/me', inviterCredentials.accessToken),
                    authenticatedGet(server, '/v1/referrals/invitations', inviterCredentials.accessToken),
                    authenticatedGet(server, '/v1/wallet/balance', inviterCredentials.accessToken),
                ]);
                const inviteeBody = inviteeMe.body as unknown as MyReferralResponseDto;
                const inviterBody = inviterMe.body as unknown as MyReferralResponseDto;
                const invitationBody = invitations.body as unknown as ReferralInvitationPageResponseDto;
                const walletBody = inviterWallet.body as unknown as WalletBalanceResponseDto;
                return (
                    inviteeMe.status === 200 &&
                    inviteeBody.eligibility === 'ATTACHED' &&
                    inviteeBody.attachedPromoCode === inviter.promoCode &&
                    inviterMe.status === 200 &&
                    inviterBody.creditedInvitationCount === 1 &&
                    inviterBody.creditedInviterBonusMl === '5000' &&
                    invitations.status === 200 &&
                    invitationBody.items.length === 1 &&
                    invitationBody.items[0]?.creditedAmountMl === '5000' &&
                    inviterWallet.status === 200 &&
                    walletBody.balanceMl === '5000'
                );
            }, 5_000);
            expect(Date.now() - startedAt).toBeLessThanOrEqual(5_000);

            const entitlement = await prisma.referralBonusEntitlement.findFirstOrThrow({
                where: { beneficiaryUserId: inviterUserId, kind: 'INVITER' },
            });
            await expect(
                prisma.walletLedgerEntry.count({
                    where: {
                        walletUserId: inviterUserId,
                        businessEventKey: entitlement.walletBusinessEventKey,
                    },
                }),
            ).resolves.toBe(1);
        } finally {
            app?.get(ReferralRecoveryScheduler).onModuleDestroy();
            await app?.close();
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
    }, 30_000);
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

async function markEntitlementDelivered(
    prisma: PrismaClient,
    userId: string,
    entitlementId: ReferralEntitlementId,
    occurredAt: Date,
): Promise<void> {
    await prisma.waterWallet.upsert({
        where: { userId },
        update: {},
        create: { userId },
    });
    const ledger = await prisma.walletLedgerEntry.create({
        data: {
            walletUserId: userId,
            businessEventKey: `test-delivered:${randomUUID()}`,
            direction: 'CREDIT',
            amountMl: bonusAmountMl,
            operationKind: REFERRAL_INVITER_OPERATION_KIND,
            source: REFERRAL_WALLET_SOURCE,
            balanceAfterMl: bonusAmountMl,
            occurredAt,
        },
        select: { id: true },
    });

    await prisma.referralBonusEntitlement.update({
        where: { id: entitlementId },
        data: {
            status: 'DELIVERED',
            walletLedgerEntryId: ledger.id,
            deliveredAt: occurredAt,
        },
    });
}

function chunks<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function configureSchedulerTestEnvironment(databaseUrl: string): void {
    const secret = randomBytes(32).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
        MQTT_URL: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'referral-sc006-apply',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        REFERRAL_WELCOME_BONUS_ML: '10000',
        REFERRAL_INVITER_BONUS_ML: '5000',
    });
}

async function authenticatedGet(server: Parameters<typeof request>[0], path: string, accessToken: string) {
    return request(server).get(path).set('authorization', `Bearer ${accessToken}`);
}

async function pollUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Condition was not observed within ${timeoutMs} ms`);
}
