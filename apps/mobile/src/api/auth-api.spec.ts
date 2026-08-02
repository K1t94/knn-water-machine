import { Observable, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FetchAuthApi } from './auth-api';

describe('FetchAuthApi', () => {
    it('calls the browser fetch with the global receiver', async () => {
        const originalFetch = globalThis.fetch;
        const receiverAwareFetch = vi.fn(function (this: typeof globalThis): Promise<Response> {
            if (this !== globalThis) {
                throw new TypeError('Illegal invocation');
            }
            return Promise.resolve({
                ok: true,
                status: 202,
                json: async () => ({}),
            } as Response);
        }) as unknown as typeof fetch;
        globalThis.fetch = receiverAwareFetch;

        try {
            const api = new FetchAuthApi('https://api.example.test', 'installation-0001');

            await firstValueFrom(api.requestOtp({ phone: '+221771234567' }));

            expect(receiverAwareFetch).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('keeps challengeId in verification and removes it from resend body', async () => {
        const fetcher = vi.fn(async () => ({
            ok: true,
            json: async () => ({}),
        })) as unknown as typeof fetch;
        const api = new FetchAuthApi('https://api.example.test', 'installation-0001', 1_000, fetcher);

        const verification$ = api.verifyOtp({
            challengeId: '00000000-0000-4000-8000-000000000001',
            phone: '+221771234567',
            code: '123456',
        });
        expect(verification$).toBeInstanceOf(Observable);
        await firstValueFrom(verification$);
        await firstValueFrom(
            api.resendOtp({
                challengeId: '00000000-0000-4000-8000-000000000001',
                phone: '+221771234567',
            }),
        );

        expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))).toMatchObject({
            challengeId: '00000000-0000-4000-8000-000000000001',
            installationId: 'installation-0001',
        });
        expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[1]?.[1]?.body))).not.toHaveProperty('challengeId');
    });

    it('is cold and aborts the native request when unsubscribed', () => {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn((_url, init) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const api = new FetchAuthApi('https://api.example.test', 'installation-0001', 1_000, fetcher);
        const request$ = api.requestOtp({ phone: '+221771234567' });

        expect(fetcher).not.toHaveBeenCalled();
        const subscription = request$.subscribe();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(false);

        subscription.unsubscribe();
        expect(signal?.aborted).toBe(true);
    });
});
