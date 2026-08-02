import * as SecureStore from 'expo-secure-store';
import { defer, from, map, of } from 'rxjs';

import type { Observable } from 'rxjs';

export interface StoredRegistrationAuthorization {
    token: string;
    expiresAt: string;
    nextStep?: 'completeRegistration' | 'acceptLegal';
}

export interface RegistrationAuthorizationStorage {
    load(): Observable<StoredRegistrationAuthorization | undefined>;
    save(value: StoredRegistrationAuthorization): Observable<void>;
    clear(): Observable<void>;
}

const STORAGE_KEY = 'kaynann.registration.authorization.v1';

export class SecureRegistrationAuthorizationStorage implements RegistrationAuthorizationStorage {
    load(): Observable<StoredRegistrationAuthorization | undefined> {
        return defer(() => from(SecureStore.getItemAsync(STORAGE_KEY))).pipe(
            map((raw) => {
                if (!raw) return undefined;
                try {
                    const value: unknown = JSON.parse(raw);
                    if (!isStoredRegistrationAuthorization(value) || Date.parse(value.expiresAt) <= Date.now()) {
                        return undefined;
                    }
                    return value;
                } catch {
                    return undefined;
                }
            }),
        );
    }

    save(value: StoredRegistrationAuthorization): Observable<void> {
        return defer(() =>
            from(
                SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value), {
                    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
                }),
            ),
        );
    }

    clear(): Observable<void> {
        return defer(() => from(SecureStore.deleteItemAsync(STORAGE_KEY)));
    }
}

function isStoredRegistrationAuthorization(value: unknown): value is StoredRegistrationAuthorization {
    if (typeof value !== 'object' || value === null) return false;

    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.token === 'string' &&
        typeof candidate.expiresAt === 'string' &&
        (candidate.nextStep === undefined ||
            candidate.nextStep === 'completeRegistration' ||
            candidate.nextStep === 'acceptLegal')
    );
}

export class DevelopmentWebRegistrationAuthorizationStorage implements RegistrationAuthorizationStorage {
    private value: StoredRegistrationAuthorization | undefined;

    load(): Observable<StoredRegistrationAuthorization | undefined> {
        return of(this.value);
    }

    save(value: StoredRegistrationAuthorization): Observable<void> {
        return defer(() => {
            this.value = value;
            return of(undefined);
        });
    }

    clear(): Observable<void> {
        return defer(() => {
            this.value = undefined;
            return of(undefined);
        });
    }
}
