import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import type { AppEnv } from '../../config/env';

const protectedPrefixes = [
  '/v1/auth/',
  '/v1/integrations/orange/sms/delivery-receipts',
];

export function authRequestContext(env: AppEnv) {
  return (request: Request & AuthSecurityRequest, response: Response, next: NextFunction): void => {
    request.authSecurity = { startedAt: Date.now() };
    request.authRequestMetadata = {
      requestId: requestId(request.header('x-request-id')),
      ipAddress: normalizeIp(request.ip || request.socket.remoteAddress || ''),
      ...(request.header('user-agent') ? { userAgent: request.header('user-agent')!.slice(0, 200) } : {}),
    };
    const requiresTls = env.APP_ENV !== 'development' &&
      protectedPrefixes.some((prefix) => request.path.startsWith(prefix));
    if (requiresTls && !request.secure) {
      response.status(400).json({
        error: {
          code: 'SECURE_TRANSPORT_REQUIRED',
          message: 'A secure connection is required.',
          retryable: false,
          requestId: request.authRequestMetadata.requestId,
        },
      });
      return;
    }
    next();
  };
}

export interface AuthSecurityRequest {
  authSecurity?: { startedAt: number; phoneFingerprint?: string; installationFingerprint?: string };
  authRequestMetadata?: { requestId: string; ipAddress: string; userAgent?: string };
}

function requestId(value: string | undefined): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

function normalizeIp(value: string): string {
  return value.replace(/^::ffff:/, '').slice(0, 64);
}
