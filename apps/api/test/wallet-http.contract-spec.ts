import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedactedExceptionFilter } from '../src/common/redacted-exception.filter';
import { AccessTokenService } from '../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';
import { WalletQueryService } from '../src/wallet/application/wallet-query.service';
import { WalletError } from '../src/wallet/domain/wallet-errors';
import { parseWalletBalance } from '../src/wallet/domain/water-amount';
import { WalletController } from '../src/wallet/http/wallet.controller';

import { httpServer, requiredRecord, requiredString, responseRecord } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('wallet HTTP contract', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000010';
    let app: INestApplication;
    const wallet = { getBalance: vi.fn(), getHistory: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        wallet.getBalance.mockResolvedValue(parseWalletBalance(0n));
        wallet.getHistory.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
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
            controllers: [WalletController],
            providers: [
                { provide: WalletQueryService, useValue: wallet },
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

    function getBalance() {
        return request(httpServer(app)).get('/v1/wallet/balance').set('authorization', 'Bearer access-token');
    }

    function getOperations(query?: Record<string, string | number>) {
        const pending = request(httpServer(app)).get('/v1/wallet/operations');
        if (query) pending.query(query);
        return pending.set('authorization', 'Bearer access-token');
    }

    it('returns exact zero without exposing owner or storage fields', async () => {
        const response = await getBalance();
        const body = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(body).toEqual({
            balanceMl: '0',
            balanceLiters: '0.000',
            observedAt: requiredString(body, 'observedAt'),
        });
        expect(requiredString(body, 'observedAt')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(wallet.getBalance).toHaveBeenCalledExactlyOnceWith(userId);
    });

    it('serializes values beyond Number.MAX_SAFE_INTEGER exactly', async () => {
        wallet.getBalance.mockResolvedValueOnce(parseWalletBalance(9_007_199_254_740_993n));

        const response = await getBalance();

        expect(response.status).toBe(200);
        expect(response.body).toEqual(
            expect.objectContaining({
                balanceMl: '9007199254740993',
                balanceLiters: '9007199254740.993',
            }),
        );
    });

    it('ignores caller-supplied owner identifiers', async () => {
        const response = await request(httpServer(app))
            .get('/v1/wallet/balance')
            .query({ userId: '00000000-0000-4000-8000-000000000099' })
            .set('authorization', 'Bearer access-token');

        expect(response.status).toBe(200);
        expect(wallet.getBalance).toHaveBeenCalledExactlyOnceWith(userId);
    });

    it('rejects missing, invalid, and replaced sessions before reading wallet data', async () => {
        const missing = await request(httpServer(app)).get('/v1/wallet/balance');
        accessTokens.validate.mockRejectedValueOnce(new Error('expired'));
        const expired = await getBalance();
        sessions.findActive.mockResolvedValueOnce({ id: sessionId, userId: 'another-user' });
        const replaced = await getBalance();

        expect([missing.status, expired.status, replaced.status]).toEqual([401, 401, 401]);
        expect(wallet.getBalance).not.toHaveBeenCalled();
    });

    it('maps storage failures to a stable retryable error without internal details', async () => {
        wallet.getBalance.mockRejectedValueOnce(
            new WalletError('WALLET_TEMPORARILY_UNAVAILABLE', 'P2024 pool timeout at WaterWallet_balanceMl_idx'),
        );

        const response = await getBalance().set('x-request-id', 'safe-wallet-request');
        const error = requiredRecord(responseRecord(response), 'error');

        expect(response.status, JSON.stringify(response.body)).toBe(503);
        expect(error).toEqual({
            code: 'WALLET_TEMPORARILY_UNAVAILABLE',
            message: 'Wallet data is temporarily unavailable.',
            retryable: true,
            requestId: 'safe-wallet-request',
        });
        expect(JSON.stringify(response.body)).not.toMatch(/P2024|WaterWallet|balanceMl_idx|stack/i);
    });

    it('returns an authenticated empty history with the default owner-scoped page', async () => {
        const response = await getOperations();

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({ items: [], nextCursor: null, hasMore: false });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(wallet.getHistory).toHaveBeenCalledExactlyOnceWith(userId, { limit: undefined, cursor: undefined });
    });

    it('accepts the maximum limit and returns only public operation fields', async () => {
        wallet.getHistory.mockResolvedValueOnce({
            items: [
                {
                    id: '00000000-0000-4000-8000-000000000020',
                    direction: 'CREDIT',
                    amountMl: '1250',
                    operationKind: 'TEST_OPERATION',
                    source: 'TEST_SUITE',
                    occurredAt: '2026-08-04T10:00:00.000Z',
                    recordedAt: '2026-08-04T10:00:01.000Z',
                },
            ],
            nextCursor: 'opaque-next-cursor',
            hasMore: true,
        });

        const response = await getOperations({ limit: 100, cursor: 'opaque-cursor' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(await wallet.getHistory.mock.results[0].value);
        expect(JSON.stringify(response.body)).not.toMatch(/businessEventKey|userId|sequence|balanceAfter|compensates/i);
        expect(wallet.getHistory).toHaveBeenCalledExactlyOnceWith(userId, {
            limit: 100,
            cursor: 'opaque-cursor',
        });
    });

    it('rejects invalid page limits before reading history', async () => {
        const response = await getOperations({ limit: 101 });

        expect(response.status).toBe(400);
        expect(wallet.getHistory).not.toHaveBeenCalled();
    });

    it('maps malformed cursors to a stable non-retryable public error', async () => {
        wallet.getHistory.mockRejectedValueOnce(new WalletError('WALLET_CURSOR_INVALID', 'raw cursor parser details'));

        const response = await getOperations({ cursor: 'invalid' }).set('x-request-id', 'wallet-cursor-request');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: {
                code: 'WALLET_CURSOR_INVALID',
                message: 'The wallet history cursor or limit is invalid.',
                retryable: false,
                requestId: 'wallet-cursor-request',
            },
        });
    });
});
