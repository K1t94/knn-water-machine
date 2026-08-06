import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WalletModule } from '../wallet/wallet.module';

import { REFERRAL_BONUS_DELIVERY, REFERRAL_REPOSITORY } from './application/ports/referral.repository';
import { ReferralApplicationService } from './application/referral-application.service';
import { ReferralBonusDeliveryService } from './application/referral-bonus-delivery.service';
import { ReferralEligibilityService } from './application/referral-eligibility.service';
import { ReferralProvisioningService } from './application/referral-provisioning.service';
import { ReferralQueryService } from './application/referral-query.service';
import { ReferralRecoveryService } from './application/referral-recovery.service';
import { REFERRAL_REGISTRATION_INTEGRATION } from './application/referral-registration.integration';
import { CLOSE_REFERRAL_ELIGIBILITY } from './composition/close-referral-eligibility';
import { ReferralRecoveryScheduler } from './composition/referral-recovery.scheduler';
import { ReferralController } from './http/referral.controller';
import { PrismaReferralRegistrationIntegration } from './infrastructure/postgres/prisma-referral-registration.integration';
import { PrismaReferralRepository } from './infrastructure/postgres/prisma-referral.repository';

@Module({
    imports: [PrismaModule, SessionsModule, WalletModule],
    controllers: [ReferralController],
    providers: [
        PrismaReferralRepository,
        {
            provide: REFERRAL_REPOSITORY,
            useExisting: PrismaReferralRepository,
        },
        {
            provide: CLOSE_REFERRAL_ELIGIBILITY,
            useExisting: ReferralEligibilityService,
        },
        {
            provide: REFERRAL_BONUS_DELIVERY,
            useExisting: ReferralBonusDeliveryService,
        },
        ReferralApplicationService,
        ReferralBonusDeliveryService,
        ReferralEligibilityService,
        ReferralProvisioningService,
        ReferralQueryService,
        ReferralRecoveryScheduler,
        ReferralRecoveryService,
        PrismaReferralRegistrationIntegration,
        {
            provide: REFERRAL_REGISTRATION_INTEGRATION,
            useExisting: PrismaReferralRegistrationIntegration,
        },
    ],
    exports: [CLOSE_REFERRAL_ELIGIBILITY, REFERRAL_REGISTRATION_INTEGRATION],
})
export class ReferralModule {}
