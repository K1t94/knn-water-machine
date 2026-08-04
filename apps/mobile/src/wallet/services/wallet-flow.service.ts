import { reaction } from 'mobx';
import { forkJoin } from 'rxjs';

import { WalletApiError } from '../../api/wallet-api';

import type { WalletApi, WalletBalance, WalletHistoryPage } from '../../api/wallet-api';
import type { SessionStore } from '../../auth/stores/session.store';
import type { WalletStore } from '../stores/wallet.store';
import type { Observable, Subscription } from 'rxjs';

export interface AuthenticatedRequestScope {
    withAccess<T>(request: (accessToken: string) => Observable<T>): Observable<T>;
}

export interface WalletCommands {
    retry(): void;
    refresh(): void;
    loadNextPage(): void;
}

export class WalletFlowService implements WalletCommands {
    private sessionEpoch = 0;
    private loadSubscription: Subscription | undefined;
    private pageSubscription: Subscription | undefined;
    private readonly disposeSessionReaction: () => void;
    private disposed = false;

    constructor(
        private readonly store: WalletStore,
        private readonly api: WalletApi,
        sessionStore: SessionStore,
        private readonly access: AuthenticatedRequestScope,
    ) {
        this.disposeSessionReaction = reaction(
            () => `${sessionStore.state}:${sessionStore.accessToken ?? ''}`,
            () => {
                this.sessionEpoch += 1;
                this.cancelRequests();
                this.store.clear();
                if (sessionStore.state === 'authenticated' && sessionStore.accessToken) {
                    this.loadFirstPage('initial');
                }
            },
            { fireImmediately: true },
        );
    }

    retry(): void {
        if (this.disposed) return;
        this.loadFirstPage(this.store.balance ? 'refresh' : 'initial');
    }

    refresh(): void {
        if (this.disposed) return;
        this.loadFirstPage(this.store.balance ? 'refresh' : 'initial');
    }

    loadNextPage(): void {
        if (this.disposed || this.pageSubscription) return;
        const cursor = this.store.nextCursor;
        const token = this.store.beginNextPage();
        if (!token || !cursor) return;
        const epoch = this.sessionEpoch;

        const subscription = this.access
            .withAccess((accessToken) => this.api.getHistory(accessToken, { cursor, limit: 20 }))
            .subscribe({
                next: (page) => {
                    if (epoch === this.sessionEpoch) this.store.finishNextPage(token, page);
                },
                error: (error: unknown) => {
                    if (epoch === this.sessionEpoch) this.store.failNextPage(token, toPresentationError(error));
                    this.pageSubscription = undefined;
                },
                complete: () => {
                    this.pageSubscription = undefined;
                },
            });
        this.pageSubscription = subscription.closed ? undefined : subscription;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.sessionEpoch += 1;
        this.disposeSessionReaction();
        this.cancelRequests();
        this.store.clear();
    }

    private loadFirstPage(mode: 'initial' | 'refresh'): void {
        this.loadSubscription?.unsubscribe();
        this.loadSubscription = undefined;
        this.pageSubscription?.unsubscribe();
        this.pageSubscription = undefined;

        const token = mode === 'initial' ? this.store.beginInitialLoad() : this.store.beginRefresh();
        const epoch = this.sessionEpoch;
        const subscription = this.access
            .withAccess((accessToken) =>
                forkJoin({
                    balance: this.api.getBalance(accessToken),
                    page: this.api.getHistory(accessToken, { limit: 20 }),
                }),
            )
            .subscribe({
                next: ({ balance, page }) => {
                    if (epoch !== this.sessionEpoch) return;
                    this.finishFirstPage(mode, token, balance, page);
                },
                error: (error: unknown) => {
                    if (epoch === this.sessionEpoch) {
                        const mapped = toPresentationError(error);
                        if (mode === 'initial') this.store.failInitialLoad(token, mapped);
                        else this.store.failRefresh(token, mapped);
                    }
                    this.loadSubscription = undefined;
                },
                complete: () => {
                    this.loadSubscription = undefined;
                },
            });
        this.loadSubscription = subscription.closed ? undefined : subscription;
    }

    private finishFirstPage(
        mode: 'initial' | 'refresh',
        token: number,
        balance: WalletBalance,
        page: WalletHistoryPage,
    ): void {
        if (mode === 'initial') this.store.finishInitialLoad(token, balance, page);
        else this.store.finishRefresh(token, balance, page);
    }

    private cancelRequests(): void {
        this.loadSubscription?.unsubscribe();
        this.loadSubscription = undefined;
        this.pageSubscription?.unsubscribe();
        this.pageSubscription = undefined;
    }
}

function toPresentationError(error: unknown): { code: string; retryable: boolean } {
    if (error instanceof WalletApiError) return { code: error.code, retryable: error.retryable };
    return { code: 'WALLET_TEMPORARILY_UNAVAILABLE', retryable: true };
}
