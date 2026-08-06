import { describe, expect, it } from 'vitest';

import { maskReferralPhone } from './phone-mask';

describe('referral phone mask', () => {
    it('reveals only the final two digits of a valid stored phone', () => {
        expect(maskReferralPhone('+221771234567')).toBe('**67');
    });

    it.each(['', '+1', '771234567', '+22177bad67', '  +221771234567  '])(
        'reveals no digits for short or malformed stored phone %j',
        (phone) => {
            expect(maskReferralPhone(phone)).toBe('**');
        },
    );
});
