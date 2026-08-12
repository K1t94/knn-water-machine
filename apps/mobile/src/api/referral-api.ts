import { TimeoutError, catchError, defer, finalize, from, map, switchMap, throwError, timeout } from 'rxjs';

import { AuthApiError } from './auth-api';

import type { Observable } from 'rxjs';

export interface MyReferral {
    promoCode: string;
    referralLink: string;
    currentInviterRewardMl: string;
    creditedInviterBonusMl: string;
    creditedInvitationCount: number;
}

export interface ReferralInvitation {
    id: string;
    inviteeLabel: string;
    appliedAt: string;
    status: 'CREDITED';
    creditedAmountMl: string;
}

export interface ReferralInvitationPage {
    items: ReferralInvitation[];
    nextCursor: string | null;
    hasMore: boolean;
}

export interface ReferralInvitationQuery {
    cursor?: string;
    limit?: number;
}

export interface ReferralApi {
    getMe(accessToken: string): Observable<MyReferral>;
    getInvitations(accessToken: string, query?: ReferralInvitationQuery): Observable<ReferralInvitationPage>;
}

export class ReferralApiError extends AuthApiError {}

export class FetchReferralApi implements ReferralApi {
    constructor(
        private readonly baseUrl: string,
        private readonly timeoutMs = 10_000,
        private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    ) {}

    getMe(accessToken: string): Observable<MyReferral> {
        return this.request('/v1/referrals/me', accessToken, { method: 'GET' }, parseMyReferral);
    }

    getInvitations(accessToken: string, query: ReferralInvitationQuery = {}): Observable<ReferralInvitationPage> {
        const search = new URLSearchParams();
        if (query.limit !== undefined) search.set('limit', String(query.limit));
        if (query.cursor !== undefined) search.set('cursor', query.cursor);
        const suffix = search.size > 0 ? `?${search.toString()}` : '';
        return this.request(`/v1/referrals/invitations${suffix}`, accessToken, { method: 'GET' }, parseInvitationPage);
    }

    private request<T>(
        path: string,
        accessToken: string,
        init: Pick<RequestInit, 'body' | 'method'>,
        parse: (payload: unknown) => T,
    ): Observable<T> {
        return defer(() => {
            const controller = new AbortController();
            const headers: Record<string, string> = {
                accept: 'application/json',
                authorization: `Bearer ${accessToken}`,
            };
            if (init.body !== undefined) headers['content-type'] = 'application/json';
            return from(
                this.fetcher(`${this.baseUrl}${path}`, {
                    ...init,
                    headers,
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
                    if (error instanceof ReferralApiError) return throwError(() => error);
                    return throwError(
                        () => new ReferralApiError(error instanceof TimeoutError ? 'REQUEST_TIMEOUT' : 'OFFLINE', true),
                    );
                }),
                finalize(() => controller.abort()),
            );
        });
    }
}

const promoCodePattern = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;
const referralLinkPattern = /^kaynann:\/\/register\?promo=[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;
const millilitresPattern = /^(0|[1-9][0-9]*)$/;
const inviteeLabelPattern = /^\*\*[0-9]{0,2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMyReferral(payload: unknown): MyReferral {
    const value = exactObject(payload, [
        'promoCode',
        'referralLink',
        'currentInviterRewardMl',
        'creditedInviterBonusMl',
        'creditedInvitationCount',
    ]);
    if (
        !matches(value.promoCode, promoCodePattern) ||
        !matches(value.referralLink, referralLinkPattern) ||
        !matches(value.currentInviterRewardMl, millilitresPattern) ||
        !matches(value.creditedInviterBonusMl, millilitresPattern) ||
        !isNonNegativeInteger(value.creditedInvitationCount)
    ) {
        throw invalidResponse();
    }
    return {
        promoCode: value.promoCode,
        referralLink: value.referralLink,
        currentInviterRewardMl: value.currentInviterRewardMl,
        creditedInviterBonusMl: value.creditedInviterBonusMl,
        creditedInvitationCount: value.creditedInvitationCount,
    };
}

function parseInvitationPage(payload: unknown): ReferralInvitationPage {
    const value = exactObject(payload, ['items', 'nextCursor', 'hasMore']);
    if (
        !Array.isArray(value.items) ||
        value.items.length > 100 ||
        !(value.nextCursor === null || isBoundedString(value.nextCursor, 1, 512)) ||
        typeof value.hasMore !== 'boolean'
    ) {
        throw invalidResponse();
    }
    return { items: value.items.map(parseInvitation), nextCursor: value.nextCursor, hasMore: value.hasMore };
}

function parseInvitation(payload: unknown): ReferralInvitation {
    const value = exactObject(payload, ['id', 'inviteeLabel', 'appliedAt', 'status', 'creditedAmountMl']);
    if (
        !matches(value.id, uuidPattern) ||
        !matches(value.inviteeLabel, inviteeLabelPattern) ||
        !isDateTime(value.appliedAt) ||
        value.status !== 'CREDITED' ||
        !matches(value.creditedAmountMl, millilitresPattern)
    ) {
        throw invalidResponse();
    }
    return {
        id: value.id,
        inviteeLabel: value.inviteeLabel,
        appliedAt: value.appliedAt,
        status: value.status,
        creditedAmountMl: value.creditedAmountMl,
    };
}

function exactObject(payload: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidResponse();
    const value = payload as Record<string, unknown>;
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== keys.length || keys.some((key) => !(key in value))) throw invalidResponse();
    return value;
}

function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
    return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function isDateTime(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseError(payload: unknown, status: number): ReferralApiError {
    const candidate = payload as { error?: { code?: unknown; retryable?: unknown } } | undefined;
    const code = typeof candidate?.error?.code === 'string' ? candidate.error.code : 'REFERRAL_SERVICE_UNAVAILABLE';
    const retryable = typeof candidate?.error?.retryable === 'boolean' ? candidate.error.retryable : status >= 500;
    return new ReferralApiError(code, retryable);
}

function invalidResponse(): ReferralApiError {
    return new ReferralApiError('INVALID_RESPONSE', true);
}
