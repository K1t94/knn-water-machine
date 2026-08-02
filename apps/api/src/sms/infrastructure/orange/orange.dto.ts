import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export interface OrangeOAuthResponse {
    token_type: string;
    access_token: string;
    expires_in: string | number;
}

export interface OrangeOutboundRequest {
    outboundSMSMessageRequest: {
        address: string;
        senderAddress: string;
        senderName?: string;
        outboundSMSTextMessage: { message: string };
        receiptRequest?: { notifyURL: string; callbackData: string };
    };
}

export interface OrangeOutboundResponse {
    outboundSMSMessageRequest: { resourceURL: string };
}

export const ORANGE_DELIVERY_STATUSES = [
    'DeliveredToNetwork',
    'DeliveryUncertain',
    'DeliveryImpossible',
    'MessageWaiting',
    'DeliveredToTerminal',
] as const;
export type OrangeDeliveryStatus = (typeof ORANGE_DELIVERY_STATUSES)[number];

export class OrangeDeliveryInfoDto {
    @ApiProperty({ example: 'tel:+221771234567', maxLength: 32 })
    @IsString()
    @Matches(/^tel:\+221\d{9}$/)
    address!: string;

    @ApiProperty({ enum: ORANGE_DELIVERY_STATUSES })
    @IsIn(ORANGE_DELIVERY_STATUSES)
    deliveryStatus!: OrangeDeliveryStatus;
}

export class OrangeDeliveryReceiptDto {
    @ApiProperty({ maxLength: 255 })
    @IsString()
    @MaxLength(255)
    callbackData!: string;

    @ApiProperty({ type: () => OrangeDeliveryInfoDto })
    @ValidateNested()
    @Type(() => OrangeDeliveryInfoDto)
    deliveryInfo!: OrangeDeliveryInfoDto;
}

export class OrangeDeliveryReceiptEnvelopeDto {
    @ApiProperty({ type: () => OrangeDeliveryReceiptDto })
    @ValidateNested()
    @Type(() => OrangeDeliveryReceiptDto)
    deliveryInfoNotification!: OrangeDeliveryReceiptDto;
}
