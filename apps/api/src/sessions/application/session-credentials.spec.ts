import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';

import { AccessTokenService } from './access-token.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsService } from './sessions.service';

import type { PrismaService } from '../../prisma/prisma.service';
import type { InitialSessionInput, SessionsRepository } from '../infrastructure/postgres/sessions.repository';

configureTestEnvironment();

describe('session credentials', () => {
    it('issues and validates only the allowed HS256 access claims', async () => {
        const service = new AccessTokenService(new JwtService());
        const sessionDeadline = new Date('2030-01-01T00:10:00.000Z');
        const issued = await service.issue({
            userId: 'user-1',
            sessionId: 'session-1',
            issuedAt: new Date('2030-01-01T00:00:00.000Z'),
            sessionExpiresAt: sessionDeadline,
        });

        const claims = await service.validate(issued.token);

        expect(issued.expiresAt).toEqual(sessionDeadline);
        expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sid', 'sub']);
        expect(claims).toMatchObject({
            aud: 'kaynann-mobile',
            iss: 'kaynann-api',
            sid: 'session-1',
            sub: 'user-1',
        });
        expect(claims).not.toHaveProperty('phone');
        expect(claims).not.toHaveProperty('legalDocuments');
    });

    it('generates a 256-bit opaque refresh credential and stable HMAC lookup material', () => {
        const service = new RefreshTokenService(new CredentialCryptoService());
        const token = service.generate();

        expect(Buffer.from(token, 'base64url')).toHaveLength(32);
        expect(service.digest(token)).toMatch(/^[a-f0-9]{64}$/);
        expect(service.digest(token)).not.toContain(token);
    });

    it('persists only the digest and fixes expiry at issuance plus sixty days', async () => {
        const repository = {
            createInitialInTransaction: vi.fn(async (...args: [object, InitialSessionInput]) => {
                void args;
                return { id: 'session-1' };
            }),
        };
        const refresh = {
            generate: vi.fn(() => 'plaintext-refresh-token-that-is-long-enough'),
            digest: vi.fn(() => 'd'.repeat(64)),
        };
        const prisma = {
            $transaction: vi.fn(async (work: (transaction: object) => unknown) => work({})),
        };
        const service = new SessionsService(
            prisma as unknown as PrismaService,
            repository as unknown as SessionsRepository,
            {
                issue: vi.fn(async (input: { sessionExpiresAt: Date }) => ({
                    token: 'access',
                    expiresAt: input.sessionExpiresAt,
                })),
            } as unknown as AccessTokenService,
            refresh as unknown as RefreshTokenService,
            new CredentialCryptoService(),
        );

        const before = Date.now();
        const credentials = await service.issueForUser({
            userId: '00000000-0000-4000-8000-000000000001',
            installationId: 'installation-identifier-0001',
            creationContext: 'challenge-1',
        });
        const persisted = repository.createInitialInTransaction.mock.calls[0]?.[1];

        expect(persisted?.refreshTokenDigest).toBe('d'.repeat(64));
        expect(JSON.stringify(persisted)).not.toContain(credentials.refreshToken);
        expect(persisted?.expiresAt.getTime() - persisted.createdAt!.getTime()).toBe(60 * 86_400_000);
        expect(persisted?.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
        expect(credentials.refreshExpiresAt).toBe(persisted?.expiresAt.toISOString());
    });
});

function configureTestEnvironment(): void {
    const secret = Buffer.alloc(32, 9).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'session-credentials-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
    });
}
