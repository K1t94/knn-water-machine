import { reaction } from 'mobx';
import { EMPTY, Subject, Subscription, catchError, exhaustMap, finalize, switchMap, takeUntil, tap } from 'rxjs';

import {
    MachineDiscoveryApiError,
    createDiscoverMachinesRequest,
    createMachineDetailRequest,
    createMachineSelectionRevalidationRequest,
    createResolveMachineRequest,
} from '../../api/machine-discovery-api';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    MachineCatalogPage,
    MachineDiscoveryContext,
    MachineId,
    MachineIdentifierInput,
    MachineRevision,
    MachineViewport,
} from '../machine-discovery.types';
import type { LocationAdapter } from '../native/LocationAdapter';
import type { MapAdapter } from '../native/MapAdapter';
import type { ScannerAdapter } from '../native/ScannerAdapter';
import type {
    MachineDiscoveryOperation,
    MachineDiscoveryStore,
    MachineDiscoveryViewMode,
} from '../stores/machine-discovery.store';
import type { Observable, SchedulerLike, TimestampProvider } from 'rxjs';

export interface MachineDiscoveryApi {
    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T>;
}

export interface MachineDiscoveryFlowDependencies {
    readonly api: MachineDiscoveryApi;
    readonly clock: TimestampProvider;
    readonly timers: SchedulerLike;
    readonly serviceAreaCode: string;
    readonly location: LocationAdapter;
    readonly scanner: ScannerAdapter;
    readonly map: MapAdapter;
    readonly store: MachineDiscoveryStore;
}

export interface MachineDiscoveryCommands {
    discover(accessToken: string, context: MachineDiscoveryContext): void;
    updateViewport(viewport: MachineViewport | null): void;
    refresh(): void;
    loadNextPage(): void;
    setViewMode(mode: MachineDiscoveryViewMode): void;
    openMachine(accessToken: string, machineId: MachineId): void;
}

interface RequestVersion {
    readonly sessionEpoch: number;
    readonly generation: number;
    readonly intentGeneration?: number;
}

interface CatalogCommand extends RequestVersion {
    readonly accessToken: string;
    readonly context: MachineDiscoveryContext;
}

interface DetailCommand extends RequestVersion {
    readonly accessToken: string;
    readonly machineId: MachineId;
}

interface ResolutionCommand extends RequestVersion {
    readonly accessToken: string;
    readonly input: MachineIdentifierInput;
}

interface SelectionCommand extends RequestVersion {
    readonly accessToken: string;
    readonly machineId: MachineId;
    readonly expectedMachineRevision: MachineRevision;
}

const DUPLICATE_QR_WINDOW_MS = 60_000;
const MACHINE_INTENT_OPERATIONS = ['detail', 'resolution', 'selection'] as const;

export class MachineDiscoveryFlowService implements MachineDiscoveryCommands {
    private readonly subscriptions = new Subscription();
    private readonly catalogRequests = new Subject<CatalogCommand>();
    private readonly pageRequests = new Subject<void>();
    private readonly pageCancellation = new Subject<void>();
    private readonly routeCancellation = new Subject<void>();
    private readonly sessionCancellation = new Subject<void>();
    private readonly detailRequests = new Subject<DetailCommand>();
    private readonly resolutionRequests = new Subject<ResolutionCommand | null>();
    private readonly selectionRequests = new Subject<SelectionCommand>();
    private accessToken: string | undefined;
    private scannerAccessToken: string | undefined;
    private lastQrDetection: { readonly value: string; readonly detectedAt: number } | undefined;
    private currentPage: MachineCatalogPage | undefined;
    private machineIntentGeneration = 0;
    private routeSubscriptions: Subscription | undefined;
    private routeContextKey: string | undefined;
    private disposed = false;

    constructor(private readonly dependencies: MachineDiscoveryFlowDependencies) {
        this.subscriptions.add(
            reaction(
                () => this.dependencies.store.sessionEpoch,
                () => this.cancelSessionWork(),
            ),
        );
        this.subscriptions.add(
            this.catalogRequests
                .pipe(
                    switchMap((command) => this.executeCatalogRequest(command)),
                    takeUntil(this.sessionCancellation),
                )
                .subscribe(),
        );
        this.subscriptions.add(
            this.pageRequests
                .pipe(
                    exhaustMap(() => this.executeNextPageRequest()),
                    takeUntil(this.sessionCancellation),
                )
                .subscribe(),
        );
        this.subscriptions.add(
            this.detailRequests
                .pipe(
                    switchMap((command) => this.executeDetailRequest(command)),
                    takeUntil(this.sessionCancellation),
                )
                .subscribe(),
        );
        this.subscriptions.add(
            this.resolutionRequests
                .pipe(
                    switchMap((command) => (command === null ? EMPTY : this.executeResolutionRequest(command))),
                    takeUntil(this.sessionCancellation),
                )
                .subscribe(),
        );
        this.subscriptions.add(
            this.selectionRequests
                .pipe(
                    exhaustMap((command) => this.executeSelectionRequest(command)),
                    takeUntil(this.sessionCancellation),
                )
                .subscribe(),
        );
        this.subscriptions.add(
            this.dependencies.scanner.capabilityState$
                .pipe(takeUntil(this.sessionCancellation))
                .subscribe((state) => this.dependencies.store.setCapability('scanner', state)),
        );
        this.subscriptions.add(
            this.dependencies.scanner.scanResults$
                .pipe(takeUntil(this.sessionCancellation))
                .subscribe((value) => this.handleScanResult(value)),
        );
    }

