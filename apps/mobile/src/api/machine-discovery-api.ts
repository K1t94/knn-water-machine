import { TimeoutError, catchError, defer, finalize, from, map, switchMap, throwError, timeout } from 'rxjs';

import {
    MachineDiscoveryContractError,
    decodeMachineCatalogPage,
    decodeMachineDetail,
    decodeMachineDiscoveryProblem,
    decodeMachineSelectionHandoff,
    type MachineDiscoveryProblem,
} from './machine-discovery-contracts';

import type {
    MachineCatalogPage,
    MachineCoordinates,
    MachineDetail,
    MachineDiscoveryContext,
    MachineId,
    MachineIdentifierInput,
    MachineRevision,
    MachineSelectionHandoff,
} from '../machine-discovery/machine-discovery.types';
import type { Observable } from 'rxjs';

export type MachineDiscoveryClientErrorCode = 'INVALID_RESPONSE' | 'OFFLINE' | 'REQUEST_TIMEOUT';

export interface MachineDiscoveryRequest<T> {
    readonly path: string;
    readonly method: 'GET' | 'POST';
    readonly body?: unknown;
    readonly decode: (payload: unknown) => T;
}

export interface DiscoverMachinesInput {
    readonly context: MachineDiscoveryContext;
    readonly cursor?: string;
    readonly limit?: number;
}

export class MachineDiscoveryApiError extends Error {
    constructor(
        public readonly code: string,
        public readonly retryable: boolean,
        public readonly problem: MachineDiscoveryProblem | null,
    ) {
        super(code);
        this.name = 'MachineDiscoveryApiError';
    }
}

export class FetchMachineDiscoveryApi {
    constructor(
        private readonly baseUrl: string,
        private readonly timeoutMs = 10_000,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {}

    discoverMachines(accessToken: string, input: DiscoverMachinesInput): Observable<MachineCatalogPage> {
        return this.request(accessToken, createDiscoverMachinesRequest(input));
    }

    getMachineDetail(
        accessToken: string,
        machineId: MachineId,
        position?: MachineCoordinates,
    ): Observable<MachineDetail> {
        return this.request(accessToken, createMachineDetailRequest(machineId, position));
    }

    resolveMachineIdentifier(accessToken: string, input: MachineIdentifierInput): Observable<MachineDetail> {
        return this.request(accessToken, createResolveMachineRequest(input));
    }

    revalidateMachineSelection(
        accessToken: string,
        machineId: MachineId,
        expectedMachineRevision: MachineRevision,
    ): Observable<MachineSelectionHandoff> {
        return this.request(accessToken, createMachineSelectionRevalidationRequest(machineId, expectedMachineRevision));
    }

    request<T>(accessToken: string, request: MachineDiscoveryRequest<T>): Observable<T> {
        return defer(() => {
            const controller = new AbortController();
            const headers: Record<string, string> = {
                accept: 'application/json',
                authorization: `Bearer ${accessToken}`,
            };
            const body = request.body === undefined ? undefined : JSON.stringify(request.body);
            if (body !== undefined) headers['content-type'] = 'application/json';

            return from(
                this.fetcher(`${this.baseUrl}${request.path}`, {
                    method: request.method,
                    headers,
                    ...(body === undefined ? {} : { body }),
                    signal: controller.signal,
                }),
            ).pipe(
                switchMap((response) =>
                    from(response.json()).pipe(
                        map((payload: unknown) => {
                            if (!response.ok) {
                                const problem = decodeMachineDiscoveryProblem(payload);
                                throw new MachineDiscoveryApiError(problem.code, problem.retryable, problem);
                            }
                            return request.decode(payload);
                        }),
                    ),
                ),
                timeout({ first: this.timeoutMs }),
                catchError((error: unknown) => {
                    if (error instanceof MachineDiscoveryApiError) return throwError(() => error);
                    if (error instanceof MachineDiscoveryContractError) {
                        return throwError(() => clientError('INVALID_RESPONSE'));
                    }
                    return throwError(() => clientError(error instanceof TimeoutError ? 'REQUEST_TIMEOUT' : 'OFFLINE'));
                }),
                finalize(() => controller.abort()),
            );
        });
    }
}

export function createDiscoverMachinesRequest(
    input: DiscoverMachinesInput,
): MachineDiscoveryRequest<MachineCatalogPage> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
    if (input.cursor !== undefined) query.set('cursor', input.cursor);
    if (input.context.mode === 'USER_LOCATION') {
        query.set('latitude', String(input.context.position.latitude));
        query.set('longitude', String(input.context.position.longitude));
    }
    if (input.context.viewport !== null) {
        query.set('north', String(input.context.viewport.north));
        query.set('east', String(input.context.viewport.east));
        query.set('south', String(input.context.viewport.south));
        query.set('west', String(input.context.viewport.west));
    }

    return {
        path: `/v1/machines?${query.toString()}`,
        method: 'GET',
        decode: decodeMachineCatalogPage,
    };
}

export function createMachineDetailRequest(
    machineId: MachineId,
    position?: MachineCoordinates,
): MachineDiscoveryRequest<MachineDetail> {
    const query = new URLSearchParams();
    if (position !== undefined) {
        query.set('latitude', String(position.latitude));
        query.set('longitude', String(position.longitude));
    }
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;

    return {
        path: `/v1/machines/${encodeURIComponent(machineId)}${suffix}`,
        method: 'GET',
        decode: decodeMachineDetail,
    };
}

export function createResolveMachineRequest(input: MachineIdentifierInput): MachineDiscoveryRequest<MachineDetail> {
    return {
        path: '/v1/machines/resolve',
        method: 'POST',
        body: input,
        decode: decodeMachineDetail,
    };
}

export function createMachineSelectionRevalidationRequest(
    machineId: MachineId,
    expectedMachineRevision: MachineRevision,
): MachineDiscoveryRequest<MachineSelectionHandoff> {
    return {
        path: `/v1/machines/${encodeURIComponent(machineId)}/selection-revalidation`,
        method: 'POST',
        body: { expectedMachineRevision },
        decode: decodeMachineSelectionHandoff,
    };
}

function clientError(code: MachineDiscoveryClientErrorCode): MachineDiscoveryApiError {
    return new MachineDiscoveryApiError(code, true, null);
}
