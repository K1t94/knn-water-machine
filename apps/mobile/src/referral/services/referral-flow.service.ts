import { reaction } from 'mobx';
import { forkJoin } from 'rxjs';

import { ReferralApiError } from '../../api/referral-api';

import type { MyReferral, ReferralApi, ReferralInvitationPage } from '../../api/referral-api';
import type { SessionStore } from '../../auth/stores/session.store';
import type { FeatureAvailabilityStore } from '../../features/stores/feature-availability.store';
import type { ReferralStore } from '../stores/referral.store';
import type { Observable, Subscription } from 'rxjs';

export interface AuthenticatedReferralRequestScope {
    withAccess<T>(request: (accessToken: string) => Observable<T>): Observable<T>;
}

export interface ReferralCommands {
    retry(): void;
    refresh(): void;
    loadNextPage(): void;
}

export class ReferralFlowService implements ReferralCommands {
    private epoch = 0;
    private loadSubscription: Subscription | undefined;
    private pageSubscription: Subscription | undefined;
    private readonly disposeReaction: () => void;
    private disposed = false;

    constructor(
        private readonly store: ReferralStore,
        private readonly api: ReferralApi,
        private readonly sessionStore: SessionStore,
        private readonly access: AuthenticatedReferralRequestScope,
        private readonly availability: FeatureAvailabilityStore,
    ) {
        this.disposeReaction = reaction(
            () => `${sessionStore.state}:${sessionStore.accessToken ?? ''}:${availability.state}`,
            () => {
                this.epoch += 1;
                this.cancelRequests();
                this.store.clear();
                if (this.canLoad()) this.loadFirstPage('initial');
            },
            { fireImmediately: true },
        );
    }

    retry(): void {
        if (!this.disposed && this.canLoad()) this.loadFirstPage(this.store.myReferral ? 'refresh' : 'initial');
    }

    refresh(): void {
        this.retry();
    }

    loadNextPage(): void {
        if (this.disposed || this.pageSubscription || !this.canLoad()) return;
        const cursor = this.store.nextCursor;
        const token = this.store.beginNextPage();
        if (!token || !cursor) return;
        const epoch = this.epoch;
        const subscription = this.access
            .withAccess((accessToken) => this.api.getInvitations(accessToken, { cursor, limit: 20 }))
            .subscribe({
                next: (page) => {
                    if (epoch === this.epoch && this.canLoad()) this.store.finishNextPage(token, page);
                },
                error: (error: unknown) => {
                    if (epoch === this.epoch) this.handleError(error, (mapped) => this.store.failNextPage(token, mapped));
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
        this.epoch += 1;
        this.disposeReaction();
        this.cancelRequests();
        this.store.clear();
    }

    private canLoad(): boolean {
        return Boolean(
            this.availability.referralProgramEnabled &&
                this.sessionStore.state === 'authenticated' &&
                this.sessionStore.accessToken,
        );
    }

    private loadFirstPage(mode: 'initial' | 'refresh'): void {
        this.cancelRequests();
        const token = mode === 'initial' ? this.store.beginInitialLoad() : this.store.beginRefresh();
        const epoch = this.epoch;
        const subscription = this.access
            .withAccess((accessToken) =>
                forkJoin({
                    referral: this.api.getMe(accessToken),
                    page: this.api.getInvitations(accessToken, { limit: 20 }),
                }),
            )
            .subscribe({
                next: ({ referral, page }) => {
                    if (epoch === this.epoch && this.canLoad()) this.finishFirstPage(mode, token, referral, page);
                },
                error: (error: unknown) => {
                    if (epoch === this.epoch) {
                        this.handleError(error, (mapped) => {
                            if (mode === 'initial') this.store.failInitialLoad(token, mapped);
                            else this.store.failRefresh(token, mapped);
                        });
                    }
                    this.loadSubscription = undefined;
                },
                complete: () => {
                    this.loadSubscription = undefined;
                },
            });
        this.loadSubscription = subscription.closed ? undefined : subscription;
    }

    private handleError(error: unknown, publish: (error: { code: string; retryable: boolean }) => void): void {
        if (error instanceof ReferralApiError && error.code === 'FEATURE_DISABLED') {
            this.availability.disableFromReferralResponse();
            return;
        }
        publish(toPresentationError(error));
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
    }
}

function toPresentationError(error: unknown): { code: string; retryable: boolean } {
    if (error instanceof ReferralApiError) return { code: error.code, retryable: error.retryable };
    return { code: 'REFERRAL_SERVICE_UNAVAILABLE', retryable: true };
}
