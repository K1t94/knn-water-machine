import { BehaviorSubject, defer, EMPTY, filter, from } from 'rxjs';

import type { MachineCoordinates } from '../machine-discovery.types';
import type { LocationAdapter, NativeCapabilityState } from './LocationAdapter';
import type * as ExpoLocation from 'expo-location';
import type { Observable } from 'rxjs';

type ExpoLocationClient = Pick<
    typeof ExpoLocation,
    | 'getCurrentPositionAsync'
    | 'getForegroundPermissionsAsync'
    | 'hasServicesEnabledAsync'
    | 'requestForegroundPermissionsAsync'
>;

export class ExpoLocationAdapter implements LocationAdapter {
    private readonly capabilityStateSubject = new BehaviorSubject<NativeCapabilityState>('undetermined');
    private disposed = false;

    readonly capabilityState$ = this.capabilityStateSubject.asObservable();

    constructor(private readonly client?: ExpoLocationClient) {}

    getCurrentPosition(): Observable<MachineCoordinates> {
        return defer(() => {
            if (this.disposed) {
                return EMPTY;
            }

            return from(this.acquireCurrentPosition()).pipe(
                filter((position): position is MachineCoordinates => position !== null),
            );
        });
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.capabilityStateSubject.complete();
    }

    private async acquireCurrentPosition(): Promise<MachineCoordinates | null> {
        try {
            const client = this.client ?? (await import('expo-location'));

            if (!(await client.hasServicesEnabledAsync())) {
                this.setCapabilityState('unavailable');
                return null;
            }

            let permission = await client.getForegroundPermissionsAsync();
            if (permission.status === 'undetermined') {
                permission = await client.requestForegroundPermissionsAsync();
            }

            if (!permission.granted) {
                const state =
                    this.capabilityStateSubject.value === 'granted'
                        ? 'revoked'
                        : permission.canAskAgain
                          ? 'denied'
                          : 'restricted';
                this.setCapabilityState(state);
                return null;
            }

            this.setCapabilityState('granted');
            const position = await client.getCurrentPositionAsync({ mayShowUserSettingsDialog: false });

            return {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            };
        } catch {
            this.setCapabilityState('unavailable');
            return null;
        }
    }

    private setCapabilityState(state: NativeCapabilityState): void {
        if (!this.disposed && this.capabilityStateSubject.value !== state) {
            this.capabilityStateSubject.next(state);
        }
    }
}
