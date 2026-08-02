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
                    const value = JSON.parse(raw) as StoredRegistrationAuthorization;
                    if (
                        typeof value.token !== 'string' ||
                        typeof value.expiresAt !== 'string' ||
                        (value.nextStep !== undefined &&
                            value.nextStep !== 'completeRegistration' &&
                            value.nextStep !== 'acceptLegal') ||
                        Date.parse(value.expiresAt) <= Date.now()
                    ) {
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
