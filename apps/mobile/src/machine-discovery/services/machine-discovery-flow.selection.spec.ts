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
    MachineSelectionHandoff,
} from '../machine-discovery.types';

interface SelectionCommands {
    openMachine(accessToken: string, machineId: MachineId): void;
    confirmSelection(accessToken: string): void;
}

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;

describe('MachineDiscoveryFlowService detail and selection', () => {
    it('switches card detail requests and rejects a late result from the previous generation', () => {
        const staleResponse = new PendingResponse();
        const currentResponse = new PendingResponse();
        const harness = setup(staleResponse, currentResponse);
        const staleDetail = detail('1');
        const currentDetail = detail('2');

        harness.flow.openMachine(ACCESS_TOKEN, MACHINE_ID);
        harness.flow.openMachine(ACCESS_TOKEN, MACHINE_ID);

        expect(staleResponse.cancelled).toBe(1);
        expect(harness.store.requestGeneration('detail')).toBe(2);

        staleResponse.emit(staleDetail);
        currentResponse.resolve(currentDetail);

        expect(harness.store.currentDetail).toEqual(currentDetail);
        expect(harness.store.detailLoading).toBe(false);

        harness.service.dispose();
    });

    it('exhausts repeated confirmations and creates one exact typed handoff', () => {
        const response = new PendingResponse();
        const harness = setup(response);
        const currentDetail = detail('7');
        const selectionHandoff = handoff('7');
        harness.store.setCurrentDetail(currentDetail);

        harness.flow.confirmSelection(ACCESS_TOKEN);
        harness.flow.confirmSelection(ACCESS_TOKEN);
        harness.flow.confirmSelection(ACCESS_TOKEN);

        expect(harness.api.calls).toHaveLength(1);
        expect(harness.api.calls[0]).toMatchObject({
            accessToken: ACCESS_TOKEN,
            request: {
                path: `/v1/machines/${MACHINE_ID}/selection-revalidation`,
                method: 'POST',
                body: { expectedMachineRevision: '7' },
            },
        });
        expect(harness.store.selectionLoading).toBe(true);

        response.resolve(selectionHandoff);

        expect(harness.store.selectionHandoff).toEqual(selectionHandoff);
        expect(harness.store.selectionLoading).toBe(false);
        expect(harness.store.error).toBeUndefined();

        harness.service.dispose();
    });

    it('replaces the card after a context change and requires a new confirmation', () => {
        const response = new PendingResponse();
        const harness = setup(response);
        const changedDetail = detail('9', 'SERVICE', false, '0.75');
        harness.store.setCurrentDetail(detail('8'));

        harness.flow.confirmSelection(ACCESS_TOKEN);
        response.fail(
            new MachineDiscoveryApiError('MACHINE_CONTEXT_CHANGED', false, {
                code: 'MACHINE_CONTEXT_CHANGED',
                message: 'Machine selection context changed.',
                retryable: false,
                correlationId: '01JEXAMPLE0000000000000000',
                currentMachine: changedDetail,
            }),
        );

        expect(harness.store.currentDetail).toEqual(changedDetail);
        expect(harness.store.selectionHandoff).toBeUndefined();
        expect(harness.store.selectionLoading).toBe(false);
        expect(harness.store.error).toEqual({ code: 'MACHINE_CONTEXT_CHANGED', retryable: false });

        harness.service.dispose();
    });

    it('recovers the confirmation gate after a non-selectable response', () => {
        const rejectedResponse = new PendingResponse();
        const retryResponse = new PendingResponse();
        const harness = setup(rejectedResponse, retryResponse);
        harness.store.setCurrentDetail(detail('10'));

        harness.flow.confirmSelection(ACCESS_TOKEN);
        rejectedResponse.fail(
            new MachineDiscoveryApiError('MACHINE_NOT_SELECTABLE', false, {
                code: 'MACHINE_NOT_SELECTABLE',
                message: 'This machine is not currently available for selection.',
                retryable: false,
                correlationId: '01JEXAMPLE0000000000000001',
            }),
        );

        expect(harness.store.selectionLoading).toBe(false);
        expect(harness.store.selectionHandoff).toBeUndefined();
        expect(harness.store.error).toEqual({ code: 'MACHINE_NOT_SELECTABLE', retryable: false });

        harness.flow.confirmSelection(ACCESS_TOKEN);
        expect(harness.api.calls).toHaveLength(2);

        retryResponse.resolve(handoff('10'));
        expect(harness.store.selectionHandoff).toEqual(handoff('10'));

        harness.service.dispose();
    });

    it('does not apply a selection result from an obsolete request generation', () => {
        const response = new PendingResponse();
        const harness = setup(response);
        harness.store.setCurrentDetail(detail('11'));

        harness.flow.confirmSelection(ACCESS_TOKEN);
        expect(harness.store.requestGeneration('selection')).toBe(1);

        harness.store.nextRequestGeneration('selection');
        harness.store.setLoading('selection', false);
        response.resolve(handoff('11'));

        expect(harness.store.requestGeneration('selection')).toBe(2);
        expect(harness.store.selectionHandoff).toBeUndefined();
        expect(harness.store.selectionLoading).toBe(false);

        harness.service.dispose();
    });
});

function setup(...responses: PendingResponse[]) {
    const store = new MachineDiscoveryStore();
    const api = new ControlledSelectionApi(responses);
    const service = new MachineDiscoveryFlowService({
        api,
        clock: { now: () => 0 },
        timers: asyncScheduler,
        location: new FakeLocationAdapter('granted', { latitude: 14.716677, longitude: -17.467686 }),
        scanner: new FakeScannerAdapter('granted'),
        map: new FakeMapAdapter('granted'),
        serviceAreaCode: 'dakar',
        store,
    });

    return { api, service, store, flow: service as unknown as SelectionCommands };
}

class ControlledSelectionApi implements MachineDiscoveryApi {
    readonly calls: { accessToken: string; request: MachineDiscoveryRequest<unknown> }[] = [];

    constructor(private readonly responses: PendingResponse[]) {}

    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T> {
        const response = this.responses.shift();
        if (!response) throw new Error('Unexpected machine request');
        this.calls.push({ accessToken, request });
        return response.observable as Observable<T>;
    }
}

class PendingResponse {
    private readonly subject = new Subject<unknown>();
    cancelled = 0;

    readonly observable = new Observable<unknown>((subscriber) => {
        const subscription = this.subject.subscribe(subscriber);
        return () => {
            this.cancelled += 1;
            subscription.unsubscribe();
        };
    });

    emit(value: unknown): void {
        this.subject.next(value);
    }

    resolve(value: unknown): void {
        this.subject.next(value);
        this.subject.complete();
    }

    fail(error: unknown): void {
        this.subject.error(error);
    }
}

function detail(
    machineRevision: string,
    status: MachineDetail['status'] = 'ONLINE',
    selectable = true,
    amountPerLiter = '0.50',
): MachineDetail {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point eau Plateau',
        address: 'Dakar Plateau',
        status,
        machineRevision: machineRevision as MachineRevision,
        price: {
            amountPerLiter: amountPerLiter as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        selectable,
        refreshedAt: '2026-08-18T10:00:00.000Z',
    };
}

function handoff(machineRevision: string): MachineSelectionHandoff {
    return {
        machineId: MACHINE_ID,
        machineRevision: machineRevision as MachineRevision,
        price: {
            amountPerLiter: '0.50' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        availability: 'ONLINE',
        validatedAt: '2026-08-18T10:00:01.000Z',
    };
}
