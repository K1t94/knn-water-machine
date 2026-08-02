import { randomInt, randomUUID } from 'node:crypto';

import { LegalDocumentKind, PrismaClient, RefreshTokenStatus, SmsProviderKind } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('phone OTP persistence constraints', () => {
    const prisma = new PrismaClient({
        datasourceUrl: databaseUrl,
    });
    const suffix = randomInt(0, 10_000_000).toString().padStart(7, '0');
    const phone = `+22177${suffix}`;
    let userId: string;
    let legalDocumentId: string;
    let sessionId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                phoneE164: phone,
                phoneConfirmedAt: new Date(),
            },
        });
        userId = user.id;

        const legalDocument = await prisma.legalDocument.create({
            data: {
                kind: LegalDocumentKind.TERMS_OF_SERVICE,
                version: `test-${suffix}`,
                locale: `x-${suffix}`,
                title: 'Migration constraint test',
                content: 'test',
                contentSha256: 'a'.repeat(64),
                mandatory: true,
                isCurrent: true,
                publishedAt: new Date(),
                effectiveAt: new Date(),
            },
        });
        legalDocumentId = legalDocument.id;
    });

    afterAll(async () => {
        await prisma.smsDelivery.deleteMany({
            where: { phoneFingerprint: suffix.padEnd(64, '0') },
        });
        if (userId) {
            await prisma.userSession.deleteMany({ where: { userId } });
            await prisma.legalAcceptance.deleteMany({ where: { userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        if (legalDocumentId) {
            await prisma.legalDocument.deleteMany({
                where: { id: legalDocumentId },
            });
        }
        await prisma.$disconnect();
    });

    it('rejects duplicate normalized phone numbers', async () => {
        await expect(
            prisma.user.create({
                data: { phoneE164: phone, phoneConfirmedAt: new Date() },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('keeps legal acceptance idempotent per user and document', async () => {
        const data = {
            userId,
            legalDocumentId,
            registrationFlowId: randomUUID(),
        };
        await prisma.legalAcceptance.create({ data });
        await expect(prisma.legalAcceptance.create({ data })).rejects.toMatchObject({
            code: 'P2002',
        });
    });

    it('allows only one current legal version per kind and locale', async () => {
        await expect(
            prisma.legalDocument.create({
                data: {
                    kind: LegalDocumentKind.TERMS_OF_SERVICE,
                    version: `other-${suffix}`,
                    locale: `x-${suffix}`,
                    title: 'Conflicting current document',
                    content: 'test',
                    contentSha256: 'b'.repeat(64),
                    mandatory: true,
                    isCurrent: true,
                    publishedAt: new Date(),
                    effectiveAt: new Date(),
                },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('uses the creation digest as a deterministic session key', async () => {
        const creationKeyDigest = suffix.padEnd(64, '1');
        const session = await prisma.userSession.create({
            data: {
                userId,
                familyId: randomUUID(),
                installationFingerprint: suffix.padEnd(64, '2'),
                creationKeyDigest,
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        sessionId = session.id;

        await expect(
            prisma.userSession.create({
                data: {
                    userId,
                    familyId: randomUUID(),
                    installationFingerprint: suffix.padEnd(64, '3'),
                    creationKeyDigest,
                    expiresAt: new Date(Date.now() + 60_000),
                },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('enforces refresh generation and one active token per session', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        await prisma.sessionRefreshToken.create({
            data: {
                sessionId,
                tokenDigest: suffix.padEnd(64, '4'),
                generation: 0,
                expiresAt,
            },
        });

        await expect(
            prisma.sessionRefreshToken.create({
                data: {
                    sessionId,
                    tokenDigest: suffix.padEnd(64, '5'),
                    generation: 1,
                    expiresAt,
                },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });

        await prisma.sessionRefreshToken.updateMany({
            where: { sessionId, generation: 0 },
            data: { status: RefreshTokenStatus.ROTATED },
        });
        await expect(
            prisma.sessionRefreshToken.create({
                data: {
                    sessionId,
                    tokenDigest: suffix.padEnd(64, '5'),
                    generation: 1,
                    expiresAt,
                },
            }),
        ).resolves.toMatchObject({ generation: 1 });
    });

    it('correlates a provider message identifier only once', async () => {
        const phoneFingerprint = suffix.padEnd(64, '0');
        const providerMessageId = `provider-${suffix}`;
        await prisma.smsDelivery.create({
            data: {
                challengeId: randomUUID(),
                provider: SmsProviderKind.FAKE,
                providerMessageId,
                phoneFingerprint,
                requestedAt: new Date(),
            },
        });

        await expect(
            prisma.smsDelivery.create({
                data: {
                    challengeId: randomUUID(),
                    provider: SmsProviderKind.FAKE,
                    providerMessageId,
                    phoneFingerprint,
                    requestedAt: new Date(),
                },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });
});
