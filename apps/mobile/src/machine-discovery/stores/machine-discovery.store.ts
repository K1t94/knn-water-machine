import { action, computed, makeObservable, observable } from 'mobx';

import type {
    MachineDetail,
    MachineDiscoveryContext,
    MachineSelectionHandoff,
    MachineSummary,
} from '../machine-discovery.types';
import type { NativeCapabilityState } from '../native/LocationAdapter';

export type MachineDiscoveryViewMode = 'map' | 'list';
export type MachineDiscoveryCapability = 'location' | 'map' | 'scanner';
export type MachineDiscoveryScannerState = 'idle' | 'scanning' | 'resolving';
export type MachineDiscoveryOperation = 'catalog' | 'detail' | 'resolution' | 'selection';

export interface MachineDiscoveryPresentationError {
    readonly code: string;
    readonly retryable: boolean;
}

export class MachineDiscoveryStore {
    discoveryContext: MachineDiscoveryContext | undefined = undefined;
    viewMode: MachineDiscoveryViewMode = 'map';
    locationCapability: NativeCapabilityState = 'undetermined';
    mapCapability: NativeCapabilityState = 'undetermined';
    scannerCapability: NativeCapabilityState = 'undetermined';
    scannerState: MachineDiscoveryScannerState = 'idle';
    currentCard: MachineSummary | undefined = undefined;
    currentDetail: MachineDetail | undefined = undefined;
    selectionHandoff: MachineSelectionHandoff | undefined = undefined;
    catalogLoading = false;
    detailLoading = false;
    resolutionLoading = false;
    selectionLoading = false;
    error: MachineDiscoveryPresentationError | undefined = undefined;
    sessionEpoch = 0;

    private catalogItems: MachineSummary[] = [];
    private readonly requestGenerations: Record<MachineDiscoveryOperation, number> = {
        catalog: 0,
        detail: 0,
        resolution: 0,
        selection: 0,
    };

    constructor() {
        makeObservable<this, 'catalogItems'>(this, {
            discoveryContext: observable.ref,
            catalogItems: observable.shallow,
            viewMode: observable,
            locationCapability: observable,
            mapCapability: observable,
            scannerCapability: observable,
            scannerState: observable,
            currentCard: observable.ref,
            currentDetail: observable.ref,
            selectionHandoff: observable.ref,
            catalogLoading: observable,
            detailLoading: observable,
            resolutionLoading: observable,
            selectionLoading: observable,
            error: observable.ref,
            sessionEpoch: observable,
            catalog: computed,
            replaceCatalog: action.bound,
            appendCatalog: action.bound,
            setDiscoveryContext: action.bound,
            setViewMode: action.bound,
            setCapability: action.bound,
            setScannerState: action.bound,
            setCurrentCard: action.bound,
            setCurrentDetail: action.bound,
            setSelectionHandoff: action.bound,
            setLoading: action.bound,
            setError: action.bound,
            nextRequestGeneration: action.bound,
            advanceSessionEpoch: action.bound,
        });
    }

    get catalog(): readonly MachineSummary[] {
        return this.catalogItems;
    }

    replaceCatalog(items: readonly MachineSummary[]): void {
        this.catalogItems = deduplicateCatalog(items);
    }

    appendCatalog(items: readonly MachineSummary[]): void {
        this.catalogItems = deduplicateCatalog([...this.catalogItems, ...items]);
    }

    setDiscoveryContext(context: MachineDiscoveryContext | undefined): void {
        this.discoveryContext = context;
    }

    setViewMode(mode: MachineDiscoveryViewMode): void {
        this.viewMode = mode;
    }

    setCapability(capability: MachineDiscoveryCapability, state: NativeCapabilityState): void {
        if (capability === 'location') this.locationCapability = state;
        if (capability === 'map') this.mapCapability = state;
        if (capability === 'scanner') this.scannerCapability = state;
    }

    setScannerState(state: MachineDiscoveryScannerState): void {
        this.scannerState = state;
    }

    setCurrentCard(machine: MachineSummary | undefined): void {
        this.currentCard = machine;
    }

    setCurrentDetail(machine: MachineDetail | undefined): void {
        this.currentDetail = machine;
    }

    setSelectionHandoff(handoff: MachineSelectionHandoff | undefined): void {
        this.selectionHandoff = handoff;
    }

    setLoading(operation: MachineDiscoveryOperation, loading: boolean): void {
        if (operation === 'catalog') this.catalogLoading = loading;
        if (operation === 'detail') this.detailLoading = loading;
        if (operation === 'resolution') this.resolutionLoading = loading;
        if (operation === 'selection') this.selectionLoading = loading;
    }

    setError(error: MachineDiscoveryPresentationError | undefined): void {
        this.error = error;
    }

    nextRequestGeneration(operation: MachineDiscoveryOperation): number {
        this.requestGenerations[operation] += 1;
        return this.requestGenerations[operation];
    }

    requestGeneration(operation: MachineDiscoveryOperation): number {
        return this.requestGenerations[operation];
    }

    advanceSessionEpoch(): number {
        this.sessionEpoch += 1;
        this.discoveryContext = undefined;
        this.catalogItems = [];
        this.viewMode = 'map';
        this.locationCapability = 'undetermined';
        this.mapCapability = 'undetermined';
        this.scannerCapability = 'undetermined';
        this.scannerState = 'idle';
        this.currentCard = undefined;
        this.currentDetail = undefined;
        this.selectionHandoff = undefined;
        this.catalogLoading = false;
        this.detailLoading = false;
        this.resolutionLoading = false;
        this.selectionLoading = false;
        this.error = undefined;

        for (const operation of Object.keys(this.requestGenerations) as MachineDiscoveryOperation[]) {
            this.requestGenerations[operation] = 0;
        }

        return this.sessionEpoch;
    }
}

function deduplicateCatalog(items: readonly MachineSummary[]): MachineSummary[] {
    const machines = new Map(items.map((machine) => [machine.machineId, machine]));
    return [...machines.values()];
}
