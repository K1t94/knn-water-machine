import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LegalDocumentKind, Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { RegistrationService } from '../src/auth/application/registration.service';
import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { ReferralRecoveryService } from '../src/referral/application/referral-recovery.service';
import { ReferralRecoveryScheduler } from '../src/referral/composition/referral-recovery.scheduler';
import { canonicalizePromoCode } from '../src/referral/domain/promo-code';
import { PrismaReferralRegistrationIntegration } from '../src/referral/infrastructure/postgres/prisma-referral-registration.integration';
import { PrismaReferralRepository } from '../src/referral/infrastructure/postgres/prisma-referral.repository';
import { SessionsService } from '../src/sessions/application/sessions.service';
import { FakeSmsOutbox } from '../src/sms/infrastructure/fake/fake-sms.outbox';

import { createReferralPostgresSchema, disposeReferralPostgresSchema } from './referral-postgres.fixture';

import type { ReferralPostgresSchema } from './referral-postgres.fixture';
import type {
    MyReferralResponseDto,
    ReferralInvitationPageResponseDto,
} from '../src/referral/http/dto/referral-response.dto';
import type { WalletBalanceResponseDto } from '../src/wallet/http/dto/wallet-response.dto';
import type { INestApplication } from '@nestjs/common';

type SupertestApp = Parameters<typeof request>[0];

const enabled =
    process.env.RUN_POSTGRES_INTEGRATION === '1' &&
    process.env.RUN_REDIS_INTEGRATION === '1' &&
    Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const integration = enabled ? describe : describe.skip;

