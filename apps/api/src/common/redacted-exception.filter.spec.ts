import type { ArgumentsHost, LoggerService } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RedactedExceptionFilter } from './redacted-exception.filter';
import { SafeAuthLogger } from './security/safe-auth-logger';

describe('RedactedExceptionFilter', () => {
  it.each([
    ['otp', '654321'],
    ['phone', '+221771234567'],
    ['promo', 'FRIEND-BONUS'],
    ['access token', 'eyJhbGciOiJIUzI1NiJ9.secret'],
    ['refresh token', 'refresh-secret-value'],
    ['registration token', 'registration-secret-value'],
    ['Orange credentials', 'orange-client-secret'],
    ['SMS body', 'KAYNANN code: 123456. Valid for 5 minutes.'],
    ['provider payload', '{"outboundSMSMessageRequest":{"secret":true}}'],
  ])('does not log or return %s', (_label, secret) => {
    const errorLog = vi.fn();
    const sink = { error: errorLog } as unknown as LoggerService;
    const response = responseMock();
    const filter = new RedactedExceptionFilter(new SafeAuthLogger(sink));

    filter.catch(new Error(secret), hostMock(response));

    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
  });

  it('preserves only the explicit product auth-error envelope', () => {
    const errorLog = vi.fn();
    const sink = { error: errorLog } as unknown as LoggerService;
    const response = responseMock();
    const body = { error: {
      code: 'OTP_EXPIRED', message: 'The code expired.', retryable: false,
      requestId: 'safe-request-id', providerPayload: 'must-not-leak',
    } };
    const filter = new RedactedExceptionFilter(new SafeAuthLogger(sink));

    filter.catch(new HttpException(body, 409), hostMock(response));

    expect(response.json).toHaveBeenCalledWith({ error: {
      code: 'OTP_EXPIRED', message: 'The code expired.', retryable: false,
      requestId: 'safe-request-id',
    } });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('must-not-leak');
  });
});

function responseMock() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function hostMock(response: ReturnType<typeof responseMock>): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        headers: { 'x-request-id': '12345678-1234-4234-9234-123456789abc' },
        path: '/v1/auth/otp/requests',
        authSecurity: { startedAt: Date.now() - 5 },
      }),
    }),
  } as ArgumentsHost;
}
