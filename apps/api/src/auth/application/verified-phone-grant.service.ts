import { Injectable } from '@nestjs/common';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { loadEnv } from '../../config/env';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type { VerifiedOtp } from '../../otp/application/otp.service';

@Injectable()
export class VerifiedPhoneGrantService {
  private readonly env = loadEnv();

  constructor(
    private readonly crypto: CredentialCryptoService,
    private readonly redis: RedisService,
  ) {}

  async issue(verified: VerifiedOtp): Promise<{ token: string; expiresAt: Date }> {
    const token = this.crypto.generateOpaqueCredential();
    const tokenDigest = this.crypto.digest('credential', ['registration', token]);
    const expiresAt = new Date(Date.now() + this.env.REGISTRATION_AUTH_TTL_SECONDS * 1000);
    await this.redis.commandClient.hSet(
      `auth:registration:${tokenDigest.keyVersion}:${tokenDigest.digest}`,
      {
        challengeId: verified.challengeId,
        phoneE164: verified.phoneE164,
        installationId: verified.installationId,
        pendingPromoCode: verified.pendingPromoCode ?? '',
        verifiedAt: verified.verifiedAt.toISOString(),
      },
    );
    await this.redis.commandClient.pExpireAt(
      `auth:registration:${tokenDigest.keyVersion}:${tokenDigest.digest}`,
      expiresAt,
    );
    return { token, expiresAt };
  }
}
