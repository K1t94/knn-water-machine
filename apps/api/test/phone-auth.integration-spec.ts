import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LegalDocumentKind, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { FakeSmsOutbox } from '../src/sms/infrastructure/fake/fake-sms.outbox';

import {
    asRecord,
    httpServer,
    requiredArray,
    requiredRecord,
    requiredString,
    responseRecord,
} from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

const phone = '+221781234567';
const installationId = 'phone-auth-integration-installation';
const enabled =
    process.env.RUN_REDIS_INTEGRATION === '1' &&
    process.env.RUN_POSTGRES_INTEGRATION === '1' &&
    Boolean(process.env.DATABASE_URL);
const integration = enabled ? describe : describe.skip;

integration('full fake-provider phone authentication journey', () => {
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    let app: INestApplication;
    let outbox: FakeSmsOutbox;
    let v1DocumentIds: string[];
    let originalCurrentLegalIds: string[];
    const challengeIds: string[] = [];

    beforeAll(async () => {
        configureEnvironment();
        await cleanPhoneState(prisma, phone);
        originalCurrentLegalIds = (
            await prisma.legalDocument.findMany({
                where: { locale: 'fr-SN', isCurrent: true },
                select: { id: true },
            })
        ).map(({ id }) => id);
        v1DocumentIds = await replaceCurrentLegalSet(prisma, 'phase8-v1');

        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(
            new ValidationPipe({
                forbidNonWhitelisted: true,
                transform: true,
                whitelist: true,
            }),
        );
        app.useGlobalFilters(new RedactedExceptionFilter());
        await app.init();
        outbox = app.get(FakeSmsOutbox);
    });

    afterAll(async () => {
        await app.close();
        await cleanPhoneState(prisma, phone);
        await prisma.$transaction(async (transaction) => {
            await transaction.smsDelivery.deleteMany({
                where: { challengeId: { in: challengeIds } },
            });
            await transaction.legalDocument.updateMany({
                where: { version: { startsWith: 'phase8-' } },
                data: { isCurrent: false, retiredAt: new Date() },
            });
            await transaction.legalDocument.updateMany({
                where: { id: { in: originalCurrentLegalIds } },
                data: { isCurrent: true, retiredAt: null },
            });
        });
        await prisma.$disconnect();
    });

    it('keeps OTP temporary and completes all session and legal boundaries', async () => {
        const firstIssue = await request(httpServer(app))
            .post('/v1/auth/otp/requests')
            .send({ phone, installationId, pendingPromoCode: 'PROMO-ORIGINAL' });
        const firstIssueBody = responseRecord(firstIssue);
        const firstChallengeId = requiredString(firstIssueBody, 'challengeId');
        expect(firstIssue.status, JSON.stringify(firstIssue.body)).toBe(202);
        challengeIds.push(firstChallengeId);
        await expectNoDurableIdentity(prisma, phone);

        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const resend = await request(httpServer(app))
            .post(`/v1/auth/otp/requests/${firstChallengeId}/resend`)
            .send({ phone, installationId, pendingPromoCode: 'PROMO-REPLACED' });
        const resendBody = responseRecord(resend);
        const resendChallengeId = requiredString(resendBody, 'challengeId');
        expect(resend.status, JSON.stringify(resend.body)).toBe(202);
        challengeIds.push(resendChallengeId);
        const firstOtp = outbox.latestFor(phone);
        expect(firstOtp?.correlationId).toBe(resendChallengeId);

        const verified = await request(httpServer(app)).post('/v1/auth/otp/verifications').send({
            challengeId: resendChallengeId,
            phone,
            code: firstOtp?.otp,
            installationId,
        });
        const verifiedBody = responseRecord(verified);
        expect(verified.status, JSON.stringify(verified.body)).toBe(200);
        expect(verifiedBody.nextStep).toBe('completeRegistration');
        await expectNoDurableIdentity(prisma, phone);

        const registrationAuthorization = requiredString(verifiedBody, 'registrationAuthorization');
        for (const pendingPromoCode of ['PROMO-FINAL', null]) {
            const context = await request(httpServer(app))
                .patch('/v1/auth/registration/context')
                .set('x-registration-authorization', registrationAuthorization)
                .send({ pendingPromoCode });
            expect(context.status, context.text).toBe(204);
        }

        const legal = await request(httpServer(app))
            .get('/v1/legal/documents/current')
            .set('x-registration-authorization', registrationAuthorization);
        const legalBody = responseRecord(legal);
        expect(legal.status).toBe(200);
        expect(documentIds(legalBody)).toEqual([...v1DocumentIds].sort());

        const complete = () =>
            request(httpServer(app))
                .post('/v1/auth/registration/complete')
                .set('x-registration-authorization', registrationAuthorization)
                .set('idempotency-key', 'phase8-registration-completion')
                .send({
                    setVersion: requiredString(legalBody, 'setVersion'),
                    acceptedDocumentIds: v1DocumentIds,
                    installationId,
                });
        const firstCompletion = await complete();
        const repeatedCompletion = await complete();
        const firstCompletionBody = responseRecord(firstCompletion);
        const firstRefreshToken = requiredString(firstCompletionBody, 'refreshToken');
        const firstRefreshExpiresAt = requiredString(firstCompletionBody, 'refreshExpiresAt');
        expect(firstCompletion.status, JSON.stringify(firstCompletion.body)).toBe(200);
        expect(repeatedCompletion.status).toBe(200);
        expect(repeatedCompletion.text).toBe(firstCompletion.text);

        const user = await prisma.user.findUniqueOrThrow({ where: { phoneE164: phone } });
        await expect(prisma.user.count({ where: { phoneE164: phone } })).resolves.toBe(1);
        await expect(prisma.legalAcceptance.count({ where: { userId: user.id } })).resolves.toBe(2);
        await expect(prisma.userSession.count({ where: { userId: user.id } })).resolves.toBe(1);

        const refresh = await request(httpServer(app))
            .post('/v1/auth/sessions/refresh')
            .send({ refreshToken: firstRefreshToken });
        const refreshBody = responseRecord(refresh);
        expect(refresh.status).toBe(200);
        expect(refreshBody.refreshToken).not.toBe(firstRefreshToken);
        expect(refreshBody.refreshExpiresAt).toBe(firstRefreshExpiresAt);

        const replay = await request(httpServer(app))
            .post('/v1/auth/sessions/refresh')
            .send({ refreshToken: firstRefreshToken });
        const replayError = requiredRecord(responseRecord(replay), 'error');
        expect(replay.status).toBe(401);
        expect(replayError.code).toBe('REFRESH_REPLAYED');

        const v2DocumentIds = await replaceCurrentLegalSet(prisma, 'phase8-v2');
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const nextIssue = await request(httpServer(app)).post('/v1/auth/otp/requests').send({ phone, installationId });
        const nextIssueBody = responseRecord(nextIssue);
        const nextChallengeId = requiredString(nextIssueBody, 'challengeId');
        expect(nextIssue.status, JSON.stringify(nextIssue.body)).toBe(202);
        challengeIds.push(nextChallengeId);
        const nextOtp = outbox.latestFor(phone);
        const staleLogin = await request(httpServer(app)).post('/v1/auth/otp/verifications').send({
            challengeId: nextChallengeId,
            phone,
            code: nextOtp?.otp,
            installationId,
        });
        const staleLoginBody = responseRecord(staleLogin);
        expect(staleLogin.status).toBe(200);
        expect(staleLoginBody.nextStep).toBe('acceptLegal');

        const staleAuthorization = requiredString(staleLoginBody, 'registrationAuthorization');
        const currentLegal = await request(httpServer(app))
            .get('/v1/legal/documents/current')
            .set('x-registration-authorization', staleAuthorization);
        const currentLegalBody = responseRecord(currentLegal);
        expect(documentIds(currentLegalBody)).toEqual([...v2DocumentIds].sort());

        const accepted = await request(httpServer(app))
            .post('/v1/auth/legal/acceptances')
            .set('x-registration-authorization', staleAuthorization)
            .set('idempotency-key', 'phase8-stale-legal-acceptance')
            .send({
                setVersion: requiredString(currentLegalBody, 'setVersion'),
                acceptedDocumentIds: v2DocumentIds,
                installationId,
            });
        const acceptedBody = responseRecord(accepted);
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

        const logout = await request(httpServer(app))
            .delete('/v1/auth/sessions/current')
            .set('authorization', `Bearer ${requiredString(acceptedBody, 'accessToken')}`);
        expect(logout.status).toBe(204);

        await expect(prisma.user.count({ where: { phoneE164: phone } })).resolves.toBe(1);
        await expect(prisma.legalAcceptance.count({ where: { userId: user.id } })).resolves.toBe(4);
        await expect(prisma.userSession.count({ where: { userId: user.id } })).resolves.toBe(2);
    }, 30_000);
});

