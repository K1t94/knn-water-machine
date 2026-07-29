import * as SecureStore from 'expo-secure-store';
import { Observable, defer, from, map, of } from 'rxjs';

export interface StoredSessionCredential {
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface SessionStorage {
  load(): Observable<StoredSessionCredential | undefined>;
  replace(value: StoredSessionCredential): Observable<void>;
  clear(): Observable<void>;
}

interface WebKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = 'kaynann.session.refresh.v1';

export class SecureSessionStorage implements SessionStorage {
  load(): Observable<StoredSessionCredential | undefined> {
    return defer(() => from(SecureStore.getItemAsync(STORAGE_KEY))).pipe(
      map(parseStoredCredential),
    );
  }

  replace(value: StoredSessionCredential): Observable<void> {
    return defer(() => from(SecureStore.setItemAsync(
      STORAGE_KEY,
      JSON.stringify(value),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    )));
  }

  clear(): Observable<void> {
    return defer(() => from(SecureStore.deleteItemAsync(STORAGE_KEY)));
  }
}

export class DevelopmentWebSessionStorage implements SessionStorage {
  constructor(
    private readonly storage: WebKeyValueStorage = globalThis.localStorage,
  ) {}

  load(): Observable<StoredSessionCredential | undefined> {
    return defer(() => of(parseStoredCredential(
      this.storage.getItem(STORAGE_KEY),
    )));
  }

  replace(value: StoredSessionCredential): Observable<void> {
    return defer(() => {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
      return of(undefined);
    });
  }

  clear(): Observable<void> {
    return defer(() => {
      this.storage.removeItem(STORAGE_KEY);
      return of(undefined);
    });
  }
}

function parseStoredCredential(
  raw: string | null,
): StoredSessionCredential | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as StoredSessionCredential;
    if (
      typeof value.refreshToken !== 'string' ||
      typeof value.refreshExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.refreshExpiresAt))
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}
