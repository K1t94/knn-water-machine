import { asyncScheduler, Observable, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { FakeLocationAdapter, FakeMapAdapter, FakeScannerAdapter } from '../../testing/machine-discovery-native-fakes';
import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDiscoveryFlowService, type MachineDiscoveryApi } from './machine-discovery-flow.service';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    CatalogCursor,
    CatalogRevision,
    MachineCatalogPage,
    MachineCoordinates,
    MachineDiscoveryContext,
    MachineId,
    MachineRevision,
    MachineSummary,
    MachineViewport,
} from '../machine-discovery.types';
import type { MachineDiscoveryViewMode } from '../stores/machine-discovery.store';

interface DiscoveryCommands {
    discover(accessToken: string, context: MachineDiscoveryContext): void;
    updateViewport(viewport: MachineViewport | null): void;
    refresh(): void;
    loadNextPage(): void;
    setViewMode(mode: MachineDiscoveryViewMode): void;
}

const ACCESS_TOKEN = 'access-token';
const POSITION_A = { latitude: 14.716677, longitude: -17.467686 };
const POSITION_B = { latitude: 14.7392, longitude: -17.4931 };
const VIEWPORT_A = { north: 14.8, east: -17.3, south: 14.6, west: -17.6 };
const VIEWPORT_B = { north: 14.78, east: -17.38, south: 14.66, west: -17.54 };

describe('MachineDiscoveryFlowService discovery', () => {
    it('switches to the latest position, viewport, and refresh request and rejects late results', () => {
        const firstPosition = new PendingResponse<MachineCatalogPage>();
        const secondPosition = new PendingResponse<MachineCatalogPage>();
        const viewport = new PendingResponse<MachineCatalogPage>();
        const refresh = new PendingResponse<MachineCatalogPage>();
        const harness = setup(firstPosition, secondPosition, viewport, refresh);

        harness.flow.discover(ACCESS_TOKEN, userLocation(POSITION_A, VIEWPORT_A));
        harness.flow.discover(ACCESS_TOKEN, userLocation(POSITION_B, VIEWPORT_A));

        expect(firstPosition.cancelled).toBe(1);

        harness.flow.updateViewport(VIEWPORT_B);
        expect(secondPosition.cancelled).toBe(1);

        harness.flow.refresh();
        expect(viewport.cancelled).toBe(1);

        refresh.resolve(page([summary('Q8pLm2Vx7Nw4Rk9Yc3TgZA', '4')], undefined, '12'));
        firstPosition.emit(page([summary('7mQ3LJvR9Gf2xK8pNc4YAw', '1')], undefined, '9'));
        secondPosition.emit(page([summary('R4tNv8Kp2Jx7Wm5Qc9YgLA', '2')], undefined, '10'));
        viewport.emit(page([summary('X6dMs3Vz8Hr1Pk7Nb4QaJw', '3')], undefined, '11'));

        expect(harness.store.catalog.map(({ machineId }) => machineId)).toEqual(['Q8pLm2Vx7Nw4Rk9Yc3TgZA']);
        expect(harness.store.discoveryContext).toEqual(userLocation(POSITION_B, VIEWPORT_B));
        expect(harness.store.requestGeneration('catalog')).toBe(4);
        expect(harness.store.catalogLoading).toBe(false);

        harness.service.dispose();
    });

    it('cancels pagination from an old generation and exhausts repeated page intents', () => {
        const initial = new PendingResponse<MachineCatalogPage>();
        const oldPage = new PendingResponse<MachineCatalogPage>();
        const refresh = new PendingResponse<MachineCatalogPage>();
        const nextPage = new PendingResponse<MachineCatalogPage>();
        const harness = setup(initial, oldPage, refresh, nextPage);
        const first = summary('7mQ3LJvR9Gf2xK8pNc4YAw', '1');
        const updatedFirst = summary(first.machineId, '2');
        const second = summary('Q8pLm2Vx7Nw4Rk9Yc3TgZA', '1');

        harness.flow.discover(ACCESS_TOKEN, serviceArea());
        initial.resolve(page([first], 'page-2', '20'));

        harness.flow.loadNextPage();
        harness.flow.loadNextPage();
        expect(harness.api.calls).toHaveLength(2);
        expect(oldPage.subscribed).toBe(1);

        harness.flow.refresh();
        expect(oldPage.cancelled).toBe(1);
        oldPage.emit(page([second], undefined, '20'));
        refresh.resolve(page([updatedFirst], 'page-2-new', '21'));

        harness.flow.loadNextPage();
        harness.flow.loadNextPage();
        expect(harness.api.calls).toHaveLength(4);
        expect(nextPage.subscribed).toBe(1);

        nextPage.resolve(page([updatedFirst, second], undefined, '21'));
        expect(harness.store.catalog).toEqual([updatedFirst, second]);
        expect(new Set(harness.store.catalog.map(({ machineId }) => machineId)).size).toBe(2);

        harness.service.dispose();
    });

    it('preserves discovery context and catalog while switching between list and map', () => {
        const initial = new PendingResponse<MachineCatalogPage>();
        const viewport = new PendingResponse<MachineCatalogPage>();
        const harness = setup(initial, viewport);
        const machine = summary('7mQ3LJvR9Gf2xK8pNc4YAw', '1');

        harness.flow.discover(ACCESS_TOKEN, userLocation(POSITION_A, VIEWPORT_A));
        initial.resolve(page([machine], undefined, '30'));
        harness.flow.setViewMode('list');

        expect(harness.api.calls).toHaveLength(1);
        expect(harness.store.viewMode).toBe('list');
        expect(harness.store.discoveryContext).toEqual(userLocation(POSITION_A, VIEWPORT_A));
        expect(harness.store.catalog).toEqual([machine]);

        harness.flow.updateViewport(VIEWPORT_B);
        viewport.resolve(page([machine], undefined, '30'));
        harness.flow.setViewMode('map');

        expect(harness.api.calls).toHaveLength(2);
        expect(harness.store.viewMode).toBe('map');
        expect(harness.store.discoveryContext).toEqual(userLocation(POSITION_A, VIEWPORT_B));
        expect(harness.store.catalog).toEqual([machine]);

        harness.service.dispose();
    });
});

