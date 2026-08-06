import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { ReferralStore } from '../referral/stores/referral.store';
import { WalletStore } from '../wallet/stores/wallet.store';

import { MainNavigator, mainNavigationRef } from './MainNavigator';

import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';

describe('MainNavigator', () => {
    it('declares Wallet, Referral, and ApplyReferralCode and keeps wallet actions wired', async () => {
        const wallet = walletRoot();
        const referral = referralRoot();
        const logout = vi.fn();
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const view = await render(<MainNavigator onLogout={logout} referral={referral} wallet={wallet} />);

        expect(view.getByText('Mon eau')).toBeTruthy();
        await fireEvent.press(view.getByLabelText('Ouvrir le parrainage'));
        expect(navigate).toHaveBeenCalledWith('Referral');
        await fireEvent.press(view.getByLabelText('Se déconnecter'));
        expect(logout).toHaveBeenCalledOnce();
        navigate.mockRestore();
    });

    it('binds signed-in deep links to the explicit apply route without applying', async () => {
        const referral = referralRoot();
        let openApplyScreen: (() => boolean) | undefined;
        const bindSignedInNavigation = vi.fn((open: () => boolean) => {
            openApplyScreen = open;
            return vi.fn();
        });
        referral.linkCoordinator.bindSignedInNavigation = bindSignedInNavigation;
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        await render(<MainNavigator onLogout={vi.fn()} referral={referral} wallet={walletRoot()} />);
        expect(bindSignedInNavigation).toHaveBeenCalledOnce();
        expect(openApplyScreen?.()).toBe(true);
        expect(navigate).toHaveBeenCalledWith('ApplyReferralCode');
        expect(referral.flow.applyPromoCode).not.toHaveBeenCalled();
        navigate.mockRestore();
    });
});

function walletRoot(): WalletCompositionRoot {
    const store = new WalletStore();
    const token = store.beginInitialLoad();
    store.finishInitialLoad(
        token,
        { balanceMl: '0', balanceLiters: '0.000', observedAt: '2026-08-10T10:00:00.000Z' },
        { items: [], nextCursor: null, hasMore: false },
    );
    return {
        store,
        flow: { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn() },
    } as unknown as WalletCompositionRoot;
}

function referralRoot(): ReferralCompositionRoot {
    return {
        store: new ReferralStore(),
        flow: { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn(), applyPromoCode: vi.fn() },
        nativeActions: { copyPromoCode: vi.fn(), shareReferralLink: vi.fn() },
        linkCoordinator: { bindSignedInNavigation: vi.fn(() => vi.fn()) },
    } as unknown as ReferralCompositionRoot;
}
