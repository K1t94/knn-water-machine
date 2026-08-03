import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/application/auth.service';
import { AuthController } from '../src/auth/http/auth.controller';
import { OtpApplicationError, OtpService } from '../src/otp/application/otp.service';

import { httpServer } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('OTP HTTP contract', () => {
    let app: INestApplication;
    const otp = {
        request: vi.fn(),
        resend: vi.fn(),
        verify: vi.fn(),
    };
    const auth = { routeVerifiedOtp: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        const module = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                { provide: OtpService, useValue: otp },
                { provide: AuthService, useValue: auth },
            ],
        }).compile();
        app = module.createNestApplication();
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

    it('validates request DTOs before application code', async () => {
        const response = await request(httpServer(app))
            .post('/v1/auth/otp/requests')
            .send({ phone: '+22177', installationId: 'short', unexpected: true });
        expect(response.status).toBe(400);
        expect(otp.request).not.toHaveBeenCalled();
    });

    it('shapes an accepted response without OTP or provider payload', async () => {
        otp.request.mockResolvedValue({
            challengeId: '00000000-0000-4000-8000-000000000001',
            delivery: 'accepted',
            expiresAt: new Date('2030-01-01T00:05:00.000Z'),
            resendAvailableAt: new Date('2030-01-01T00:01:00.000Z'),
        });
        const response = await request(httpServer(app))
            .post('/v1/auth/otp/requests')
            .set('x-request-id', 'request-1')
            .send({ phone: '+221771234567', installationId: 'installation-0001' });
        expect(response.status).toBe(202);
        expect(response.body).toEqual({
            challengeId: '00000000-0000-4000-8000-000000000001',
            delivery: 'accepted',
            expiresAt: '2030-01-01T00:05:00.000Z',
            resendAvailableAt: '2030-01-01T00:01:00.000Z',
        });
        expect(JSON.stringify(response.body)).not.toMatch(/otp|provider|phone/i);
    });

    it('returns stable safe errors and retry timing', async () => {
        otp.resend.mockRejectedValue(new OtpApplicationError('RATE_LIMITED', 42));
        const response = await request(httpServer(app))
            .post('/v1/auth/otp/requests/00000000-0000-4000-8000-000000000001/resend')
            .set('x-request-id', 'request-2')
            .send({ phone: '+221771234567', installationId: 'installation-0001' });
        expect(response.status).toBe(429);
        expect(response.body).toEqual({
            error: {
                code: 'RATE_LIMITED',
                message: 'Please wait before trying again.',
                retryable: true,
                retryAfterSeconds: 42,
                requestId: 'request-2',
            },
        });
    });

    it('returns only an opaque registration handoff after verification', async () => {
        otp.verify.mockResolvedValue({
            challengeId: '00000000-0000-4000-8000-000000000001',
            phoneE164: '+221771234567',
            installationId: 'installation-0001',
            verifiedAt: new Date(),
        });
        auth.routeVerifiedOtp.mockResolvedValue({
            nextStep: 'completeRegistration',
            registrationAuthorization: 'opaque-registration-authorization',
            expiresAt: new Date('2030-01-01T00:15:00.000Z'),
        });
        const response = await request(httpServer(app)).post('/v1/auth/otp/verifications').send({
            challengeId: '00000000-0000-4000-8000-000000000001',
            phone: '+221771234567',
            code: '123456',
            installationId: 'installation-0001',
        });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            nextStep: 'completeRegistration',
            registrationAuthorization: 'opaque-registration-authorization',
            expiresAt: '2030-01-01T00:15:00.000Z',
        });
        expect(JSON.stringify(response.body)).not.toContain('+221');
        expect(JSON.stringify(response.body)).not.toContain('123456');
    });
});