    startDiscovery(accessToken: string): void {
        if (this.disposed) return;

        this.stopDiscovery();
        const routeSubscriptions = new Subscription();
        this.routeSubscriptions = routeSubscriptions;

        routeSubscriptions.add(
            this.dependencies.location.capabilityState$.subscribe((state) => {
                if (this.routeSubscriptions !== routeSubscriptions) return;
                this.dependencies.store.setCapability('location', state);
                if (state !== 'undetermined' && state !== 'granted') {
                    this.startRouteDiscovery(accessToken, {
                        mode: 'SERVICE_AREA',
                        serviceAreaCode: this.dependencies.serviceAreaCode,
                        viewport: null,
                    });
                }
            }),
        );
        routeSubscriptions.add(
            this.dependencies.location.getCurrentPosition().subscribe({
                next: (position) => {
                    if (
                        this.routeSubscriptions !== routeSubscriptions ||
                        this.dependencies.store.locationCapability !== 'granted'
                    ) {
                        return;
                    }
                    this.startRouteDiscovery(accessToken, { mode: 'USER_LOCATION', position, viewport: null });
                },
                error: () => {
                    if (this.routeSubscriptions !== routeSubscriptions) return;
                    this.dependencies.store.setCapability('location', 'unavailable');
                    this.startRouteDiscovery(accessToken, {
                        mode: 'SERVICE_AREA',
                        serviceAreaCode: this.dependencies.serviceAreaCode,
                        viewport: null,
                    });
                },
            }),
        );
    }

    stopDiscovery(): void {
        this.routeCancellation.next();
        this.pageCancellation.next();
        this.routeSubscriptions?.unsubscribe();
        this.routeSubscriptions = undefined;
        this.routeContextKey = undefined;
        this.accessToken = undefined;
        this.currentPage = undefined;
    }

    discover(accessToken: string, context: MachineDiscoveryContext): void {
        this.accessToken = accessToken;
        this.dependencies.store.setDiscoveryContext(context);
        this.startCatalogRequest(accessToken, context);
    }

    updateViewport(viewport: MachineViewport | null): void {
        const { discoveryContext } = this.dependencies.store;
        if (discoveryContext === undefined || this.accessToken === undefined) return;

        const context = { ...discoveryContext, viewport } as MachineDiscoveryContext;
        this.dependencies.store.setDiscoveryContext(context);
        this.startCatalogRequest(this.accessToken, context);
    }

    refresh(): void {
        const { discoveryContext } = this.dependencies.store;
        if (discoveryContext === undefined || this.accessToken === undefined) return;
        this.startCatalogRequest(this.accessToken, discoveryContext);
    }

    loadNextPage(): void {
        if (this.currentPage?.hasMore !== true || this.currentPage.nextCursor === undefined) return;
        this.pageRequests.next();
    }

    setViewMode(mode: MachineDiscoveryViewMode): void {
        this.dependencies.store.setViewMode(mode);
    }

    openMachine(accessToken: string, machineId: MachineId): void {
        this.dependencies.store.setCurrentCard(
            this.dependencies.store.catalog.find((machine) => machine.machineId === machineId),
        );
        const version = this.beginMachineIntent('detail');
        this.dependencies.store.setLoading('detail', true);
        this.dependencies.store.setError(undefined);
        this.detailRequests.next({ accessToken, machineId, ...version });
    }

    confirmSelection(accessToken: string): void {
        const detail = this.dependencies.store.currentDetail;
        if (detail?.selectable !== true || this.dependencies.store.selectionLoading) return;

        const version = this.beginMachineIntent('selection');
        this.dependencies.store.setLoading('selection', true);
        this.dependencies.store.setError(undefined);
        this.selectionRequests.next({
            accessToken,
            machineId: detail.machineId,
            expectedMachineRevision: detail.machineRevision,
            ...version,
        });
    }

