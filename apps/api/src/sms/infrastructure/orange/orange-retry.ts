import { SmsProviderError } from '../../application/sms-error';

export interface OrangeRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function withOrangeRetry<T>(
  operation: () => Promise<T>,
  options: OrangeRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof SmsProviderError) || !error.retryable || attempt >= options.maxAttempts) {
        throw error;
      }
      const exponential = options.baseDelayMs * 2 ** (attempt - 1);
      const hinted = (error.retryAfterSeconds ?? 0) * 1_000;
      await sleep(Math.min(options.maxDelayMs, Math.max(exponential, hinted)));
    }
  }
}
