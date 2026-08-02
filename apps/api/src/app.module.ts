import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from './auth/auth.module';
import { SecurityModule } from './common/security/security.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        PrismaModule,
        RedisModule,
        SecurityModule,
        ObservabilityModule,
        SmsModule,
        AuthModule,
        HealthModule,
    ],
})
export class AppModule {}
