import { asyncScheduler, Observable, Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeLocationAdapter, FakeMapAdapter, FakeScannerAdapter } from '../../testing/machine-discovery-native-fakes';
import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDiscoveryFlowService, type MachineDiscoveryApi } from './machine-discovery-flow.service';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    CatalogRevision,
    CurrencyCode,
    ExactMoneyString,
    MachineCatalogPage,
    MachineDetail,
    MachineDiscoveryContext,
    MachineId,
    MachineRevision,
    MachineSelectionHandoff,
} from '../machine-discovery.types';

interface StaleResultCommands {
    discover(accessToken: string, context: MachineDiscoveryContext): void;
    openMachine(accessToken: string, machineId: MachineId): void;
    resolveManualCode(accessToken: string, value: string): void;
    confirmSelection(accessToken: string): void;
}

const ACCESS_TOKEN = 'access-token';
const MACHINE_A = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const MACHINE_B = 'Q8pLm2Vx7Nw4Rk9Yc3TgZA' as MachineId;
const POSITION = { latitude: 14.716677, longitude: -17.467686 };
const CONTEXT_A: MachineDiscoveryContext = {
    mode: 'SERVICE_AREA',
    serviceAreaCode: 'dakar',
    viewport: null,
};
const CONTEXT_B: MachineDiscoveryContext = {
    mode: 'USER_LOCATION',
    position: POSITION,
    viewport: null,
};

const activeServices: MachineDiscoveryFlowService[] = [];

type PendingMachineResponse =
    | PendingResponse<MachineCatalogPage>
    | PendingResponse<MachineDetail>
    | PendingResponse<MachineSelectionHandoff>;

afterEach(() => {
    activeServices.splice(0).forEach((service) => service.dispose());
});

describe('MachineDiscoveryFlowService stale result rejection', () => {
    it('keeps the latest discovery result when an older catalog generation completes late', () => {
        const staleResponse = new PendingResponse<MachineCatalogPage>();
        const currentResponse = new PendingResponse<MachineCatalogPage>();
        const harness = setup(staleResponse, currentResponse);

        harness.flow.discover(ACCESS_TOKEN, CONTEXT_A);
        harness.flow.discover(ACCESS_TOKEN, CONTEXT_B);

        expect(staleResponse.cancelled).toBe(1);
        staleResponse.resolve(page(detail(MACHINE_A, '1')));
        currentResponse.resolve(page(detail(MACHINE_B, '2')));

        expect(harness.store.requestGeneration('catalog')).toBe(2);
        expect(harness.store.discoveryContext).toEqual(CONTEXT_B);
        expect(harness.store.catalog).toEqual([detail(MACHINE_B, '2')]);
        expect(harness.store.catalogLoading).toBe(false);
    });

    it('rejects delayed detail after a newer resolution generation starts', () => {
        const staleDetail = new PendingResponse<MachineDetail>();
        const currentResolution = new PendingResponse<MachineDetail>();
        const harness = setup(staleDetail, currentResolution);

        harness.flow.openMachine(ACCESS_TOKEN, MACHINE_A);
        harness.flow.resolveManualCode(ACCESS_TOKEN, 'DKR-PLATEAU-02');
        staleDetail.resolve(detail(MACHINE_A, '1'));

        expect(harness.store.requestGeneration('resolution')).toBe(1);
        expect(harness.store.currentDetail).toBeUndefined();

        const currentDetail = detail(MACHINE_B, '2');
        currentResolution.resolve(currentDetail);
        expect(harness.store.currentDetail).toEqual(currentDetail);
    });

    it('rejects delayed resolution after a newer detail generation starts', () => {
        const staleResolution = new PendingResponse<MachineDetail>();
        const currentDetail = new PendingResponse<MachineDetail>();
        const harness = setup(staleResolution, currentDetail);

        harness.flow.resolveManualCode(ACCESS_TOKEN, 'DKR-PLATEAU-01');
        harness.flow.openMachine(ACCESS_TOKEN, MACHINE_B);
        staleResolution.resolve(detail(MACHINE_A, '1'));

        expect(harness.store.requestGeneration('detail')).toBe(1);
        expect(harness.store.currentDetail).toBeUndefined();

        const resolvedDetail = detail(MACHINE_B, '2');
        currentDetail.resolve(resolvedDetail);
        expect(harness.store.currentDetail).toEqual(resolvedDetail);
    });

    it('rejects delayed revalidation after a newer detail generation starts', () => {
        const staleRevalidation = new PendingResponse<MachineSelectionHandoff>();
        const currentDetail = new PendingResponse<MachineDetail>();
        const harness = setup(staleRevalidation, currentDetail);
        harness.store.setCurrentDetail(detail(MACHINE_A, '1'));

        harness.flow.confirmSelection(ACCESS_TOKEN);
        harness.flow.openMachine(ACCESS_TOKEN, MACHINE_B);
        staleRevalidation.resolve(handoff(MACHINE_A, '1'));

        expect(harness.store.requestGeneration('detail')).toBe(1);
        expect(harness.store.selectionHandoff).toBeUndefined();

        currentDetail.resolve(detail(MACHINE_B, '2'));
        expect(harness.store.currentDetail).toEqual(detail(MACHINE_B, '2'));
    });
});

function setup(...responses: PendingMachineResponse[]) {
    const store = new MachineDiscoveryStore();
    const api = new ControlledApi(responses);
    const service = new MachineDiscoveryFlowService({
        api,
        clock: { now: () => 0 },
        timers: asyncScheduler,
        location: new FakeLocationAdapter('granted', POSITION),
        scanner: new FakeScannerAdapter('granted'),
        map: new FakeMapAdapter('granted'),
        serviceAreaCode: 'dakar',
        store,
    });
    activeServices.push(service);

    return { service, store, flow: service as unknown as StaleResultCommands };
}

class ControlledApi implements MachineDiscoveryApi {
    constructor(private readonly responses: PendingMachineResponse[]) {}

    request<T>(_accessToken: string, _request: MachineDiscoveryRequest<T>): Observable<T> {
        const response = this.responses.shift();
        if (!response) throw new Error('Unexpected machine request');
        return response.observable as unknown as Observable<T>;
    }
}

class PendingResponse<T> {
    private readonly subject = new Subject<T>();
    cancelled = 0;

    readonly observable = new Observable<T>((subscriber) => {
        const subscription = this.subject.subscribe(subscriber);
        return () => {
            this.cancelled += 1;
            subscription.unsubscribe();
        };
    });

    resolve(value: T): void {
        this.subject.next(value);
        this.subject.complete();
    }
}

function page(machine: MachineDetail): MachineCatalogPage {
    return {
        items: [machine],
        hasMore: false,
        catalogRevision: '1' as CatalogRevision,
    };
}

function detail(machineId: MachineId, machineRevision: string): MachineDetail {
    return {
        machineId,
        displayName: machineId === MACHINE_A ? 'Point eau Plateau' : 'Point eau Medina',
        address: machineId === MACHINE_A ? 'Dakar Plateau' : 'Dakar Medina',
        status: 'ONLINE',
        machineRevision: machineRevision as MachineRevision,
        price: {
            amountPerLiter: '0.50' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        selectable: true,
        refreshedAt: '2026-08-18T10:00:00.000Z',
    };
}

function handoff(machineId: MachineId, machineRevision: string): MachineSelectionHandoff {
    return {
        machineId,
        machineRevision: machineRevision as MachineRevision,
        price: {
            amountPerLiter: '0.50' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        availability: 'ONLINE',
        validatedAt: '2026-08-18T10:00:01.000Z',
    };
}
