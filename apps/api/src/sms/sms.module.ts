import { Module } from '@nestjs/common';

import { loadEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../common/security/security.module';
import { SMS_PROVIDER } from './application/ports/sms-provider';
import { SmsDeliveryService } from './application/sms-delivery.service';
import { FakeSmsOutbox } from './infrastructure/fake/fake-sms.outbox';
import { FakeSmsProvider } from './infrastructure/fake/fake-sms.provider';
import { OrangeDeliveryReceiptController } from './infrastructure/orange/orange-delivery-receipt.controller';
import { OrangeOAuthClient } from './infrastructure/orange/orange-oauth-client';
import { OrangeSmsProvider } from './infrastructure/orange/orange-sms.provider';
import { SmsDeliveryRepository } from './infrastructure/postgres/sms-delivery.repository';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [OrangeDeliveryReceiptController],
  providers: [
    FakeSmsOutbox,
    SmsDeliveryRepository,
    SmsDeliveryService,
    {
      provide: SMS_PROVIDER,
      inject: [FakeSmsOutbox, SmsDeliveryService],
      useFactory: (outbox: FakeSmsOutbox, deliveries: SmsDeliveryService) => {
        const env = loadEnv();
        if (env.SMS_PROVIDER === 'fake') {
          return deliveries.recorded(new FakeSmsProvider(outbox));
        }
        const oauth = new OrangeOAuthClient({
          clientId: env.ORANGE_SMS_CLIENT_ID!,
          clientSecret: env.ORANGE_SMS_CLIENT_SECRET!,
          oauthUrl: env.ORANGE_SMS_OAUTH_URL!,
        });
        return deliveries.recorded(new OrangeSmsProvider(oauth, {
          apiUrl: env.ORANGE_SMS_API_URL!,
          senderAddress: env.ORANGE_SMS_SENDER_ADDRESS!,
          senderName: env.ORANGE_SMS_SENDER_NAME!,
          ...(env.ORANGE_SMS_DR_ENABLED
            ? { receiptCallbackUrl: env.ORANGE_SMS_DR_CALLBACK_URL }
            : {}),
        }));
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