function setup(...responses: PendingResponse<MachineCatalogPage>[]) {
    const store = new MachineDiscoveryStore();
    const api = new ControlledDiscoveryApi(responses);
    const service = new MachineDiscoveryFlowService({
        api,
        clock: { now: () => 0 },
        timers: asyncScheduler,
        location: new FakeLocationAdapter('granted', POSITION_A),
        scanner: new FakeScannerAdapter('granted'),
        map: new FakeMapAdapter('granted'),
        serviceAreaCode: 'dakar',
        store,
    });

    return { api, service, store, flow: service as unknown as DiscoveryCommands };
}

class ControlledDiscoveryApi implements MachineDiscoveryApi {
    readonly calls: { accessToken: string; request: MachineDiscoveryRequest<unknown> }[] = [];

    constructor(private readonly responses: PendingResponse<MachineCatalogPage>[]) {}

    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T> {
        const response = this.responses.shift();
        if (!response) throw new Error('Unexpected discovery request');
        this.calls.push({
            accessToken,
            request,
        });
        return response.observable as unknown as Observable<T>;
    }
}

class PendingResponse<T> {
    private readonly subject = new Subject<T>();
    subscribed = 0;
    cancelled = 0;

    readonly observable = new Observable<T>((subscriber) => {
        this.subscribed += 1;
        const subscription = this.subject.subscribe(subscriber);
        return () => {
            this.cancelled += 1;
            subscription.unsubscribe();
        };
    });

    emit(value: T): void {
        this.subject.next(value);
    }

    resolve(value: T): void {
        this.subject.next(value);
        this.subject.complete();
    }
}

function userLocation(position: MachineCoordinates, viewport: MachineViewport): MachineDiscoveryContext {
    return { mode: 'USER_LOCATION', position, viewport };
}

function serviceArea(): MachineDiscoveryContext {
    return { mode: 'SERVICE_AREA', serviceAreaCode: 'dakar', viewport: null };
}

function page(
    items: readonly MachineSummary[],
    nextCursor: string | undefined,
    catalogRevision: string,
): MachineCatalogPage {
    return {
        items,
        ...(nextCursor === undefined ? {} : { nextCursor: nextCursor as CatalogCursor }),
        hasMore: nextCursor !== undefined,
        catalogRevision: catalogRevision as CatalogRevision,
    };
}

function summary(machineId: string, machineRevision: string): MachineSummary {
    return {
        machineId: machineId as MachineId,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
        status: 'ONLINE',
        machineRevision: machineRevision as MachineRevision,
    };
}