    startScanner(accessToken: string): void {
        this.scannerAccessToken = accessToken;
        this.dependencies.store.setError(undefined);
        this.dependencies.store.setScannerState('scanning');
    }

    resolveManualCode(accessToken: string, value: string): void {
        this.scannerAccessToken = undefined;
        this.startResolution(accessToken, { source: 'MANUAL', value });
    }

    cancelResolution(): void {
        this.scannerAccessToken = undefined;
        this.machineIntentGeneration += 1;
        this.dependencies.store.nextRequestGeneration('resolution');
        this.resolutionRequests.next(null);
        this.dependencies.store.setScannerState('idle');
        this.dependencies.store.setLoading('resolution', false);
    }

    private startCatalogRequest(accessToken: string, context: MachineDiscoveryContext): void {
        this.pageCancellation.next();
        this.currentPage = undefined;
        const generation = this.dependencies.store.nextRequestGeneration('catalog');
        const sessionEpoch = this.dependencies.store.sessionEpoch;
        this.dependencies.store.setLoading('catalog', true);
        this.dependencies.store.setError(undefined);
        this.catalogRequests.next({ accessToken, context, generation, sessionEpoch });
    }

    private executeCatalogRequest(command: CatalogCommand): Observable<MachineCatalogPage> {
        return this.dependencies.api
            .request(command.accessToken, createDiscoverMachinesRequest({ context: command.context }))
            .pipe(
                takeUntil(this.routeCancellation),
                tap((page) => {
                    if (!this.isCurrentRequest('catalog', command)) return;
                    this.currentPage = page;
                    this.dependencies.store.replaceCatalog(page.items);
                }),
                catchError((error: unknown) => {
                    this.captureError('catalog', command, error);
                    return EMPTY;
                }),
                finalize(() => this.finishLoading('catalog', command)),
            );
    }

    private startRouteDiscovery(accessToken: string, context: MachineDiscoveryContext): void {
        const contextKey =
            context.mode === 'USER_LOCATION'
                ? `USER_LOCATION:${context.position.latitude}:${context.position.longitude}`
                : `SERVICE_AREA:${context.serviceAreaCode}`;
        if (this.routeContextKey === contextKey) return;

        this.routeContextKey = contextKey;
        this.discover(accessToken, context);
    }

    private executeNextPageRequest(): Observable<MachineCatalogPage> {
        const page = this.currentPage;
        const context = this.dependencies.store.discoveryContext;
        const accessToken = this.accessToken;
        const version = {
            generation: this.dependencies.store.requestGeneration('catalog'),
            sessionEpoch: this.dependencies.store.sessionEpoch,
        };
        if (page?.nextCursor === undefined || context === undefined || accessToken === undefined) return EMPTY;

        this.dependencies.store.setLoading('catalog', true);
        return this.dependencies.api
            .request(accessToken, createDiscoverMachinesRequest({ context, cursor: page.nextCursor }))
            .pipe(
                takeUntil(this.pageCancellation),
                tap((nextPage) => {
                    if (!this.isCurrentRequest('catalog', version)) return;
                    this.currentPage = nextPage;
                    this.dependencies.store.appendCatalog(nextPage.items);
                }),
                catchError((error: unknown) => {
                    this.captureError('catalog', version, error);
                    return EMPTY;
                }),
                finalize(() => this.finishLoading('catalog', version)),
            );
    }

    private executeDetailRequest(command: DetailCommand) {
        const context = this.dependencies.store.discoveryContext;
        const position = context?.mode === 'USER_LOCATION' ? context.position : undefined;

        return this.dependencies.api
            .request(command.accessToken, createMachineDetailRequest(command.machineId, position))
            .pipe(
                tap((detail) => {
                    if (this.isCurrentRequest('detail', command)) {
                        this.dependencies.store.setCurrentDetail(detail);
                    }
                }),
                catchError((error: unknown) => {
                    this.captureError('detail', command, error);
                    return EMPTY;
                }),
                finalize(() => this.finishLoading('detail', command)),
            );
    }

    private handleScanResult(value: string): void {
        const accessToken = this.scannerAccessToken;
        if (accessToken === undefined || this.dependencies.store.scannerState !== 'scanning') return;

        const detectedAt = this.dependencies.clock.now();
        if (
            this.lastQrDetection?.value === value &&
            detectedAt - this.lastQrDetection.detectedAt < DUPLICATE_QR_WINDOW_MS
        ) {
            return;
        }

        this.lastQrDetection = { value, detectedAt };
        this.scannerAccessToken = undefined;
        this.startResolution(accessToken, { source: 'QR', value });
    }

