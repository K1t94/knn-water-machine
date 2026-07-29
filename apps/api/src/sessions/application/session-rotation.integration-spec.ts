import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionsRepository } from '../infrastructure/postgres/sessions.repository';
import {
  createSessionFixture,
  destroySessionFixture,
  randomDigest,
  type SessionFixture,
} from './testing/postgres-session.fixture';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('refresh rotation transaction', () => {
  let fixture: SessionFixture | undefined;

  afterEach(async () => {
    if (fixture) await destroySessionFixture(fixture);
    fixture = undefined;
  });

  it('allows one simultaneous claimant and preserves generation lineage and deadline', async () => {
    const deadline = new Date(Date.now() + 60 * 86_400_000);
    fixture = await createSessionFixture({ expiresAt: deadline });
    const secondPrisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    const secondRepository = new SessionsRepository(secondPrisma as never);

    try {
      const results = await Promise.all([
        fixture.repository.rotate(
          fixture.refreshDigest,
          randomDigest(),
        ),
        secondRepository.rotate(
          fixture.refreshDigest,
          randomDigest(),
        ),
      ]);

      expect(results.filter(({ status }) => status === 'rotated')).toHaveLength(1);
      expect(results.filter(({ status }) => status === 'replayed')).toHaveLength(1);
      const tokens = await fixture.prisma.sessionRefreshToken.findMany({
        where: { sessionId: fixture.session.id },
        orderBy: { generation: 'asc' },
      });
      expect(tokens.map(({ generation }) => generation)).toEqual([0, 1]);
      expect(tokens[0]?.replacedById).toBe(tokens[1]?.id);
      expect(tokens.every(({ expiresAt }) =>
        expiresAt.getTime() === deadline.getTime())).toBe(true);
    } finally {
      await secondPrisma.$disconnect();
    }
  });

  it('issues no replacement at the PostgreSQL session deadline', async () => {
    fixture = await createSessionFixture();
    await fixture.prisma.$executeRaw`
      UPDATE "UserSession"
      SET "expiresAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${fixture.session.id}::uuid
    `;
    await fixture.prisma.$executeRaw`
      UPDATE "SessionRefreshToken"
      SET "expiresAt" = CURRENT_TIMESTAMP
      WHERE "sessionId" = ${fixture.session.id}::uuid
    `;

    await expect(
      fixture.repository.rotate(fixture.refreshDigest, randomDigest()),
    ).resolves.toEqual({ status: 'expired' });
    await expect(fixture.prisma.sessionRefreshToken.count({
      where: { sessionId: fixture.session.id },
    })).resolves.toBe(1);
  });
});
