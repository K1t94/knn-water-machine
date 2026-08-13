import { asyncScheduler, Observable, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { FakeLocationAdapter, FakeMapAdapter, FakeScannerAdapter } from '../../testing/machine-discovery-native-fakes';
import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDiscoveryFlowService, type MachineDiscoveryApi } from './machine-discovery-flow.service';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineDiscoveryContext,
    MachineId,
    MachineRevision,
} from '../machine-discovery.types';

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const QR_VALUE = `kaynann://machine/v1/${MACHINE_ID}`;
const DISCOVERY_CONTEXT: MachineDiscoveryContext = {
    mode: 'SERVICE_AREA',
    serviceAreaCode: 'dakar',
    viewport: null,
};

interface SessionFlowCommands {
    discover(accessToken: string, context: MachineDiscoveryContext): void;
    openMachine(accessToken: string, machineId: MachineId): void;
    startScanner(accessToken: string): void;
    resolveManualCode(accessToken: string, value: string): void;
    confirmSelection(accessToken: string): void;
}

interface FlowHarness {
    readonly flow: SessionFlowCommands;
    readonly scanner: FakeScannerAdapter;
    readonly service: MachineDiscoveryFlowService;
    readonly store: MachineDiscoveryStore;
}

interface ActiveStream {
    readonly name: string;
    start(harness: FlowHarness): void;
}

interface SessionEnding {
    readonly name: string;
    end(harness: FlowHarness): void;
}

const activeStreams: readonly ActiveStream[] = [
    {
        name: 'discovery',
        start: ({ flow }) => flow.discover(ACCESS_TOKEN, DISCOVERY_CONTEXT),
    },
    {
        name: 'detail',
        start: ({ flow }) => flow.openMachine(ACCESS_TOKEN, MACHINE_ID),
    },
    {
        name: 'QR resolution',
        start: ({ flow, scanner }) => {
            flow.startScanner(ACCESS_TOKEN);
            scanner.emitScan(QR_VALUE);
        },
    },
    {
        name: 'manual resolution',
        start: ({ flow }) => flow.resolveManualCode(ACCESS_TOKEN, 'DKR-PLATEAU-01'),
    },
    {
        name: 'selection confirmation',
        start: ({ flow, store }) => {
            store.setCurrentDetail(machineDetail());
            flow.confirmSelection(ACCESS_TOKEN);
        },
    },
];

// Store-level session commands map these three account endings to one epoch boundary.
const accountScopeEndings: readonly SessionEnding[] = [
    {
        name: 'access expiry with failed renewal',
        end: ({ store }) => {
            store.advanceSessionEpoch();
        },
    },
    {
        name: 'logout',
        end: ({ store }) => {
            store.advanceSessionEpoch();
        },
    },
    {
        name: 'account replacement',
        end: ({ store }) => {
            store.advanceSessionEpoch();
        },
    },
];

const disposal: SessionEnding = {
    name: 'scope disposal',
    end: ({ service }) => {
        service.dispose();
    },
};

describe.each(activeStreams)('MachineDiscoveryFlowService $name session cancellation', (activeStream) => {
    it.each(accountScopeEndings)('cancels the active request on $name', (sessionEnding) => {
        const pendingResponse = new PendingResponse();
        const harness = setup(pendingResponse);

        try {
            activeStream.start(harness);
            expect(pendingResponse.subscribed).toBe(1);
            expect(pendingResponse.cancelled).toBe(0);

            sessionEnding.end(harness);

            expect(pendingResponse.cancelled).toBe(1);
        } finally {
            harness.service.dispose();
        }
    });

    it(`cancels the active request on ${disposal.name}`, () => {
        const pendingResponse = new PendingResponse();
        const harness = setup(pendingResponse);

        activeStream.start(harness);
        expect(pendingResponse.subscribed).toBe(1);
        expect(pendingResponse.cancelled).toBe(0);

        disposal.end(harness);

        expect(pendingResponse.cancelled).toBe(1);
    });
});

function setup(pendingResponse: PendingResponse): FlowHarness {
    const store = new MachineDiscoveryStore();
    const scanner = new FakeScannerAdapter('granted');
    const service = new MachineDiscoveryFlowService({
        api: new ControlledApi(pendingResponse),
        clock: { now: () => 0 },
        timers: asyncScheduler,
        location: new FakeLocationAdapter('granted', { latitude: 14.716677, longitude: -17.467686 }),
        scanner,
        map: new FakeMapAdapter('granted'),
        serviceAreaCode: 'dakar',
        store,
    });

    return {
        flow: service,
        scanner,
        service,
        store,
    };
}

class ControlledApi implements MachineDiscoveryApi {
    constructor(private readonly pendingResponse: PendingResponse) {}

    request<T>(_accessToken: string, _request: MachineDiscoveryRequest<T>): Observable<T> {
        return this.pendingResponse.observable as Observable<T>;
    }
}

class PendingResponse {
    private readonly subject = new Subject<unknown>();
    subscribed = 0;
    cancelled = 0;

    readonly observable = new Observable<unknown>((subscriber) => {
        this.subscribed += 1;
        const subscription = this.subject.subscribe(subscriber);
        return () => {
            this.cancelled += 1;
            subscription.unsubscribe();
        };
    });
}

function machineDetail(): MachineDetail {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
        status: 'ONLINE',
        machineRevision: '1' as MachineRevision,
        price: {
            amountPerLiter: '0.50' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        selectable: true,
        refreshedAt: '2026-08-24T10:00:00.000Z',
    };
}
