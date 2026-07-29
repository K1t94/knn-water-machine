import { Inject, Injectable } from '@nestjs/common';
import {
  RefreshTokenStatus,
  SessionRevokeReason,
  UserSessionStatus,
  type Prisma,
  type UserSession,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

export interface InitialSessionInput {
  id: string;
  familyId: string;
  userId: string;
  installationFingerprint: string;
  creationKeyDigest: string;
  expiresAt: Date;
  refreshTokenDigest: string;
  refreshExpiresAt: Date;
  createdAt?: Date;
}

export type RefreshRotationResult =
  | {
      status: 'rotated';
      userId: string;
      sessionId: string;
      sessionExpiresAt: Date;
      rotatedAt: Date;
    }
  | { status: 'invalid' | 'expired' | 'replayed' };

@Injectable()
export class SessionsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByCreationKey(creationKeyDigest: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({
      where: { creationKeyDigest },
    });
  }

  async hasInitialRefreshDigest(
    creationKeyDigest: string,
    refreshTokenDigest: string,
  ): Promise<boolean> {
    const count = await this.prisma.sessionRefreshToken.count({
      where: {
        tokenDigest: refreshTokenDigest,
        generation: 0,
        session: { creationKeyDigest },
      },
    });
    return count === 1;
  }

  async createInitialInTransaction(
    transaction: Prisma.TransactionClient,
    input: InitialSessionInput,
  ): Promise<UserSession> {
    const existing = await transaction.userSession.findUnique({
      where: { creationKeyDigest: input.creationKeyDigest },
    });
    if (existing) {
      const token = await transaction.sessionRefreshToken.findFirst({
        where: {
          sessionId: existing.id,
          generation: 0,
          tokenDigest: input.refreshTokenDigest,
        },
        select: { id: true },
      });
      if (!token) {
        throw new Error('Existing registration session has different credentials');
      }
      return existing;
    }

    return transaction.userSession.create({
      data: {
        id: input.id,
        familyId: input.familyId,
        userId: input.userId,
        installationFingerprint: input.installationFingerprint,
        creationKeyDigest: input.creationKeyDigest,
        expiresAt: input.expiresAt,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        refreshTokens: {
          create: {
            tokenDigest: input.refreshTokenDigest,
            generation: 0,
            expiresAt: input.refreshExpiresAt,
            ...(input.createdAt ? { issuedAt: input.createdAt } : {}),
          },
        },
      },
    });
  }

  rotate(
    currentTokenDigest: string,
    nextTokenDigest: string,
  ): Promise<RefreshRotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      const current = await transaction.sessionRefreshToken.findUnique({
        where: { tokenDigest: currentTokenDigest },
        include: { session: true },
      });
      if (!current) return { status: 'invalid' };

      if (
        current.session.revokeReason === SessionRevokeReason.REPLAY ||
        current.session.replayDetectedAt
      ) {
        return { status: 'replayed' };
      }
      if (
        current.session.status === UserSessionStatus.EXPIRED ||
        current.session.expiresAt.getTime() <= now.getTime() ||
        current.expiresAt.getTime() <= now.getTime()
      ) {
        await this.expireFamily(transaction, current.sessionId, now);
        return { status: 'expired' };
      }
      if (
        current.session.status !== UserSessionStatus.ACTIVE ||
        current.status !== RefreshTokenStatus.ACTIVE
      ) {
        await this.revokeForReplay(transaction, current.sessionId, now);
        return { status: 'replayed' };
      }

      const claimed = await transaction.sessionRefreshToken.updateMany({
        where: {
          id: current.id,
          status: RefreshTokenStatus.ACTIVE,
          session: {
            status: UserSessionStatus.ACTIVE,
            expiresAt: { gt: now },
          },
        },
        data: {
          status: RefreshTokenStatus.ROTATED,
          usedAt: now,
        },
      });
      if (claimed.count !== 1) {
        await this.revokeForReplay(transaction, current.sessionId, now);
        return { status: 'replayed' };
      }

      const replacement = await transaction.sessionRefreshToken.create({
        data: {
          sessionId: current.sessionId,
          tokenDigest: nextTokenDigest,
          generation: current.generation + 1,
          issuedAt: now,
          expiresAt: current.session.expiresAt,
        },
      });
      await transaction.sessionRefreshToken.update({
        where: { id: current.id },
        data: { replacedById: replacement.id },
      });
      await transaction.userSession.update({
        where: { id: current.sessionId },
        data: { lastUsedAt: now },
      });
      return {
        status: 'rotated',
        userId: current.session.userId,
        sessionId: current.sessionId,
        sessionExpiresAt: current.session.expiresAt,
        rotatedAt: now,
      };
    });
  }

  async findActive(sessionId: string): Promise<UserSession | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.status !== UserSessionStatus.ACTIVE ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return session;
  }

  revokeCurrent(sessionId: string): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      await transaction.userSession.updateMany({
        where: { id: sessionId, status: UserSessionStatus.ACTIVE },
        data: {
          status: UserSessionStatus.REVOKED,
          revokedAt: now,
          revokeReason: SessionRevokeReason.LOGOUT,
        },
      });
      await transaction.sessionRefreshToken.updateMany({
        where: {
          sessionId,
          status: RefreshTokenStatus.ACTIVE,
        },
        data: { status: RefreshTokenStatus.REVOKED },
      });
    });
  }

  private async expireFamily(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await transaction.userSession.updateMany({
      where: { id: sessionId, status: UserSessionStatus.ACTIVE },
      data: {
        status: UserSessionStatus.EXPIRED,
        revokedAt: now,
        revokeReason: SessionRevokeReason.EXPIRED,
      },
    });
    await transaction.sessionRefreshToken.updateMany({
      where: {
        sessionId,
        status: RefreshTokenStatus.ACTIVE,
      },
      data: { status: RefreshTokenStatus.EXPIRED },
    });
  }

  private async revokeForReplay(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await transaction.userSession.updateMany({
      where: { id: sessionId },
      data: {
        status: UserSessionStatus.REVOKED,
        revokedAt: now,
        replayDetectedAt: now,
        revokeReason: SessionRevokeReason.REPLAY,
      },
    });
    await transaction.sessionRefreshToken.updateMany({
      where: { sessionId },
      data: { status: RefreshTokenStatus.REVOKED },
    });
  }
}
