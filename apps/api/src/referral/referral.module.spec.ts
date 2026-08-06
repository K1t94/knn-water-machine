import { describe, expect, it } from 'vitest';

import { REFERRAL_REGISTRATION_INTEGRATION } from './application/referral-registration.integration';
import { CLOSE_REFERRAL_ELIGIBILITY } from './composition/close-referral-eligibility';
import { ReferralModule } from './referral.module';

describe('ReferralModule', () => {
    it('exports only trusted cross-domain application contracts', () => {
        expect(Reflect.getMetadata('exports', ReferralModule)).toEqual([
            CLOSE_REFERRAL_ELIGIBILITY,
            REFERRAL_REGISTRATION_INTEGRATION,
        ]);
    });
});
