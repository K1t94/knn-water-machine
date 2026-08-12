import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReferralApiError } from '../../api/referral-api';
import { SessionStore } from '../../auth/stores/session.store';
import { FeatureAvailabilityStore } from '../../features/stores/feature-availability.store';
import { ReferralStore } from '../stores/referral.store';

import { ReferralFlowService } from './referral-flow.service';

import type { ReferralApi, MyReferral, ReferralInvitationPage } from '../../api/referral-api';
import type { Observable } from 'rxjs';

describe('ReferralFlowService', () => {
    it('loads only for an authenticated session while enabled', () => {
        const session = new SessionStore();
        const availability = enabledAvailability();
        const store = new ReferralStore();
        const api = createApi();
        const flow = new ReferralFlowService(store, api, session, access(session), availability);
        expect(api.getMe).not.toHaveBeenCalled();
        session.authenticate(credentials('token'));
        expect(store.myReferral?.promoCode).toBe('23456789ABCD');
        availability.disableFromReferralResponse();
        expect(store.myReferral).toBeUndefined();
        expect('applyPromoCode' in flow).toBe(false);
        flow.dispose();
    });

    it('publishes FEATURE_DISABLED globally and rejects stale data', () => {
        const session = new SessionStore();
        session.authenticate(credentials('token'));
        const availability = enabledAvailability();
        const store = new ReferralStore();
        const me = new Subject<MyReferral>();
        const invitations = new Subject<ReferralInvitationPage>();
        const api = createApi({ getMe: vi.fn(() => me), getInvitations: vi.fn(() => invitations) });
        const flow = new ReferralFlowService(store, api, session, access(session), availability);
        me.error(new ReferralApiError('FEATURE_DISABLED', false));
        expect(availability.state).toBe('disabled');
        expect(store.myReferral).toBeUndefined();
        invitations.next(page());
        expect(store.myReferral).toBeUndefined();
        flow.dispose();
    });

    it('keeps ordinary retryable errors local and reloads on retry', () => {
        const session = new SessionStore();
        session.authenticate(credentials('token'));
        const api = createApi({ getMe: vi.fn().mockReturnValueOnce(throwError(() => new ReferralApiError('OFFLINE', true))).mockReturnValue(of(summary())) });
        const store = new ReferralStore();
        const flow = new ReferralFlowService(store, api, session, access(session), enabledAvailability());
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });
        flow.retry();
        expect(store.myReferral).toEqual(summary());
        flow.dispose();
    });
});

function createApi(overrides: Partial<ReferralApi> = {}): ReferralApi {
    return { getMe: vi.fn(() => of(summary())), getInvitations: vi.fn(() => of(page())), ...overrides };
}
function access(session: SessionStore) { return { withAccess<T>(request: (token: string) => Observable<T>) { return request(session.accessToken ?? ''); } }; }
function enabledAvailability(): FeatureAvailabilityStore { const store = new FeatureAvailabilityStore(); store.finishRefresh(store.beginRefresh(), true); return store; }
function credentials(accessToken: string) { return { accessToken, accessExpiresAt: '2099-01-01T00:15:00.000Z', refreshToken: 'refresh', refreshExpiresAt: '2099-03-01T00:00:00.000Z' }; }
function summary(): MyReferral { return { promoCode: '23456789ABCD', referralLink: 'kaynann://register?promo=23456789ABCD', currentInviterRewardMl: '5000', creditedInviterBonusMl: '5000', creditedInvitationCount: 1 }; }
function page(): ReferralInvitationPage { return { items: [], nextCursor: null, hasMore: false }; }