integration('referral registration onboarding', () => {
    const phoneBase = randomInt(1_000_000, 9_999_990);
    const phone = (offset: number) => `+22177${String(phoneBase + offset).padStart(7, '0')}`;
    const inviterPhone = phone(1);
    const inviteePhone = phone(2);
    const pendingOnlyPhone = phone(3);
    const noPromoPhone = phone(4);
    const unknownPromoPhone = phone(5);
    const suspendedPromoPhone = phone(6);
    const rollbackPhone = phone(7);
    const recoveryPhone = phone(8);
    const suspendedOwnerPhone = phone(9);
    const changedConfigPhone = phone(10);
    const sc006Phone = phone(11);
    let fixture: ReferralPostgresSchema;
    let app: INestApplication;
    let httpServer: SupertestApp;
    let outbox: FakeSmsOutbox;
    let recovery: ReferralRecoveryService;
    let registration: RegistrationService;
    let registrationIntegration: PrismaReferralRegistrationIntegration;
    let repository: PrismaReferralRepository;
    let inviterUserId: string;
    let promoCode: string;
    let suspendedPromoCode: string;
    let legalDocumentIds: string[];
    const previousDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('registration');
        fixture.deploy();
        configureEnvironment(fixture.url, [
            inviterPhone,
            inviteePhone,
            pendingOnlyPhone,
            noPromoPhone,
            unknownPromoPhone,
            suspendedPromoPhone,
            rollbackPhone,
            recoveryPhone,
            suspendedOwnerPhone,
            changedConfigPhone,
            sc006Phone,
        ]);
        legalDocumentIds = await seedLegalDocuments(fixture);
        const inviter = await fixture.prisma.user.create({
            data: { phoneE164: inviterPhone, phoneConfirmedAt: new Date() },
        });
        inviterUserId = inviter.id;
        repository = new PrismaReferralRepository(fixture.prisma);
        promoCode = (
            await repository.provisionUser({
                userId: inviter.id,
                createdAt: inviter.createdAt,
            })
        ).promoCode;
        const suspendedOwner = await fixture.prisma.user.create({
            data: { phoneE164: suspendedOwnerPhone, phoneConfirmedAt: new Date() },
        });
        suspendedPromoCode = (
            await repository.provisionUser({
                userId: suspendedOwner.id,
                createdAt: suspendedOwner.createdAt,
            })
        ).promoCode;
        await fixture.prisma.user.update({ where: { id: suspendedOwner.id }, data: { status: 'SUSPENDED' } });

        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        app.useGlobalFilters(new RedactedExceptionFilter());
        await app.init();
        const rawHttpServer: unknown = app.getHttpServer();
        httpServer = rawHttpServer as SupertestApp;
        outbox = app.get(FakeSmsOutbox);
        recovery = app.get(ReferralRecoveryService);
        registration = app.get(RegistrationService);
        registrationIntegration = app.get(PrismaReferralRegistrationIntegration);
        app.get(ReferralRecoveryScheduler).onModuleDestroy();
    }, 30_000);

    afterAll(async () => {
        await app.close();
        process.env.DATABASE_URL = previousDatabaseUrl;
        await disposeReferralPostgresSchema(fixture);
    });

    it('creates no durable referral effect before OTP and legal completion', async () => {
        await request(httpServer).post('/v1/auth/otp/requests').send({
            phone: pendingOnlyPhone,
            installationId: 'referral-registration-installation',
            pendingPromoCode: promoCode,
        });

        await expect(fixture.prisma.referralRelationship.count()).resolves.toBe(0);
        await expect(fixture.prisma.referralBonusEntitlement.count()).resolves.toBe(0);
    });

    it('registers without a promo and grants exactly one welcome bonus', async () => {
        const context = await verifiedRegistrationContext(noPromoPhone, null);
        const response = await completeRegistration(context, 'referral-registration-no-promo');
        expect(response.status, response.text).toBe(200);

        const user = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: noPromoPhone } });
        await expect(fixture.prisma.referralRelationship.count({ where: { inviteeUserId: user.id } })).resolves.toBe(0);
        const entitlements = await fixture.prisma.referralBonusEntitlement.findMany({
            where: { beneficiaryUserId: user.id },
        });
        expect(entitlements).toMatchObject([{ kind: 'WELCOME', amountMl: 10_000n, status: 'DELIVERED' }]);
        await expect(fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: user.id } })).resolves.toBe(1);
    });

    it('applies changed bonus configuration only to newly created entitlements', async () => {
        const existingUser = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: noPromoPhone } });
        const existingEntitlement = await fixture.prisma.referralBonusEntitlement.findFirstOrThrow({
            where: { beneficiaryUserId: existingUser.id, kind: 'WELCOME' },
        });
        const previousAmount = process.env.REFERRAL_WELCOME_BONUS_ML;

        try {
            process.env.REFERRAL_WELCOME_BONUS_ML = '12000';
            const context = await verifiedRegistrationContext(changedConfigPhone, null);
            const response = await completeRegistration(context, 'referral-registration-changed-config');
            expect(response.status, response.text).toBe(200);
        } finally {
            process.env.REFERRAL_WELCOME_BONUS_ML = previousAmount;
        }

        const newUser = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: changedConfigPhone } });
        await expect(
            fixture.prisma.referralBonusEntitlement.findFirstOrThrow({
                where: { beneficiaryUserId: newUser.id, kind: 'WELCOME' },
            }),
        ).resolves.toMatchObject({ amountMl: 12_000n, status: 'DELIVERED' });
        await expect(
            fixture.prisma.referralBonusEntitlement.findUniqueOrThrow({
                where: { id: existingEntitlement.id },
            }),
        ).resolves.toMatchObject({ amountMl: 10_000n, status: 'DELIVERED' });
    });

    it('uses one safe unavailable response for unknown and suspended-owner promo codes', async () => {
        const unknown = await verifiedRegistrationContext(unknownPromoPhone, '23456789ABCD');
        const suspended = await verifiedRegistrationContext(suspendedPromoPhone, suspendedPromoCode);

        for (const [context, key] of [
            [unknown, 'referral-registration-unknown'],
            [suspended, 'referral-registration-suspended'],
        ] as const) {
            const response = await completeRegistration(context, key);
            expect(response.status).toBe(400);
            expect((response.body as { error: { code: string } }).error.code).toBe('REFERRAL_CODE_UNAVAILABLE');
        }
    });

    it('rejects self-referral at the authoritative database boundary', async () => {
        await expect(
            repository.validatePromoCode(canonicalizePromoCode(promoCode), inviterUserId),
        ).rejects.toMatchObject({
            code: 'REFERRAL_SELF_NOT_ALLOWED',
        });
    });

    it('atomically onboards once and returns byte-identical credentials for repeated and concurrent replays', async () => {
        const context = await verifiedRegistrationContext(inviteePhone, promoCode);
        const unavailable = await request(httpServer)
            .patch('/v1/auth/registration/context')
            .set('x-registration-authorization', context.authorization)
            .send({ pendingPromoCode: '23456789ABCD' });
        expect(unavailable.status).toBe(204);
        const rejected = await request(httpServer)
            .post('/v1/auth/registration/complete')
            .set('x-registration-authorization', context.authorization)
            .set('idempotency-key', 'referral-registration-invalid-code')
            .send({
                setVersion: context.setVersion,
                acceptedDocumentIds: legalDocumentIds,
                installationId: context.installationId,
            });
        expect(rejected.status).toBe(400);
        expect((rejected.body as { error: { code: string } }).error.code).toBe('REFERRAL_CODE_UNAVAILABLE');
        await request(httpServer)
            .patch('/v1/auth/registration/context')
            .set('x-registration-authorization', context.authorization)
            .send({ pendingPromoCode: promoCode })
            .expect(204);
        const complete = () => completeRegistration(context, 'referral-registration-same-key');

        const first = await complete();
        expect(first.status, first.text).toBe(200);
        for (let attempt = 1; attempt < 100; attempt += 1) {
            const replay = await registration.complete({
                registrationAuthorization: context.authorization,
                idempotencyKey: 'referral-registration-same-key',
                setVersion: context.setVersion,
                acceptedDocumentIds: legalDocumentIds,
                installationId: context.installationId,
            });
            expect(JSON.stringify(replay)).toBe(first.text);
        }
        const concurrent = await Promise.all(
            Array.from({ length: 100 }, () =>
                registration.complete({
                    registrationAuthorization: context.authorization,
                    idempotencyKey: 'referral-registration-same-key',
                    setVersion: context.setVersion,
                    acceptedDocumentIds: legalDocumentIds,
                    installationId: context.installationId,
                }),
            ),
        );
        expect(concurrent.every((result) => JSON.stringify(result) === first.text)).toBe(true);

        const invitee = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: inviteePhone } });
        const inviter = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: inviterPhone } });
        await expect(fixture.prisma.referralRelationship.count({ where: { inviteeUserId: invitee.id } })).resolves.toBe(
            1,
        );
        const entitlements = await fixture.prisma.referralBonusEntitlement.findMany({
            where: { beneficiaryUserId: { in: [invitee.id, inviter.id] } },
            orderBy: { kind: 'asc' },
        });
        expect(entitlements).toHaveLength(2);
        expect(entitlements.find(({ kind }) => kind === 'WELCOME')).toMatchObject({
            beneficiaryUserId: invitee.id,
            amountMl: 10_000n,
        });
        expect(entitlements.find(({ kind }) => kind === 'INVITER')).toMatchObject({
            beneficiaryUserId: inviter.id,
            amountMl: 5_000n,
        });
        expect(entitlements.filter(({ beneficiaryUserId }) => beneficiaryUserId === invitee.id)).toHaveLength(1);
        await expect(
            fixture.prisma.walletLedgerEntry.count({
                where: { walletUserId: { in: [invitee.id, inviter.id] } },
            }),
        ).resolves.toBe(2);
    }, 120_000);

    it('rolls back user, legal, session, and referral facts when onboarding fails', async () => {
        const before = await durableCounts();
        const context = await verifiedRegistrationContext(rollbackPhone, null);
        await fixture.prisma.$executeRaw(Prisma.sql`
            CREATE FUNCTION referral_test_reject_entitlement() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'fault-injected entitlement failure';
            END;
            $$ LANGUAGE plpgsql
        `);
        await fixture.prisma.$executeRaw(Prisma.sql`
            CREATE TRIGGER referral_test_reject_entitlement
            BEFORE INSERT ON "ReferralBonusEntitlement"
            FOR EACH ROW EXECUTE FUNCTION referral_test_reject_entitlement()
        `);

        try {
            const response = await completeRegistration(context, 'referral-registration-rollback');
            expect(response.status).toBe(503);
        } finally {
            await fixture.prisma.$executeRaw(Prisma.sql`
                DROP TRIGGER IF EXISTS referral_test_reject_entitlement ON "ReferralBonusEntitlement"
            `);
            await fixture.prisma.$executeRaw(Prisma.sql`DROP FUNCTION IF EXISTS referral_test_reject_entitlement()`);
        }

        expect(await durableCounts()).toEqual(before);
        await expect(fixture.prisma.user.findUnique({ where: { phoneE164: rollbackPhone } })).resolves.toBeNull();
    });

    it('recovers a committed entitlement after inline delivery is interrupted', async () => {
        const delivery = vi.spyOn(registrationIntegration, 'deliverAfterCommit').mockResolvedValueOnce(undefined);
        const context = await verifiedRegistrationContext(recoveryPhone, null);
        const response = await completeRegistration(context, 'referral-registration-recovery');
        expect(response.status, response.text).toBe(200);
        delivery.mockRestore();

        const user = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: recoveryPhone } });
        const entitlement = await fixture.prisma.referralBonusEntitlement.findFirstOrThrow({
            where: { beneficiaryUserId: user.id, kind: 'WELCOME' },
        });
        expect(entitlement.status).toBe('PENDING');
        await expect(fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: user.id } })).resolves.toBe(0);

        const recovered = await recovery.runOnce({ workerId: randomUUID() });
        expect(recovered.delivered).toBeGreaterThanOrEqual(1);
        await expect(fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: user.id } })).resolves.toBe(1);
        await expect(
            fixture.prisma.referralBonusEntitlement.findUniqueOrThrow({ where: { id: entitlement.id } }),
        ).resolves.toMatchObject({ status: 'DELIVERED' });
    });

    it('SC-006 registration exposes scheduler-backed welcome and inviter effects within 5 seconds', async () => {
        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        const schedulerApp = module.createNestApplication();
        schedulerApp.useGlobalPipes(
            new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
        );
        schedulerApp.useGlobalFilters(new RedactedExceptionFilter());
        await schedulerApp.init();

        try {
            const schedulerServer = schedulerApp.getHttpServer() as SupertestApp;
            const schedulerOutbox = schedulerApp.get(FakeSmsOutbox);
            const inviterCredentials = await schedulerApp.get(SessionsService).issueForUser({
                userId: inviterUserId,
                installationId: `sc006-registration-inviter-${randomUUID()}`,
                creationContext: `sc006-registration-inviter-${randomUUID()}`,
            });
            const installationId = `sc006-registration-${randomUUID()}`;
            const issued = await request(schedulerServer).post('/v1/auth/otp/requests').send({
                phone: sc006Phone,
                installationId,
                pendingPromoCode: promoCode,
            });
            expect(issued.status, issued.text).toBe(202);
            const otp = schedulerOutbox.latestFor(sc006Phone);
            if (!otp) throw new Error('Fake OTP was not captured for SC-006 registration');
            const verified = await request(schedulerServer).post('/v1/auth/otp/verifications').send({
                challengeId: otp.correlationId,
                phone: sc006Phone,
                code: otp.otp,
                installationId,
            });
            expect(verified.status, verified.text).toBe(200);
            const registrationAuthorization = (verified.body as unknown as { registrationAuthorization: string })
                .registrationAuthorization;
            const legal = await request(schedulerServer)
                .get('/v1/legal/documents/current')
                .set('x-registration-authorization', registrationAuthorization);
            expect(legal.status, legal.text).toBe(200);
            const setVersion = (legal.body as unknown as { setVersion: string }).setVersion;

            const completed = await request(schedulerServer)
                .post('/v1/auth/registration/complete')
                .set('x-registration-authorization', registrationAuthorization)
                .set('idempotency-key', `sc006-registration-${randomUUID()}`)
                .send({ setVersion, acceptedDocumentIds: legalDocumentIds, installationId });
            expect(completed.status, completed.text).toBe(200);
            const inviteeAccessToken = (completed.body as unknown as { accessToken: string }).accessToken;
            const startedAt = Date.now();

            await pollUntil(async () => {
                const [inviteeMe, inviteeWallet, inviterMe, invitations, inviterWallet] = await Promise.all([
                    authenticatedGet(schedulerServer, '/v1/referrals/me', inviteeAccessToken),
                    authenticatedGet(schedulerServer, '/v1/wallet/balance', inviteeAccessToken),
                    authenticatedGet(schedulerServer, '/v1/referrals/me', inviterCredentials.accessToken),
                    authenticatedGet(schedulerServer, '/v1/referrals/invitations', inviterCredentials.accessToken),
                    authenticatedGet(schedulerServer, '/v1/wallet/balance', inviterCredentials.accessToken),
                ]);
                const inviteeBody = inviteeMe.body as unknown as MyReferralResponseDto;
                const inviteeWalletBody = inviteeWallet.body as unknown as WalletBalanceResponseDto;
                const inviterBody = inviterMe.body as unknown as MyReferralResponseDto;
                const invitationBody = invitations.body as unknown as ReferralInvitationPageResponseDto;
                const inviterWalletBody = inviterWallet.body as unknown as WalletBalanceResponseDto;
                return (
                    inviteeMe.status === 200 &&
                    inviteeBody.eligibility === 'ATTACHED' &&
                    inviteeBody.attachedPromoCode === promoCode &&
                    inviteeWallet.status === 200 &&
                    inviteeWalletBody.balanceMl === '10000' &&
                    inviterMe.status === 200 &&
                    inviterBody.creditedInvitationCount >= 1 &&
                    BigInt(inviterBody.creditedInviterBonusMl) >= 5_000n &&
                    invitations.status === 200 &&
                    invitationBody.items.some((item) => item.inviteeLabel.endsWith(sc006Phone.slice(-2))) &&
                    inviterWallet.status === 200 &&
                    BigInt(inviterWalletBody.balanceMl) >= 5_000n
                );
            }, 5_000);
            expect(Date.now() - startedAt).toBeLessThanOrEqual(5_000);

            const invitee = await fixture.prisma.user.findUniqueOrThrow({ where: { phoneE164: sc006Phone } });
            const relationship = await fixture.prisma.referralRelationship.findUniqueOrThrow({
                where: { inviteeUserId: invitee.id },
            });
            const entitlements = await fixture.prisma.referralBonusEntitlement.findMany({
                where: {
                    OR: [
                        { beneficiaryUserId: invitee.id, kind: 'WELCOME' },
                        { relationshipId: relationship.id, kind: 'INVITER' },
                    ],
                },
                orderBy: { kind: 'asc' },
            });
            expect(entitlements).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        beneficiaryUserId: invitee.id,
                        kind: 'WELCOME',
                        amountMl: 10_000n,
                        status: 'DELIVERED',
                    }),
                    expect.objectContaining({
                        beneficiaryUserId: inviterUserId,
                        kind: 'INVITER',
                        amountMl: 5_000n,
                        status: 'DELIVERED',
                    }),
                ]),
            );
            expect(entitlements).toHaveLength(2);
            for (const entitlement of entitlements) {
                await expect(
                    fixture.prisma.walletLedgerEntry.count({
                        where: { businessEventKey: entitlement.walletBusinessEventKey },
                    }),
                ).resolves.toBe(1);
            }
        } finally {
            schedulerApp.get(ReferralRecoveryScheduler).onModuleDestroy();
            await schedulerApp.close();
        }
    }, 30_000);

    async function verifiedRegistrationContext(phone: string, pendingPromoCode: string | null) {
        const installationId = `referral-${randomUUID()}`;
        const issued = await request(httpServer)
            .post('/v1/auth/otp/requests')
            .send({
                phone,
                installationId,
                ...(pendingPromoCode === null ? {} : { pendingPromoCode }),
            });
        expect(issued.status, issued.text).toBe(202);
        const otp = outbox.latestFor(phone);
        if (!otp) throw new Error('Fake OTP was not captured');
        const verified = await request(httpServer).post('/v1/auth/otp/verifications').send({
            challengeId: otp.correlationId,
            phone,
            code: otp.otp,
            installationId,
        });
        expect(verified.status, verified.text).toBe(200);
        const body = verified.body as { registrationAuthorization: string };
        const legal = await request(httpServer)
            .get('/v1/legal/documents/current')
            .set('x-registration-authorization', body.registrationAuthorization);
        return {
            authorization: body.registrationAuthorization,
            installationId,
            setVersion: (legal.body as { setVersion: string }).setVersion,
        };
    }

    function completeRegistration(
        context: Awaited<ReturnType<typeof verifiedRegistrationContext>>,
        idempotencyKey: string,
    ) {
        return request(httpServer)
            .post('/v1/auth/registration/complete')
            .set('x-registration-authorization', context.authorization)
            .set('idempotency-key', idempotencyKey)
            .send({
                setVersion: context.setVersion,
                acceptedDocumentIds: legalDocumentIds,
                installationId: context.installationId,
            });
    }

    async function durableCounts() {
        const [users, legalAcceptances, sessions, promoCodes, eligibilities, relationships, entitlements] =
            await Promise.all([
                fixture.prisma.user.count(),
                fixture.prisma.legalAcceptance.count(),
                fixture.prisma.userSession.count(),
                fixture.prisma.referralPromoCode.count(),
                fixture.prisma.referralEligibility.count(),
                fixture.prisma.referralRelationship.count(),
                fixture.prisma.referralBonusEntitlement.count(),
            ]);
        return { users, legalAcceptances, sessions, promoCodes, eligibilities, relationships, entitlements };
    }
});

