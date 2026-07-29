import {
  EMPTY,
  Observable,
  Subject,
  Subscription,
  catchError,
  concatMap,
  defer,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';

import {
  AuthApiError,
  type AuthApi,
  type SessionCredentials,
} from '../../api/auth-api';
import type { SessionStorage } from '../storage/session.storage';
import { SessionStore } from '../stores/session.store';

export interface SessionCommands {
  restore(): void;
  retryRestore(): void;
  acceptCredentials(credentials: SessionCredentials): void;
  requireLegal(): void;
  logout(): void;
}

export type SessionApi = Pick<
  AuthApi,
  'refreshSession' | 'logoutCurrentSession'
>;

export class SessionFlowService implements SessionCommands {
  private readonly teardown = new Subject<void>();
  private readonly subscriptions = new Subscription();
  private refreshInFlight: Observable<SessionCredentials> | undefined;
  private disposed = false;

  constructor(
    private readonly store: SessionStore,
    private readonly api: SessionApi,
    private readonly storage: SessionStorage,
  ) {}

  restore(): void {
    if (this.disposed) return;
    this.store.beginRestore();
    this.track(this.restoreSession());
  }

  retryRestore(): void {
    this.restore();
  }

  acceptCredentials(credentials: SessionCredentials): void {
    if (this.disposed) return;
    this.track(this.persistAndAuthenticate(credentials));
  }

  requireLegal(): void {
    this.store.requireLegal();
  }

  logout(): void {
    if (this.disposed) return;
    const accessToken = this.store.accessToken;
    const remote$ = accessToken
      ? this.api
          .logoutCurrentSession(accessToken)
          .pipe(catchError(() => of(undefined)))
      : of(undefined);
    this.track(
      remote$.pipe(
        concatMap(() => this.storage.clear()),
        tap(() => this.store.markAnonymous()),
      ),
    );
  }

  withAccess<T>(
    request: (accessToken: string) => Observable<T>,
  ): Observable<T> {
    return defer(() => {
      const accessToken = this.store.accessToken;
      if (!accessToken)
        return this.refreshOnce().pipe(
          switchMap((credentials) => request(credentials.accessToken)),
        );
      return request(accessToken).pipe(
        catchError((error: unknown) => {
          if (!isAccessFailure(error)) return throwError(() => error);
          return this.refreshOnce().pipe(
            switchMap((credentials) => request(credentials.accessToken)),
          );
        }),
      );
    }).pipe(takeUntil(this.teardown));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown.next();
    this.teardown.complete();
    this.subscriptions.unsubscribe();
    this.refreshInFlight = undefined;
  }

  private restoreSession(): Observable<void> {
    return this.storage.load().pipe(
      switchMap((stored) => {
        if (!stored) {
          this.store.markAnonymous();
          return EMPTY;
        }
        if (Date.parse(stored.refreshExpiresAt) <= Date.now()) {
          return this.storage
            .clear()
            .pipe(tap(() => this.store.markAnonymous()));
        }
        return this.api.refreshSession(stored.refreshToken).pipe(
          concatMap((credentials) => this.persistAndAuthenticate(credentials)),
          catchError((error: unknown) =>
            this.handleRefreshError(error, stored.refreshExpiresAt),
          ),
        );
      }),
      map(() => undefined),
    );
  }

  private refreshOnce(): Observable<SessionCredentials> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const shared = this.storage.load().pipe(
      switchMap((stored) => {
        if (!stored || Date.parse(stored.refreshExpiresAt) <= Date.now()) {
          return throwError(() => new AuthApiError('REFRESH_EXPIRED', false));
        }
        return this.api.refreshSession(stored.refreshToken);
      }),
      concatMap((credentials) =>
        this.persistAndAuthenticate(credentials).pipe(map(() => credentials)),
      ),
      catchError((error: unknown) =>
        this.handleRefreshError(error).pipe(
          switchMap(() => throwError(() => error)),
        ),
      ),
      finalize(() => {
        this.refreshInFlight = undefined;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      takeUntil(this.teardown),
    );
    this.refreshInFlight = shared;
    return shared;
  }

  private persistAndAuthenticate(
    credentials: SessionCredentials,
  ): Observable<void> {
    return this.storage
      .replace({
        refreshToken: credentials.refreshToken,
        refreshExpiresAt: credentials.refreshExpiresAt,
      })
      .pipe(tap(() => this.store.authenticate(credentials)));
  }

  private handleRefreshError(
    error: unknown,
    refreshExpiresAt?: string,
  ): Observable<void> {
    if (isOffline(error)) {
      this.store.markOffline(refreshExpiresAt);
      return EMPTY;
    }
    return this.storage.clear().pipe(tap(() => this.store.markAnonymous()));
  }

  private track(work: Observable<unknown>): void {
    this.subscriptions.add(work.pipe(takeUntil(this.teardown)).subscribe());
  }
}

function isOffline(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    (error.code === 'OFFLINE' || error.code === 'REQUEST_TIMEOUT')
  );
}

function isAccessFailure(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    (error.code === 'REFRESH_INVALID' || error.code === 'REFRESH_EXPIRED')
  );
}
