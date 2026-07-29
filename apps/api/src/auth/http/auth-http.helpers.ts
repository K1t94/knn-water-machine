import { HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { LegalVersionStaleError } from '../../legal/application/legal.service';
import { OtpApplicationError } from '../../otp/application/otp.service';
import { PhoneValidationError } from '../../otp/domain/senegal-phone';
import { OtpAbuseError } from '../../otp/infrastructure/redis/otp-abuse-guard';
import { SessionError } from '../../sessions/application/sessions.service';
import { DependencyUnavailableError } from '../application/auth-application.error';
import { RegistrationAuthorizationError } from '../infrastructure/redis/registration-authorization.store';
import type { AuthErrorCode } from './auth-error-code';
import { AuthErrorResponseDto, type AuthErrorResponse } from './auth-error.response';

export const requestIdHeader = {
  name: 'X-Request-Id',
  required: false,
  schema: { type: 'string', maxLength: 128 },
} as const;

export const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 8, maxLength: 128 },
} as const;

export const noStoreHeader = {
  'Cache-Control': {
    description: 'Sensitive credential response must not be cached',
    schema: { type: 'string', enum: ['no-store'] },
  },
};

export const authErrorResponse = {
  description: 'Stable product error without dependency details',
  type: AuthErrorResponseDto,
};

export async function withAuthErrors<T>(
  requestId: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = mapError(error);
    if (!code) throw error;
    const retryAfterSeconds = error instanceof OtpApplicationError || error instanceof OtpAbuseError
      ? error.retryAfterSeconds : undefined;
    const body: AuthErrorResponse = {
      error: {
        code,
        message: productMessage(code),
        retryable: isRetryable(code),
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        requestId: requestId?.slice(0, 128) || randomUUID(),
      },
    };
    throw new HttpException(body, statusFor(code));
  }
}

export function requireRegistrationAuthorization(value: string | undefined): string {
  if (!value || value.length < 32 || value.length > 512) {
    throw new RegistrationAuthorizationError('REGISTRATION_AUTH_INVALID');
  }
  return value;
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 128 || !/^[\x21-\x7E]+$/.test(value)) {
    throw new HttpException(
      { statusCode: 400, error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function mapError(error: unknown): AuthErrorCode | undefined {
  if (error instanceof DependencyUnavailableError) return error.code;
  if (error instanceof PhoneValidationError) return error.code;
  if (error instanceof OtpApplicationError || error instanceof OtpAbuseError) return error.code;
  if (error instanceof LegalVersionStaleError) return error.code;
  if (error instanceof SessionError) return error.code;
  if (error instanceof RegistrationAuthorizationError) {
    if (error.code === 'REGISTRATION_AUTH_EXPIRED') return error.code;
    if (error.code === 'REGISTRATION_ALREADY_COMPLETING') return 'DEPENDENCY_UNAVAILABLE';
    return 'REGISTRATION_AUTH_INVALID';
  }
  return undefined;
}

function statusFor(code: AuthErrorCode): number {
  if (code === 'RATE_LIMITED' || code === 'SMS_PROVIDER_RATE_LIMITED') return 429;
  if (code.startsWith('REGISTRATION_AUTH_') || code.startsWith('REFRESH_')) return 401;
  if (code === 'LEGAL_VERSION_STALE') return 409;
  if (code.startsWith('OTP_')) return code === 'OTP_INVALID' ? 400 : 409;
  if (code.startsWith('SMS_') || code === 'DEPENDENCY_UNAVAILABLE' ||
    code === 'SESSION_CREATION_FAILED') return 503;
  return 400;
}

function isRetryable(code: AuthErrorCode): boolean {
  return ['RATE_LIMITED', 'SMS_PROVIDER_RATE_LIMITED', 'SMS_TIMEOUT',
    'SMS_TEMPORARILY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE'].includes(code);
}

function productMessage(code: AuthErrorCode): string {
  const messages: Partial<Record<AuthErrorCode, string>> = {
    INVALID_PHONE: 'Enter a valid Senegalese phone number.',
    UNSUPPORTED_COUNTRY: 'Only Senegalese phone numbers are supported.',
    RATE_LIMITED: 'Please wait before trying again.',
    SMS_BUDGET_EXHAUSTED: 'SMS service is temporarily unavailable.',
    OTP_INVALID: 'The code is incorrect.',
    OTP_EXPIRED: 'The code has expired. Request a new code.',
    OTP_USED: 'This code has already been used.',
    OTP_ATTEMPTS_EXHAUSTED: 'Too many incorrect attempts. Request a new code.',
    REGISTRATION_AUTH_INVALID: 'Registration authorization is invalid.',
    REGISTRATION_AUTH_EXPIRED: 'Confirm your phone number again.',
    LEGAL_VERSION_STALE: 'Legal documents changed. Review the latest versions.',
    REFRESH_INVALID: 'The session is invalid. Sign in again.',
    REFRESH_EXPIRED: 'The session has expired. Sign in again.',
    REFRESH_REPLAYED: 'The session was revoked. Sign in again.',
  };
  return messages[code] ?? 'The service is temporarily unavailable.';
}
