import { Module } from '@nestjs/common';

import { ReferralModule } from '../referral/referral.module';

import { AppConfigController } from './http/app-config.controller';

@Module({
    imports: [ReferralModule],
    controllers: [AppConfigController],
})
export class AppConfigModule {}
