import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';

import { WALLET_REPOSITORY } from './application/ports/wallet.repository';
import { WalletCommandService } from './application/wallet-command.service';
import { WalletQueryService } from './application/wallet-query.service';
import { WalletController } from './http/wallet.controller';
import { PrismaWalletRepository } from './infrastructure/postgres/prisma-wallet.repository';

@Module({
    imports: [PrismaModule, SessionsModule],
    controllers: [WalletController],
    providers: [
        PrismaWalletRepository,
        {
            provide: WALLET_REPOSITORY,
            useExisting: PrismaWalletRepository,
        },
        WalletCommandService,
        WalletQueryService,
    ],
    exports: [WalletCommandService, WalletQueryService],
})
export class WalletModule {}
