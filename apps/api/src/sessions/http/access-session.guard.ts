import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

import type { AuthErrorResponse } from '../../auth/http/auth-error.response';
import {
  AccessTokenService,
  type AccessTokenClaims,
} from '../application/access-token.service';
import { SessionsRepository } from '../infrastructure/postgres/sessions.repository';

export interface AuthenticatedRequest extends Request {
  sessionClaims: AccessTokenClaims;
}

@Injectable()
export class AccessSessionGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenService)
    private readonly accessTokens: AccessTokenService,
    @Inject(SessionsRepository)
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      const token = bearerToken(request.headers.authorization);
      const claims = await this.accessTokens.validate(token);
      const session = await this.sessions.findActive(claims.sid);
      if (!session || session.userId !== claims.sub) {
        throw new Error('Inactive session');
      }
      request.sessionClaims = claims;
      return true;
    } catch {
      const body: AuthErrorResponse = {
        error: {
          code: 'REFRESH_INVALID',
          message: 'Authentication is required.',
          retryable: false,
          requestId:
            headerValue(request.headers['x-request-id'])?.slice(0, 128) ??
            randomUUID(),
        },
      };
      throw new HttpException(body, HttpStatus.UNAUTHORIZED);
    }
  }
}

function bearerToken(value: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/.exec(value ?? '');
  if (!match || match[1].length > 4_096) {
    throw new Error('Missing bearer token');
  }
  return match[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
