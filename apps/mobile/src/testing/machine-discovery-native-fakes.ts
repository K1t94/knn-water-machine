import { BehaviorSubject, of, Subject } from 'rxjs';

import type { MachineCoordinates, MachineViewport } from '../machine-discovery/machine-discovery.types';
import type { LocationAdapter, NativeCapabilityState } from '../machine-discovery/native/LocationAdapter';
import type { MapAdapter } from '../machine-discovery/native/MapAdapter';
import type { ScannerAdapter } from '../machine-discovery/native/ScannerAdapter';
import type { Observable } from 'rxjs';

export class FakeLocationAdapter implements LocationAdapter {
    private readonly capabilityStateSubject: BehaviorSubject<NativeCapabilityState>;
    private position: MachineCoordinates;

    readonly capabilityState$: Observable<NativeCapabilityState>;

    constructor(capabilityState: NativeCapabilityState, position: MachineCoordinates) {
        this.capabilityStateSubject = new BehaviorSubject(capabilityState);
        this.capabilityState$ = this.capabilityStateSubject.asObservable();
        this.position = position;
    }

    setCapabilityState(capabilityState: NativeCapabilityState): void {
        this.capabilityStateSubject.next(capabilityState);
    }

    setPosition(position: MachineCoordinates): void {
        this.position = position;
    }

    getCurrentPosition(): Observable<MachineCoordinates> {
        return of(this.position);
    }

    dispose(): void {
        this.capabilityStateSubject.complete();
    }
}

export class FakeScannerAdapter implements ScannerAdapter {
    private readonly capabilityStateSubject: BehaviorSubject<NativeCapabilityState>;
    private readonly scanResultsSubject = new Subject<string>();

    readonly capabilityState$: Observable<NativeCapabilityState>;
    readonly scanResults$ = this.scanResultsSubject.asObservable();

    constructor(capabilityState: NativeCapabilityState) {
        this.capabilityStateSubject = new BehaviorSubject(capabilityState);
        this.capabilityState$ = this.capabilityStateSubject.asObservable();
    }

    setCapabilityState(capabilityState: NativeCapabilityState): void {
        this.capabilityStateSubject.next(capabilityState);
    }

    emitScan(value: string): void {
        this.scanResultsSubject.next(value);
    }

    dispose(): void {
        this.capabilityStateSubject.complete();
        this.scanResultsSubject.complete();
    }
}

export class FakeMapAdapter implements MapAdapter {
    private readonly capabilityStateSubject: BehaviorSubject<NativeCapabilityState>;
    private readonly viewportChangesSubject = new Subject<MachineViewport>();

    readonly capabilityState$: Observable<NativeCapabilityState>;
    readonly viewportChanges$ = this.viewportChangesSubject.asObservable();

    constructor(capabilityState: NativeCapabilityState) {
        this.capabilityStateSubject = new BehaviorSubject(capabilityState);
        this.capabilityState$ = this.capabilityStateSubject.asObservable();
    }

    setCapabilityState(capabilityState: NativeCapabilityState): void {
        this.capabilityStateSubject.next(capabilityState);
    }

    emitViewport(viewport: MachineViewport): void {
        this.viewportChangesSubject.next(viewport);
    }

    dispose(): void {
        this.capabilityStateSubject.complete();
        this.viewportChangesSubject.complete();
    }
}