    private startResolution(accessToken: string, input: MachineIdentifierInput): void {
        const version = this.beginMachineIntent('resolution');
        this.dependencies.store.setCurrentDetail(undefined);
        this.dependencies.store.setError(undefined);
        this.dependencies.store.setScannerState('resolving');
        this.dependencies.store.setLoading('resolution', true);
        this.resolutionRequests.next({ accessToken, input, ...version });
    }

    private executeResolutionRequest(command: ResolutionCommand) {
        return this.dependencies.api.request(command.accessToken, createResolveMachineRequest(command.input)).pipe(
            tap((detail) => {
                if (this.isCurrentRequest('resolution', command)) {
                    this.dependencies.store.setCurrentDetail(detail);
                }
            }),
            catchError((error: unknown) => {
                this.captureError('resolution', command, error);
                return EMPTY;
            }),
            finalize(() => {
                if (!this.isCurrentRequest('resolution', command)) return;
                this.dependencies.store.setScannerState('idle');
                this.finishLoading('resolution', command);
            }),
        );
    }

    private executeSelectionRequest(command: SelectionCommand) {
        return this.dependencies.api
            .request(
                command.accessToken,
                createMachineSelectionRevalidationRequest(command.machineId, command.expectedMachineRevision),
            )
            .pipe(
                tap((handoff) => {
                    const detail = this.dependencies.store.currentDetail;
                    if (
                        !this.isCurrentRequest('selection', command) ||
                        detail?.machineId !== command.machineId ||
                        detail.machineRevision !== command.expectedMachineRevision ||
                        handoff.machineId !== command.machineId ||
                        handoff.machineRevision !== command.expectedMachineRevision
                    ) {
                        return;
                    }
                    this.dependencies.store.setSelectionHandoff(handoff);
                }),
                catchError((error: unknown) => {
                    if (
                        this.isCurrentRequest('selection', command) &&
                        error instanceof MachineDiscoveryApiError &&
                        error.problem?.code === 'MACHINE_CONTEXT_CHANGED' &&
                        'currentMachine' in error.problem
                    ) {
                        this.dependencies.store.setCurrentCard(error.problem.currentMachine);
                        this.dependencies.store.setCurrentDetail(error.problem.currentMachine);
                    }
                    this.captureError('selection', command, error);
                    return EMPTY;
                }),
                finalize(() => this.finishLoading('selection', command)),
            );
    }

    private beginMachineIntent(operation: (typeof MACHINE_INTENT_OPERATIONS)[number]): RequestVersion {
        for (const candidate of MACHINE_INTENT_OPERATIONS) {
            if (candidate !== operation) this.dependencies.store.setLoading(candidate, false);
        }

        if (operation !== 'resolution') this.dependencies.store.setScannerState('idle');
        this.dependencies.store.setSelectionHandoff(undefined);

        return {
            generation: this.dependencies.store.nextRequestGeneration(operation),
            intentGeneration: ++this.machineIntentGeneration,
            sessionEpoch: this.dependencies.store.sessionEpoch,
        };
    }

    private captureError(operation: MachineDiscoveryOperation, version: RequestVersion, error: unknown): void {
        if (!this.isCurrentRequest(operation, version)) return;
        this.dependencies.store.setError(
            error instanceof MachineDiscoveryApiError
                ? { code: error.code, retryable: error.retryable }
                : { code: 'OFFLINE', retryable: true },
        );
    }

    private finishLoading(operation: MachineDiscoveryOperation, version: RequestVersion): void {
        if (this.isCurrentRequest(operation, version)) this.dependencies.store.setLoading(operation, false);
    }

    private isCurrentRequest(operation: MachineDiscoveryOperation, version: RequestVersion): boolean {
        return (
            this.dependencies.store.sessionEpoch === version.sessionEpoch &&
            this.dependencies.store.requestGeneration(operation) === version.generation &&
            (version.intentGeneration === undefined || version.intentGeneration === this.machineIntentGeneration)
        );
    }

    private cancelSessionWork(): void {
        this.stopDiscovery();
        this.scannerAccessToken = undefined;
        this.lastQrDetection = undefined;
        this.currentPage = undefined;
        this.machineIntentGeneration += 1;
        this.sessionCancellation.next();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopDiscovery();
        this.sessionCancellation.next();
        this.subscriptions.unsubscribe();
        this.catalogRequests.complete();
        this.pageRequests.complete();
        this.pageCancellation.complete();
        this.routeCancellation.complete();
        this.sessionCancellation.complete();
        this.detailRequests.complete();
        this.resolutionRequests.complete();
        this.selectionRequests.complete();
        this.dependencies.location.dispose();
        this.dependencies.scanner.dispose();
        this.dependencies.map.dispose();
    }
}
