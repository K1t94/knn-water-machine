import {
    EMPTY,
    Subject,
    Subscription,
    catchError,
    concatMap,
    defer,
    exhaustMap,
    map,
    of,
    switchMap,
    takeUntil,
    tap,
} from 'rxjs';

import { AuthApiError, type AuthApi, type OtpVerified } from '../../api/auth-api';

import type {
    RegistrationAuthorizationStorage,
    StoredRegistrationAuthorization,
} from '../storage/registration-authorization.storage';
import type { RegistrationStore } from '../stores/registration.store';

export interface RegistrationCommands {
    begin(result: OtpVerified): void;
    restore(): void;
    retryDocuments(): void;
    setPendingPromoCode(value: string): void;
    removePendingPromoCode(): void;
    toggleAcceptance(documentId: string): void;
    complete(): void;
    cancel(): void;
}

type StartCommand = { kind: 'begin'; result: OtpVerified } | { kind: 'restore' };

export class RegistrationFlowService implements RegistrationCommands {
    private readonly starts = new Subject<StartCommand>();
    private readonly documentLoads = new Subject<void>();
    private readonly promoMutations = new Subject<string | null>();
    private readonly completions = new Subject<void>();
    private readonly flowCancellation = new Subject<void>();
    private readonly subscriptions = new Subscription();
    private authorization: StoredRegistrationAuthorization | undefined;
    private idempotencyKey: string | undefined;
    private disposed = false;

    constructor(
        private readonly store: RegistrationStore,
        private readonly api: AuthApi,
        private readonly storage: RegistrationAuthorizationStorage,
        private readonly onCompleted?: (session: NonNullable<RegistrationStore['session']>) => void,
    ) {
        this.subscriptions.add(this.starts.pipe(switchMap((command) => this.start(command))).subscribe());
        this.subscriptions.add(this.documentLoads.pipe(exhaustMap(() => this.loadDocuments())).subscribe());
        this.subscriptions.add(this.promoMutations.pipe(switchMap((value) => this.persistPromo(value))).subscribe());
        this.subscriptions.add(this.completions.pipe(exhaustMap(() => this.completeRegistration())).subscribe());
    }

    begin = (result: OtpVerified): void => {
        this.flowCancellation.next();
        this.starts.next({ kind: 'begin', result });
    };

    restore = (): void => {
        this.starts.next({ kind: 'restore' });
    };

    retryDocuments = (): void => {
        this.documentLoads.next();
    };

    setPendingPromoCode = (value: string): void => {
        this.store.setPendingPromoCode(value);
        if (this.authorization) {
            this.promoMutations.next(this.store.pendingPromoCode ?? null);
        }
    };

    removePendingPromoCode = (): void => {
        this.store.removePendingPromoCode();
        if (this.authorization) this.promoMutations.next(null);
    };

    toggleAcceptance = (documentId: string): void => {
        this.store.toggleAcceptance(documentId);
    };

    complete = (): void => {
        if (!this.store.canComplete) {
            this.store.markIncomplete();
            return;
        }
        this.completions.next();
    };

    cancel = (): void => {
        this.flowCancellation.next();
        this.authorization = undefined;
        this.idempotencyKey = undefined;
        this.subscriptions.add(this.storage.clear().subscribe());
        this.store.reset();
    };

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subscriptions.unsubscribe();
        this.starts.complete();
        this.documentLoads.complete();
        this.promoMutations.complete();
        this.completions.complete();
        this.flowCancellation.next();
        this.flowCancellation.complete();
    }

    private start(command: StartCommand) {
        const authorization$ = command.kind === 'begin' ? this.storeAuthorization(command.result) : this.storage.load();
        this.store.beginLoading();
        return authorization$.pipe(
            concatMap((authorization) => {
                if (!authorization) {
                    this.store.reset();
                    return EMPTY;
                }
                this.authorization = authorization;
                this.idempotencyKey = undefined;
                return this.loadDocuments();
            }),
            catchError((error: unknown) => this.handleError(error)),
            takeUntil(this.flowCancellation),
        );
    }

    private storeAuthorization(result: OtpVerified) {
        if (result.nextStep === 'authenticated' || !result.registrationAuthorization || !result.expiresAt) {
            return of(undefined);
        }
        const authorization = {
            token: result.registrationAuthorization,
            expiresAt: result.expiresAt,
            nextStep: result.nextStep,
        };
        return this.storage.save(authorization).pipe(map(() => authorization));
    }

    private loadDocuments() {
        if (!this.authorization) return EMPTY;
        this.store.beginLoading();
        return this.api.getCurrentLegalDocuments(this.authorization.token).pipe(
            tap((legalSet) => this.store.finishLoading(legalSet)),
            map(() => undefined),
            catchError((error: unknown) => this.handleError(error)),
            takeUntil(this.flowCancellation),
        );
    }

    private persistPromo(value: string | null) {
        if (!this.authorization) return EMPTY;
        return this.api.updateRegistrationContext(this.authorization.token, value).pipe(
            catchError((error: unknown) => this.handleError(error)),
            takeUntil(this.flowCancellation),
        );
    }

    private completeRegistration() {
        if (!this.authorization || !this.store.legalSet || !this.store.canComplete) {
            return EMPTY;
        }
        this.store.beginCompletion();
        this.idempotencyKey ??= createIdempotencyKey();
        const completion =
            this.authorization.nextStep === 'acceptLegal'
                ? this.api.acceptUpdatedLegal.bind(this.api)
                : this.api.completeRegistration.bind(this.api);
        return defer(() =>
            completion(this.authorization!.token, this.idempotencyKey!, {
                setVersion: this.store.legalSet!.setVersion,
                acceptedDocumentIds: [...this.store.acceptedDocumentIds],
            }),
        ).pipe(
            concatMap((session) => this.storage.clear().pipe(map(() => session))),
            tap((session) => {
                this.authorization = undefined;
                this.idempotencyKey = undefined;
                this.store.finishCompletion(session);
                this.onCompleted?.(session);
                this.flowCancellation.next();
            }),
            map(() => undefined),
            catchError((error: unknown) => {
                return this.handleError(error);
            }),
        );
    }

    private handleError(error: unknown) {
        const code = error instanceof AuthApiError ? error.code : 'OFFLINE';
        if (code === 'LEGAL_VERSION_STALE') {
            this.store.fail('stale', 'Legal documents changed. Review the latest versions.');
        } else if (code === 'OFFLINE' || code === 'REQUEST_TIMEOUT') {
            this.store.fail('offline', 'Check your internet connection and try again.');
        } else {
            this.store.fail('error', 'Registration is temporarily unavailable.');
        }
        return EMPTY;
    }
}

function createIdempotencyKey(): string {
    return (
        globalThis.crypto?.randomUUID?.() ??
        `registration-${Date.now().toString(36)}-${performance.now().toString(36).replace('.', '')}`
    );
}
