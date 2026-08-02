import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';

import { CLOCK, RANDOM_SOURCE } from '../auth/application/ports';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { SmsModule } from '../sms/sms.module';

import { OtpService } from './application/otp.service';
import { OtpCrypto } from './domain/otp-crypto';
import { OtpAbuseGuard } from './infrastructure/redis/otp-abuse-guard';
import { OtpChallengeStore } from './infrastructure/redis/otp-challenge.store';

@Module({
    imports: [RedisModule, SmsModule],
    providers: [
        OtpCrypto,
        OtpChallengeStore,
        OtpAbuseGuard,
        OtpService,
        { provide: CLOCK, useValue: { now: () => new Date() } },
        {
            provide: RANDOM_SOURCE,
            useValue: {
                bytes: (size: number) => randomBytes(size),
                integer: (minimum: number, maximum: number) => randomInt(minimum, maximum),
                uuid: () => randomUUID(),
            },
        },
    ],
    exports: [OtpService],
})
export class OtpModule {}
