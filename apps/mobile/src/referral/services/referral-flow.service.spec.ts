import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReferralApiError } from '../../api/referral-api';
import { SessionStore } from '../../auth/stores/session.store';
import { ReferralStore } from '../stores/referral.store';

import { ReferralFlowService } from './referral-flow.service';

import type { AuthenticatedReferralRequestScope } from './referral-flow.service';
import type { SessionCredentials } from '../../api/auth-api';
import type { MyReferral, ReferralApi, ReferralInvitationPage, ReferralInvitationQuery } from '../../api/referral-api';
import type { Observable } from 'rxjs';

describe('ReferralFlowService', () => {
    it('loads on login/restoration and supports retry, refresh, apply, and serialized pagination', () => {
        const session = new SessionStore();
        const store = new ReferralStore();
        const api = createApi();
        const access = new TestAccessScope(() => session.accessToken ?? '');
        const flow = new ReferralFlowService(store, api, session, access);

        session.authenticate(credentials('token'));
        expect(store.myReferral?.promoCode).toBe('23456789ABCD');
        expect(access.calls).toBe(1);

        flow.applyPromoCode('abcdefghjkmn');
        expect(api.apply).toHaveBeenCalledWith('token', 'ABCDEFGHJKMN');
        expect(store.applyState).toBe('success');

        flow.loadNextPage();
        flow.loadNextPage();
        expect(api.getInvitations).toHaveBeenCalledTimes(3);

        vi.mocked(api.getMe).mockReturnValueOnce(throwError(() => new ReferralApiError('OFFLINE', true)));
        flow.refresh();
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });
        flow.retry();
        expect(store.error).toBeUndefined();
        flow.dispose();
    });

    it('cancels and clears on logout or replacement and blocks stale publication after dispose', () => {
        const session = new SessionStore();
        const store = new ReferralStore();
        const me = new Subject<MyReferral>();
        const invitations = new Subject<ReferralInvitationPage>();
        const api = createApi({ getMe: vi.fn(() => me), getInvitations: vi.fn(() => invitations) });
        const flow = new ReferralFlowService(store, api, session, new TestAccessScope(() => session.accessToken ?? ''));

        session.authenticate(credentials('old'));
        expect(me.observed).toBe(true);
        session.authenticate(credentials('replacement'));
        expect(api.getMe).toHaveBeenCalledTimes(2);
        session.markAnonymous();
        expect(me.observed).toBe(false);
        expect(store.viewState).toBe('initial');

        me.next(summary());
        invitations.next(page());
        expect(store.myReferral).toBeUndefined();
        flow.dispose();
        session.authenticate(credentials('after-dispose'));
        expect(api.getMe).toHaveBeenCalledTimes(2);
    });
});

class TestAccessScope implements AuthenticatedReferralRequestScope {
    calls = 0;

    constructor(private readonly resolveToken: () => string) {}

    withAccess<T>(request: (accessToken: string) => Observable<T>): Observable<T> {
        this.calls += 1;
        return request(this.resolveToken());
    }
}

function createApi(overrides: Partial<ReferralApi> = {}): ReferralApi {
    return {
        getMe: vi.fn(() => of(summary())),
        apply: vi.fn((_token: string, promoCode: string) =>
            of({ status: 'ATTACHED' as const, promoCode, appliedAt: '2026-08-10T10:00:00.000Z' }),
        ),
        getInvitations: vi.fn((_token: string, query?: ReferralInvitationQuery) =>
            of(page(query?.cursor ? [] : [invitation('one')], query?.cursor ? 'last' : 'next', true)),
        ),
        ...overrides,
    };
}

function credentials(accessToken: string): SessionCredentials {
    return {
        accessToken,
        accessExpiresAt: '2099-01-01T00:15:00.000Z',
        refreshToken: 'refresh',
        refreshExpiresAt: '2099-03-01T00:00:00.000Z',
    };
}

function summary(): MyReferral {
    return {
        promoCode: '23456789ABCD',
        referralLink: 'kaynann://register?promo=23456789ABCD',
        eligibility: 'OPEN',
        attachedPromoCode: null,
        currentInviterRewardMl: '5000',
        creditedInviterBonusMl: '5000',
        creditedInvitationCount: 1,
    };
}

function page(
    items: ReferralInvitationPage['items'] = [],
    nextCursor: string | null = null,
    hasMore = false,
): ReferralInvitationPage {
    return { items, nextCursor, hasMore };
}

function invitation(id: string): ReferralInvitationPage['items'][number] {
    return {
        id,
        inviteeLabel: '**42',
        appliedAt: '2026-08-10T09:00:00.000Z',
        status: 'CREDITED',
        creditedAmountMl: '5000',
    };
}
