import { describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../auth/stores/session.store';
import { ReferralStore } from '../referral/stores/referral.store';

import { ReferralLinkCoordinator, type ReferralLinkSource } from './referral-link-coordinator';

class TestLinkSource implements ReferralLinkSource {
    private listener: ((url: string) => void) | undefined;

    constructor(private readonly initialUrl: string | null) {}

    getInitialUrl(): Promise<string | null> {
        return Promise.resolve(this.initialUrl);
    }

    subscribe(listener: (url: string) => void): () => void {
        this.listener = listener;
        return () => {
            if (this.listener === listener) this.listener = undefined;
        };
    }

    emit(url: string): void {
        this.listener?.(url);
    }
}

function credentials(accessToken: string) {
    return {
        accessToken,
        accessExpiresAt: '2030-01-01T00:00:00.000Z',
        refreshToken: `refresh-${accessToken}`,
        refreshExpiresAt: '2030-02-01T00:00:00.000Z',
    };
}

describe('ReferralLinkCoordinator', () => {
    it('preserves an editable signed-out promo from the initial URL and later link events', async () => {
        const source = new TestLinkSource('kaynann://register?promo=firstcode123');
        const session = new SessionStore();
        session.markAnonymous();
        const referral = new ReferralStore();
        const setPendingPromoCode = vi.fn();
        const coordinator = new ReferralLinkCoordinator(session, referral, source);

        const unbind = coordinator.bindRegistration({ setPendingPromoCode });
        await vi.waitFor(() => expect(setPendingPromoCode).toHaveBeenCalledWith('FIRSTCODE123'));

        source.emit('kaynann://register?promo=secondcode12');
        expect(setPendingPromoCode).toHaveBeenLastCalledWith('SECONDCODE12');

        unbind();
        coordinator.dispose();
    });

    it('prefills signed-in apply state without applying and suppresses auth-to-main duplicates', async () => {
        const source = new TestLinkSource('kaynann://register?promo=sharedcode12');
        const session = new SessionStore();
        session.markAnonymous();
        const referral = new ReferralStore();
        const setPendingPromoCode = vi.fn();
        const openApplyScreen = vi.fn(() => true);
        const coordinator = new ReferralLinkCoordinator(session, referral, source);
        coordinator.bindRegistration({ setPendingPromoCode });
        coordinator.bindSignedInNavigation(openApplyScreen);

        await vi.waitFor(() => expect(setPendingPromoCode).toHaveBeenCalledTimes(1));
        session.authenticate(credentials('access-one'));
        source.emit('kaynann://register?promo=sharedcode12');

        expect(referral.applyCode).toBe('');
        expect(referral.applyState).toBe('idle');
        expect(setPendingPromoCode).toHaveBeenCalledTimes(1);

        source.emit('kaynann://register?promo=signedincode1');
        expect(referral.applyCode).toBe('SIGNEDINCODE1');
        expect(referral.applyState).toBe('idle');
        expect(openApplyScreen).toHaveBeenCalledOnce();

        coordinator.dispose();
    });

    it('ignores unrelated and duplicate subsequent links', () => {
        const source = new TestLinkSource(null);
        const session = new SessionStore();
        session.authenticate(credentials('access-one'));
        const referral = new ReferralStore();
        const coordinator = new ReferralLinkCoordinator(session, referral, source);

        source.emit('https://example.com/register?promo=IGNORED12345');
        source.emit('kaynann://register?promo=onceonly1234');
        referral.setApplyCode('USEREDIT1234');
        source.emit('kaynann://register?promo=ONCEONLY1234');

        expect(referral.applyCode).toBe('USEREDIT1234');

        coordinator.dispose();
        source.emit('kaynann://register?promo=AFTERDISPOSE');
        expect(referral.applyCode).toBe('USEREDIT1234');
    });
});
