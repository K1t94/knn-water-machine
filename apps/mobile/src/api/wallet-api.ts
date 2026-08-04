import { TimeoutError, catchError, defer, finalize, from, map, switchMap, throwError, timeout } from 'rxjs';

import type { Observable } from 'rxjs';

export interface WalletBalance {
    balanceMl: string;
    balanceLiters: string;
    observedAt: string;
}

export interface WalletOperation {
    id: string;
    direction: 'CREDIT' | 'DEBIT';
    amountMl: string;
    operationKind: string;
    source: string;
    occurredAt: string;
    recordedAt: string;
}

export interface WalletHistoryPage {
    items: WalletOperation[];
    nextCursor: string | null;
    hasMore: boolean;
}

export interface WalletHistoryQuery {
    cursor?: string;
    limit?: number;
}

export interface WalletApi {
    getBalance(accessToken: string): Observable<WalletBalance>;
    getHistory(accessToken: string, query?: WalletHistoryQuery): Observable<WalletHistoryPage>;
}

export class WalletApiError extends Error {
    constructor(
        public readonly code: string,
        public readonly retryable: boolean,
    ) {
        super(code);
    }
}

export class FetchWalletApi implements WalletApi {
    constructor(
        private readonly baseUrl: string,
        private readonly timeoutMs = 10_000,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {}

    getBalance(accessToken: string): Observable<WalletBalance> {
        return this.get('/v1/wallet/balance', accessToken, parseBalance);
    }

    getHistory(accessToken: string, query: WalletHistoryQuery = {}): Observable<WalletHistoryPage> {
        const search = new URLSearchParams();
        if (query.limit !== undefined) search.set('limit', String(query.limit));
        if (query.cursor !== undefined) search.set('cursor', query.cursor);
        const suffix = search.size > 0 ? `?${search.toString()}` : '';
        return this.get(`/v1/wallet/operations${suffix}`, accessToken, parseHistoryPage);
    }

    private get<T>(path: string, accessToken: string, parse: (payload: unknown) => T): Observable<T> {
        return defer(() => {
            const controller = new AbortController();
            return from(
                this.fetcher(`${this.baseUrl}${path}`, {
                    method: 'GET',
                    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
                    signal: controller.signal,
                }),
            ).pipe(
                switchMap((response) =>
                    from(response.json()).pipe(
                        map((payload: unknown) => {
                            if (!response.ok) throw parseError(payload, response.status);
                            return parse(payload);
                        }),
                    ),
                ),
                timeout({ first: this.timeoutMs }),
                catchError((error: unknown) => {
                    if (error instanceof WalletApiError) return throwError(() => error);
                    return throwError(
                        () => new WalletApiError(error instanceof TimeoutError ? 'REQUEST_TIMEOUT' : 'OFFLINE', true),
                    );
                }),
                finalize(() => controller.abort()),
            );
        });
    }
}

const canonicalMillilitres = /^(0|[1-9][0-9]{0,18})$/;
const positiveMillilitres = /^[1-9][0-9]{0,18}$/;
const litres = /^(0|[1-9][0-9]*)\.[0-9]{3}$/;
const category = /^[A-Z][A-Z0-9_]{1,63}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBalance(payload: unknown): WalletBalance {
    const value = exactObject(payload, ['balanceMl', 'balanceLiters', 'observedAt']);
    if (
        !isMatchingString(value.balanceMl, canonicalMillilitres) ||
        !isMatchingString(value.balanceLiters, litres) ||
        !isDateTime(value.observedAt)
    ) {
        throw invalidResponse();
    }
    return {
        balanceMl: value.balanceMl,
        balanceLiters: value.balanceLiters,
        observedAt: value.observedAt,
    };
}

function parseHistoryPage(payload: unknown): WalletHistoryPage {
    const value = exactObject(payload, ['items', 'nextCursor', 'hasMore']);
    if (
        !Array.isArray(value.items) ||
        value.items.length > 100 ||
        !(
            value.nextCursor === null ||
            (typeof value.nextCursor === 'string' && value.nextCursor.length > 0 && value.nextCursor.length <= 512)
        ) ||
        typeof value.hasMore !== 'boolean'
    ) {
        throw invalidResponse();
    }
    return {
        items: value.items.map(parseOperation),
        nextCursor: value.nextCursor,
        hasMore: value.hasMore,
    };
}

function parseOperation(payload: unknown): WalletOperation {
    const value = exactObject(payload, [
        'id',
        'direction',
        'amountMl',
        'operationKind',
        'source',
        'occurredAt',
        'recordedAt',
    ]);
    if (
        !isMatchingString(value.id, uuid) ||
        (value.direction !== 'CREDIT' && value.direction !== 'DEBIT') ||
        !isMatchingString(value.amountMl, positiveMillilitres) ||
        !isMatchingString(value.operationKind, category) ||
        !isMatchingString(value.source, category) ||
        !isDateTime(value.occurredAt) ||
        !isDateTime(value.recordedAt)
    ) {
        throw invalidResponse();
    }
    return {
        id: value.id,
        direction: value.direction,
        amountMl: value.amountMl,
        operationKind: value.operationKind,
        source: value.source,
        occurredAt: value.occurredAt,
        recordedAt: value.recordedAt,
    };
}

function exactObject(payload: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidResponse();
    const value = payload as Record<string, unknown>;
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== keys.length || keys.some((key) => !(key in value))) throw invalidResponse();
    return value;
}

function isMatchingString(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.test(value);
}

function isDateTime(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseError(payload: unknown, status: number): WalletApiError {
    const candidate = payload as { error?: { code?: unknown; retryable?: unknown } } | undefined;
    const code = typeof candidate?.error?.code === 'string' ? candidate.error.code : 'WALLET_TEMPORARILY_UNAVAILABLE';
    const retryable = typeof candidate?.error?.retryable === 'boolean' ? candidate.error.retryable : status >= 500;
    return new WalletApiError(code, retryable);
}

function invalidResponse(): WalletApiError {
    return new WalletApiError('INVALID_RESPONSE', true);
}
