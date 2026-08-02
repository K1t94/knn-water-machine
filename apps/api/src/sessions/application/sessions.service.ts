import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { loadEnv } from '../../config/env';
import { AuthMetrics } from '../../observability/auth-metrics';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsRepository } from '../infrastructure/postgres/sessions.repository';

import { AccessTokenService } from './access-token.service';
import { RefreshTokenService } from './refresh-token.service';

import type { Prisma } from '@prisma/client';

export type SessionErrorCode = 'REFRESH_INVALID' | 'REFRESH_EXPIRED' | 'REFRESH_REPLAYED';

export class SessionError extends Error {
    constructor(public readonly code: SessionErrorCode) {
        super(code);
    }
}

export interface SessionCredentials {
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    refreshExpiresAt: string;
}

@Injectable()
export class SessionsService {
    private readonly env = loadEnv();

    constructor(
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(SessionsRepository) private readonly repository: SessionsRepository,
        @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
        @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
        @Inject(CredentialCryptoService) private readonly crypto: CredentialCryptoService,
        @Optional() @Inject(AuthMetrics) private readonly metrics?: AuthMetrics,
    ) {}

    async issueForUser(input: {
        userId: string;
        installationId: string;
        creationContext: string;
    }): Promise<SessionCredentials> {
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + this.env.SESSION_TTL_DAYS * 86_400_000);
        const refreshToken = this.refreshTokens.generate();
        const sessionId = randomUUID();
        const access = await this.accessTokens.issue({
            userId: input.userId,
            sessionId,
            issuedAt,
            sessionExpiresAt: expiresAt,
        });
        await this.prisma.$transaction((transaction) =>
            this.repository.createInitialInTransaction(transaction, {
                id: sessionId,
                familyId: randomUUID(),
                userId: input.userId,
                installationFingerprint: this.crypto.fingerprintInstallation(input.installationId).digest,
                creationKeyDigest: this.crypto.digest('credential', ['session-creation', input.creationContext]).digest,
                expiresAt,
                refreshTokenDigest: this.refreshTokens.digest(refreshToken),
                refreshExpiresAt: expiresAt,
                createdAt: issuedAt,
            }),
        );
        return this.shape(access, refreshToken, expiresAt);
    }

    async prepareInitialCredentials(input: { userId: string; sessionId: string }): Promise<SessionCredentials> {
        const issuedAt = new Date();
        const refreshExpiresAt = new Date(issuedAt.getTime() + this.env.SESSION_TTL_DAYS * 86_400_000);
        const access = await this.accessTokens.issue({
            userId: input.userId,
            sessionId: input.sessionId,
            issuedAt,
            sessionExpiresAt: refreshExpiresAt,
        });
        return this.shape(access, this.refreshTokens.generate(), refreshExpiresAt);
    }

    createInitialInTransaction(
        transaction: Prisma.TransactionClient,
        input: {
            credentials: SessionCredentials;
            sessionId: string;
            familyId: string;
            userId: string;
            installationFingerprint: string;
            creationKeyDigest: string;
        },
    ) {
        const refreshExpiresAt = new Date(input.credentials.refreshExpiresAt);
        const createdAt = new Date(refreshExpiresAt.getTime() - this.env.SESSION_TTL_DAYS * 86_400_000);
        return this.repository.createInitialInTransaction(transaction, {
            id: input.sessionId,
            familyId: input.familyId,
            userId: input.userId,
            installationFingerprint: input.installationFingerprint,
            creationKeyDigest: input.creationKeyDigest,
            expiresAt: refreshExpiresAt,
            refreshTokenDigest: this.refreshTokens.digest(input.credentials.refreshToken),
            refreshExpiresAt,
            createdAt,
        });
    }

    async refresh(refreshToken: string): Promise<SessionCredentials> {
        if (refreshToken.length < 32 || refreshToken.length > 512) {
            this.metrics?.sessionRefresh('invalid');
            throw new SessionError('REFRESH_INVALID');
        }
        const nextToken = this.refreshTokens.generate();
        const result = await this.repository.rotate(
            this.refreshTokens.digest(refreshToken),
            this.refreshTokens.digest(nextToken),
        );
        if (result.status !== 'rotated') {
            this.metrics?.sessionRefresh(
                result.status === 'expired' ? 'expired' : result.status === 'replayed' ? 'replayed' : 'invalid',
            );
            throw new SessionError(
                result.status === 'expired'
                    ? 'REFRESH_EXPIRED'
                    : result.status === 'replayed'
                      ? 'REFRESH_REPLAYED'
                      : 'REFRESH_INVALID',
            );
        }
        const access = await this.accessTokens.issue({
            userId: result.userId,
            sessionId: result.sessionId,
            issuedAt: result.rotatedAt,
            sessionExpiresAt: result.sessionExpiresAt,
        });
        this.metrics?.sessionRefresh('success');
        return this.shape(access, nextToken, result.sessionExpiresAt);
    }

    logout(sessionId: string): Promise<void> {
        return this.repository.revokeCurrent(sessionId);
    }

    private shape(
        access: { token: string; expiresAt: Date },
        refreshToken: string,
        refreshExpiresAt: Date,
    ): SessionCredentials {
        return {
            accessToken: access.token,
            accessExpiresAt: access.expiresAt.toISOString(),
            refreshToken,
            refreshExpiresAt: refreshExpiresAt.toISOString(),
        };
    }
}
