import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { FeatureAvailabilityStore } from '../features/stores/feature-availability.store';
import { ReferralStore } from '../referral/stores/referral.store';
import { WalletStore } from '../wallet/stores/wallet.store';

import { MainNavigator, mainNavigationRef } from './MainNavigator';

import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';

describe('MainNavigator', () => {
    it('shows the referral entry only while availability is enabled', async () => {
        const referral = referralRoot(true);
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const view = await render(<MainNavigator onLogout={vi.fn()} referral={referral} wallet={walletRoot()} />);
        await fireEvent.press(view.getByLabelText('Ouvrir le parrainage'));
        expect(navigate).toHaveBeenCalledWith('Referral');
        await act(async () => referral.availability.disableFromReferralResponse());
        await waitFor(() => expect(view.queryByLabelText('Ouvrir le parrainage')).toBeNull());
        navigate.mockRestore();
    });

    it.each([false, undefined])('does not declare referral UI when enabled is %s', async (enabled) => {
        const referral = referralRoot(enabled === true);
        if (enabled === undefined) referral.availability.resetForSessionReplacement();
        const view = await render(<MainNavigator onLogout={vi.fn()} referral={referral} wallet={walletRoot()} />);
        expect(view.queryByLabelText('Ouvrir le parrainage')).toBeNull();
    });

    it('does not contain the retired post-registration apply screen or route', () => {
        const mobileSourceRoot = join(__dirname, '..');
        const productionFiles = productionTypeScriptFiles(mobileSourceRoot);

        expect(productionFiles.some((path) => /ApplyReferralCodeScreen/.test(path))).toBe(false);
        expect(
            productionFiles.filter((path) =>
                /ApplyReferralCodeScreen|ApplyReferralCode|ReferralApplication/.test(readFileSync(path, 'utf8')),
            ),
        ).toEqual([]);
    });
});

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

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
function referralRoot(enabled: boolean): ReferralCompositionRoot {
    const availability = new FeatureAvailabilityStore();
    availability.finishRefresh(availability.beginRefresh(), enabled);
    return {
        availability,
        store: new ReferralStore(),
        flow: { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn() },
        nativeActions: { copyPromoCode: vi.fn(), shareReferralLink: vi.fn() },
        linkCoordinator: {},
    } as unknown as ReferralCompositionRoot;
}
