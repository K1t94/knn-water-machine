import { BehaviorSubject, Subject } from 'rxjs';

import type { MachineViewport } from '../machine-discovery.types';
import type { NativeCapabilityState } from './LocationAdapter';
import type { MapAdapter, MapRegion } from './MapAdapter';

export class ReactNativeMapAdapter implements MapAdapter {
    private readonly capabilityStateSubject = new BehaviorSubject<NativeCapabilityState>('undetermined');
    private readonly viewportChangesSubject = new Subject<MachineViewport>();
    private disposed = false;

    readonly capabilityState$ = this.capabilityStateSubject.asObservable();
    readonly viewportChanges$ = this.viewportChangesSubject.asObservable();

    readonly onMapReady = (): void => {
        this.setCapabilityState('granted');
    };

    readonly onMapUnavailable = (): void => {
        this.setCapabilityState('unavailable');
    };

    readonly onRegionChangeComplete = (region: MapRegion): void => {
        if (this.disposed || this.capabilityStateSubject.value !== 'granted') {
            return;
        }

        const viewport = toMachineViewport(region);
        if (viewport !== null) {
            this.viewportChangesSubject.next(viewport);
        }
    };

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.capabilityStateSubject.complete();
        this.viewportChangesSubject.complete();
    }

    private setCapabilityState(state: NativeCapabilityState): void {
        if (!this.disposed && this.capabilityStateSubject.value !== state) {
            this.capabilityStateSubject.next(state);
        }
    }
}

function toMachineViewport(region: MapRegion): MachineViewport | null {
    const values = [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta];
    if (!values.every(Number.isFinite) || region.latitudeDelta <= 0 || region.longitudeDelta <= 0) {
        return null;
    }

    const latitudeRadius = region.latitudeDelta / 2;
    const longitudeRadius = region.longitudeDelta / 2;
    const viewport = {
        north: region.latitude + latitudeRadius,
        east: region.longitude + longitudeRadius,
        south: region.latitude - latitudeRadius,
        west: region.longitude - longitudeRadius,
    };

    if (viewport.north > 90 || viewport.south < -90 || viewport.east > 180 || viewport.west < -180) {
        return null;
    }

    return viewport;
}
