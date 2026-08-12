import { reaction } from 'mobx';
import { EMPTY, Subject, Subscription, catchError, switchMap, tap } from 'rxjs';

import { AppConfigApiError } from '../../api/app-config-api';

import type { AppConfigApi } from '../../api/app-config-api';
import type { SessionStore } from '../../auth/stores/session.store';
import type { FeatureAvailabilityStore } from '../stores/feature-availability.store';

export class FeatureAvailabilityService {
    private readonly refreshes = new Subject<void>();
    private readonly subscriptions = new Subscription();
    private readonly disposeSessionReaction: () => void;
    private disposed = false;

    constructor(
        private readonly store: FeatureAvailabilityStore,
        private readonly api: AppConfigApi,
        sessionStore: SessionStore,
    ) {
        this.subscriptions.add(
            this.refreshes
                .pipe(
                    switchMap(() => {
                        const token = this.store.beginRefresh();
                        return this.api.getConfig().pipe(
                            tap((config) =>
                                this.store.finishRefresh(token, config.features.referralProgramEnabled),
                            ),
                            catchError((error: unknown) => {
                                this.store.failRefresh(token, toAvailabilityError(error));
                                return EMPTY;
                            }),
                        );
                    }),
                )
                .subscribe(),
        );
        this.disposeSessionReaction = reaction(
            () => `${sessionStore.state}:${sessionStore.accessToken ?? ''}`,
            () => {
                this.store.resetForSessionReplacement();
                this.refresh();
            },
            { fireImmediately: true },
        );
    }

    refresh(): void {
        if (!this.disposed) this.refreshes.next();
    }

    retry(): void {
        this.refresh();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.disposeSessionReaction();
        this.subscriptions.unsubscribe();
        this.refreshes.complete();
        this.store.resetForSessionReplacement();
    }
}

function toAvailabilityError(error: unknown): { code: string; retryable: boolean } {
    if (error instanceof AppConfigApiError) return { code: error.code, retryable: error.retryable };
    return { code: 'SERVICE_UNAVAILABLE', retryable: true };
}
