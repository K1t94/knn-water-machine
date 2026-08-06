import { reaction } from 'mobx';
import { forkJoin } from 'rxjs';

import { ReferralApiError } from '../../api/referral-api';

import type { MyReferral, ReferralApi, ReferralInvitationPage } from '../../api/referral-api';
import type { SessionStore } from '../../auth/stores/session.store';
import type { ReferralApplyError, ReferralStore } from '../stores/referral.store';
import type { Observable, Subscription } from 'rxjs';

export interface AuthenticatedReferralRequestScope {
    withAccess<T>(request: (accessToken: string) => Observable<T>): Observable<T>;
}

export interface ReferralCommands {
    retry(): void;
    refresh(): void;
    loadNextPage(): void;
    applyPromoCode(value?: string): void;
}

export class ReferralFlowService implements ReferralCommands {
    private sessionEpoch = 0;
    private loadSubscription: Subscription | undefined;
    private pageSubscription: Subscription | undefined;
    private applySubscription: Subscription | undefined;
    private readonly disposeSessionReaction: () => void;
    private disposed = false;

    constructor(
        private readonly store: ReferralStore,
        private readonly api: ReferralApi,
        sessionStore: SessionStore,
        private readonly access: AuthenticatedReferralRequestScope,
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
        this.loadFirstPage(this.store.myReferral ? 'refresh' : 'initial');
    }

    refresh(): void {
        if (this.disposed) return;
        this.loadFirstPage(this.store.myReferral ? 'refresh' : 'initial');
    }

    loadNextPage(): void {
        if (this.disposed || this.pageSubscription) return;
        const cursor = this.store.nextCursor;
        const token = this.store.beginNextPage();
        if (!token || !cursor) return;
        const epoch = this.sessionEpoch;
        const subscription = this.access
            .withAccess((accessToken) => this.api.getInvitations(accessToken, { cursor, limit: 20 }))
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

    applyPromoCode(value?: string): void {
        if (this.disposed || this.applySubscription) return;
        if (value !== undefined) this.store.setApplyCode(value);
        const promoCode = this.store.applyCode;
        const token = this.store.beginApply();
        if (!token || !promoCode) return;
        const epoch = this.sessionEpoch;
        const subscription = this.access
            .withAccess((accessToken) => this.api.apply(accessToken, promoCode))
            .subscribe({
                next: (result) => {
                    if (epoch === this.sessionEpoch) this.store.finishApply(token, result);
                },
                error: (error: unknown) => {
                    if (epoch === this.sessionEpoch) this.store.failApply(token, toApplyError(error));
                    this.applySubscription = undefined;
                },
                complete: () => {
                    this.applySubscription = undefined;
                },
            });
        this.applySubscription = subscription.closed ? undefined : subscription;
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
                    referral: this.api.getMe(accessToken),
                    page: this.api.getInvitations(accessToken, { limit: 20 }),
                }),
            )
            .subscribe({
                next: ({ referral, page }) => {
                    if (epoch === this.sessionEpoch) this.finishFirstPage(mode, token, referral, page);
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
        referral: MyReferral,
        page: ReferralInvitationPage,
    ): void {
        if (mode === 'initial') this.store.finishInitialLoad(token, referral, page);
        else this.store.finishRefresh(token, referral, page);
    }

    private cancelRequests(): void {
        this.loadSubscription?.unsubscribe();
        this.loadSubscription = undefined;
        this.pageSubscription?.unsubscribe();
        this.pageSubscription = undefined;
        this.applySubscription?.unsubscribe();
        this.applySubscription = undefined;
    }
}

function toPresentationError(error: unknown): { code: string; retryable: boolean } {
    if (error instanceof ReferralApiError) return { code: error.code, retryable: error.retryable };
    return { code: 'REFERRAL_SERVICE_UNAVAILABLE', retryable: true };
}

function toApplyError(error: unknown): ReferralApplyError {
    const mapped = toPresentationError(error);
    if (mapped.code === 'REFERRAL_CODE_UNAVAILABLE') return { ...mapped, kind: 'validation' };
    if (mapped.code === 'REFERRAL_ELIGIBILITY_CLOSED') return { ...mapped, kind: 'closed' };
    if (mapped.code === 'REFERRAL_SELF_NOT_ALLOWED' || mapped.code === 'REFERRAL_ALREADY_ATTACHED') {
        return { ...mapped, kind: 'conflict' };
    }
    return { ...mapped, kind: 'service' };
}
