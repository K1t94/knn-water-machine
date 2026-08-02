import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthApiError, type SessionCredentials } from '../../api/auth-api';
import { SessionStore } from '../stores/session.store';

import { SessionFlowService, type SessionApi } from './session-flow.service';

import type { SessionStorage, StoredSessionCredential } from '../storage/session.storage';

const credentials: SessionCredentials = {
    accessToken: 'access-new',
    accessExpiresAt: '2030-01-01T00:15:00.000Z',
    refreshToken: 'refresh-new',
    refreshExpiresAt: '2030-03-02T00:00:00.000Z',
};

class MemorySessionStorage implements SessionStorage {
    value: StoredSessionCredential | undefined;
    replaceCalls = 0;
    clearCalls = 0;

    load(): Observable<StoredSessionCredential | undefined> {
        return of(this.value);
    }

    replace(value: StoredSessionCredential): Observable<void> {
        return new Observable((subscriber) => {
            this.replaceCalls += 1;
            this.value = value;
            subscriber.next();
            subscriber.complete();
        });
    }

    clear(): Observable<void> {
        return new Observable((subscriber) => {
            this.clearCalls += 1;
            this.value = undefined;
            subscriber.next();
            subscriber.complete();
        });
    }
}

describe('SessionFlowService', () => {
    it('restores by rotating the secure refresh and replacing it before store update', () => {
        const store = new SessionStore();
        const storage = validStorage();
        const api = createApi();
        const flow = new SessionFlowService(store, api, storage);

        flow.restore();

        expect(api.refreshSession).toHaveBeenCalledWith('refresh-old');
        expect(storage.value?.refreshToken).toBe('refresh-new');
        expect(storage.replaceCalls).toBe(1);
        expect(store.rootRoute).toBe('main');
        expect(store.accessToken).toBe('access-new');
        flow.dispose();
    });

    it('shares one refresh rotation across concurrent authenticated requests', async () => {
        const store = new SessionStore();
        store.markAnonymous();
        const storage = validStorage();
        const refreshResult = new Subject<SessionCredentials>();
        const api = createApi({
            refreshSession: vi.fn(() => refreshResult),
        });
        const flow = new SessionFlowService(store, api, storage);
        const request = vi.fn((accessToken: string) => of(accessToken));

        const first = firstValueFrom(flow.withAccess(request));
        const second = firstValueFrom(flow.withAccess(request));
        expect(api.refreshSession).toHaveBeenCalledTimes(1);

        refreshResult.next(credentials);
        refreshResult.complete();

        await expect(first).resolves.toBe('access-new');
        await expect(second).resolves.toBe('access-new');
        expect(storage.replaceCalls).toBe(1);
        expect(request).toHaveBeenCalledTimes(2);
        flow.dispose();
    });

    it('keeps a valid refresh on offline restoration but clears terminal failures', () => {
        const offlineStore = new SessionStore();
        const offlineStorage = validStorage();
        const offlineFlow = new SessionFlowService(
            offlineStore,
            createApi({
                refreshSession: vi.fn(() => throwError(() => new AuthApiError('OFFLINE', true))),
            }),
            offlineStorage,
        );
        offlineFlow.restore();

        expect(offlineStore.rootRoute).toBe('offline');
        expect(offlineStorage.clearCalls).toBe(0);

        const terminalStore = new SessionStore();
        const terminalStorage = validStorage();
        const terminalFlow = new SessionFlowService(
            terminalStore,
            createApi({
                refreshSession: vi.fn(() => throwError(() => new AuthApiError('REFRESH_REPLAYED', false))),
            }),
            terminalStorage,
        );
        terminalFlow.restore();

        expect(terminalStore.rootRoute).toBe('auth');
        expect(terminalStorage.clearCalls).toBe(1);
        offlineFlow.dispose();
        terminalFlow.dispose();
    });

    it('routes an absolute local expiry to OTP without calling refresh', () => {
        const store = new SessionStore();
        const storage = validStorage();
        storage.value!.refreshExpiresAt = new Date(Date.now() - 1).toISOString();
        const api = createApi();
        const flow = new SessionFlowService(store, api, storage);

        flow.restore();

        expect(api.refreshSession).not.toHaveBeenCalled();
        expect(storage.clearCalls).toBe(1);
        expect(store.rootRoute).toBe('auth');
        flow.dispose();
    });

    it('terminates root work after disposal', () => {
        const store = new SessionStore();
        const storage = validStorage();
        const refreshResult = new Subject<SessionCredentials>();
        const flow = new SessionFlowService(store, createApi({ refreshSession: vi.fn(() => refreshResult) }), storage);
        flow.restore();

        flow.dispose();
        refreshResult.next(credentials);

        expect(store.rootRoute).toBe('loading');
        expect(storage.replaceCalls).toBe(0);
    });
});

function validStorage(): MemorySessionStorage {
    const storage = new MemorySessionStorage();
    storage.value = {
        refreshToken: 'refresh-old',
        refreshExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    return storage;
}

function createApi(overrides: Partial<SessionApi> = {}): SessionApi {
    return {
        refreshSession: vi.fn(() => of(credentials)),
        logoutCurrentSession: vi.fn(() => of(undefined)),
        ...overrides,
    };
}
