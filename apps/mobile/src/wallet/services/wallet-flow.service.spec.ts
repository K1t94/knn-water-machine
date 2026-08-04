import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { WalletApiError, type WalletApi, type WalletBalance, type WalletHistoryPage } from '../../api/wallet-api';
import { SessionStore } from '../../auth/stores/session.store';
import { WalletStore } from '../stores/wallet.store';
import { WalletCompositionRoot } from '../wallet-composition-root';

import { WalletFlowService } from './wallet-flow.service';

import type { AuthenticatedRequestScope } from './wallet-flow.service';
import type { SessionCredentials } from '../../api/auth-api';
import type { Observable } from 'rxjs';

describe('WalletFlowService', () => {
    it('loads after login/restoration through withAccess and supports retry and refresh', () => {
        const session = new SessionStore();
        const store = new WalletStore();
        const api = createApi();
        const access = new TestAccessScope(() => 'access-token');
        const flow = new WalletFlowService(store, api, session, access);

        session.authenticate(credentials('access-token'));
        expect(access.calls).toBe(1);
        expect(store.balance?.balanceMl).toBe('1000');
        expect(store.viewState).toBe('loaded');

        vi.mocked(api.getBalance).mockReturnValueOnce(throwError(() => new WalletApiError('OFFLINE', true)));
        flow.refresh();
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });
        expect(store.operations).toHaveLength(1);

        flow.retry();
        expect(store.error).toBeUndefined();
        flow.dispose();
    });

    it('clears and cancels in-flight work on logout and suppresses stale completion and errors', () => {
        const session = new SessionStore();
        const store = new WalletStore();
        const balanceResult = new Subject<WalletBalance>();
        const historyResult = new Subject<WalletHistoryPage>();
        const api = createApi({ getBalance: vi.fn(() => balanceResult), getHistory: vi.fn(() => historyResult) });
        const flow = new WalletFlowService(store, api, session, new TestAccessScope(() => 'old-token'));

        session.authenticate(credentials('old-token'));
        expect(balanceResult.observed).toBe(true);
        session.markAnonymous();
        expect(store.viewState).toBe('initial');
        expect(balanceResult.observed).toBe(false);

        balanceResult.next(balance('9999'));
        historyResult.error(new WalletApiError('OFFLINE', true));
        expect(store.balance).toBeUndefined();
        expect(store.error).toBeUndefined();
        flow.dispose();
    });

    it('replaces the session epoch, serializes next-page commands, and disposes all work', () => {
        const session = new SessionStore();
        const store = new WalletStore();
        const pages = new Subject<WalletHistoryPage>();
        const getHistory: WalletApi['getHistory'] = (_token, query) =>
            query?.cursor ? pages : of(page([entry('one')], 'next', true));
        const api = createApi({
            getHistory: vi.fn(getHistory),
        });
        const flow = new WalletFlowService(store, api, session, new TestAccessScope(() => session.accessToken ?? ''));

        session.authenticate(credentials('first-token'));
        flow.loadNextPage();
        flow.loadNextPage();
        expect(api.getHistory).toHaveBeenCalledTimes(2);

        session.authenticate(credentials('replacement-token'));
        expect(pages.observed).toBe(false);
        expect(store.operations.map(({ id }) => id)).toEqual(['one']);

        flow.dispose();
        session.authenticate(credentials('after-dispose'));
        expect(api.getBalance).toHaveBeenCalledTimes(2);
    });

    it('owns a session-scoped store and disposes it through WalletCompositionRoot', () => {
        const session = new SessionStore();
        const api = createApi();
        const root = new WalletCompositionRoot(api, session, new TestAccessScope(() => 'token'));

        session.authenticate(credentials('token'));
        expect(root.store.balance?.balanceMl).toBe('1000');

        root.dispose();
        expect(root.store.viewState).toBe('initial');
        session.authenticate(credentials('replacement'));
        expect(api.getBalance).toHaveBeenCalledOnce();
    });

    it('allows another page after a synchronously completed page request', () => {
        const session = new SessionStore();
        const store = new WalletStore();
        const getHistory: WalletApi['getHistory'] = (_token, query) =>
            of(page([entry(query?.cursor ?? 'one')], query?.cursor === 'next' ? 'last' : 'next', true));
        const api = createApi({ getHistory: vi.fn(getHistory) });
        const flow = new WalletFlowService(store, api, session, new TestAccessScope(() => 'token'));

        session.authenticate(credentials('token'));
        flow.loadNextPage();
        flow.loadNextPage();

        expect(api.getHistory).toHaveBeenCalledTimes(3);
        flow.dispose();
    });
});

class TestAccessScope implements AuthenticatedRequestScope {
    calls = 0;

    constructor(private readonly resolveToken: () => string) {}

    withAccess<T>(request: (accessToken: string) => Observable<T>): Observable<T> {
        this.calls += 1;
        return request(this.resolveToken());
    }
}

function createApi(overrides: Partial<WalletApi> = {}): WalletApi {
    return {
        getBalance: vi.fn(() => of(balance('1000'))),
        getHistory: vi.fn(() => of(page([entry('one')]))),
        ...overrides,
    };
}

function credentials(accessToken: string): SessionCredentials {
    return {
        accessToken,
        accessExpiresAt: '2099-01-01T00:15:00.000Z',
        refreshToken: 'refresh-token',
        refreshExpiresAt: '2099-03-01T00:00:00.000Z',
    };
}

function balance(balanceMl: string): WalletBalance {
    return { balanceMl, balanceLiters: '1.000', observedAt: '2026-08-06T10:00:00.000Z' };
}

function page(items: WalletHistoryPage['items'], nextCursor: string | null = null, hasMore = false): WalletHistoryPage {
    return { items, nextCursor, hasMore };
}

function entry(id: string): WalletHistoryPage['items'][number] {
    return {
        id,
        direction: 'CREDIT',
        amountMl: '1000',
        operationKind: 'PACKAGE_CREDIT',
        source: 'TEST_FIXTURE',
        occurredAt: '2026-08-06T09:00:00.000Z',
        recordedAt: '2026-08-06T09:00:01.000Z',
    };
}
