import { asyncScheduler, Observable, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MachineDiscoveryApiError } from '../../api/machine-discovery-api';
import { FakeLocationAdapter, FakeMapAdapter, FakeScannerAdapter } from '../../testing/machine-discovery-native-fakes';
import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDiscoveryFlowService, type MachineDiscoveryApi } from './machine-discovery-flow.service';

import type { MachineDiscoveryRequest } from '../../api/machine-discovery-api';
import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachineRevision,
} from '../machine-discovery.types';

interface ResolutionCommands {
    startScanner(accessToken: string): void;
    resolveManualCode(accessToken: string, value: string): void;
    cancelResolution(): void;
}

const ACCESS_TOKEN = 'access-token';
const QR_VALUE = 'kaynann://machine/v1/7mQ3LJvR9Gf2xK8pNc4YAw';
const MANUAL_VALUE = 'DKR-PLATEAU-01';

describe('MachineDiscoveryFlowService identifier resolution', () => {
    it('tracks scanner capability and transitions from scanning through resolution to the current detail', () => {
        const response = new PendingResponse<MachineDetail>();
        const harness = setup(response);
        const resolved = detail('7mQ3LJvR9Gf2xK8pNc4YAw', '2');

        expect(harness.store.scannerCapability).toBe('granted');
        expect(harness.store.scannerState).toBe('idle');

        harness.scanner.setCapabilityState('revoked');
        expect(harness.store.scannerCapability).toBe('revoked');

        harness.scanner.setCapabilityState('granted');
        harness.flow.startScanner(ACCESS_TOKEN);
        expect(harness.store.scannerState).toBe('scanning');

        harness.scanner.emitScan(QR_VALUE);
        expect(harness.store.scannerState).toBe('resolving');
        expect(harness.store.resolutionLoading).toBe(true);
        expect(harness.api.calls[0]).toMatchObject({
            accessToken: ACCESS_TOKEN,
            request: {
                path: '/v1/machines/resolve',
                method: 'POST',
                body: { source: 'QR', value: QR_VALUE },
            },
        });

        response.resolve(resolved);

        expect(harness.store.currentDetail).toEqual(resolved);
        expect(harness.store.scannerState).toBe('idle');
        expect(harness.store.resolutionLoading).toBe(false);

        harness.service.dispose();
    });

    it('uses one switchMap channel for QR and manual input and rejects late generations', () => {
        const qrResponse = new PendingResponse<MachineDetail>();
        const firstManualResponse = new PendingResponse<MachineDetail>();
        const latestManualResponse = new PendingResponse<MachineDetail>();
        const harness = setup(qrResponse, firstManualResponse, latestManualResponse);
        const staleQr = detail('7mQ3LJvR9Gf2xK8pNc4YAw', '1');
        const staleManual = detail('Q8pLm2Vx7Nw4Rk9Yc3TgZA', '2');
        const latest = detail('R4tNv8Kp2Jx7Wm5Qc9YgLA', '3');

        harness.flow.startScanner(ACCESS_TOKEN);
        harness.scanner.emitScan(QR_VALUE);
        harness.flow.resolveManualCode(ACCESS_TOKEN, 'DKR-MEDINA-02');
        expect(qrResponse.cancelled).toBe(1);

        harness.flow.resolveManualCode(ACCESS_TOKEN, MANUAL_VALUE);
        expect(firstManualResponse.cancelled).toBe(1);
        expect(harness.store.requestGeneration('resolution')).toBe(3);

        qrResponse.emit(staleQr);
        firstManualResponse.emit(staleManual);
        latestManualResponse.resolve(latest);

        expect(harness.api.calls.map(({ request }) => request.body)).toEqual([
            { source: 'QR', value: QR_VALUE },
            { source: 'MANUAL', value: 'DKR-MEDINA-02' },
            { source: 'MANUAL', value: MANUAL_VALUE },
        ]);
        expect(harness.store.currentDetail).toEqual(latest);
        expect(harness.store.resolutionLoading).toBe(false);

        harness.service.dispose();
    });

    it('suppresses repeated QR detections during the active time window', () => {
        const first = new PendingResponse<MachineDetail>();
        const afterWindow = new PendingResponse<MachineDetail>();
        const harness = setup(first, afterWindow);

        harness.flow.startScanner(ACCESS_TOKEN);
        harness.scanner.emitScan(QR_VALUE);
        harness.scanner.emitScan(QR_VALUE);
        expect(harness.api.calls).toHaveLength(1);

        first.resolve(detail('7mQ3LJvR9Gf2xK8pNc4YAw', '1'));
        harness.flow.startScanner(ACCESS_TOKEN);
        harness.scanner.emitScan(QR_VALUE);
        expect(harness.api.calls).toHaveLength(1);

        harness.advanceClock(60_000);
        harness.scanner.emitScan(QR_VALUE);
        expect(harness.api.calls).toHaveLength(2);

        harness.service.dispose();
    });

    it('cancels an active resolution without selecting a machine or accepting later scans', () => {
        const response = new PendingResponse<MachineDetail>();
        const harness = setup(response);

        harness.flow.startScanner(ACCESS_TOKEN);
        harness.scanner.emitScan(QR_VALUE);
        harness.flow.cancelResolution();

        expect(response.cancelled).toBe(1);
        expect(harness.store.scannerState).toBe('idle');
        expect(harness.store.resolutionLoading).toBe(false);
        expect(harness.store.currentDetail).toBeUndefined();

        response.emit(detail('7mQ3LJvR9Gf2xK8pNc4YAw', '1'));
        harness.scanner.emitScan('kaynann://machine/v1/Q8pLm2Vx7Nw4Rk9Yc3TgZA');

        expect(harness.api.calls).toHaveLength(1);
        expect(harness.store.currentDetail).toBeUndefined();

        harness.service.dispose();
    });

    it.each([
        ['QR', 'OFFLINE', true],
        ['QR', 'MACHINE_CODE_INVALID', false],
        ['QR', 'MACHINE_NOT_FOUND', false],
        ['MANUAL', 'OFFLINE', true],
        ['MANUAL', 'MACHINE_CODE_INVALID', false],
        ['MANUAL', 'MACHINE_NOT_FOUND', false],
    ] as const)('preserves the %s resolution distinction for %s', (source, code, retryable) => {
        const response = new PendingResponse<MachineDetail>();
        const harness = setup(response);

        if (source === 'QR') {
            harness.flow.startScanner(ACCESS_TOKEN);
            harness.scanner.emitScan(QR_VALUE);
        } else {
            harness.flow.resolveManualCode(ACCESS_TOKEN, MANUAL_VALUE);
        }
        response.fail(new MachineDiscoveryApiError(code, retryable, null));

        expect(harness.store.error).toEqual({ code, retryable });
        expect(harness.store.currentDetail).toBeUndefined();
        expect(harness.store.scannerState).toBe('idle');
        expect(harness.store.resolutionLoading).toBe(false);

        harness.service.dispose();
    });
});

