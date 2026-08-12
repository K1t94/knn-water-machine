import { Observable, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FetchReferralApi, ReferralApiError } from './referral-api';

describe('FetchReferralApi', () => {
    it('keeps get-me cold and strictly preserves exact millilitre strings', async () => {
        const payload = summary();
        const fetcher = vi.fn(async () => response(payload)) as unknown as typeof fetch;
        const api = new FetchReferralApi('https://api.example.test', 1_000, fetcher);

        const request$ = api.getMe('access-token');

        expect(request$).toBeInstanceOf(Observable);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(firstValueFrom(request$)).resolves.toEqual(payload);
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example.test/v1/referrals/me',
            expect.objectContaining({ headers: { accept: 'application/json', authorization: 'Bearer access-token' } }),
        );
    });

    it('requests deterministic invitation pages and rejects extra response fields', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(response(page()))
            .mockResolvedValueOnce(response({ ...summary(), internalId: 'private' }));
        const api = new FetchReferralApi('https://api.example.test', 1_000, fetcher);

        await expect(firstValueFrom(api.getInvitations('token', { cursor: 'opaque', limit: 20 }))).resolves.toEqual(
            page(),
        );
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            'https://api.example.test/v1/referrals/invitations?limit=20&cursor=opaque',
            expect.any(Object),
        );
        await expect(firstValueFrom(api.getMe('token'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('maps stable errors and aborts an in-flight request on unsubscribe', async () => {
        const errorFetcher = vi.fn(async () =>
            response({ error: { code: 'FEATURE_DISABLED', retryable: false } }, 503),
        ) as unknown as typeof fetch;
        const api = new FetchReferralApi('https://api.example.test', 1_000, errorFetcher);

        await expect(firstValueFrom(api.getMe('token'))).rejects.toEqual(
            new ReferralApiError('FEATURE_DISABLED', false),
        );

        let signal: AbortSignal | undefined;
        const pendingFetcher = vi.fn((...[, init]: Parameters<typeof fetch>) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const pendingApi = new FetchReferralApi('https://api.example.test', 1_000, pendingFetcher);
        const request$ = pendingApi.getMe('token');

        expect(pendingFetcher).not.toHaveBeenCalled();
        const subscription = request$.subscribe();
        expect(signal?.aborted).toBe(false);
        subscription.unsubscribe();
        expect(signal?.aborted).toBe(true);
    });
});

function summary() {
    return {
        promoCode: '23456789ABCD',
        referralLink: 'kaynann://register?promo=23456789ABCD',
        currentInviterRewardMl: '5000',
        creditedInviterBonusMl: '9007199254740993',
        creditedInvitationCount: 2,
    };
}

function page() {
    return {
        items: [
            {
                id: '00000000-0000-4000-8000-000000000001',
                inviteeLabel: '**42',
                appliedAt: '2026-08-10T09:00:00.000Z',
                status: 'CREDITED' as const,
                creditedAmountMl: '5000',
            },
        ],
        nextCursor: 'next-page',
        hasMore: true,
    };
}

function response(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}
