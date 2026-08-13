import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ExpoLocationAdapter as ExpoLocationAdapterImplementation } from './ExpoLocationAdapter';

import type { LocationAdapter, NativeCapabilityState } from './LocationAdapter';

const POSITION = { latitude: 14.716677, longitude: -17.467686 };

type PermissionStatus = 'undetermined' | 'granted' | 'denied';

type LocationPermission = {
    status: PermissionStatus;
    granted: boolean;
    canAskAgain: boolean;
    expires: 'never';
};

type LocationObject = {
    coords: typeof POSITION & {
        altitude: number | null;
        accuracy: number | null;
        altitudeAccuracy: number | null;
        heading: number | null;
        speed: number | null;
    };
    timestamp: number;
};

type ExpoLocationClient = {
    hasServicesEnabledAsync(): Promise<boolean>;
    getForegroundPermissionsAsync(): Promise<LocationPermission>;
    requestForegroundPermissionsAsync(): Promise<LocationPermission>;
    getCurrentPositionAsync(options: { mayShowUserSettingsDialog: boolean }): Promise<LocationObject>;
};

type ExpoLocationAdapterConstructor = new (client: ExpoLocationClient) => LocationAdapter;

const ExpoLocationAdapter = ExpoLocationAdapterImplementation as unknown as ExpoLocationAdapterConstructor;

function permission(status: PermissionStatus, canAskAgain = status === 'undetermined'): LocationPermission {
    return {
        status,
        granted: status === 'granted',
        canAskAgain,
        expires: 'never',
    };
}

function createClient(initialPermission: LocationPermission = permission('granted')): ExpoLocationClient {
    return {
        hasServicesEnabledAsync: vi.fn(async () => true),
        getForegroundPermissionsAsync: vi.fn(async () => initialPermission),
        requestForegroundPermissionsAsync: vi.fn(async () => initialPermission),
        getCurrentPositionAsync: vi.fn(async () => ({
            coords: {
                ...POSITION,
                altitude: null,
                accuracy: 10,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: 1,
        })),
    };
}

async function acquire(adapter: LocationAdapter): Promise<typeof POSITION | null> {
    return firstValueFrom(adapter.getCurrentPosition(), { defaultValue: null });
}

function recordStates(adapter: LocationAdapter): NativeCapabilityState[] {
    const states: NativeCapabilityState[] = [];
    adapter.capabilityState$.subscribe((state) => states.push(state));
    return states;
}

describe('ExpoLocationAdapter', () => {
    it('requests only foreground permission when the state is undetermined', async () => {
        const client = createClient(permission('undetermined'));
        vi.mocked(client.requestForegroundPermissionsAsync).mockResolvedValue(permission('granted'));
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toEqual(POSITION);

        expect(client.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
        expect(client).not.toHaveProperty('requestBackgroundPermissionsAsync');
        expect(client.getCurrentPositionAsync).toHaveBeenCalledOnce();
        expect(states).toEqual(['undetermined', 'granted']);
    });

    it('uses an existing foreground grant without showing another permission prompt', async () => {
        const client = createClient();
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toEqual(POSITION);

        expect(client.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(client.getCurrentPositionAsync).toHaveBeenCalledWith(
            expect.objectContaining({ mayShowUserSettingsDialog: false }),
        );
        expect(states).toEqual(['undetermined', 'granted']);
    });

    it.each([
        ['denied', permission('denied', true)],
        ['restricted', permission('denied', false)],
    ] as const)('normalizes an unavailable position as %s and preserves fallbacks', async (expected, response) => {
        const client = createClient(response);
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toBeNull();

        expect(client.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(client.getCurrentPositionAsync).not.toHaveBeenCalled();
        expect(states).toEqual(['undetermined', expected]);
    });

    it('normalizes a withdrawn previous grant as revoked', async () => {
        const client = createClient();
        vi.mocked(client.getForegroundPermissionsAsync)
            .mockResolvedValueOnce(permission('granted'))
            .mockResolvedValueOnce(permission('denied', false));
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toEqual(POSITION);
        await expect(acquire(adapter)).resolves.toBeNull();

        expect(states).toEqual(['undetermined', 'granted', 'revoked']);
    });

    it('reports unavailable without requesting permission when location services are disabled', async () => {
        const client = createClient();
        vi.mocked(client.hasServicesEnabledAsync).mockResolvedValue(false);
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toBeNull();

        expect(client.getForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(client.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(client.getCurrentPositionAsync).not.toHaveBeenCalled();
        expect(states).toEqual(['undetermined', 'unavailable']);
    });

    it('converts a temporary native location failure to unavailable without blocking fallbacks', async () => {
        const client = createClient();
        vi.mocked(client.getCurrentPositionAsync).mockRejectedValue(new Error('native provider details'));
        const adapter = new ExpoLocationAdapter(client);
        const states = recordStates(adapter);

        await expect(acquire(adapter)).resolves.toBeNull();

        expect(states).toEqual(['undetermined', 'granted', 'unavailable']);
    });
});
