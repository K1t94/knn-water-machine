import { Observable, firstValueFrom } from 'rxjs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { FetchMachineDiscoveryApi, MachineDiscoveryApiError } from './machine-discovery-api';
import {
    decodeMachineCatalogPage,
    decodeMachineDetail,
    decodeMachineDiscoveryProblem,
    decodeMachineSelectionHandoff,
} from './machine-discovery-contracts';

import type { MachineSelectionHandoff } from '../machine-discovery/machine-discovery.types';

describe('machine discovery response decoders', () => {
    it('decodes an allowlisted catalog page and preserves exact money strings', () => {
        const payload = catalogPage();

        const decoded = decodeMachineCatalogPage(payload);

        expect(decoded).toEqual(payload);
        expect(decoded.items[0]?.price?.amountPerLiter).toBe('9007199254740993.123456');
        expect(typeof decoded.items[0]?.price?.amountPerLiter).toBe('string');
    });

    it('decodes fresh machine detail without dropping optional public fields', () => {
        const payload = machineDetail();

        expect(decodeMachineDetail(payload)).toEqual(payload);
    });

    it('decodes the navigation-only selection handoff as its domain type', () => {
        const payload = selectionHandoff();
        const decoded = decodeMachineSelectionHandoff(payload);

        expectTypeOf(decoded).toEqualTypeOf<MachineSelectionHandoff>();
        expect(decoded).toEqual(payload);
        expect(decoded.price.amountPerLiter).toBe('9007199254740993.123456');
    });

    it.each([
        ['catalog page', () => decodeMachineCatalogPage({ ...catalogPage(), internalId: 'private' })],
        ['machine detail', () => decodeMachineDetail({ ...machineDetail(), mqttTopic: 'private/topic' })],
        [
            'selection handoff',
            () => decodeMachineSelectionHandoff({ ...selectionHandoff(), reservationToken: 'not-allowed' }),
        ],
    ])('rejects non-allowlisted fields in a %s payload', (_name, decode) => {
        expect(decode).toThrow();
    });

    it.each(['2e3', '2.1234567', '-1.000000', 'NaN', 'Infinity', 2.5])(
        'rejects a non-contract money value %j',
        (amountPerLiter) => {
            expect(() =>
                decodeMachineDetail({
                    ...machineDetail(),
                    price: { amountPerLiter, currency: 'RUB' },
                }),
            ).toThrow();
        },
    );

    it('decodes the generic OpenAPI problem and retains its correlation ID', () => {
        const payload = problem();

        expect(decodeMachineDiscoveryProblem(payload)).toEqual(payload);
    });

    it('decodes validation fields without accepting extra field metadata', () => {
        const payload = validationProblem();

        expect(decodeMachineDiscoveryProblem(payload)).toEqual(payload);
        expect(() =>
            decodeMachineDiscoveryProblem({
                ...payload,
                fields: [{ field: 'limit', code: 'OUT_OF_RANGE', suppliedValue: 101 }],
            }),
        ).toThrow();
    });

    it('decodes the context-changed problem with its fresh current machine', () => {
        const payload = contextChangedProblem();

        expect(decodeMachineDiscoveryProblem(payload)).toEqual(payload);
    });

    it.each([problem(), validationProblem(), contextChangedProblem()])(
        'rejects an error payload without correlationId',
        (payload) => {
            const { correlationId: _omitted, ...withoutCorrelationId } = payload;

            expect(() => decodeMachineDiscoveryProblem(withoutCorrelationId)).toThrow();
        },
    );
});

describe('FetchMachineDiscoveryApi', () => {
    it('keeps decoded requests cold and authenticates only on subscription', async () => {
        const fetcher = vi.fn(async () => response(catalogPage())) as unknown as typeof fetch;
        const api = new FetchMachineDiscoveryApi('https://api.example.test', 1_000, fetcher);

        const request$ = api.request('access-token', {
            path: '/v1/machines?limit=20',
            method: 'GET',
            decode: decodeMachineCatalogPage,
        });

        expect(request$).toBeInstanceOf(Observable);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(firstValueFrom(request$)).resolves.toEqual(catalogPage());
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example.test/v1/machines?limit=20',
            expect.objectContaining({
                method: 'GET',
                headers: { accept: 'application/json', authorization: 'Bearer access-token' },
            }),
        );
    });

    it('decodes problem responses and preserves correlation IDs in typed errors', async () => {
        const payload = contextChangedProblem();
        const fetcher = vi.fn(async () => response(payload, 409)) as unknown as typeof fetch;
        const api = new FetchMachineDiscoveryApi('https://api.example.test', 1_000, fetcher);

        const result = firstValueFrom(
            api.request('access-token', {
                path: `/v1/machines/${MACHINE_ID}/selection-revalidation`,
                method: 'POST',
                body: { expectedMachineRevision: '41' },
                decode: decodeMachineSelectionHandoff,
            }),
        );

        await expect(result).rejects.toBeInstanceOf(MachineDiscoveryApiError);
        await expect(result).rejects.toMatchObject({ problem: payload });
    });

    it('aborts an in-flight decoded request when its subscription is disposed', () => {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn((...[, init]: Parameters<typeof fetch>) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const api = new FetchMachineDiscoveryApi('https://api.example.test', 1_000, fetcher);
        const request$ = api.request('access-token', {
            path: '/v1/machines',
            method: 'GET',
            decode: decodeMachineCatalogPage,
        });

        expect(fetcher).not.toHaveBeenCalled();
        const subscription = request$.subscribe();
        expect(signal?.aborted).toBe(false);
        subscription.unsubscribe();
        expect(signal?.aborted).toBe(true);
    });
});

const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw';
const CORRELATION_ID = '01JEXAMPLE0000000000000000';

function machineSummary() {
    return {
        machineId: MACHINE_ID,
        displayName: 'Water machine',
        address: 'Test address',
        coordinates: { latitude: 55.751244, longitude: 37.618423 },
        distanceMeters: 125,
        price: { amountPerLiter: '9007199254740993.123456', currency: 'RUB' },
        status: 'ONLINE' as const,
        machineRevision: '42',
    };
}

function machineDetail() {
    return {
        ...machineSummary(),
        selectable: true,
        refreshedAt: '2026-08-15T10:00:00.000Z',
    };
}

function catalogPage() {
    return {
        items: [machineSummary()],
        nextCursor: 'opaque-catalog-cursor',
        hasMore: true,
        catalogRevision: '7',
    };
}

function selectionHandoff() {
    return {
        machineId: MACHINE_ID,
        machineRevision: '42',
        price: { amountPerLiter: '9007199254740993.123456', currency: 'RUB' },
        availability: 'ONLINE' as const,
        validatedAt: '2026-08-15T10:00:01.000Z',
    };
}

function problem() {
    return {
        code: 'DISCOVERY_TEMPORARILY_UNAVAILABLE',
        message: 'Machine information is temporarily unavailable.',
        retryable: true,
        correlationId: CORRELATION_ID,
    };
}

function validationProblem() {
    return {
        code: 'VALIDATION_ERROR' as const,
        message: 'Request validation failed.',
        retryable: false as const,
        correlationId: CORRELATION_ID,
        fields: [{ field: 'limit', code: 'OUT_OF_RANGE' }],
    };
}

function contextChangedProblem() {
    return {
        code: 'MACHINE_CONTEXT_CHANGED' as const,
        message: 'Machine selection context changed.',
        retryable: false as const,
        correlationId: CORRELATION_ID,
        currentMachine: machineDetail(),
    };
}

function response(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}
