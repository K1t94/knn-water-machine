import { action, computed, makeObservable, observable } from 'mobx';

import type { MyReferral, ReferralInvitation, ReferralInvitationPage } from '../../api/referral-api';

export interface ReferralPresentationError {
    code: string;
    retryable: boolean;
}

export type ReferralViewState = 'initial' | 'loading' | 'empty' | 'loaded' | 'error';

export class ReferralStore {
    myReferral: MyReferral | undefined = undefined;
    invitations: ReferralInvitation[] = [];
    nextCursor: string | null = null;
    hasMore = false;
    initialLoading = false;
    refreshing = false;
    loadingNextPage = false;
    error: ReferralPresentationError | undefined = undefined;

    private generation = 0;
    private initialToken: number | undefined;
    private refreshToken: number | undefined;
    private nextPageToken: number | undefined;

    constructor() {
        makeObservable(this, {
            myReferral: observable.ref,
            invitations: observable.shallow,
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

    get viewState(): ReferralViewState {
        if (this.initialLoading && !this.myReferral) return 'loading';
        if (!this.myReferral && this.error) return 'error';
        if (!this.myReferral) return 'initial';
        return this.invitations.length === 0 ? 'empty' : 'loaded';
    }

    beginInitialLoad(): number {
        const token = this.invalidateRequests();
        this.initialToken = token;
        this.initialLoading = true;
        this.error = undefined;
        return token;
    }

    finishInitialLoad(token: number, referral: MyReferral, page: ReferralInvitationPage): void {
        if (token !== this.initialToken) return;
        this.initialToken = undefined;
        this.initialLoading = false;
        this.replaceData(referral, page);
    }

    failInitialLoad(token: number, error: ReferralPresentationError): void {
        if (token !== this.initialToken) return;
        this.initialToken = undefined;
        this.initialLoading = false;
        this.error = error;
    }

    beginRefresh(): number {
        const token = this.invalidateRequests();
        this.refreshToken = token;
        this.refreshing = true;
        this.error = undefined;
        return token;
    }

    finishRefresh(token: number, referral: MyReferral, page: ReferralInvitationPage): void {
        if (token !== this.refreshToken) return;
        this.refreshToken = undefined;
        this.refreshing = false;
        this.replaceData(referral, page);
    }

    failRefresh(token: number, error: ReferralPresentationError): void {
        if (token !== this.refreshToken) return;
        this.refreshToken = undefined;
        this.refreshing = false;
        this.error = error;
    }

    beginNextPage(): number | undefined {
        if (!this.hasMore || !this.nextCursor || this.loadingNextPage || this.initialLoading || this.refreshing) return undefined;
        const token = ++this.generation;
        this.nextPageToken = token;
        this.loadingNextPage = true;
        this.error = undefined;
        return token;
    }

    finishNextPage(token: number, page: ReferralInvitationPage): void {
        if (token !== this.nextPageToken) return;
        this.nextPageToken = undefined;
        this.loadingNextPage = false;
        const seen = new Set(this.invitations.map(({ id }) => id));
        this.invitations = [...this.invitations, ...page.items.filter(({ id }) => !seen.has(id))];
        this.nextCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.error = undefined;
    }

    failNextPage(token: number, error: ReferralPresentationError): void {
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
        this.myReferral = undefined;
        this.invitations = [];
        this.nextCursor = null;
        this.hasMore = false;
        this.initialLoading = false;
        this.refreshing = false;
        this.loadingNextPage = false;
        this.error = undefined;
    }

    private invalidateRequests(): number {
        const token = ++this.generation;
        this.initialToken = undefined;
        this.refreshToken = undefined;
        this.nextPageToken = undefined;
        this.initialLoading = false;
        this.refreshing = false;
        this.loadingNextPage = false;
        return token;
    }

    private replaceData(referral: MyReferral, page: ReferralInvitationPage): void {
        this.myReferral = referral;
        this.invitations = [...page.items];
        this.nextCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.error = undefined;
    }
}
