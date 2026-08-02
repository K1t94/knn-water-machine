import { RefreshTokenStatus, SessionRevokeReason, UserSessionStatus } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createSessionFixture,
    destroySessionFixture,
    randomDigest,
    type SessionFixture,
} from './testing/postgres-session.fixture';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('refresh replay detection', () => {
    let fixture: SessionFixture | undefined;

    afterEach(async () => {
        if (fixture) await destroySessionFixture(fixture);
        fixture = undefined;
    });

    it('revokes the device family and rejects its newest token after old-token reuse', async () => {
        fixture = await createSessionFixture();
        const newestDigest = randomDigest();

        await expect(fixture.repository.rotate(fixture.refreshDigest, newestDigest)).resolves.toMatchObject({
            status: 'rotated',
        });
        await expect(fixture.repository.rotate(fixture.refreshDigest, randomDigest())).resolves.toEqual({
            status: 'replayed',
        });
        await expect(fixture.repository.rotate(newestDigest, randomDigest())).resolves.toEqual({ status: 'replayed' });

        const session = await fixture.prisma.userSession.findUniqueOrThrow({
            where: { id: fixture.session.id },
        });
        const tokens = await fixture.prisma.sessionRefreshToken.findMany({
            where: { sessionId: fixture.session.id },
        });
        expect(session).toMatchObject({
            status: UserSessionStatus.REVOKED,
            revokeReason: SessionRevokeReason.REPLAY,
        });
        expect(session.replayDetectedAt).not.toBeNull();
        expect(tokens.every(({ status }) => status === RefreshTokenStatus.REVOKED)).toBe(true);
    });
});
