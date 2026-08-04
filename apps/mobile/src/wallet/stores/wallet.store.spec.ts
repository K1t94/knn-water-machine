import { configure, isAction, isObservableProp } from 'mobx';
import { beforeAll, describe, expect, it } from 'vitest';

import { WalletStore } from './wallet.store';

import type { WalletBalance, WalletHistoryPage } from '../../api/wallet-api';

describe('WalletStore', () => {
    beforeAll(() => configure({ enforceActions: 'always' }));

    it('owns observable initial, loading, empty, loaded, and retryable error states', () => {
        const store = new WalletStore();
        expect(isObservableProp(store, 'balance')).toBe(true);
        expect(store.viewState).toBe('initial');

        const token = store.beginInitialLoad();
        expect(store.viewState).toBe('loading');
        store.finishInitialLoad(token, zeroBalance(), emptyPage());
        expect(store.viewState).toBe('empty');

        store.clear();
        const retryToken = store.beginInitialLoad();
        store.failInitialLoad(retryToken, { code: 'OFFLINE', retryable: true });
        expect(store.viewState).toBe('error');
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });

        const loadedToken = store.beginInitialLoad();
        store.finishInitialLoad(loadedToken, balance('1250'), page([entry('one', '1000')]));
        expect(store.viewState).toBe('loaded');
    });

    it('preserves existing data during refresh and replaces it on completion', () => {
        const store = loadedStore();
        const token = store.beginRefresh();

        expect(store.refreshing).toBe(true);
        expect(store.operations.map(({ id }) => id)).toEqual(['one']);

        store.finishRefresh(token, balance('2000'), page([entry('two', '750')]));
        expect(store.refreshing).toBe(false);
        expect(store.balance?.balanceMl).toBe('2000');
        expect(store.operations.map(({ id }) => id)).toEqual(['two']);
    });

    it('appends pages once, deduplicates entries, and ignores stale request tokens', () => {
        const store = loadedStore(true);
        const pageToken = store.beginNextPage();
        expect(pageToken).toBeDefined();
        expect(store.beginNextPage()).toBeUndefined();

        store.finishNextPage(pageToken!, page([entry('one', '1000'), entry('two', '500')], null, false));
        expect(store.operations.map(({ id }) => id)).toEqual(['one', 'two']);

        const staleToken = store.beginRefresh();
        store.clear();
        store.finishRefresh(staleToken, balance('9999'), page([entry('stale', '9999')]));
        expect(store.balance).toBeUndefined();
        expect(store.operations).toEqual([]);
        expect(store.viewState).toBe('initial');
    });

    it('exposes every state transition as a MobX action', () => {
        const store = new WalletStore();
        expect(isAction(store.beginInitialLoad)).toBe(true);
        expect(isAction(store.finishInitialLoad)).toBe(true);
        expect(isAction(store.beginRefresh)).toBe(true);
        expect(isAction(store.finishRefresh)).toBe(true);
        expect(isAction(store.beginNextPage)).toBe(true);
        expect(isAction(store.finishNextPage)).toBe(true);
        expect(isAction(store.clear)).toBe(true);
    });
});

function loadedStore(hasMore = false): WalletStore {
    const store = new WalletStore();
    const token = store.beginInitialLoad();
    store.finishInitialLoad(token, balance('1000'), page([entry('one', '1000')], hasMore ? 'next' : null, hasMore));
    return store;
}

function zeroBalance(): WalletBalance {
    return balance('0');
}

function balance(balanceMl: string): WalletBalance {
    return { balanceMl, balanceLiters: `${balanceMl}.000`, observedAt: '2026-08-06T10:00:00.000Z' };
}

function emptyPage(): WalletHistoryPage {
    return page([]);
}

function page(items: WalletHistoryPage['items'], nextCursor: string | null = null, hasMore = false): WalletHistoryPage {
    return { items, nextCursor, hasMore };
}

function entry(id: string, amountMl: string): WalletHistoryPage['items'][number] {
    return {
        id,
        direction: 'CREDIT',
        amountMl,
        operationKind: 'PACKAGE_CREDIT',
        source: 'TEST_FIXTURE',
        occurredAt: '2026-08-06T09:00:00.000Z',
        recordedAt: '2026-08-06T09:00:01.000Z',
    };
}
