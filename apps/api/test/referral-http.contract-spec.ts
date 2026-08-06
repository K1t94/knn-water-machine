import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { ReferralApplicationService } from '../src/referral/application/referral-application.service';
import { ReferralQueryService } from '../src/referral/application/referral-query.service';
import { canonicalizePromoCode } from '../src/referral/domain/promo-code';
import { ReferralError } from '../src/referral/domain/referral-errors';
import { parseReferralMillilitres } from '../src/referral/domain/referral-types';
import { ReferralController } from '../src/referral/http/referral.controller';
import { AccessTokenService } from '../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';

import { httpServer, requiredArray, requiredRecord, requiredString, responseRecord } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('referral HTTP contract', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const anotherUserId = '00000000-0000-4000-8000-000000000099';
    const sessionId = '00000000-0000-4000-8000-000000000010';
    const promoCode = canonicalizePromoCode('3A7K9MN2QTVW');
    const appliedAt = new Date('2026-08-10T10:00:00.000Z');
    let app: INestApplication;
    const applications = { apply: vi.fn() };
    const queries = { getMyReferral: vi.fn(), getInvitations: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.resetAllMocks();
        applications.apply.mockResolvedValue({ status: 'ATTACHED', promoCode, appliedAt });
        queries.getMyReferral.mockResolvedValue({
            promoCode,
            referralLink: `kaynann://register?promo=${promoCode}`,
            applicationStatus: 'OPEN',
            attachedPromoCode: null,
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
                { provide: ReferralApplicationService, useValue: applications },
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

    describe('applications', () => {
        it('uses session identity and returns canonical first-apply state without requiring an idempotency key', async () => {
            const response = await authenticated(
                request(httpServer(app)).post('/v1/referrals/applications').send({
                    promoCode: ' 3a7k9mn2qtvw ',
                    userId: anotherUserId,
                }),
            );

            expect(response.status, JSON.stringify(response.body)).toBe(400);
            expect(applications.apply).not.toHaveBeenCalled();

            const success = await authenticated(
                request(httpServer(app)).post('/v1/referrals/applications').send({ promoCode: ' 3a7k9mn2qtvw ' }),
            );
            expect(success.status, JSON.stringify(success.body)).toBe(200);
            expect(success.body).toEqual({ status: 'ATTACHED', promoCode, appliedAt: appliedAt.toISOString() });
            expect(success.headers['cache-control']).toBe('no-store');
            expect(applications.apply).toHaveBeenCalledExactlyOnceWith({
                inviteeUserId: userId,
                promoCode: ' 3a7k9mn2qtvw ',
            });
        });

        it('returns the same persisted appliedAt for same-code replay with a distinct public status', async () => {
            applications.apply
                .mockResolvedValueOnce({ status: 'ATTACHED', promoCode, appliedAt })
                .mockResolvedValueOnce({ status: 'ALREADY_ATTACHED', promoCode, appliedAt });

            const first = await authenticated(
                request(httpServer(app)).post('/v1/referrals/applications').send({ promoCode }),
            );
            const replay = await authenticated(
                request(httpServer(app)).post('/v1/referrals/applications').send({ promoCode }),
            );

            const firstBody = responseRecord(first);
            const replayBody = responseRecord(replay);
            expect([requiredString(firstBody, 'status'), requiredString(replayBody, 'status')]).toEqual([
                'ATTACHED',
                'ALREADY_ATTACHED',
            ]);
            expect(requiredString(firstBody, 'appliedAt')).toBe(requiredString(replayBody, 'appliedAt'));
        });

        it.each([
            ['invalid', new ReferralError('REFERRAL_CODE_UNAVAILABLE', 'invalid shape')],
            ['unknown', new ReferralError('REFERRAL_CODE_UNAVAILABLE', 'unknown owner')],
            ['suspended owner', new ReferralError('REFERRAL_CODE_UNAVAILABLE', 'owner inactive')],
        ])('maps %s codes to the same safe unavailable response', async (_case, error) => {
            applications.apply.mockRejectedValueOnce(error);

            const response = await authenticated(
                request(httpServer(app))
                    .post('/v1/referrals/applications')
                    .set('x-request-id', 'referral-code-request')
                    .send({ promoCode }),
            );

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                error: {
                    code: 'REFERRAL_CODE_UNAVAILABLE',
                    message: 'Referral code is unavailable.',
                    retryable: false,
                    requestId: 'referral-code-request',
                },
            });
        });

        it.each([
            ['REFERRAL_SELF_NOT_ALLOWED', 409],
            ['REFERRAL_ALREADY_ATTACHED', 409],
            ['REFERRAL_ELIGIBILITY_CLOSED', 409],
        ] as const)('maps %s to a stable conflict', async (code, status) => {
            applications.apply.mockRejectedValueOnce(new ReferralError(code, 'private repository details'));

            const response = await authenticated(
                request(httpServer(app)).post('/v1/referrals/applications').send({ promoCode }),
            );

            expect(response.status).toBe(status);
            expect(requiredRecord(responseRecord(response), 'error').code).toBe(code);
            expect(JSON.stringify(response.body)).not.toContain('private repository details');
        });

        it('redacts unexpected dependency failures as retryable service unavailability', async () => {
            applications.apply.mockRejectedValueOnce(
                new Error('P2024 at ReferralBonusEntitlement walletBusinessEventKey'),
            );

            const response = await authenticated(
                request(httpServer(app))
                    .post('/v1/referrals/applications')
                    .set('x-request-id', 'dependency-request')
                    .send({ promoCode }),
            );

            expect(response.status).toBe(503);
            expect(response.body).toEqual({
                error: {
                    code: 'REFERRAL_SERVICE_UNAVAILABLE',
                    message: 'Referral service is temporarily unavailable.',
                    retryable: true,
                    requestId: 'dependency-request',
                },
            });
            expect(response.headers['cache-control']).toBe('no-store');
            expect(JSON.stringify(response.body)).not.toMatch(/P2024|Entitlement|businessEventKey|stack/i);
        });
    });

    describe('referrals/me', () => {
        it('returns stable owner-scoped summary with exact millilitre strings and no private fields', async () => {
            queries.getMyReferral.mockResolvedValueOnce({
                promoCode,
                referralLink: `kaynann://register?promo=${promoCode}`,
                applicationStatus: 'ATTACHED',
                attachedPromoCode: canonicalizePromoCode('4A7K9MN2QTVW'),
                currentInviterRewardMl: 5_000n,
                deliveredInvitationCount: 2,
                deliveredInviterBonusMl: 10_000n,
                inviteePhone: '+221771234567',
                walletBusinessEventKey: 'private-key',
            });

            const response = await authenticated(request(httpServer(app)).get('/v1/referrals/me'));

            expect(response.status, JSON.stringify(response.body)).toBe(200);
            expect(response.body).toEqual({
                promoCode,
                referralLink: `kaynann://register?promo=${promoCode}`,
                eligibility: 'ATTACHED',
                attachedPromoCode: '4A7K9MN2QTVW',
                currentInviterRewardMl: '5000',
                creditedInviterBonusMl: '10000',
                creditedInvitationCount: 2,
            });
            expect(response.headers['cache-control']).toBe('no-store');
            expect(queries.getMyReferral).toHaveBeenCalledExactlyOnceWith(userId);
            expect(JSON.stringify(response.body)).not.toMatch(/userId|phone|entitlement|business|delivery|lease/i);
        });

        it('rejects unauthenticated reads before lazy provisioning is reached', async () => {
            const response = await request(httpServer(app)).get('/v1/referrals/me');

            expect(response.status).toBe(401);
            expect(queries.getMyReferral).not.toHaveBeenCalled();
        });
    });

    describe('invitations and cursor history', () => {
        it('uses default 20 and returns only stable public credited invitation fields', async () => {
            queries.getInvitations.mockResolvedValueOnce({
                items: [
                    {
                        sequence: 250n,
                        publicId: '00000000-0000-4000-8000-000000000250',
                        inviteeLabel: '**42',
                        appliedAt,
                        creditedAmountMl: parseReferralMillilitres(5_000n),
                        status: 'CREDITED',
                        inviteeUserId: anotherUserId,
                        entitlementId: 'private-entitlement',
                    },
                ],
                nextCursor: 'opaque-next' as never,
            });

            const response = await authenticated(request(httpServer(app)).get('/v1/referrals/invitations'));
            const items = requiredArray(responseRecord(response), 'items');

            expect(response.status, JSON.stringify(response.body)).toBe(200);
            expect(items).toEqual([
                {
                    id: '00000000-0000-4000-8000-000000000250',
                    inviteeLabel: '**42',
                    appliedAt: appliedAt.toISOString(),
                    creditedAmountMl: '5000',
                    status: 'CREDITED',
                },
            ]);
            expect(response.body).toEqual(expect.objectContaining({ nextCursor: 'opaque-next', hasMore: true }));
            expect(response.headers['cache-control']).toBe('no-store');
            expect(queries.getInvitations).toHaveBeenCalledExactlyOnceWith(userId, 20, null);
            expect(JSON.stringify(response.body)).not.toMatch(/sequence|userId|entitlement|phoneE164|business|lease/i);
        });

        it('accepts maximum page size and forwards only the opaque cursor for the current owner', async () => {
            const response = await authenticated(
                request(httpServer(app))
                    .get('/v1/referrals/invitations')
                    .query({ limit: 100, cursor: 'opaque-cursor', userId: anotherUserId }),
            );

            expect(response.status).toBe(400);
            expect(queries.getInvitations).not.toHaveBeenCalled();

            const success = await authenticated(
                request(httpServer(app))
                    .get('/v1/referrals/invitations')
                    .query({ limit: 100, cursor: 'opaque-cursor' }),
            );
            expect(success.status).toBe(200);
            expect(queries.getInvitations).toHaveBeenCalledExactlyOnceWith(userId, 100, 'opaque-cursor');
        });

        it('maps malformed cursors and invalid limits to the same stable non-retryable error', async () => {
            queries.getInvitations.mockRejectedValueOnce(
                new ReferralError('REFERRAL_CURSOR_INVALID', 'base64 parser internals'),
            );
            const malformed = await authenticated(
                request(httpServer(app)).get('/v1/referrals/invitations').query({ cursor: 'malformed' }),
            );
            const invalidLimit = await authenticated(
                request(httpServer(app)).get('/v1/referrals/invitations').query({ limit: 101 }),
            );

            for (const response of [malformed, invalidLimit]) {
                expect(response.status).toBe(400);
                expect(requiredRecord(responseRecord(response), 'error')).toEqual(
                    expect.objectContaining({
                        code: 'REFERRAL_CURSOR_INVALID',
                        message: 'The referral history cursor or limit is invalid.',
                        retryable: false,
                    }),
                );
            }
        });
    });
});
