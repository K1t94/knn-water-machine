import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReferralNativeActions } from './referral-native-actions';

describe('ReferralNativeActions', () => {
    it('copies the API-provided promo code lazily', async () => {
        const clipboard = { setStringAsync: vi.fn().mockResolvedValue(undefined) };
        const share = { share: vi.fn() };
        const actions = new ReferralNativeActions(clipboard, share);

        const operation$ = actions.copyPromoCode('23456789ABCD');

        expect(clipboard.setStringAsync).not.toHaveBeenCalled();
        await firstValueFrom(operation$);
        expect(clipboard.setStringAsync).toHaveBeenCalledWith('23456789ABCD');
    });

    it('shares the API-provided referral link through the platform Share API', async () => {
        const clipboard = { setStringAsync: vi.fn() };
        const share = { share: vi.fn().mockResolvedValue({ action: 'sharedAction' }) };
        const actions = new ReferralNativeActions(clipboard, share);

        await firstValueFrom(actions.shareReferralLink('kaynann://register?promo=23456789ABCD'));

        expect(share.share).toHaveBeenCalledWith({ message: 'kaynann://register?promo=23456789ABCD' });
    });
});
