import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/application/auth.service';
import { RegistrationService } from '../src/auth/application/registration.service';
import { AuthController } from '../src/auth/http/auth.controller';
import { LegalAcceptanceController } from '../src/legal/http/legal.controller';
import { OtpService } from '../src/otp/application/otp.service';
import { AccessTokenService } from '../src/sessions/application/access-token.service';
import { SessionError, SessionsService } from '../src/sessions/application/sessions.service';
import { AccessSessionGuard } from '../src/sessions/http/access-session.guard';
import { SessionsController } from '../src/sessions/http/sessions.controller';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';

import { httpServer, requiredRecord, responseRecord } from './http-test-helpers';

import type { RegistrationAuthorizationStore } from '../src/auth/infrastructure/redis/registration-authorization.store';
import type { LegalService } from '../src/legal/application/legal.service';
import type { LegalRepository } from '../src/legal/infrastructure/postgres/legal.repository';
import type { UsersRepository } from '../src/users/infrastructure/postgres/users.repository';
import type { INestApplication } from '@nestjs/common';

const credentials = {
    accessToken: 'access-token',
    accessExpiresAt: '2030-01-01T00:15:00.000Z',
    refreshToken: 'new-refresh-token-that-is-at-least-thirty-two-bytes',
    refreshExpiresAt: '2030-03-01T00:00:00.000Z',
};
const verifiedOtp = {
    challengeId: '00000000-0000-4000-8000-000000000001',
    phoneE164: '+221771234567',
    installationId: 'installation-0001',
    verifiedAt: new Date('2030-01-01T00:00:00.000Z'),
};

describe('existing-user post-OTP routing', () => {
    const users = { findByPhone: vi.fn() };
    const legal = { currentMandatory: vi.fn() };
    const legalRepository = { acceptedDocumentIds: vi.fn() };
    const registrations = { issue: vi.fn() };
    const sessions = { issueForUser: vi.fn() };
    const service = new AuthService(
        users as unknown as UsersRepository,
        legal as unknown as LegalService,
        legalRepository as unknown as LegalRepository,
        registrations as unknown as RegistrationAuthorizationStore,
        sessions as unknown as SessionsService,
    );

    beforeEach(() => {
        vi.clearAllMocks();
        users.findByPhone.mockResolvedValue({ id: 'user-1' });
        legal.currentMandatory.mockResolvedValue({
            documents: [{ id: 'terms-v1' }, { id: 'privacy-v1' }],
        });
        sessions.issueForUser.mockResolvedValue(credentials);
    });

    it('immediately authenticates a user with every current acceptance', async () => {
        legalRepository.acceptedDocumentIds.mockResolvedValue(['terms-v1', 'privacy-v1']);

        await expect(service.routeVerifiedOtp(verifiedOtp)).resolves.toEqual({
            nextStep: 'authenticated',
            session: credentials,
        });
        expect(registrations.issue).not.toHaveBeenCalled();
        expect(sessions.issueForUser).toHaveBeenCalledWith({
            userId: 'user-1',
            installationId: verifiedOtp.installationId,
            creationContext: `otp:${verifiedOtp.challengeId}:user-1`,
        });
    });

    it('gates a stale user behind restricted legal authorization', async () => {
        legalRepository.acceptedDocumentIds.mockResolvedValue(['terms-v1']);
        registrations.issue.mockResolvedValue({
            token: 'registration-authorization-token',
            expiresAt: new Date('2030-01-01T00:15:00.000Z'),
        });

        await expect(service.routeVerifiedOtp(verifiedOtp)).resolves.toEqual({
            nextStep: 'acceptLegal',
            registrationAuthorization: 'registration-authorization-token',
            expiresAt: '2030-01-01T00:15:00.000Z',
        });
        expect(registrations.issue).toHaveBeenCalledWith(
            expect.objectContaining({
                existingUserId: 'user-1',
            }),
        );
        expect(sessions.issueForUser).not.toHaveBeenCalled();
    });
});

