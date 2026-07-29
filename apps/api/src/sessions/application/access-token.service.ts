import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

import { loadEnv } from '../../config/env';

@Injectable()
export class AccessTokenService {
  private readonly env = loadEnv();

  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async issue(input: {
    userId: string;
    sessionId: string;
    issuedAt: Date;
    sessionExpiresAt: Date;
  }): Promise<{ token: string; expiresAt: Date }> {
    const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1_000);
    const sessionExpirySeconds = Math.floor(
      input.sessionExpiresAt.getTime() / 1_000,
    );
    const expiresAtSeconds = Math.min(
      issuedAtSeconds + this.env.ACCESS_TOKEN_TTL_SECONDS,
      sessionExpirySeconds,
    );
    const token = await this.jwt.signAsync(
      {
        iss: 'kaynann-api',
        aud: 'kaynann-mobile',
        sub: input.userId,
        sid: input.sessionId,
        jti: randomUUID(),
        iat: issuedAtSeconds,
        exp: expiresAtSeconds,
      },
      {
        algorithm: 'HS256',
        secret: Buffer.from(
          this.env.JWT_ACCESS_SIGNING_KEY,
          'base64url',
        ),
      },
    );
    return { token, expiresAt: new Date(expiresAtSeconds * 1_000) };
  }

  async validate(token: string): Promise<AccessTokenClaims> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
      algorithms: ['HS256'],
      audience: 'kaynann-mobile',
      issuer: 'kaynann-api',
      secret: Buffer.from(this.env.JWT_ACCESS_SIGNING_KEY, 'base64url'),
    });
    if (
      !claims.sub ||
      !claims.sid ||
      !claims.jti ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp)
    ) {
      throw new Error('Invalid access token claims');
    }
    return claims;
  }
}

export interface AccessTokenClaims {
  iss: 'kaynann-api';
  aud: 'kaynann-mobile';
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}
