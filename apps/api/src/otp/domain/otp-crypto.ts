import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';

export interface OtpVerificationMaterial {
  digest: string;
  keyVersion: string;
}

@Injectable()
export class OtpCrypto {
  constructor(@Inject(CredentialCryptoService) private readonly credentials: CredentialCryptoService) {}

  generateCode(random: (maximum: number) => number = randomInt): string {
    return random(1_000_000).toString().padStart(6, '0');
  }

  material(challengeId: string, phoneE164: string, code: string): OtpVerificationMaterial {
    return this.credentials.digest('otp', [challengeId, phoneE164, code]);
  }

  verify(
    challengeId: string,
    phoneE164: string,
    code: string,
    expected: OtpVerificationMaterial,
  ): boolean {
    const actual = this.material(challengeId, phoneE164, code);
    return actual.keyVersion === expected.keyVersion &&
      this.credentials.compareDigests(actual.digest, expected.digest);
  }
}
