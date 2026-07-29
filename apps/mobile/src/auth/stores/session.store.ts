import { action, computed, makeObservable, observable } from 'mobx';

import type { SessionCredentials } from '../../api/auth-api';

export type SessionState =
  | 'restoring'
  | 'anonymous'
  | 'authenticated'
  | 'staleLegal'
  | 'offline';
export type RootRoute = 'loading' | 'auth' | 'legal' | 'main' | 'offline';

export class SessionStore {
  state: SessionState = 'restoring';
  accessToken: string | undefined = undefined;
  accessExpiresAt: string | undefined = undefined;
  refreshExpiresAt: string | undefined = undefined;

  constructor() {
    makeObservable(this, {
      state: observable,
      accessToken: observable,
      accessExpiresAt: observable,
      refreshExpiresAt: observable,
      rootRoute: computed,
      beginRestore: action.bound,
      authenticate: action.bound,
      requireLegal: action.bound,
      markAnonymous: action.bound,
      markOffline: action.bound,
    });
  }

  get rootRoute(): RootRoute {
    if (this.state === 'restoring') return 'loading';
    if (this.state === 'authenticated') return 'main';
    if (this.state === 'staleLegal') return 'legal';
    if (this.state === 'offline') return 'offline';
    return 'auth';
  }

  beginRestore(): void {
    this.clearMemory();
    this.state = 'restoring';
  }

  authenticate(credentials: SessionCredentials): void {
    this.accessToken = credentials.accessToken;
    this.accessExpiresAt = credentials.accessExpiresAt;
    this.refreshExpiresAt = credentials.refreshExpiresAt;
    this.state = 'authenticated';
  }

  requireLegal(): void {
    this.clearMemory();
    this.state = 'staleLegal';
  }

  markAnonymous(): void {
    this.clearMemory();
    this.state = 'anonymous';
  }

  markOffline(refreshExpiresAt?: string): void {
    this.clearMemory();
    this.refreshExpiresAt = refreshExpiresAt;
    this.state = 'offline';
  }

  private clearMemory(): void {
    this.accessToken = undefined;
    this.accessExpiresAt = undefined;
    this.refreshExpiresAt = undefined;
  }
}
