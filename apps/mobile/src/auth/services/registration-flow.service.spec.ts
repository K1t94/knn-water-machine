import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  AuthApiError,
  type AuthApi,
  type CurrentLegalSet,
  type SessionCredentials,
} from '../../api/auth-api';
import type {
  RegistrationAuthorizationStorage,
  StoredRegistrationAuthorization,
} from '../storage/registration-authorization.storage';
import { RegistrationStore } from '../stores/registration.store';
import { RegistrationFlowService } from './registration-flow.service';

const legalSet: CurrentLegalSet = {
  setVersion: 'set-v1',
  documents: [{
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'TERMS_OF_SERVICE',
    version: '1',
    title: 'Conditions',
    content: 'Current terms',
    mandatory: true,
    contentSha256: 'a'.repeat(64),
  }],
};
const session: SessionCredentials = {
  accessToken: 'access',
  accessExpiresAt: '2030-01-01T00:15:00.000Z',
  refreshToken: 'refresh',
  refreshExpiresAt: '2030-03-01T00:00:00.000Z',
};
const verified = {
  nextStep: 'completeRegistration' as const,
  registrationAuthorization: 'registration-authorization',
  expiresAt: '2030-01-01T00:15:00.000Z',
};

class MemoryAuthorizationStorage
implements RegistrationAuthorizationStorage {
  value: StoredRegistrationAuthorization | undefined;
  readonly saveCalls: StoredRegistrationAuthorization[] = [];
  clearCalls = 0;

  load(): Observable<StoredRegistrationAuthorization | undefined> {
    return of(this.value);
  }

  save(value: StoredRegistrationAuthorization): Observable<void> {
    return new Observable((subscriber) => {
      this.value = value;
      this.saveCalls.push(value);
      subscriber.next();
      subscriber.complete();
    });
  }

  clear(): Observable<void> {
    return new Observable((subscriber) => {
      this.value = undefined;
      this.clearCalls += 1;
      subscriber.next();
      subscriber.complete();
    });
  }
}

function createApi(
  overrides: Partial<AuthApi> = {},
): AuthApi {
  return {
    requestOtp: vi.fn(),
    resendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    updateRegistrationContext: vi.fn(() => of(undefined)),
    getCurrentLegalDocuments: vi.fn(() => of(legalSet)),
    completeRegistration: vi.fn(() => of(session)),
    acceptUpdatedLegal: vi.fn(() => of(session)),
    refreshSession: vi.fn(() => of(session)),
    logoutCurrentSession: vi.fn(() => of(undefined)),
    ...overrides,
  };
}

function readyFlow(api = createApi()) {
  const store = new RegistrationStore();
  const storage = new MemoryAuthorizationStorage();
  const completed = vi.fn();
  const flow = new RegistrationFlowService(store, api, storage, completed);
  flow.begin(verified);
  store.toggleAcceptance(legalSet.documents[0]!.id);
  return { api, completed, flow, storage, store };
}

