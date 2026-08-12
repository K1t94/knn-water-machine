import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WalletModule } from '../wallet/wallet.module';

import { REFERRAL_FEATURE_STATE_REPOSITORY } from './application/ports/referral-feature-state.repository';
import { REFERRAL_BONUS_DELIVERY, REFERRAL_REPOSITORY } from './application/ports/referral.repository';
import { ReferralBonusDeliveryService } from './application/referral-bonus-delivery.service';
import { ReferralFeatureStateService } from './application/referral-feature-state.service';
import { ReferralProvisioningService } from './application/referral-provisioning.service';
import { ReferralQueryService } from './application/referral-query.service';
import { ReferralRecoveryService } from './application/referral-recovery.service';
import { REFERRAL_REGISTRATION_INTEGRATION } from './application/referral-registration.integration';
import { ReferralRecoveryScheduler } from './composition/referral-recovery.scheduler';
import { ReferralFeatureOperationsController } from './http/referral-feature-operations.controller';
import { ReferralOperationsGuard } from './http/referral-operations.guard';
import { ReferralController } from './http/referral.controller';
import { PrismaReferralFeatureStateRepository } from './infrastructure/postgres/prisma-referral-feature-state.repository';
import { PrismaReferralRegistrationIntegration } from './infrastructure/postgres/prisma-referral-registration.integration';
import { PrismaReferralRepository } from './infrastructure/postgres/prisma-referral.repository';

@Module({
    imports: [PrismaModule, SessionsModule, WalletModule],
    controllers: [ReferralController, ReferralFeatureOperationsController],
    providers: [
        PrismaReferralFeatureStateRepository,
        {
            provide: REFERRAL_FEATURE_STATE_REPOSITORY,
            useExisting: PrismaReferralFeatureStateRepository,
        },
        PrismaReferralRepository,
        {
            provide: REFERRAL_REPOSITORY,
            useExisting: PrismaReferralRepository,
        },
        {
            provide: REFERRAL_BONUS_DELIVERY,
            useExisting: ReferralBonusDeliveryService,
        },
        ReferralBonusDeliveryService,
        ReferralFeatureStateService,
        ReferralOperationsGuard,
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
    exports: [REFERRAL_REGISTRATION_INTEGRATION, ReferralFeatureStateService],
})
export class ReferralModule {}
