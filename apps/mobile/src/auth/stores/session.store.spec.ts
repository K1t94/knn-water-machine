import { isAction, isComputedProp, isObservableProp } from 'mobx';
import { describe, expect, it } from 'vitest';

import { SessionStore } from './session.store';

const credentials = {
  accessToken: 'access-token',
  accessExpiresAt: '2030-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshExpiresAt: '2030-03-02T00:00:00.000Z',
};

describe('SessionStore', () => {
  it('owns observable session state and derives root-route gating', () => {
    const store = new SessionStore();

    expect(isObservableProp(store, 'accessToken')).toBe(true);
    expect(isObservableProp(store, 'state')).toBe(true);
    expect(isComputedProp(store, 'rootRoute')).toBe(true);
    expect(isAction(store.authenticate)).toBe(true);
    expect(store.rootRoute).toBe('loading');

    store.markAnonymous();
    expect(store.rootRoute).toBe('auth');
    store.requireLegal();
    expect(store.rootRoute).toBe('legal');
    store.authenticate(credentials);
    expect(store.rootRoute).toBe('main');
    expect(store.accessToken).toBe('access-token');
    store.markOffline(credentials.refreshExpiresAt);
    expect(store.rootRoute).toBe('offline');
    expect(store.accessToken).toBeUndefined();
  });

  it('clears all in-memory credentials on terminal anonymous transition', () => {
    const store = new SessionStore();
    store.authenticate(credentials);

    store.markAnonymous();

    expect(store.accessToken).toBeUndefined();
    expect(store.accessExpiresAt).toBeUndefined();
    expect(store.refreshExpiresAt).toBeUndefined();
    expect(store.rootRoute).toBe('auth');
  });
});
