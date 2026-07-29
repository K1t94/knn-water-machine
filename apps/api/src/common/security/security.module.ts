import { Global, Module } from '@nestjs/common';

import { CredentialCryptoService } from './credential-crypto.service';

@Global()
@Module({
  providers: [CredentialCryptoService],
  exports: [CredentialCryptoService],
})
export class SecurityModule {}
