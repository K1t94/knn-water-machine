import { Module } from '@nestjs/common';

import { LegalAcceptanceController, LegalController } from '../legal/http/legal.controller';
import { LegalModule } from '../legal/legal.module';
import { OtpModule } from '../otp/otp.module';
import { ReferralModule } from '../referral/referral.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';

import { AuthRetentionScheduler } from './application/auth-retention.scheduler';
import { AuthRetentionService } from './application/auth-retention.service';
import { AuthService } from './application/auth.service';
import { RegistrationService } from './application/registration.service';
import { AuthController, RegistrationController } from './http/auth.controller';
import { RegistrationAuthorizationStore } from './infrastructure/redis/registration-authorization.store';

@Module({
    imports: [OtpModule, UsersModule, LegalModule, SessionsModule, ReferralModule],
    controllers: [AuthController, RegistrationController, LegalController, LegalAcceptanceController],
    providers: [
        AuthService,
        RegistrationService,
        AuthRetentionService,
        AuthRetentionScheduler,
        RegistrationAuthorizationStore,
    ],
    exports: [RegistrationAuthorizationStore],
})
export class AuthModule {}
