import { describe, expect, it } from 'vitest';

import { ReferralStore } from './referral.store';

import type { MyReferral, ReferralInvitationPage } from '../../api/referral-api';

describe('ReferralStore', () => {
    it('moves through initial, loading, empty, loaded, refresh, and retryable error states', () => {
        const store = new ReferralStore();
        expect(store.viewState).toBe('initial');

        const initial = store.beginInitialLoad();
        expect(store.viewState).toBe('loading');
        store.finishInitialLoad(initial, summary(), page([]));
        expect(store.viewState).toBe('empty');

        const refresh = store.beginRefresh();
        expect(store.refreshing).toBe(true);
        store.finishRefresh(refresh, summary(), page([invitation('one')]));
        expect(store.viewState).toBe('loaded');

        const retry = store.beginRefresh();
        store.failRefresh(retry, { code: 'OFFLINE', retryable: true });
        expect(store.error).toEqual({ code: 'OFFLINE', retryable: true });
        expect(store.invitations).toHaveLength(1);
    });

    it('serializes pagination and ignores stale results after clear', () => {
        const store = new ReferralStore();
        const initial = store.beginInitialLoad();
        store.finishInitialLoad(initial, summary(), page([invitation('one')], 'next', true));

        const next = store.beginNextPage();
        expect(next).toEqual(expect.any(Number));
        expect(store.beginNextPage()).toBeUndefined();
        store.clear();
        store.finishNextPage(next!, page([invitation('stale')]));

        expect(store.invitations).toEqual([]);
        expect(store.myReferral).toBeUndefined();
        expect(store.viewState).toBe('initial');
    });

    it('owns apply success, validation, closed, and prefilled-code states', () => {
        const store = new ReferralStore();
        const initial = store.beginInitialLoad();
        store.finishInitialLoad(initial, summary(), page([]));
        store.prefillPromoCode('  23456789abcd ');
        expect(store.applyCode).toBe('23456789ABCD');

        const applied = store.beginApply();
        store.finishApply(applied!, {
            status: 'ATTACHED',
            promoCode: '23456789ABCD',
            appliedAt: '2026-08-10T10:00:00.000Z',
        });
        expect(store.applyState).toBe('success');
        expect(store.myReferral?.attachedPromoCode).toBe('23456789ABCD');

        store.clear();
        store.prefillPromoCode('INVALID');
        const invalid = store.beginApply();
        store.failApply(invalid!, { code: 'REFERRAL_CODE_UNAVAILABLE', kind: 'validation', retryable: false });
        expect(store.applyState).toBe('validation-error');

        const closed = store.beginApply();
        store.failApply(closed!, { code: 'REFERRAL_ELIGIBILITY_CLOSED', kind: 'closed', retryable: false });
        expect(store.applyState).toBe('closed');
        store.clear();
        expect(store.applyCode).toBe('');
        expect(store.applyError).toBeUndefined();
    });
});

function summary(): MyReferral {
    return {
        promoCode: '23456789ABCD',
        referralLink: 'kaynann://register?promo=23456789ABCD',
        eligibility: 'OPEN',
        attachedPromoCode: null,
        currentInviterRewardMl: '5000',
        creditedInviterBonusMl: '0',
        creditedInvitationCount: 0,
    };
}

function page(
    items: ReferralInvitationPage['items'],
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
