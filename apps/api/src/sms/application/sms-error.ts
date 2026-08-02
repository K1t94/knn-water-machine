export const SMS_ERROR_CATEGORIES = [
    'INVALID_CONFIGURATION',
    'AUTHENTICATION_FAILED',
    'BALANCE_EXHAUSTED',
    'PROVIDER_RATE_LIMITED',
    'INVALID_RECIPIENT',
    'MESSAGE_REJECTED',
    'TIMEOUT',
    'TEMPORARY_PROVIDER_FAILURE',
] as const;

export type SmsErrorCategory = (typeof SMS_ERROR_CATEGORIES)[number];

export class SmsProviderError extends Error {
    constructor(
        public readonly category: SmsErrorCategory,
        public readonly retryable: boolean,
        public readonly retryAfterSeconds?: number,
    ) {
        super(`SMS provider failed: ${category}`);
        this.name = 'SmsProviderError';
    }
}