describe('session HTTP contract', () => {
    let app: INestApplication;
    const otp = { request: vi.fn(), resend: vi.fn(), verify: vi.fn() };
    const auth = { routeVerifiedOtp: vi.fn() };
    const sessions = {
        refresh: vi.fn(),
        logout: vi.fn(),
    };
    const registration = { complete: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessionRepository = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        sessions.refresh.mockResolvedValue(credentials);
        sessions.logout.mockResolvedValue(undefined);
        registration.complete.mockResolvedValue(credentials);
        accessTokens.validate.mockResolvedValue({
            iss: 'kaynann-api',
            aud: 'kaynann-mobile',
            sub: 'user-1',
            sid: '00000000-0000-4000-8000-000000000010',
            jti: 'jti-1',
            iat: 1,
            exp: 2,
        });
        sessionRepository.findActive.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000010',
            userId: 'user-1',
        });
        const module = await Test.createTestingModule({
            controllers: [AuthController, SessionsController, LegalAcceptanceController],
            providers: [
                { provide: OtpService, useValue: otp },
                { provide: AuthService, useValue: auth },
                { provide: SessionsService, useValue: sessions },
                { provide: RegistrationService, useValue: registration },
                { provide: AccessTokenService, useValue: accessTokens },
                { provide: SessionsRepository, useValue: sessionRepository },
                AccessSessionGuard,
            ],
        }).compile();
        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(
            new ValidationPipe({
                forbidNonWhitelisted: true,
                transform: true,
                whitelist: true,
            }),
        );
        await app.init();
    });

    afterEach(() => app.close());

    it('returns rotated credentials without changing the absolute deadline', async () => {
        const response = await request(httpServer(app)).post('/v1/auth/sessions/refresh').send({
            refreshToken: 'old-refresh-token-that-is-at-least-thirty-two-bytes',
        });

        const body = responseRecord(response);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual(credentials);
        expect(body.refreshExpiresAt).toBe(credentials.refreshExpiresAt);
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it.each([
        ['REFRESH_INVALID', 'The session is invalid. Sign in again.'],
        ['REFRESH_EXPIRED', 'The session has expired. Sign in again.'],
        ['REFRESH_REPLAYED', 'The session was revoked. Sign in again.'],
    ] as const)('maps terminal %s without internal details', async (code, message) => {
        sessions.refresh.mockRejectedValueOnce(new SessionError(code));

        const response = await request(httpServer(app)).post('/v1/auth/sessions/refresh').send({
            refreshToken: 'old-refresh-token-that-is-at-least-thirty-two-bytes',
        });

        const error = requiredRecord(responseRecord(response), 'error');
        expect(response.status, JSON.stringify(response.body)).toBe(401);
        expect(error).toEqual(
            expect.objectContaining({
                code,
                message,
                retryable: false,
            }),
        );
    });

    it('rejects revoked, expired, or malformed access credentials', async () => {
        sessionRepository.findActive.mockResolvedValueOnce(null);
        const revoked = await request(httpServer(app))
            .delete('/v1/auth/sessions/current')
            .set('authorization', 'Bearer access-token');
        accessTokens.validate.mockRejectedValueOnce(new Error('expired'));
        const expired = await request(httpServer(app))
            .delete('/v1/auth/sessions/current')
            .set('authorization', 'Bearer access-token');
        const missing = await request(httpServer(app)).delete('/v1/auth/sessions/current');

        expect([revoked.status, expired.status, missing.status]).toEqual([401, 401, 401]);
        expect(sessions.logout).not.toHaveBeenCalled();
    });

    it('logs out the current device idempotently', async () => {
        const send = () =>
            request(httpServer(app)).delete('/v1/auth/sessions/current').set('authorization', 'Bearer access-token');

        const first = await send();
        const second = await send();

        expect([first.status, second.status], JSON.stringify([first.body, second.body])).toEqual([204, 204]);
        expect(sessions.logout).toHaveBeenCalledTimes(2);
        expect(sessions.logout).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000010');
    });

    it('uses the restricted authorization to atomically accept stale legal versions', async () => {
        const response = await request(httpServer(app))
            .post('/v1/auth/legal/acceptances')
            .set('x-registration-authorization', 'registration-authorization-token-with-enough-entropy')
            .set('idempotency-key', 'legal-acceptance-attempt-0001')
            .send({
                setVersion: 'set-v2',
                acceptedDocumentIds: ['00000000-0000-4000-8000-000000000001'],
                installationId: 'installation-0001',
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(credentials);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(registration.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                registrationAuthorization: 'registration-authorization-token-with-enough-entropy',
                idempotencyKey: 'legal-acceptance-attempt-0001',
                setVersion: 'set-v2',
            }),
        );
    });
});
