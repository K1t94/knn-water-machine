import { describe, expect, it } from 'vitest';

import { FeatureAvailabilityStore } from './feature-availability.store';

describe('FeatureAvailabilityStore', () => {
    it('fails closed through unknown, loading, disabled, and error states', () => {
        const store = new FeatureAvailabilityStore();
        expect(store.referralUiVisible).toBe(false);
        const disabled = store.beginRefresh();
        expect(store.state).toBe('loading');
        store.finishRefresh(disabled, false);
        expect(store.state).toBe('disabled');
        const failed = store.beginRefresh();
        store.failRefresh(failed, { code: 'OFFLINE', retryable: true });
        expect(store.state).toBe('error');
        expect(store.referralUiVisible).toBe(false);
    });

    it('publishes enabled state without exposing a revision and rejects stale refreshes', () => {
        const store = new FeatureAvailabilityStore();
        const stale = store.beginRefresh();
        const current = store.beginRefresh();
        store.finishRefresh(stale, true);
        expect(store.state).toBe('loading');
        store.finishRefresh(current, true);
        expect(store.referralUiVisible).toBe(true);
        expect('revision' in store).toBe(false);
    });

    it('atomically fails closed on FEATURE_DISABLED and session replacement', () => {
        const store = new FeatureAvailabilityStore();
        store.finishRefresh(store.beginRefresh(), true);
        store.disableFromReferralResponse();
        expect(store.state).toBe('disabled');
        expect(store.error).toBeUndefined();
        store.resetForSessionReplacement();
        expect(store.state).toBe('unknown');
        expect(store.referralUiVisible).toBe(false);
    });
});
