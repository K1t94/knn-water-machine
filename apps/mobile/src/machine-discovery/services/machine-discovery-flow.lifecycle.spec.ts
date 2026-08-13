import { asyncScheduler, BehaviorSubject, Observable, of, Subject, type Subscriber } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import {
    MachineDiscoveryFlowService,
    type MachineDiscoveryApi,
    type MachineDiscoveryFlowDependencies,
} from './machine-discovery-flow.service';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    CatalogRevision,
    MachineCatalogPage,
    MachineCoordinates,
    MachineId,
    MachineRevision,
    MachineSummary,
    MachineViewport,
} from '../machine-discovery.types';
import type { LocationAdapter, NativeCapabilityState } from '../native/LocationAdapter';
import type { MapAdapter } from '../native/MapAdapter';
import type { ScannerAdapter } from '../native/ScannerAdapter';

const ACCESS_TOKEN = 'access-token';
const SERVICE_AREA_CODE = 'dakar';
const USER_POSITION: MachineCoordinates = { latitude: 14.7167, longitude: -17.4677 };

interface LifecycleCommands {
    startDiscovery(accessToken: string): void;
    stopDiscovery(): void;
}

class ControlledLocationAdapter implements LocationAdapter {
    private readonly capability = new BehaviorSubject<NativeCapabilityState>('undetermined');
    private readonly positions = new Subject<MachineCoordinates>();

    readonly capabilityState$ = this.capability.asObservable();
    readonly getCurrentPosition = vi.fn(() => this.positions.asObservable());
    readonly dispose = vi.fn(() => {
        this.capability.complete();
        this.positions.complete();
    });

    setCapabilityState(state: NativeCapabilityState): void {
        this.capability.next(state);
    }

    emitPosition(position: MachineCoordinates): void {
        this.positions.next(position);
    }
}

class StaticMapAdapter implements MapAdapter {
    readonly capabilityState$ = new BehaviorSubject<NativeCapabilityState>('granted');
    readonly viewportChanges$ = new Subject<MachineViewport>();
    readonly dispose = vi.fn(() => {
        this.capabilityState$.complete();
        this.viewportChanges$.complete();
    });
}

class StaticScannerAdapter implements ScannerAdapter {
    readonly capabilityState$ = new BehaviorSubject<NativeCapabilityState>('granted');
    readonly scanResults$ = new Subject<string>();
    readonly dispose = vi.fn(() => {
        this.capabilityState$.complete();
        this.scanResults$.complete();
    });
}

class PendingResponse<T> {
    private observer: Subscriber<T> | undefined;
    private settled = false;

    readonly cancelled = vi.fn();
    readonly observable = new Observable<T>((observer) => {
        this.observer = observer;
        return () => {
            if (!this.settled) this.cancelled();
        };
    });

    resolve(value: T): void {
        this.settled = true;
        this.observer?.next(value);
        this.observer?.complete();
    }
}

class RecordingMachineDiscoveryApi implements MachineDiscoveryApi {
    readonly requests: {
        accessToken: string;
        request: MachineDiscoveryRequest<unknown>;
    }[] = [];

    constructor(private readonly responses: readonly Observable<MachineCatalogPage>[] = []) {}

    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T> {
        const requestIndex = this.requests.length;
        this.requests.push({ accessToken, request });
        return (this.responses[requestIndex] ?? of(emptyPage())) as Observable<T>;
    }
}

function emptyPage(items: readonly MachineSummary[] = []): MachineCatalogPage {
    return {
        items,
        hasMore: false,
        catalogRevision: '1' as CatalogRevision,
    };
}

function summary(id: string): MachineSummary {
    return {
        machineId: id as MachineId,
        displayName: `Machine ${id}`,
        address: 'Dakar',
        status: 'ONLINE',
        machineRevision: '1' as MachineRevision,
    };
}

function createHarness(responses: readonly Observable<MachineCatalogPage>[] = []) {
    const api = new RecordingMachineDiscoveryApi(responses);
    const location = new ControlledLocationAdapter();
    const store = new MachineDiscoveryStore();
    const dependencies = {
        api,
        clock: { now: () => Date.parse('2026-08-24T12:00:00.000Z') },
        location,
        map: new StaticMapAdapter(),
        scanner: new StaticScannerAdapter(),
        store,
        timers: asyncScheduler,
        serviceAreaCode: SERVICE_AREA_CODE,
    } as MachineDiscoveryFlowDependencies & { readonly serviceAreaCode: string };
    const service = new MachineDiscoveryFlowService(dependencies);

    return {
        api,
        lifecycle: service as MachineDiscoveryFlowService & LifecycleCommands,
        location,
        service,
        store,
    };
}