function authenticatedGet(server: SupertestApp, path: string, accessToken: string) {
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

async function seedLegalDocuments(fixture: ReferralPostgresSchema): Promise<string[]> {
    const ids: string[] = [];
    for (const kind of [LegalDocumentKind.TERMS_OF_SERVICE, LegalDocumentKind.PRIVACY_POLICY]) {
        const document = await fixture.prisma.legalDocument.create({
            data: {
                kind,
                version: 'referral-registration-v1',
                locale: 'fr-SN',
                title: kind,
                content: `${kind} content`,
                contentSha256: (kind === LegalDocumentKind.TERMS_OF_SERVICE ? '1' : '2').repeat(64),
                mandatory: true,
                isCurrent: true,
                publishedAt: new Date(),
                effectiveAt: new Date(),
            },
        });
        ids.push(document.id);
    }
    return ids;
}

function configureEnvironment(databaseUrl: string, phones: readonly string[]): void {
    const secret = randomBytes(32).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: databaseUrl,
        SMS_PROVIDER: 'fake',
        FAKE_SMS_EXPOSE_OTP: 'true',
        FAKE_SMS_TEST_NUMBERS: phones.join(','),
        OTP_RESEND_COOLDOWN_SECONDS: '1',
        OTP_SENDS_PER_PHONE_HOUR: '200',
        OTP_SENDS_PER_PHONE_DAY: '200',
        OTP_SENDS_PER_IP_HOUR: '400',
        OTP_SENDS_PER_INSTALLATION_HOUR: '200',
        OTP_SENDS_PER_INSTALLATION_DAY: '200',
        SMS_MAX_SENDS_PER_SECOND: '1000',
        OTP_MAX_PARALLEL_SENDS_GLOBAL: '1000',
        SMS_DAILY_COUNT_LIMIT: '10000',
        SMS_DAILY_XOF_LIMIT: '200000',
        MQTT_URL: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'referral-registration-integration',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        REFERRAL_WELCOME_BONUS_ML: '10000',
        REFERRAL_INVITER_BONUS_ML: '5000',
    });
}