describe('RegistrationFlowService', () => {
  it('keeps UI command callbacks bound to the service instance', () => {
    const { flow, store } = readyFlow();
    const { setPendingPromoCode, removePendingPromoCode } = flow;

    setPendingPromoCode(' PROMO-1 ');
    expect(store.pendingPromoCode).toBe('PROMO-1');

    removePendingPromoCode();
    expect(store.pendingPromoCode).toBeUndefined();
    flow.dispose();
  });

  it('persists the OTP handoff and loads legal documents through cold adapters', () => {
    const { flow, storage, store } = readyFlow();

    expect(storage.saveCalls).toEqual([{
      token: 'registration-authorization',
      expiresAt: '2030-01-01T00:15:00.000Z',
      nextStep: 'completeRegistration',
    }]);
    expect(store.legalSet).toEqual(legalSet);
    expect(store.state).toBe('ready');
    flow.dispose();
  });

  it('edits and removes pending promo only as registration context', () => {
    const { api, flow, store } = readyFlow();

    flow.setPendingPromoCode('  PROMO-1  ');
    flow.removePendingPromoCode();

    expect(store.pendingPromoCode).toBeUndefined();
    expect(api.updateRegistrationContext).toHaveBeenNthCalledWith(
      1,
      'registration-authorization',
      'PROMO-1',
    );
    expect(api.updateRegistrationContext).toHaveBeenNthCalledWith(
      2,
      'registration-authorization',
      null,
    );
    flow.dispose();
  });

  it('does not submit until every mandatory document is accepted', () => {
    const api = createApi();
    const store = new RegistrationStore();
    const flow = new RegistrationFlowService(
      store,
      api,
      new MemoryAuthorizationStorage(),
    );
    flow.begin(verified);

    flow.complete();

    expect(store.state).toBe('incomplete');
    expect(api.completeRegistration).not.toHaveBeenCalled();
    flow.dispose();
  });

  it('keeps one idempotency key across an explicit offline retry', () => {
    const keys: string[] = [];
    const completeRegistration = vi.fn((
      _authorization: string,
      key: string,
    ) => {
      keys.push(key);
      return keys.length === 1
        ? throwError(() => new AuthApiError('OFFLINE', true))
        : of(session);
    });
    const { completed, flow, storage, store } = readyFlow(createApi({
      completeRegistration,
    }));

    flow.complete();
    expect(store.state).toBe('offline');
    flow.complete();

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(store.state).toBe('success');
    expect(storage.clearCalls).toBe(1);
    expect(completed).toHaveBeenCalledWith(session);
    flow.dispose();
  });

  it('maps stale versions and reloads only after an explicit retry command', () => {
    const getCurrentLegalDocuments = vi.fn()
      .mockReturnValueOnce(of(legalSet))
      .mockReturnValueOnce(of({
        ...legalSet,
        setVersion: 'set-v2',
      }));
    const { flow, store } = readyFlow(createApi({
      getCurrentLegalDocuments,
      completeRegistration: vi.fn(() => throwError(
        () => new AuthApiError('LEGAL_VERSION_STALE', false),
      )),
    }));

    flow.complete();
    expect(store.state).toBe('stale');
    expect(getCurrentLegalDocuments).toHaveBeenCalledTimes(1);

    flow.retryDocuments();
    expect(getCurrentLegalDocuments).toHaveBeenCalledTimes(2);
    expect(store.legalSet?.setVersion).toBe('set-v2');
    expect(store.acceptedDocumentIds.size).toBe(0);
    flow.dispose();
  });

  it('cancels in-flight work on cancellation and flow replacement', () => {
    const legalResponses = new Subject<CurrentLegalSet>();
    const teardown = vi.fn();
    const api = createApi({
      getCurrentLegalDocuments: vi.fn(() =>
        new Observable<CurrentLegalSet>((subscriber) => {
        const subscription = legalResponses.subscribe(subscriber);
        return () => {
          teardown();
          subscription.unsubscribe();
        };
      })),
    });
    const store = new RegistrationStore();
    const flow = new RegistrationFlowService(
      store,
      api,
      new MemoryAuthorizationStorage(),
    );

    flow.begin(verified);
    flow.begin(verified);
    expect(teardown).toHaveBeenCalledTimes(1);
    flow.cancel();
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(store.state).toBe('idle');
    flow.dispose();
  });

  it('disposal terminates all active work and is idempotent', () => {
    const teardown = vi.fn();
    const api = createApi({
      getCurrentLegalDocuments: vi.fn(() =>
        new Observable<CurrentLegalSet>(() => teardown)),
    });
    const store = new RegistrationStore();
    const flow = new RegistrationFlowService(
      store,
      api,
      new MemoryAuthorizationStorage(),
    );
    flow.begin(verified);

    flow.dispose();

    expect(teardown).toHaveBeenCalledOnce();
    expect(() => flow.dispose()).not.toThrow();
  });
});
