import { afterEach, describe, expect, it } from 'vitest';

import {
    createSessionFixture,
    destroySessionFixture,
    randomDigest,
    type SessionFixture,
} from './testing/postgres-session.fixture';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('independent device sessions', () => {
    let first: SessionFixture | undefined;

    afterEach(async () => {
        if (first) await destroySessionFixture(first);
        first = undefined;
    });

    it('logs out only the current installation and keeps another session active', async () => {
        first = await createSessionFixture();
        const secondSession = await first.prisma.userSession.create({
            data: {
                userId: first.user.id,
                familyId: crypto.randomUUID(),
                installationFingerprint: randomDigest(),
                creationKeyDigest: randomDigest(),
                expiresAt: first.session.expiresAt,
                refreshTokens: {
                    create: {
                        tokenDigest: randomDigest(),
                        generation: 0,
                        expiresAt: first.session.expiresAt,
                    },
                },
            },
            include: { refreshTokens: true },
        });
        const secondRefreshDigest = secondSession.refreshTokens[0].tokenDigest;

        await first.repository.revokeCurrent(first.session.id);
        await first.repository.revokeCurrent(first.session.id);

        await expect(first.repository.findActive(first.session.id)).resolves.toBeNull();
        await expect(first.repository.findActive(secondSession.id)).resolves.toMatchObject({ id: secondSession.id });
        await expect(first.repository.rotate(secondRefreshDigest, randomDigest())).resolves.toMatchObject({
            status: 'rotated',
            sessionId: secondSession.id,
        });
    });
});
