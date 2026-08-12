import { describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../auth/stores/session.store';
import { FeatureAvailabilityStore } from '../features/stores/feature-availability.store';

import { ReferralLinkCoordinator, type ReferralLinkSource } from './referral-link-coordinator';

class TestLinkSource implements ReferralLinkSource {
    private listener: ((url: string) => void) | undefined;
    constructor(private readonly initialUrl: string | null) {}
    getInitialUrl(): Promise<string | null> { return Promise.resolve(this.initialUrl); }
    subscribe(listener: (url: string) => void): () => void {
        this.listener = listener;
        return () => { if (this.listener === listener) this.listener = undefined; };
    }
    emit(url: string): void { this.listener?.(url); }
}

describe('ReferralLinkCoordinator', () => {
    it('accepts editable anonymous promo context only while enabled', async () => {
        const source = new TestLinkSource('kaynann://register?promo=firstcode123');
        const session = anonymousSession();
        const availability = enabledAvailability();
        const commands = { setPendingPromoCode: vi.fn(), removePendingPromoCode: vi.fn() };
        const coordinator = new ReferralLinkCoordinator(session, availability, source);
        coordinator.bindRegistration(commands);

        await vi.waitFor(() => expect(commands.setPendingPromoCode).toHaveBeenCalledWith('FIRSTCODE123'));
        source.emit('kaynann://register?promo=secondcode12');
        expect(commands.setPendingPromoCode).toHaveBeenLastCalledWith('SECONDCODE12');
        availability.disableFromReferralResponse();
        expect(commands.removePendingPromoCode).toHaveBeenCalledOnce();
        source.emit('kaynann://register?promo=ignoredcode1');
        expect(commands.setPendingPromoCode).toHaveBeenCalledTimes(2);
        coordinator.dispose();
    });

    it.each(['unknown', 'disabled'] as const)('does not retain links while %s', async (state) => {
        const source = new TestLinkSource('kaynann://register?promo=ignoredcode1');
        const availability = new FeatureAvailabilityStore();
        if (state === 'disabled') availability.finishRefresh(availability.beginRefresh(), false);
        const commands = { setPendingPromoCode: vi.fn(), removePendingPromoCode: vi.fn() };
        const coordinator = new ReferralLinkCoordinator(anonymousSession(), availability, source);
        coordinator.bindRegistration(commands);
        await Promise.resolve();
        availability.finishRefresh(availability.beginRefresh(), true);
        coordinator.bindRegistration(commands);
        expect(commands.setPendingPromoCode).not.toHaveBeenCalled();
        coordinator.dispose();
    });

    it('unconditionally ignores signed-in referral links', async () => {
        const source = new TestLinkSource('kaynann://register?promo=signedincode1');
        const session = anonymousSession();
        session.authenticate(credentials());
        const commands = { setPendingPromoCode: vi.fn(), removePendingPromoCode: vi.fn() };
        const coordinator = new ReferralLinkCoordinator(session, enabledAvailability(), source);
        coordinator.bindRegistration(commands);
        source.emit('kaynann://register?promo=secondcode12');
        await Promise.resolve();
        expect(commands.setPendingPromoCode).not.toHaveBeenCalled();
        coordinator.dispose();
    });
});

function anonymousSession(): SessionStore { const store = new SessionStore(); store.markAnonymous(); return store; }
function enabledAvailability(): FeatureAvailabilityStore {
    const store = new FeatureAvailabilityStore();
    store.finishRefresh(store.beginRefresh(), true);
    return store;
}
function credentials() {
    return { accessToken: 'access', accessExpiresAt: '2030-01-01T00:00:00.000Z', refreshToken: 'refresh', refreshExpiresAt: '2030-02-01T00:00:00.000Z' };
}
