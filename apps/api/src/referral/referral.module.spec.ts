import { describe, expect, it } from 'vitest';

import { ReferralFeatureStateService } from './application/referral-feature-state.service';
import { REFERRAL_REGISTRATION_INTEGRATION } from './application/referral-registration.integration';
import { ReferralModule } from './referral.module';

describe('ReferralModule', () => {
    it('exports only trusted cross-domain application contracts', () => {
        expect(Reflect.getMetadata('exports', ReferralModule)).toEqual([
            REFERRAL_REGISTRATION_INTEGRATION,
            ReferralFeatureStateService,
        ]);
    });
});
