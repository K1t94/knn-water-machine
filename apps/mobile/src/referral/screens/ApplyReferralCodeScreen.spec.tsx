import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { ReferralStore } from '../stores/referral.store';

import { ApplyReferralCodeScreen } from './ApplyReferralCodeScreen';

import type { ReferralCommands } from '../services/referral-flow.service';

describe('ApplyReferralCodeScreen', () => {
    it('prefills a code but requires explicit confirmation', async () => {
        const store = new ReferralStore();
        store.prefillPromoCode('abcd2345wxyz');
        const commands = createCommands();
        const view = await render(<ApplyReferralCodeScreen commands={commands} store={store} />);

        expect(view.getByLabelText('Code promo').props.value).toBe('ABCD2345WXYZ');
        expect(commands.applyPromoCode).not.toHaveBeenCalled();
        await fireEvent.press(view.getByLabelText('Confirmer le code promo'));
        expect(commands.applyPromoCode).toHaveBeenCalledWith('ABCD2345WXYZ');
    });

    it('renders validation feedback and keeps server-side business decisions out of input handling', async () => {
        const store = new ReferralStore();
        const commands = createCommands();
        const view = await render(<ApplyReferralCodeScreen commands={commands} store={store} />);

        await fireEvent.changeText(view.getByLabelText('Code promo'), '  user-entered  ');
        expect(store.applyCode).toBe('USER-ENTERED');
        await act(() => {
            const token = store.beginApply();
            store.failApply(token!, { code: 'REFERRAL_CODE_UNAVAILABLE', retryable: false, kind: 'validation' });
        });
        expect(view.getByRole('alert').props.children).toContain('indisponible');

        await fireEvent.changeText(view.getByLabelText('Code promo'), 'retrycode123');
        await act(() => {
            const token = store.beginApply();
            store.failApply(token!, { code: 'OFFLINE', retryable: true, kind: 'service' });
        });
        await fireEvent.press(view.getByLabelText('Réessayer d’appliquer le code promo'));
        expect(commands.applyPromoCode).toHaveBeenLastCalledWith('RETRYCODE123');
    });

    it('locks an attached code and explains closed eligibility', async () => {
        const attached = new ReferralStore();
        attached.setApplyCode('ABCD2345WXYZ');
        const actualToken = attached.beginApply();
        attached.finishApply(actualToken!, {
            status: 'ATTACHED',
            promoCode: 'ABCD2345WXYZ',
            appliedAt: '2026-08-10T10:00:00.000Z',
        });
        const attachedView = await render(<ApplyReferralCodeScreen commands={createCommands()} store={attached} />);
        expect(attachedView.getByLabelText('Code promo').props.editable).toBe(false);
        expect(attachedView.getByText('Code rattaché avec succès')).toBeTruthy();

        const closed = new ReferralStore();
        const token = closed.beginInitialLoad();
        closed.finishInitialLoad(
            token,
            {
                promoCode: 'ZXCV2345BNMQ',
                referralLink: 'kaynann://register?promo=ZXCV2345BNMQ',
                eligibility: 'CLOSED',
                attachedPromoCode: null,
                currentInviterRewardMl: '5000',
                creditedInviterBonusMl: '0',
                creditedInvitationCount: 0,
            },
            { items: [], nextCursor: null, hasMore: false },
        );
        const closedView = await render(<ApplyReferralCodeScreen commands={createCommands()} store={closed} />);
        expect(closedView.getByRole('alert')).toBeTruthy();
        expect(closedView.getByLabelText('Code promo').props.editable).toBe(false);
    });
});

function createCommands(): ReferralCommands & { applyPromoCode: ReturnType<typeof vi.fn> } {
    return { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn(), applyPromoCode: vi.fn() };
}