describe('MachineDiscoveryFlowService route lifecycle', () => {
    it('requests location and starts exactly one user-location catalog load on entry', () => {
        const harness = createHarness();
        try {
            harness.lifecycle.startDiscovery(ACCESS_TOKEN);
            harness.location.setCapabilityState('granted');
            harness.location.emitPosition(USER_POSITION);

            expect(harness.location.getCurrentPosition).toHaveBeenCalledTimes(1);
            expect(harness.api.requests).toHaveLength(1);
            expect(harness.api.requests[0]?.accessToken).toBe(ACCESS_TOKEN);
            expect(harness.api.requests[0]?.request.path).toContain(
                `latitude=${USER_POSITION.latitude}`,
            );
            expect(harness.api.requests[0]?.request.path).toContain(
                `longitude=${USER_POSITION.longitude}`,
            );
            expect(harness.store.discoveryContext).toEqual({
                mode: 'USER_LOCATION',
                position: USER_POSITION,
                viewport: null,
            });
        } finally {
            harness.service.dispose();
        }
    });

    it.each<NativeCapabilityState>(['denied', 'restricted', 'revoked', 'unavailable'])(
        'falls back to the configured service area when location is %s',
        (capability) => {
            const harness = createHarness();
            try {
                harness.lifecycle.startDiscovery(ACCESS_TOKEN);
                harness.location.setCapabilityState(capability);

                expect(harness.location.getCurrentPosition).toHaveBeenCalledTimes(1);
                expect(harness.api.requests).toHaveLength(1);
                expect(harness.api.requests[0]?.request.path).not.toContain('latitude=');
                expect(harness.api.requests[0]?.request.path).not.toContain('longitude=');
                expect(harness.store.discoveryContext).toEqual({
                    mode: 'SERVICE_AREA',
                    serviceAreaCode: SERVICE_AREA_CODE,
                    viewport: null,
                });
            } finally {
                harness.service.dispose();
            }
        },
    );

    it('switches discovery context on capability changes without duplicating catalog entries', () => {
        const fallbackResponse = new Subject<MachineCatalogPage>();
        const locatedResponse = new Subject<MachineCatalogPage>();
        const revokedResponse = new Subject<MachineCatalogPage>();
        const harness = createHarness([fallbackResponse, locatedResponse, revokedResponse]);

        try {
            harness.lifecycle.startDiscovery(ACCESS_TOKEN);
            harness.location.setCapabilityState('denied');
            fallbackResponse.next(emptyPage([summary('machine-a')]));
            fallbackResponse.complete();

            harness.location.setCapabilityState('granted');
            harness.location.emitPosition(USER_POSITION);
            locatedResponse.next(emptyPage([summary('machine-a'), summary('machine-b')]));
            locatedResponse.complete();

            expect(harness.api.requests).toHaveLength(2);
            expect(harness.store.catalog.map((item) => item.machineId)).toEqual([
                'machine-a',
                'machine-b',
            ]);
            expect(harness.store.discoveryContext?.mode).toBe('USER_LOCATION');

            harness.location.setCapabilityState('revoked');
            expect(harness.api.requests).toHaveLength(3);
            expect(harness.store.catalog.map((item) => item.machineId)).toEqual([
                'machine-a',
                'machine-b',
            ]);
            expect(harness.store.discoveryContext?.mode).toBe('SERVICE_AREA');
        } finally {
            harness.service.dispose();
        }
    });

    it('cancels route work and prevents late catalog commits after stop', () => {
        const pending = new PendingResponse<MachineCatalogPage>();
        const harness = createHarness([pending.observable]);
        try {
            harness.lifecycle.startDiscovery(ACCESS_TOKEN);
            harness.location.setCapabilityState('granted');
            harness.location.emitPosition(USER_POSITION);
            harness.lifecycle.stopDiscovery();
            pending.resolve(emptyPage([summary('late-machine')]));

            expect(pending.cancelled).toHaveBeenCalledTimes(1);
            expect(harness.store.catalog).toEqual([]);
        } finally {
            harness.service.dispose();
        }
    });

    it('prevents late lifecycle commits after the authenticated session is replaced', () => {
        const pending = new PendingResponse<MachineCatalogPage>();
        const harness = createHarness([pending.observable]);
        try {
            harness.lifecycle.startDiscovery(ACCESS_TOKEN);
            harness.location.setCapabilityState('granted');
            harness.location.emitPosition(USER_POSITION);
            harness.store.advanceSessionEpoch();
            pending.resolve(emptyPage([summary('previous-account-machine')]));

            expect(pending.cancelled).toHaveBeenCalledTimes(1);
            expect(harness.store.catalog).toEqual([]);
        } finally {
            harness.service.dispose();
        }
    });
});
