import { autorun, configure } from 'mobx';
import { beforeAll, describe, expect, it } from 'vitest';

import { MachineDiscoveryStore } from './machine-discovery.store';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachineRevision,
    MachineSelectionHandoff,
    MachineSummary,
} from '../machine-discovery.types';

const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const SESSION_IDENTITY_CHANGES = [
    'access expiry with failed renewal',
    'logout',
    'account replacement',
    'session replacement',
] as const;

describe('MachineDiscoveryStore session isolation', () => {
    beforeAll(() => configure({ enforceActions: 'always' }));

    it.each(SESSION_IDENTITY_CHANGES)('atomically clears feature state on %s', () => {
        const store = new MachineDiscoveryStore();
        store.advanceSessionEpoch();
        populateStore(store);

        const observedStates: StoreSnapshot[] = [];
        const stopObserving = autorun(() => {
            observedStates.push(snapshot(store));
        });
        observedStates.length = 0;

        try {
            expect(store.advanceSessionEpoch()).toBe(2);

            expect(observedStates).toEqual([emptySnapshot(2)]);
            expect(snapshot(store)).toEqual(emptySnapshot(2));
        } finally {
            stopObserving();
        }
    });
});

interface StoreSnapshot {
    readonly sessionEpoch: number;
    readonly discoveryContext: MachineDiscoveryStore['discoveryContext'];
    readonly catalog: readonly MachineSummary[];
    readonly viewMode: MachineDiscoveryStore['viewMode'];
    readonly locationCapability: MachineDiscoveryStore['locationCapability'];
    readonly mapCapability: MachineDiscoveryStore['mapCapability'];
    readonly scannerCapability: MachineDiscoveryStore['scannerCapability'];
    readonly scannerState: MachineDiscoveryStore['scannerState'];
    readonly currentCard: MachineDiscoveryStore['currentCard'];
    readonly currentDetail: MachineDiscoveryStore['currentDetail'];
    readonly selectionHandoff: MachineDiscoveryStore['selectionHandoff'];
    readonly loading: readonly boolean[];
    readonly error: MachineDiscoveryStore['error'];
    readonly generations: readonly number[];
}

function populateStore(store: MachineDiscoveryStore): void {
    const card = machineSummary();
    const detail = machineDetail(card);

    store.setDiscoveryContext({ mode: 'SERVICE_AREA', serviceAreaCode: 'dakar', viewport: null });
    store.replaceCatalog([card]);
    store.setViewMode('list');
    store.setCapability('location', 'denied');
    store.setCapability('map', 'granted');
    store.setCapability('scanner', 'restricted');
    store.setScannerState('resolving');
    store.setCurrentCard(card);
    store.setCurrentDetail(detail);
    store.setSelectionHandoff(selectionHandoff(detail));
    store.setLoading('catalog', true);
    store.setLoading('detail', true);
    store.setLoading('resolution', true);
    store.setLoading('selection', true);
    store.setError({ code: 'OFFLINE', retryable: true });
    store.nextRequestGeneration('catalog');
    store.nextRequestGeneration('detail');
    store.nextRequestGeneration('resolution');
    store.nextRequestGeneration('selection');
}

function snapshot(store: MachineDiscoveryStore): StoreSnapshot {
    return {
        sessionEpoch: store.sessionEpoch,
        discoveryContext: store.discoveryContext,
        catalog: store.catalog,
        viewMode: store.viewMode,
        locationCapability: store.locationCapability,
        mapCapability: store.mapCapability,
        scannerCapability: store.scannerCapability,
        scannerState: store.scannerState,
        currentCard: store.currentCard,
        currentDetail: store.currentDetail,
        selectionHandoff: store.selectionHandoff,
        loading: [store.catalogLoading, store.detailLoading, store.resolutionLoading, store.selectionLoading],
        error: store.error,
        generations: [
            store.requestGeneration('catalog'),
            store.requestGeneration('detail'),
            store.requestGeneration('resolution'),
            store.requestGeneration('selection'),
        ],
    };
}

function emptySnapshot(sessionEpoch: number): StoreSnapshot {
    return {
        sessionEpoch,
        discoveryContext: undefined,
        catalog: [],
        viewMode: 'map',
        locationCapability: 'undetermined',
        mapCapability: 'undetermined',
        scannerCapability: 'undetermined',
        scannerState: 'idle',
        currentCard: undefined,
        currentDetail: undefined,
        selectionHandoff: undefined,
        loading: [false, false, false, false],
        error: undefined,
        generations: [0, 0, 0, 0],
    };
}

function machineSummary(): MachineSummary {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
        status: 'ONLINE',
        machineRevision: '1' as MachineRevision,
    };
}

function machineDetail(machine: MachineSummary): MachineDetail {
    return {
        ...machine,
        price: {
            amountPerLiter: '25.00' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        selectable: true,
        refreshedAt: '2026-08-24T10:00:00.000Z',
    };
}

function selectionHandoff(machine: MachineDetail): MachineSelectionHandoff {
    return {
        machineId: machine.machineId,
        machineRevision: machine.machineRevision,
        price: machine.price!,
        availability: 'ONLINE',
        validatedAt: '2026-08-24T10:00:01.000Z',
    };
}
