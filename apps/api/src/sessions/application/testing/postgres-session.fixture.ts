import { randomInt, randomUUID } from 'node:crypto';

import { PrismaClient, type User, type UserSession } from '@prisma/client';

import { SessionsRepository } from '../../infrastructure/postgres/sessions.repository';

export interface SessionFixture {
    prisma: PrismaClient;
    repository: SessionsRepository;
    user: User;
    session: UserSession;
    refreshDigest: string;
}

export async function createSessionFixture(input?: {
    expiresAt?: Date;
    installationFingerprint?: string;
}): Promise<SessionFixture> {
    const prisma = new PrismaClient({
        datasourceUrl: process.env.DATABASE_URL,
    });
    const suffix = randomInt(0, 10_000_000).toString().padStart(7, '0');
    const user = await prisma.user.create({
        data: {
            phoneE164: `+22178${suffix}`,
            phoneConfirmedAt: new Date(),
        },
    });
    const refreshDigest = randomDigest();
    const session = await prisma.userSession.create({
        data: {
            userId: user.id,
            familyId: randomUUID(),
            installationFingerprint: input?.installationFingerprint ?? randomDigest(),
            creationKeyDigest: randomDigest(),
            expiresAt: input?.expiresAt ?? new Date(Date.now() + 60 * 86_400_000),
            refreshTokens: {
                create: {
                    tokenDigest: refreshDigest,
                    generation: 0,
                    expiresAt: input?.expiresAt ?? new Date(Date.now() + 60 * 86_400_000),
                },
            },
        },
    });
    return {
        prisma,
        repository: new SessionsRepository(prisma as never),
        user,
        session,
        refreshDigest,
    };
}

export async function destroySessionFixture(fixture: SessionFixture): Promise<void> {
    await fixture.prisma.userSession.deleteMany({
        where: { userId: fixture.user.id },
    });
    await fixture.prisma.user.deleteMany({ where: { id: fixture.user.id } });
    await fixture.prisma.$disconnect();
}

export function randomDigest(): string {
    return Buffer.from(randomUUID().replaceAll('-', '')).toString('hex');
}
