import * as SecureStore from 'expo-secure-store';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DevelopmentWebSessionStorage,
  SecureSessionStorage,
  type StoredSessionCredential,
} from './session.storage';

const credential: StoredSessionCredential = {
  refreshToken: 'opaque-refresh-token',
  refreshExpiresAt: '2030-03-02T00:00:00.000Z',
};

describe('SecureSessionStorage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is cold and persists only the refresh credential record', async () => {
    const storage = new SecureSessionStorage();
    const save$ = storage.replace(credential);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    await firstValueFrom(save$);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'kaynann.session.refresh.v1',
      JSON.stringify(credential),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
    expect(JSON.stringify(credential)).not.toContain('accessToken');
  });

  it('loads a valid record and clears its isolated key', async () => {
    vi.mocked(SecureStore.getItemAsync)
      .mockResolvedValue(JSON.stringify(credential));
    const storage = new SecureSessionStorage();

    await expect(firstValueFrom(storage.load())).resolves.toEqual(credential);
    await firstValueFrom(storage.clear());

    expect(SecureStore.deleteItemAsync)
      .toHaveBeenCalledWith('kaynann.session.refresh.v1');
  });
});

describe('DevelopmentWebSessionStorage', () => {
  it('persists the refresh credential across adapter instances', async () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const firstInstance = new DevelopmentWebSessionStorage(localStorage);
    const save$ = firstInstance.replace(credential);

    expect(values.size).toBe(0);
    await firstValueFrom(save$);

    const secondInstance = new DevelopmentWebSessionStorage(localStorage);
    await expect(firstValueFrom(secondInstance.load())).resolves.toEqual(
      credential,
    );
    expect(values.get('kaynann.session.refresh.v1')).toBe(
      JSON.stringify(credential),
    );
    expect([...values.values()].join()).not.toContain('accessToken');

    await firstValueFrom(secondInstance.clear());
    await expect(firstValueFrom(firstInstance.load())).resolves.toBeUndefined();
  });
});
