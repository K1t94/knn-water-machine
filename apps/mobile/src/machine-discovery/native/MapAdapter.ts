import type { MachineViewport } from '../machine-discovery.types';
import type { NativeCapabilityState } from './LocationAdapter';
import type { Observable } from 'rxjs';

export interface MapAdapter {
    readonly capabilityState$: Observable<NativeCapabilityState>;
    readonly viewportChanges$: Observable<MachineViewport>;
    dispose(): void;
}

export interface MapRegion {
    readonly latitude: number;
    readonly longitude: number;
    readonly latitudeDelta: number;
    readonly longitudeDelta: number;
}
