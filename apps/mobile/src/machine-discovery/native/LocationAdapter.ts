import type { MachineCoordinates } from '../machine-discovery.types';
import type { Observable } from 'rxjs';

export type NativeCapabilityState = 'undetermined' | 'granted' | 'denied' | 'restricted' | 'revoked' | 'unavailable';

export interface LocationAdapter {
    readonly capabilityState$: Observable<NativeCapabilityState>;
    getCurrentPosition(): Observable<MachineCoordinates>;
    dispose(): void;
}
