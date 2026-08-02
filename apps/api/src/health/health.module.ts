import { Module } from '@nestjs/common';

import { RedisModule } from '../infrastructure/redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';

import { DependencyChecksService } from './dependency-checks.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
    imports: [PrismaModule, RedisModule],
    controllers: [HealthController],
    providers: [DependencyChecksService, HealthService],
})
export class HealthModule {}
