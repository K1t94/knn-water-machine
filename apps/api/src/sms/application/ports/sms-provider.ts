import type { SmsErrorCategory } from '../sms-error';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export type SmsSendStatus = 'accepted' | 'uncertain';

export interface SendSmsCommand {
    recipientE164: string;
    message: string;
    correlationId: string;
}

export interface SendSmsResult {
    status: SmsSendStatus;
    providerMessageId?: string;
    acceptedAt: Date;
}

export interface SmsDeliveryCapability {
    supported: boolean;
    statusCategories: readonly ['delivered', 'pending', 'uncertain', 'failed'];
}

export interface SmsProvider {
    readonly name: string;
    readonly delivery: SmsDeliveryCapability;
    send(command: SendSmsCommand): Promise<SendSmsResult>;
}

export interface SmsSendFailure {
    category: SmsErrorCategory;
    retryable: boolean;
    retryAfterSeconds?: number;
}