function documentIds(body: Readonly<Record<string, unknown>>): string[] {
    return requiredArray(body, 'documents')
        .map((document) => requiredString(asRecord(document, 'legal document'), 'id'))
        .sort();
}

async function expectNoDurableIdentity(prisma: PrismaClient, phoneE164: string) {
    const user = await prisma.user.findUnique({ where: { phoneE164 } });
    expect(user).toBeNull();
    await expect(
        prisma.userSession.count({
            where: { user: { phoneE164 } },
        }),
    ).resolves.toBe(0);
}

async function replaceCurrentLegalSet(prisma: PrismaClient, version: string): Promise<string[]> {
    return prisma.$transaction(async (transaction) => {
        await transaction.legalDocument.updateMany({
            where: { locale: 'fr-SN', isCurrent: true },
            data: { isCurrent: false, retiredAt: new Date() },
        });
        const ids: string[] = [];
        for (const kind of [LegalDocumentKind.TERMS_OF_SERVICE, LegalDocumentKind.PRIVACY_POLICY]) {
            const document = await transaction.legalDocument.upsert({
                where: { kind_version_locale: { kind, version, locale: 'fr-SN' } },
                update: { isCurrent: true, retiredAt: null },
                create: {
                    kind,
                    version,
                    locale: 'fr-SN',
                    title: `${kind} ${version}`,
                    content: `${kind} acceptance text for ${version}`,
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
    });
}

async function cleanPhoneState(prisma: PrismaClient, phoneE164: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { phoneE164 } });
    if (!user) return;
    await prisma.$transaction([
        prisma.sessionRefreshToken.deleteMany({ where: { session: { userId: user.id } } }),
        prisma.userSession.deleteMany({ where: { userId: user.id } }),
        prisma.legalAcceptance.deleteMany({ where: { userId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
    ]);
}

function configureEnvironment(): void {
    const secret = Buffer.alloc(32, 8).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        SMS_PROVIDER: 'fake',
        FAKE_SMS_EXPOSE_OTP: 'true',
        FAKE_SMS_TEST_NUMBERS: phone,
        OTP_RESEND_COOLDOWN_SECONDS: '1',
        OTP_SENDS_PER_PHONE_HOUR: '10',
        OTP_SENDS_PER_PHONE_DAY: '10',
        OTP_SENDS_PER_IP_HOUR: '20',
        OTP_SENDS_PER_INSTALLATION_HOUR: '20',
        OTP_SENDS_PER_INSTALLATION_DAY: '20',
        SMS_DAILY_COUNT_LIMIT: '10000',
        SMS_DAILY_XOF_LIMIT: '200000',
        MQTT_URL: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'phone-auth-integration',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
    });
}
