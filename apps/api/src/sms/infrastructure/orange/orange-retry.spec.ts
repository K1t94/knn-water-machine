import { describe, expect, it, vi } from 'vitest';

import { SmsProviderError } from '../../application/sms-error';
import { withOrangeRetry } from './orange-retry';

describe('withOrangeRetry', () => {
  it('uses bounded exponential backoff for transient errors', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new SmsProviderError('TIMEOUT', true))
      .mockRejectedValueOnce(new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true))
      .mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withOrangeRetry(operation, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150, sleep })).resolves.toBe('ok');
    expect(sleep.mock.calls).toEqual([[100], [150]]);
  });

  it('does not retry permanent errors', async () => {
    const operation = vi.fn().mockRejectedValue(new SmsProviderError('INVALID_RECIPIENT', false));
    await expect(withOrangeRetry(operation, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toMatchObject({ category: 'INVALID_RECIPIENT' });
    expect(operation).toHaveBeenCalledOnce();
  });
});
