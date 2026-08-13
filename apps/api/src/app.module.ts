import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './app-config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { SecurityModule } from './common/security/security.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { MachinesModule } from './machines/machines.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReferralModule } from './referral/referral.module';
import { SmsModule } from './sms/sms.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        AppConfigModule,
        PrismaModule,
        RedisModule,
        SecurityModule,
        ObservabilityModule,
        SmsModule,
        AuthModule,
        HealthModule,
        MachinesModule,
        ReferralModule,
        WalletModule,
    ],
})
export class AppModule {}
