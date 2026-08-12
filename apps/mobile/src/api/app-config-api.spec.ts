import { Observable, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FetchAppConfigApi } from './app-config-api';

describe('FetchAppConfigApi', () => {
    it('is cold and strictly shapes the privacy-safe response', async () => {
        const fetcher = vi.fn(async () => response({ features: { referralProgramEnabled: true } })) as unknown as typeof fetch;
        const api = new FetchAppConfigApi('https://api.example.test', 1_000, fetcher);

        const request$ = api.getConfig();
        expect(request$).toBeInstanceOf(Observable);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(firstValueFrom(request$)).resolves.toEqual({ features: { referralProgramEnabled: true } });
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example.test/v1/app-config',
            expect.objectContaining({ headers: { accept: 'application/json' }, method: 'GET' }),
        );
    });

    it.each([
        { features: { referralProgramEnabled: true }, operatorToken: 'secret' },
        { features: { referralProgramEnabled: true, updatedBy: 'operator' } },
        { features: { referralProgramEnabled: 'true' } },
    ])('rejects extra, private, and malformed fields', async (payload) => {
        const fetcher = vi.fn(async () => response(payload)) as unknown as typeof fetch;
        const api = new FetchAppConfigApi('https://api.example.test', 1_000, fetcher);
        await expect(firstValueFrom(api.getConfig())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('aborts the request on teardown', () => {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn((...[, init]: Parameters<typeof fetch>) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const subscription = new FetchAppConfigApi('https://api.example.test', 1_000, fetcher)
            .getConfig()
            .subscribe();

        expect(signal?.aborted).toBe(false);
        subscription.unsubscribe();
        expect(signal?.aborted).toBe(true);
    });
});

function response(payload: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}
