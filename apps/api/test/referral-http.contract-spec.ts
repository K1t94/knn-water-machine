import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { ReferralQueryService } from '../src/referral/application/referral-query.service';
import { canonicalizePromoCode } from '../src/referral/domain/promo-code';
import { referralFeatureDisabled } from '../src/referral/domain/referral-errors';
import { parseReferralMillilitres } from '../src/referral/domain/referral-types';
import { ReferralController } from '../src/referral/http/referral.controller';
import { AccessTokenService } from '../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';

import { httpServer } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('referral HTTP contract', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000010';
    const promoCode = canonicalizePromoCode('3A7K9MN2QTVW');
    const appliedAt = new Date('2026-08-10T10:00:00.000Z');
    let app: INestApplication;
    const queries = { getMyReferral: vi.fn(), getInvitations: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.resetAllMocks();
        queries.getMyReferral.mockResolvedValue({
            promoCode,
            referralLink: `kaynann://register?promo=${promoCode}`,
            currentInviterRewardMl: 5_000n,
            deliveredInvitationCount: 0,
            deliveredInviterBonusMl: 0n,
        });
        queries.getInvitations.mockResolvedValue({ items: [], nextCursor: null });
        accessTokens.validate.mockResolvedValue({
            iss: 'kaynann-api',
            aud: 'kaynann-mobile',
            sub: userId,
            sid: sessionId,
            jti: 'jti-1',
            iat: 1,
            exp: 2,
        });
        sessions.findActive.mockResolvedValue({ id: sessionId, userId });

        const module = await Test.createTestingModule({
            controllers: [ReferralController],
            providers: [
                { provide: ReferralQueryService, useValue: queries },
                { provide: AccessTokenService, useValue: accessTokens },
                { provide: SessionsRepository, useValue: sessions },
                AccessSessionGuard,
            ],
        }).compile();
        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        app.useGlobalFilters(new RedactedExceptionFilter());
        await app.init();
    });

    afterEach(() => app.close());

    function authenticated<T extends request.Test>(pending: T): T {
        return pending.set('authorization', 'Bearer access-token');
    }

    it('does not expose post-registration promo application', async () => {
        const response = await authenticated(
            request(httpServer(app)).post('/v1/referrals/applications').send({ promoCode }),
        );

        expect(response.status).toBe(404);
        expect(response.body).not.toHaveProperty('promoCode');
        expect(queries.getMyReferral).not.toHaveBeenCalled();
        expect(queries.getInvitations).not.toHaveBeenCalled();
    });

    it('returns an inviter-only summary without eligibility or attached-code fields', async () => {
        queries.getMyReferral.mockResolvedValueOnce({
            promoCode,
            referralLink: `kaynann://register?promo=${promoCode}`,
            currentInviterRewardMl: 5_000n,
            deliveredInvitationCount: 2,
            deliveredInviterBonusMl: 10_000n,
        });

        const response = await authenticated(request(httpServer(app)).get('/v1/referrals/me'));

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({
            promoCode,
            referralLink: `kaynann://register?promo=${promoCode}`,
            currentInviterRewardMl: '5000',
            creditedInviterBonusMl: '10000',
            creditedInvitationCount: 2,
        });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(queries.getMyReferral).toHaveBeenCalledExactlyOnceWith(userId);
        expect(JSON.stringify(response.body)).not.toMatch(/eligibility|attachedPromoCode|userId|phone|business/i);
    });

    it('returns only privacy-safe credited invitation fields', async () => {
        queries.getInvitations.mockResolvedValueOnce({
            items: [
                {
                    sequence: 250n,
                    publicId: '00000000-0000-4000-8000-000000000250',
                    inviteeLabel: '**42',
                    appliedAt,
                    creditedAmountMl: parseReferralMillilitres(5_000n),
                },
            ],
            nextCursor: 'cursor-250',
        });

        const response = await authenticated(request(httpServer(app)).get('/v1/referrals/invitations?limit=20'));

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({
            items: [
                {
                    id: '00000000-0000-4000-8000-000000000250',
                    inviteeLabel: '**42',
                    appliedAt: appliedAt.toISOString(),
                    creditedAmountMl: '5000',
                },
            ],
            nextCursor: 'cursor-250',
            hasMore: true,
        });
        expect(queries.getInvitations).toHaveBeenCalledExactlyOnceWith(userId, 20, null);
        expect(JSON.stringify(response.body)).not.toMatch(/sequence|phone|userId|businessEvent/i);
    });

    it.each(['/v1/referrals/me', '/v1/referrals/invitations'])(
        'requires an active session for GET %s',
        async (path) => {
            const response = await request(httpServer(app)).get(path);

            expect(response.status).toBe(401);
        },
    );

    it.each([
        ['/v1/referrals/me', 'getMyReferral'],
        ['/v1/referrals/invitations', 'getInvitations'],
    ] as const)('returns the identical safe disabled envelope for GET %s', async (path, method) => {
        queries[method].mockRejectedValueOnce(referralFeatureDisabled());
        const response = await authenticated(request(httpServer(app)).get(path));
        const body = response.body as unknown as {
            error: { code: string; message: string; retryable: boolean; requestId: string };
        };

        expect(response.status).toBe(503);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(body.error).toMatchObject({
            code: 'FEATURE_DISABLED',
            message: 'Referral program is disabled.',
            retryable: false,
        });
        expect(body.error.requestId).toEqual(expect.any(String));
        expect(JSON.stringify(response.body)).not.toMatch(/promoCode|referralLink|invitation|bonus/i);
    });
});
