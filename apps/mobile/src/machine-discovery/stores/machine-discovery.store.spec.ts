import { configure, isAction, isComputedProp, isObservableProp } from 'mobx';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

import { MachineDiscoveryStore } from './machine-discovery.store';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineDiscoveryContext,
    MachineId,
    MachineRevision,
    MachineSelectionHandoff,
    MachineSummary,
} from '../machine-discovery.types';
import type { NativeCapabilityState } from '../native/LocationAdapter';

describe('MachineDiscoveryStore', () => {
    beforeAll(() => configure({ enforceActions: 'always' }));

    it('is the observable owner of discovery, native, card, handoff, loading, and error state', () => {
        const store = new MachineDiscoveryStore();

        for (const property of [
            'discoveryContext',
            'viewMode',
            'locationCapability',
            'mapCapability',
            'scannerCapability',
            'scannerState',
            'currentCard',
            'currentDetail',
            'selectionHandoff',
            'catalogLoading',
            'detailLoading',
            'resolutionLoading',
            'selectionLoading',
            'error',
            'sessionEpoch',
        ] as const) {
            expect(isObservableProp(store, property)).toBe(true);
        }
        expect(isComputedProp(store, 'catalog')).toBe(true);

        expect(store.discoveryContext).toBeUndefined();
        expect(store.catalog).toEqual([]);
        expect(store.viewMode).toBe('map');
        expect(store.scannerState).toBe('idle');
        expect(store.sessionEpoch).toBe(0);
        expectTypeOf(store.selectionHandoff).toEqualTypeOf<MachineSelectionHandoff | undefined>();
    });

    it('deduplicates the catalog by public machine id and preserves stable order while updating entries', () => {
        const store = new MachineDiscoveryStore();
        const first = summary('7mQ3LJvR9Gf2xK8pNc4YAw', '1', 'ONLINE');
        const updated = summary(first.machineId, '2', 'SERVICE');
        const second = summary('Q8pLm2Vx7Nw4Rk9Yc3TgZA', '1', 'OFFLINE');

        store.replaceCatalog([first, updated]);
        expect(store.catalog).toEqual([updated]);

        store.appendCatalog([updated, second]);
        expect(store.catalog).toEqual([updated, second]);
    });

    it('exposes side-effect-free typed transitions for every feature-owned state', () => {
        const store = new MachineDiscoveryStore();
        const context: MachineDiscoveryContext = {
            mode: 'SERVICE_AREA',
            serviceAreaCode: 'dakar',
            viewport: null,
        };
        const card = summary('7mQ3LJvR9Gf2xK8pNc4YAw', '1', 'ONLINE');
        const detail = machineDetail(card);
        const handoff = selectionHandoff(detail);

        store.setDiscoveryContext(context);
        store.setViewMode('list');
        store.setCapability('location', 'denied');
        store.setCapability('map', 'granted');
        store.setCapability('scanner', 'restricted');
        store.setScannerState('scanning');
        store.setCurrentCard(card);
        store.setCurrentDetail(detail);
        store.setSelectionHandoff(handoff);
        store.setLoading('catalog', true);
        store.setLoading('detail', true);
        store.setLoading('resolution', true);
        store.setLoading('selection', true);
        store.setError({ code: 'OFFLINE', retryable: true });

        expect(store.discoveryContext).toEqual(context);
        expect(store.viewMode).toBe('list');
        expect(store.locationCapability).toBe('denied');
        expect(store.mapCapability).toBe('granted');
        expect(store.scannerCapability).toBe('restricted');
        expect(store.scannerState).toBe('scanning');
        expect(store.currentCard).toEqual(card);
        expect(store.currentDetail).toEqual(detail);
        expect(store.selectionHandoff).toEqual(handoff);
        expect([store.catalogLoading, store.detailLoading, store.resolutionLoading, store.selectionLoading]).toEqual([
            true,
            true,
            true,
            true,
        ]);
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });

        for (const transition of [
            store.replaceCatalog,
            store.appendCatalog,
            store.setDiscoveryContext,
            store.setViewMode,
            store.setCapability,
            store.setScannerState,
            store.setCurrentCard,
            store.setCurrentDetail,
            store.setSelectionHandoff,
            store.setLoading,
            store.setError,
            store.nextRequestGeneration,
            store.advanceSessionEpoch,
        ]) {
            expect(isAction(transition)).toBe(true);
        }
    });

    it('increments request generations independently and advances the session epoch without async work', () => {
        const store = new MachineDiscoveryStore();

        expect(store.nextRequestGeneration('catalog')).toBe(1);
        expect(store.nextRequestGeneration('catalog')).toBe(2);
        expect(store.nextRequestGeneration('detail')).toBe(1);
        expect(store.nextRequestGeneration('resolution')).toBe(1);
        expect(store.nextRequestGeneration('selection')).toBe(1);
        expect(store.requestGeneration('catalog')).toBe(2);
        expect(store.requestGeneration('detail')).toBe(1);

        expect(store.advanceSessionEpoch()).toBe(1);
        expect(store.sessionEpoch).toBe(1);
    });
});

function summary(machineId: string, machineRevision: string, status: MachineSummary['status']): MachineSummary {
    return {
        machineId: machineId as MachineId,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
        status,
        machineRevision: machineRevision as MachineRevision,
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
        refreshedAt: '2026-08-15T10:00:00.000Z',
    };
}

function selectionHandoff(machine: MachineDetail): MachineSelectionHandoff {
    return {
        machineId: machine.machineId,
        machineRevision: machine.machineRevision,
        price: machine.price!,
        availability: 'ONLINE',
        validatedAt: '2026-08-15T10:00:01.000Z',
    };
}

expectTypeOf<NativeCapabilityState>().toEqualTypeOf<
    'undetermined' | 'granted' | 'denied' | 'restricted' | 'revoked' | 'unavailable'
>();
