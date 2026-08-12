import { TimeoutError, catchError, defer, finalize, from, map, switchMap, throwError, timeout } from 'rxjs';

import type { Observable } from 'rxjs';

export interface PublicAppConfig {
    features: {
        referralProgramEnabled: boolean;
    };
}

export interface AppConfigApi {
    getConfig(): Observable<PublicAppConfig>;
}

export class AppConfigApiError extends Error {
    constructor(
        readonly code: 'INVALID_RESPONSE' | 'OFFLINE' | 'REQUEST_TIMEOUT' | 'SERVICE_UNAVAILABLE',
        readonly retryable: boolean,
    ) {
        super(code);
        this.name = 'AppConfigApiError';
    }
}

export class FetchAppConfigApi implements AppConfigApi {
    constructor(
        private readonly baseUrl: string,
        private readonly timeoutMs = 10_000,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {}

    getConfig(): Observable<PublicAppConfig> {
        return defer(() => {
            const controller = new AbortController();
            return from(
                this.fetcher(`${this.baseUrl}/v1/app-config`, {
                    headers: { accept: 'application/json' },
                    method: 'GET',
                    signal: controller.signal,
                }),
            ).pipe(
                switchMap((response) =>
                    from(response.json()).pipe(
                        map((payload: unknown) => {
                            if (!response.ok) {
                                throw new AppConfigApiError('SERVICE_UNAVAILABLE', response.status >= 500);
                            }
                            return parseAppConfig(payload);
                        }),
                    ),
                ),
                timeout({ first: this.timeoutMs }),
                catchError((error: unknown) => {
                    if (error instanceof AppConfigApiError) return throwError(() => error);
                    return throwError(
                        () => new AppConfigApiError(error instanceof TimeoutError ? 'REQUEST_TIMEOUT' : 'OFFLINE', true),
                    );
                }),
                finalize(() => controller.abort()),
            );
        });
    }
}

function parseAppConfig(payload: unknown): PublicAppConfig {
    const root = exactObject(payload, ['features']);
    const features = exactObject(root.features, ['referralProgramEnabled']);
    if (typeof features.referralProgramEnabled !== 'boolean') {
        throw new AppConfigApiError('INVALID_RESPONSE', false);
    }
    return { features: { referralProgramEnabled: features.referralProgramEnabled } };
}

function exactObject(payload: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AppConfigApiError('INVALID_RESPONSE', false);
    }
    const value = payload as Record<string, unknown>;
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== keys.length || keys.some((key) => !(key in value))) {
        throw new AppConfigApiError('INVALID_RESPONSE', false);
    }
    return value;
}
