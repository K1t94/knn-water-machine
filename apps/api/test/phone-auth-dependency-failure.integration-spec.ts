import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DependencyUnavailableError } from '../src/auth/application/auth-application.error';
import { AuthService } from '../src/auth/application/auth.service';
import { RegistrationService } from '../src/auth/application/registration.service';
import { AuthController, RegistrationController } from '../src/auth/http/auth.controller';
import { OtpApplicationError, OtpService } from '../src/otp/application/otp.service';

import type { INestApplication } from '@nestjs/common';

const authorization = 'registration-authorization-token-with-enough-entropy';
const completionBody = {
    setVersion: 'set-v1',
    acceptedDocumentIds: ['00000000-0000-4000-8000-000000000001'],
    installationId: 'installation-dependency-0001',
};
const credentials = {
    accessToken: 'access-token',
    accessExpiresAt: '2030-01-01T00:15:00.000Z',
    refreshToken: 'refresh-token-that-is-at-least-thirty-two-bytes',
    refreshExpiresAt: '2030-03-01T00:00:00.000Z',
};

describe('phone auth dependency recovery', () => {
    let app: INestApplication;
    const otp = { request: vi.fn(), resend: vi.fn(), verify: vi.fn() };
    const auth = { routeVerifiedOtp: vi.fn() };
    const registration = { complete: vi.fn(), updatePendingPromo: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        const module = await Test.createTestingModule({
            controllers: [AuthController, RegistrationController],
            providers: [
                { provide: OtpService, useValue: otp },
                { provide: AuthService, useValue: auth },
                { provide: RegistrationService, useValue: registration },
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

    it('normalizes provider unavailability before a challenge is confirmed', async () => {
        otp.request.mockRejectedValueOnce(new OtpApplicationError('SMS_TEMPORARILY_UNAVAILABLE'));

        const response = await request(app.getHttpAdapter().getInstance())
            .post('/v1/auth/otp/requests')
            .set('x-request-id', 'provider-failure')
            .send({
                phone: '+221771234567',
                installationId: 'installation-dependency-0001',
            });

        expect(response.status).toBe(503);
        expect(response.body.error).toEqual(
            expect.objectContaining({
                code: 'SMS_TEMPORARILY_UNAVAILABLE',
                retryable: true,
                requestId: 'provider-failure',
            }),
        );
    });

    it.each(['Redis', 'PostgreSQL'])('%s failure remains safely retryable after OTP handoff', async () => {
        registration.complete
            .mockRejectedValueOnce(new DependencyUnavailableError())
            .mockResolvedValueOnce(credentials);

        const send = () =>
            request(app.getHttpAdapter().getInstance())
                .post('/v1/auth/registration/complete')
                .set('x-registration-authorization', authorization)
                .set('idempotency-key', 'dependency-retry-attempt')
                .set('x-request-id', 'dependency-failure')
                .send(completionBody);

        const failed = await send();
        const retried = await send();

        expect(failed.status).toBe(503);
        expect(failed.body.error).toEqual(
            expect.objectContaining({
                code: 'DEPENDENCY_UNAVAILABLE',
                retryable: true,
                requestId: 'dependency-failure',
            }),
        );
        expect(retried.status).toBe(200);
        expect(retried.body).toEqual(credentials);
        expect(registration.complete).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                registrationAuthorization: authorization,
                idempotencyKey: 'dependency-retry-attempt',
            }),
        );
    });
});
