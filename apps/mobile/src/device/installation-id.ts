import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { defer, from, map, of, switchMap } from 'rxjs';

import { createRuntimeId } from '../common/create-runtime-id';

import type { Observable } from 'rxjs';

const STORAGE_KEY = 'kaynann.installation-id';
let developmentWebInstallationId: string | undefined;

export function getOrCreateInstallationId(): Observable<string> {
    if (Platform.OS === 'web') {
        if (!__DEV__) {
            throw new Error('Web installation storage is development-only');
        }
        developmentWebInstallationId ??= createInstallationId();
        return of(developmentWebInstallationId);
    }

    return defer(() => from(SecureStore.getItemAsync(STORAGE_KEY))).pipe(
        switchMap((existing) => {
            if (existing) return of(existing);
            const value = createInstallationId();
            return defer(() => from(SecureStore.setItemAsync(STORAGE_KEY, value))).pipe(map(() => value));
        }),
    );
}

function createInstallationId(): string {
    return createRuntimeId('install');
}
