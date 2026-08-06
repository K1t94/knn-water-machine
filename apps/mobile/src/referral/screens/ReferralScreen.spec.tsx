import { act, fireEvent, render } from '@testing-library/react-native';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReferralStore } from '../stores/referral.store';

import { ReferralScreen } from './ReferralScreen';

import type { MyReferral, ReferralInvitationPage } from '../../api/referral-api';
import type { ReferralNativeCommands } from '../native/referral-native-actions';
import type { ReferralCommands } from '../services/referral-flow.service';

describe('ReferralScreen', () => {
    it('renders loading and retryable errors accessibly', async () => {
        const store = new ReferralStore();
        const commands = createCommands();
        const token = store.beginInitialLoad();
        const view = await render(<ReferralScreen commands={commands} nativeActions={nativeActions} store={store} />);

        expect(view.getByLabelText('Chargement du parrainage')).toBeTruthy();

        await act(() => store.failInitialLoad(token, { code: 'OFFLINE', retryable: true }));
        expect(view.getByRole('alert')).toBeTruthy();
        await fireEvent.press(view.getByLabelText('Réessayer de charger le parrainage'));
        expect(commands.retry).toHaveBeenCalledOnce();
    });

    it('shows only API-provided summary values and supports refresh, copy, and share', async () => {
        const store = loadedStore(myReferral(), page([]));
        const commands = createCommands();
        const copyPromoCode = vi.fn(() => of(undefined));
        const shareReferralLink = vi.fn(() => of(undefined));
        const onBack = vi.fn();
        const view = await render(
            <ReferralScreen
                commands={commands}
                nativeActions={{ copyPromoCode, shareReferralLink }}
                onApplyCode={vi.fn()}
                onBack={onBack}
                store={store}
            />,
        );

        expect(view.getByText('ABCD2345WXYZ')).toBeTruthy();
        expect(view.getByText('15.000 L')).toBeTruthy();
        expect(view.getByText('Aucune invitation créditée')).toBeTruthy();
        expect(view.queryByText(/20 L|après achat|Jean|Marie/i)).toBeNull();

        await fireEvent.press(view.getByLabelText('Copier le code promo'));
        await fireEvent.press(view.getByLabelText('Partager le lien de parrainage'));
        await fireEvent.press(view.getByLabelText('Actualiser le parrainage'));
        await fireEvent.press(view.getByLabelText('Retour au portefeuille'));

        expect(copyPromoCode).toHaveBeenCalledWith('ABCD2345WXYZ');
        expect(shareReferralLink).toHaveBeenCalledWith('kaynann://register?promo=ABCD2345WXYZ');
        expect(commands.refresh).toHaveBeenCalledOnce();
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('renders privacy-safe history and distinct pagination states without duplicate rows', async () => {
        const store = loadedStore(
            myReferral(),
            page([invitation('00000000-0000-4000-8000-000000000001', '**42')], 'next', true),
        );
        const commands = createCommands();
        const view = await render(<ReferralScreen commands={commands} nativeActions={nativeActions} store={store} />);

        expect(view.getByText('**42')).toBeTruthy();
        expect(view.queryByText(/77\s?123/)).toBeNull();
        await fireEvent.press(view.getByLabelText('Charger plus d’invitations'));
        expect(commands.loadNextPage).toHaveBeenCalledOnce();

        let token: number | undefined;
        await act(() => {
            token = store.beginNextPage();
        });
        expect(token).toBeDefined();
        expect(view.getByLabelText('Chargement des invitations suivantes')).toBeTruthy();
        await act(() => store.failNextPage(token!, { code: 'OFFLINE', retryable: true }));
        expect(view.getByText('Les invitations suivantes n’ont pas pu être chargées.')).toBeTruthy();

        let retryToken: number | undefined;
        await act(() => {
            retryToken = store.beginNextPage();
        });
        await act(() =>
            store.finishNextPage(
                retryToken!,
                page([
                    invitation('00000000-0000-4000-8000-000000000001', '**42'),
                    invitation('00000000-0000-4000-8000-000000000002', '**09'),
                ]),
            ),
        );
        expect(view.getAllByText('**42')).toHaveLength(1);
        expect(view.getByText('**09')).toBeTruthy();
        expect(view.getByText('Toutes les invitations sont affichées')).toBeTruthy();
    });

    it('renders 250 owner-safe invitation rows without exposing phone numbers', async () => {
        const invitations = Array.from({ length: 250 }, (_, index) =>
            invitation(`invitation-${String(index).padStart(3, '0')}`, `**${String(index % 100).padStart(2, '0')}`),
        );
        const view = await render(
            <ReferralScreen
                commands={createCommands()}
                nativeActions={nativeActions}
                store={loadedStore(myReferral(), page(invitations))}
            />,
        );

        expect(view.getAllByLabelText(/^Invitation \*\*\d{2}$/)).toHaveLength(250);
        expect(view.queryByText(/\+221|77\s?\d{3}/)).toBeNull();
    });
});

const nativeActions: ReferralNativeCommands = {
    copyPromoCode: () => of(undefined),
    shareReferralLink: () => of(undefined),
};

function createCommands(): ReferralCommands &
    Record<'retry' | 'refresh' | 'loadNextPage' | 'applyPromoCode', ReturnType<typeof vi.fn>> {
    return { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn(), applyPromoCode: vi.fn() };
}

function loadedStore(referral: MyReferral, invitations: ReferralInvitationPage): ReferralStore {
    const store = new ReferralStore();
    const token = store.beginInitialLoad();
    store.finishInitialLoad(token, referral, invitations);
    return store;
}

function myReferral(): MyReferral {
    return {
        promoCode: 'ABCD2345WXYZ',
        referralLink: 'kaynann://register?promo=ABCD2345WXYZ',
        eligibility: 'OPEN',
        attachedPromoCode: null,
        currentInviterRewardMl: '5000',
        creditedInviterBonusMl: '15000',
        creditedInvitationCount: 3,
    };
}

function page(
    items: ReferralInvitationPage['items'],
    nextCursor: string | null = null,
    hasMore = false,
): ReferralInvitationPage {
    return { items, nextCursor, hasMore };
}

function invitation(id: string, inviteeLabel: string): ReferralInvitationPage['items'][number] {
    return {
        id,
        inviteeLabel,
        appliedAt: '2026-08-10T10:00:00.000Z',
        status: 'CREDITED',
        creditedAmountMl: '5000',
    };
}
