import { Observable, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FetchWalletApi, WalletApiError } from './wallet-api';

describe('FetchWalletApi', () => {
    it('keeps balance requests cold and sends the access token on subscription', async () => {
        const fetcher = vi.fn(async () =>
            response({
                balanceMl: '9007199254740993',
                balanceLiters: '9007199254740.993',
                observedAt: '2026-08-06T10:00:00.000Z',
            }),
        ) as unknown as typeof fetch;
        const api = new FetchWalletApi('https://api.example.test', 1_000, fetcher);

        const request$ = api.getBalance('access-token');

        expect(request$).toBeInstanceOf(Observable);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(firstValueFrom(request$)).resolves.toEqual({
            balanceMl: '9007199254740993',
            balanceLiters: '9007199254740.993',
            observedAt: '2026-08-06T10:00:00.000Z',
        });
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example.test/v1/wallet/balance',
            expect.objectContaining({ headers: { accept: 'application/json', authorization: 'Bearer access-token' } }),
        );
    });

    it('maps an exact history page without coercing millilitres to number', async () => {
        const payload = {
            items: [operation('9007199254740993')],
            nextCursor: 'opaque-cursor',
            hasMore: true,
        };
        const fetcher = vi.fn(async () => response(payload)) as unknown as typeof fetch;
        const api = new FetchWalletApi('https://api.example.test', 1_000, fetcher);
        const request$ = api.getHistory('access-token', { limit: 20, cursor: 'opaque-cursor' });

        expect(fetcher).not.toHaveBeenCalled();
        await expect(firstValueFrom(request$)).resolves.toEqual(payload);
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example.test/v1/wallet/operations?limit=20&cursor=opaque-cursor',
            expect.any(Object),
        );
    });

    it('rejects malformed successful responses instead of publishing partial data', async () => {
        const fetcher = vi.fn(async () =>
            response({ balanceMl: 1250, balanceLiters: '1.250', observedAt: 'invalid' }),
        ) as unknown as typeof fetch;
        const api = new FetchWalletApi('https://api.example.test', 1_000, fetcher);

        await expect(firstValueFrom(api.getBalance('access-token'))).rejects.toMatchObject({
            code: 'INVALID_RESPONSE',
            retryable: true,
        });
    });

    it('maps stable server errors and aborts an in-flight request on unsubscribe', async () => {
        const errorFetcher = vi.fn(async () =>
            response({ error: { code: 'WALLET_CURSOR_INVALID', retryable: false } }, 400),
        ) as unknown as typeof fetch;
        const errorApi = new FetchWalletApi('https://api.example.test', 1_000, errorFetcher);
        await expect(firstValueFrom(errorApi.getHistory('token', { cursor: 'bad' }))).rejects.toEqual(
            new WalletApiError('WALLET_CURSOR_INVALID', false),
        );

        let signal: AbortSignal | undefined;
        const pendingFetcher = vi.fn((...[, init]: Parameters<typeof fetch>) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const pendingApi = new FetchWalletApi('https://api.example.test', 1_000, pendingFetcher);
        const request$ = pendingApi.getBalance('token');

        expect(pendingFetcher).not.toHaveBeenCalled();
        const subscription = request$.subscribe();
        expect(signal?.aborted).toBe(false);
        subscription.unsubscribe();
        expect(signal?.aborted).toBe(true);
    });
});

function operation(amountMl: string) {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        direction: 'CREDIT' as const,
        amountMl,
        operationKind: 'PACKAGE_CREDIT',
        source: 'TEST_FIXTURE',
        occurredAt: '2026-08-06T09:00:00.000Z',
        recordedAt: '2026-08-06T09:00:01.000Z',
    };
}

function response(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}
