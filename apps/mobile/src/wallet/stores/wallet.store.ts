import { action, computed, makeObservable, observable } from 'mobx';

import type { WalletBalance, WalletHistoryPage, WalletOperation } from '../../api/wallet-api';

export interface WalletPresentationError {
    code: string;
    retryable: boolean;
}

export type WalletViewState = 'initial' | 'loading' | 'empty' | 'loaded' | 'error';

export class WalletStore {
    balance: WalletBalance | undefined = undefined;
    operations: WalletOperation[] = [];
    nextCursor: string | null = null;
    hasMore = false;
    initialLoading = false;
    refreshing = false;
    loadingNextPage = false;
    error: WalletPresentationError | undefined = undefined;

    private generation = 0;
    private initialToken: number | undefined;
    private refreshToken: number | undefined;
    private nextPageToken: number | undefined;

    constructor() {
        makeObservable(this, {
            balance: observable.ref,
            operations: observable.shallow,
            nextCursor: observable,
            hasMore: observable,
            initialLoading: observable,
            refreshing: observable,
            loadingNextPage: observable,
            error: observable.ref,
            viewState: computed,
            beginInitialLoad: action.bound,
            finishInitialLoad: action.bound,
            failInitialLoad: action.bound,
            beginRefresh: action.bound,
            finishRefresh: action.bound,
            failRefresh: action.bound,
            beginNextPage: action.bound,
            finishNextPage: action.bound,
            failNextPage: action.bound,
            clear: action.bound,
        });
    }

    get viewState(): WalletViewState {
        if (this.initialLoading && !this.balance) return 'loading';
        if (!this.balance && this.error) return 'error';
        if (!this.balance) return 'initial';
        return this.operations.length === 0 ? 'empty' : 'loaded';
    }

    beginInitialLoad(): number {
        const token = this.nextToken();
        this.initialToken = token;
        this.initialLoading = true;
        this.refreshing = false;
        this.loadingNextPage = false;
        this.refreshToken = undefined;
        this.nextPageToken = undefined;
        this.error = undefined;
        return token;
    }

    finishInitialLoad(token: number, balance: WalletBalance, page: WalletHistoryPage): void {
        if (token !== this.initialToken) return;
        this.initialToken = undefined;
        this.initialLoading = false;
        this.replaceData(balance, page);
    }

    failInitialLoad(token: number, error: WalletPresentationError): void {
        if (token !== this.initialToken) return;
        this.initialToken = undefined;
        this.initialLoading = false;
        this.error = error;
    }

    beginRefresh(): number {
        const token = this.nextToken();
        this.refreshToken = token;
        this.refreshing = true;
        this.initialLoading = false;
        this.loadingNextPage = false;
        this.initialToken = undefined;
        this.nextPageToken = undefined;
        this.error = undefined;
        return token;
    }

    finishRefresh(token: number, balance: WalletBalance, page: WalletHistoryPage): void {
        if (token !== this.refreshToken) return;
        this.refreshToken = undefined;
        this.refreshing = false;
        this.replaceData(balance, page);
    }

    failRefresh(token: number, error: WalletPresentationError): void {
        if (token !== this.refreshToken) return;
        this.refreshToken = undefined;
        this.refreshing = false;
        this.error = error;
    }

    beginNextPage(): number | undefined {
        if (!this.hasMore || !this.nextCursor || this.loadingNextPage || this.initialLoading || this.refreshing) {
            return undefined;
        }
        const token = this.nextToken();
        this.nextPageToken = token;
        this.loadingNextPage = true;
        this.error = undefined;
        return token;
    }

    finishNextPage(token: number, page: WalletHistoryPage): void {
        if (token !== this.nextPageToken) return;
        this.nextPageToken = undefined;
        this.loadingNextPage = false;
        const seen = new Set(this.operations.map(({ id }) => id));
        this.operations = [...this.operations, ...page.items.filter(({ id }) => !seen.has(id))];
        this.nextCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.error = undefined;
    }

    failNextPage(token: number, error: WalletPresentationError): void {
        if (token !== this.nextPageToken) return;
        this.nextPageToken = undefined;
        this.loadingNextPage = false;
        this.error = error;
    }

    clear(): void {
        this.generation += 1;
        this.initialToken = undefined;
        this.refreshToken = undefined;
        this.nextPageToken = undefined;
        this.balance = undefined;
        this.operations = [];
        this.nextCursor = null;
        this.hasMore = false;
        this.initialLoading = false;
        this.refreshing = false;
        this.loadingNextPage = false;
        this.error = undefined;
    }

    private nextToken(): number {
        this.generation += 1;
        return this.generation;
    }

    private replaceData(balance: WalletBalance, page: WalletHistoryPage): void {
        this.balance = balance;
        this.operations = [...page.items];
        this.nextCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.error = undefined;
    }
}
