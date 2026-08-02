import * as SecureStore from 'expo-secure-store';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DevelopmentWebRegistrationAuthorizationStorage,
    SecureRegistrationAuthorizationStorage,
} from './registration-authorization.storage';

describe('SecureRegistrationAuthorizationStorage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('defers every native Promise until Observable subscription', async () => {
        const storage = new SecureRegistrationAuthorizationStorage();
        const value = {
            token: 'opaque-registration-authorization',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        const save$ = storage.save(value);

        expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
        await firstValueFrom(save$);

        expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
            'kaynann.registration.authorization.v1',
            JSON.stringify(value),
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
    });

    it('rejects malformed and expired persisted authorizations', async () => {
        vi.mocked(SecureStore.getItemAsync)
            .mockResolvedValueOnce('{malformed')
            .mockResolvedValueOnce(
                JSON.stringify({
                    token: 'expired',
                    expiresAt: new Date(Date.now() - 1).toISOString(),
                }),
            );
        const storage = new SecureRegistrationAuthorizationStorage();

        await expect(firstValueFrom(storage.load())).resolves.toBeUndefined();
        await expect(firstValueFrom(storage.load())).resolves.toBeUndefined();
    });

    it('clears the isolated secure-storage key', async () => {
        const storage = new SecureRegistrationAuthorizationStorage();

        await firstValueFrom(storage.clear());

        expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('kaynann.registration.authorization.v1');
    });
});

describe('DevelopmentWebRegistrationAuthorizationStorage', () => {
    it('keeps authorization only in memory for the current runtime', async () => {
        const storage = new DevelopmentWebRegistrationAuthorizationStorage();
        const value = {
            token: 'opaque-registration-authorization',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };

        await firstValueFrom(storage.save(value));
        await expect(firstValueFrom(storage.load())).resolves.toEqual(value);

        await firstValueFrom(storage.clear());
        await expect(firstValueFrom(storage.load())).resolves.toBeUndefined();
    });
});
