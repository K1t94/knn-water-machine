import { Module } from '@nestjs/common';

import { LegalModule } from '../legal/legal.module';
import { OtpModule } from '../otp/otp.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AuthService } from './application/auth.service';
import { RegistrationService } from './application/registration.service';
import { AuthRetentionScheduler } from './application/auth-retention.scheduler';
import { AuthRetentionService } from './application/auth-retention.service';
import {
  AuthController,
  RegistrationController,
} from './http/auth.controller';
import {
  LegalAcceptanceController,
  LegalController,
} from '../legal/http/legal.controller';
import { RegistrationAuthorizationStore } from './infrastructure/redis/registration-authorization.store';

@Module({
  imports: [OtpModule, UsersModule, LegalModule, SessionsModule],
  controllers: [
    AuthController,
    RegistrationController,
    LegalController,
    LegalAcceptanceController,
  ],
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
