import {
    TimeoutError,
    catchError,
    defer,
    finalize,
    from,
    map,
    type Observable,
    of,
    switchMap,
    throwError,
    timeout,
} from 'rxjs';

export type OtpDelivery = 'accepted' | 'uncertain';

export interface OtpIssued {
    challengeId: string;
    expiresAt: string;
    resendAvailableAt: string;
    delivery: OtpDelivery;
}

export interface OtpVerified {
    nextStep: 'completeRegistration' | 'acceptLegal' | 'authenticated';
    registrationAuthorization?: string;
    expiresAt?: string;
    session?: SessionCredentials;
}

export interface LegalDocument {
    id: string;
    kind: 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY';
    version: string;
    title: string;
    content: string;
    mandatory: boolean;
    contentSha256: string;
}

export interface CurrentLegalSet {
    setVersion: string;
    documents: LegalDocument[];
}

export interface SessionCredentials {
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    refreshExpiresAt: string;
}

export class AuthApiError extends Error {
    constructor(
        public readonly code: string,
        public readonly retryable: boolean,
        public readonly retryAfterSeconds?: number,
    ) {
        super(code);
    }
}

interface OtpBaseInput {
    phone: string;
    pendingPromoCode?: string | null;
}

export interface AuthApi {
    requestOtp(input: OtpBaseInput): Observable<OtpIssued>;
    resendOtp(input: OtpBaseInput & { challengeId: string }): Observable<OtpIssued>;
    verifyOtp(input: OtpBaseInput & { challengeId: string; code: string }): Observable<OtpVerified>;
    updateRegistrationContext(registrationAuthorization: string, pendingPromoCode: string | null): Observable<void>;
    getCurrentLegalDocuments(registrationAuthorization: string): Observable<CurrentLegalSet>;
    completeRegistration(
        registrationAuthorization: string,
        idempotencyKey: string,
        input: { setVersion: string; acceptedDocumentIds: readonly string[] },
    ): Observable<SessionCredentials>;
    acceptUpdatedLegal(
        registrationAuthorization: string,
        idempotencyKey: string,
        input: { setVersion: string; acceptedDocumentIds: readonly string[] },
    ): Observable<SessionCredentials>;
    refreshSession(refreshToken: string): Observable<SessionCredentials>;
    logoutCurrentSession(accessToken: string): Observable<void>;
}

