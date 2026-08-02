import { SmsProviderError } from '../../application/sms-error';

export interface OrangeErrorInput {
    operation: 'oauth' | 'send';
    status?: number;
    providerCode?: string | number;
    text?: string;
    retryAfter?: string | null;
    cause?: unknown;
    aborted?: boolean;
    malformedResponse?: boolean;
}

export interface OrangeMappedError {
    error: SmsProviderError;
    expiredCredential: boolean;
}

export function mapOrangeError(input: OrangeErrorInput): OrangeMappedError {
    const text = (input.text ?? '').toLowerCase();
    const code = String(input.providerCode ?? '');
    const retryAfter = parseRetryAfter(input.retryAfter);

    if (input.aborted || input.status === 408) {
        return mapped('TIMEOUT', true);
    }
    if (input.status === 401 || (input.operation === 'oauth' && input.status === 400)) {
        return {
            error: new SmsProviderError('AUTHENTICATION_FAILED', false),
            expiredCredential: code === '42' || text.includes('expired'),
        };
    }
    if (/not enough|not enought|balance|credit/.test(text)) {
        return mapped('BALANCE_EXHAUSTED', false);
    }
    if (input.status === 429 || (input.status === 403 && code === '53')) {
        return mapped('PROVIDER_RATE_LIMITED', true, retryAfter);
    }
    if (/sender|sendername|sender name/.test(text)) {
        return mapped('INVALID_CONFIGURATION', false);
    }
    if (/recipient|destination|address/.test(text)) {
        return mapped('INVALID_RECIPIENT', false);
    }
    if (input.status !== undefined && input.status >= 500) {
        return mapped('TEMPORARY_PROVIDER_FAILURE', true);
    }
    if (input.malformedResponse || input.cause !== undefined) {
        return mapped('TEMPORARY_PROVIDER_FAILURE', true);
    }
    return mapped('MESSAGE_REJECTED', false);
}

export async function mapOrangeResponse(
    response: Response,
    operation: OrangeErrorInput['operation'],
): Promise<OrangeMappedError> {
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        payload = undefined;
    }
    const record = isRecord(payload) ? payload : {};
    return mapOrangeError({
        operation,
        status: response.status,
        providerCode: scalar(record.code),
        text: collectStrings(payload).join(' '),
        retryAfter: response.headers.get('retry-after'),
    });
}

function mapped(
    category: ConstructorParameters<typeof SmsProviderError>[0],
    retryable: boolean,
    retryAfterSeconds?: number,
): OrangeMappedError {
    return {
        error: new SmsProviderError(category, retryable, retryAfterSeconds),
        expiredCredential: false,
    };
}

function parseRetryAfter(value?: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 5);
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.min(5, Math.max(0, Math.ceil((date - Date.now()) / 1_000)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function scalar(value: unknown): string | number | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function collectStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(collectStrings);
    if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
    return [];
}