function setup(...responses: PendingResponse<MachineDetail>[]) {
    const store = new MachineDiscoveryStore();
    const api = new ControlledResolutionApi(responses);
    const scanner = new FakeScannerAdapter('granted');
    let now = 0;
    const service = new MachineDiscoveryFlowService({
        api,
        clock: { now: () => now },
        timers: asyncScheduler,
        location: new FakeLocationAdapter('granted', { latitude: 14.716677, longitude: -17.467686 }),
        scanner,
        map: new FakeMapAdapter('granted'),
        serviceAreaCode: 'dakar',
        store,
    });

    return {
        api,
        scanner,
        service,
        store,
        flow: service as unknown as ResolutionCommands,
        advanceClock(milliseconds: number): void {
            now += milliseconds;
        },
    };
}

class ControlledResolutionApi implements MachineDiscoveryApi {
    readonly calls: { accessToken: string; request: MachineDiscoveryRequest<unknown> }[] = [];

    constructor(private readonly responses: PendingResponse<MachineDetail>[]) {}

    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T> {
        const response = this.responses.shift();
        if (!response) throw new Error('Unexpected resolution request');
        this.calls.push({ accessToken, request });
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

    fail(error: unknown): void {
        this.subject.error(error);
    }
}

function detail(machineId: string, machineRevision: string): MachineDetail {
    return {
        machineId: machineId as MachineId,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
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