export class FetchAuthApi implements AuthApi {
    constructor(
        private readonly baseUrl: string,
        private readonly installationId: string,
        private readonly timeoutMs = 10_000,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {}

    requestOtp(input: OtpBaseInput): Observable<OtpIssued> {
        return this.send('/v1/auth/otp/requests', input, false);
    }

    resendOtp(input: OtpBaseInput & { challengeId: string }): Observable<OtpIssued> {
        return this.send(`/v1/auth/otp/requests/${encodeURIComponent(input.challengeId)}/resend`, input, true);
    }

    verifyOtp(input: OtpBaseInput & { challengeId: string; code: string }): Observable<OtpVerified> {
        return this.send('/v1/auth/otp/verifications', input, false);
    }

    updateRegistrationContext(registrationAuthorization: string, pendingPromoCode: string | null): Observable<void> {
        return this.send('/v1/auth/registration/context', {
            method: 'PATCH',
            body: { pendingPromoCode },
            registrationAuthorization,
        });
    }

    getCurrentLegalDocuments(registrationAuthorization: string): Observable<CurrentLegalSet> {
        return this.send('/v1/legal/documents/current', {
            method: 'GET',
            registrationAuthorization,
        });
    }

    completeRegistration(
        registrationAuthorization: string,
        idempotencyKey: string,
        input: { setVersion: string; acceptedDocumentIds: readonly string[] },
    ): Observable<SessionCredentials> {
        return this.send('/v1/auth/registration/complete', {
            method: 'POST',
            body: { ...input, installationId: this.installationId },
            registrationAuthorization,
            idempotencyKey,
        });
    }

    acceptUpdatedLegal(
        registrationAuthorization: string,
        idempotencyKey: string,
        input: { setVersion: string; acceptedDocumentIds: readonly string[] },
    ): Observable<SessionCredentials> {
        return this.send('/v1/auth/legal/acceptances', {
            method: 'POST',
            body: { ...input, installationId: this.installationId },
            registrationAuthorization,
            idempotencyKey,
        });
    }

    refreshSession(refreshToken: string): Observable<SessionCredentials> {
        return this.send('/v1/auth/sessions/refresh', {
            method: 'POST',
            body: { refreshToken },
        });
    }

    logoutCurrentSession(accessToken: string): Observable<void> {
        return this.send('/v1/auth/sessions/current', {
            method: 'DELETE',
            accessToken,
        });
    }

    private send<T>(
        path: string,
        input: OtpBaseInput & { challengeId?: string; code?: string },
        omitChallengeId?: boolean,
    ): Observable<T>;
    private send<T>(
        path: string,
        request: {
            method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
            body?: object;
            registrationAuthorization?: string;
            idempotencyKey?: string;
            accessToken?: string;
        },
    ): Observable<T>;
    private send<T>(
        path: string,
        input:
            | (OtpBaseInput & { challengeId?: string; code?: string })
            | {
                  method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
                  body?: object;
                  registrationAuthorization?: string;
                  idempotencyKey?: string;
                  accessToken?: string;
              },
        omitChallengeId = false,
    ): Observable<T> {
        const isRequest = 'method' in input;
        const method = isRequest ? input.method : 'POST';
        const body = isRequest
            ? input.body
            : {
                  ...Object.fromEntries(
                      Object.entries(input).filter(([key]) => !omitChallengeId || key !== 'challengeId'),
                  ),
                  installationId: this.installationId,
              };
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-request-id': createRequestId(),
        };
        if (isRequest && input.registrationAuthorization) {
            headers['x-registration-authorization'] = input.registrationAuthorization;
        }
        if (isRequest && input.idempotencyKey) {
            headers['idempotency-key'] = input.idempotencyKey;
        }
        if (isRequest && input.accessToken) {
            headers.authorization = `Bearer ${input.accessToken}`;
        }

        return defer(() => {
            const controller = new AbortController();
            return from(
                this.fetcher(`${this.baseUrl}${path}`, {
                    method,
                    headers,
                    ...(body ? { body: JSON.stringify(body) } : {}),
                    signal: controller.signal,
                }),
            ).pipe(
                switchMap((response) =>
                    defer(() => (response.status === 204 ? of(undefined) : from(response.json()))).pipe(
                        catchError(() => of(undefined)),
                        map((payload: unknown) => normalizeResponse<T>(response, payload)),
                    ),
                ),
                timeout({ first: this.timeoutMs }),
                catchError((error: unknown) => {
                    if (error instanceof AuthApiError) return throwError(() => error);
                    return throwError(
                        () => new AuthApiError(error instanceof TimeoutError ? 'REQUEST_TIMEOUT' : 'OFFLINE', true),
                    );
                }),
                finalize(() => controller.abort()),
            );
        });
    }
}

function normalizeResponse<T>(response: Response, payload: unknown): T {
    const errorPayload = payload as
        | {
              error?: { code?: string; retryable?: boolean; retryAfterSeconds?: number };
          }
        | undefined;
    if (!response.ok) {
        throw new AuthApiError(
            errorPayload?.error?.code ?? 'SERVICE_UNAVAILABLE',
            errorPayload?.error?.retryable ?? response.status >= 500,
            errorPayload?.error?.retryAfterSeconds,
        );
    }
    return payload as T;
}

function createRequestId(): string {
    return (
        globalThis.crypto?.randomUUID?.() ??
        `mobile-${Date.now().toString(36)}-${performance.now().toString(36).replace('.', '')}`
    );
}
