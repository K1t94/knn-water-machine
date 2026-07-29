import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { loadEnv } from '../../../config/env';
import { SmsDeliveryService } from '../../application/sms-delivery.service';
import {
  OrangeDeliveryReceiptEnvelopeDto,
  type OrangeDeliveryStatus,
} from './orange.dto';

@ApiTags('integrations')
@Controller('v1/integrations/orange/sms')
export class OrangeDeliveryReceiptController {
  private readonly env = loadEnv();
  private readonly allowedIps = new Set(
    this.env.ORANGE_SMS_DR_ALLOWED_IPS.split(',').map((value) => normalizeIp(value.trim())).filter(Boolean),
  );

  constructor(
    @Inject(SmsDeliveryService)
    private readonly deliveries: SmsDeliveryService,
  ) {}

  @Post('delivery-receipts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive an optional Orange delivery status' })
  @ApiOkResponse({ description: 'Well-formed event acknowledged' })
  @ApiBadRequestResponse({ description: 'Invalid callback schema' })
  @ApiForbiddenResponse({ description: 'Invalid callback transport or source' })
  @ApiNotFoundResponse({ description: 'Callback feature disabled' })
  async receive(
    @Req() request: Request,
    @Body(new ValidationPipe({
      expectedType: OrangeDeliveryReceiptEnvelopeDto,
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }))
    body: OrangeDeliveryReceiptEnvelopeDto,
  ): Promise<void> {
    if (!this.env.ORANGE_SMS_DR_ENABLED) throw new NotFoundException();
    const sourceIp = normalizeIp(request.ip ?? request.socket.remoteAddress ?? '');
    if (!this.allowedIps.has(sourceIp)) throw new ForbiddenException();
    if (!request.secure) throw new ForbiddenException();
    const notification = body.deliveryInfoNotification;
    await this.deliveries.applyReceipt(
      notification.callbackData,
      normalizeStatus(notification.deliveryInfo.deliveryStatus),
    );
  }
}

function normalizeStatus(status: OrangeDeliveryStatus) {
  if (status === 'DeliveredToTerminal') return 'delivered' as const;
  if (status === 'DeliveryImpossible') return 'failed' as const;
  if (status === 'DeliveryUncertain') return 'uncertain' as const;
  return 'pending' as const;
}

function normalizeIp(value: string): string {
  return value.replace(/^::ffff:/, '');
}
