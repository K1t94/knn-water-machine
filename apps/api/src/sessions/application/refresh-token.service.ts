import { Inject, Injectable } from '@nestjs/common';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';

@Injectable()
export class RefreshTokenService {
    constructor(@Inject(CredentialCryptoService) private readonly crypto: CredentialCryptoService) {}

    generate(): string {
        return this.crypto.generateOpaqueCredential();
    }

    digest(token: string): string {
        return this.crypto.digest('credential', ['refresh-token', token]).digest;
    }
}
