import { describe, expect, it } from 'vitest';

import { buildOtpSms, gsm7SeptetLength } from './sms-message-builder';

describe('OTP SMS message builder', () => {
    it('builds the exact single-segment GSM-7 production template', () => {
        const message = buildOtpSms('123456');

        expect(message).toBe('KAYNANN code: 123456. Valid for 5 minutes.');
        expect(gsm7SeptetLength(message)).toBeLessThanOrEqual(160);
        expect(message).not.toMatch(/https?:\/\/|www\./i);
    });

    it.each(['12345', '1234567', '12A456'])('rejects invalid OTP value %s', (otp) => {
        expect(() => buildOtpSms(otp)).toThrow('OTP must contain exactly six digits');
    });

    it('rejects characters outside GSM-7', () => {
        expect(() => gsm7SeptetLength('Код 123456')).toThrow('OTP SMS contains a non-GSM-7 character');
    });
});
