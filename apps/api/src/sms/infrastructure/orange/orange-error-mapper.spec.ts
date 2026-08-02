import { describe, expect, it } from 'vitest';

import { mapOrangeError } from './orange-error-mapper';

describe('Orange error normalization', () => {
    it.each([
        [{ operation: 'send', status: 400, text: 'invalid sender name' }, 'INVALID_CONFIGURATION', false],
        [{ operation: 'oauth', status: 401, providerCode: 41 }, 'AUTHENTICATION_FAILED', false],
        [{ operation: 'send', status: 403, text: 'not enought credit' }, 'BALANCE_EXHAUSTED', false],
        [{ operation: 'send', status: 429, retryAfter: '2' }, 'PROVIDER_RATE_LIMITED', true],
        [{ operation: 'send', status: 400, text: 'invalid recipient address' }, 'INVALID_RECIPIENT', false],
        [{ operation: 'send', status: 400, text: 'message rejected' }, 'MESSAGE_REJECTED', false],
        [{ operation: 'send', aborted: true }, 'TIMEOUT', true],
        [{ operation: 'send', status: 503 }, 'TEMPORARY_PROVIDER_FAILURE', true],
        [{ operation: 'send', malformedResponse: true }, 'TEMPORARY_PROVIDER_FAILURE', true],
        [{ operation: 'send', cause: new TypeError('network') }, 'TEMPORARY_PROVIDER_FAILURE', true],
    ] as const)('maps %o', (input, category, retryable) => {
        expect(mapOrangeError(input)).toMatchObject({ error: { category, retryable } });
    });
});
