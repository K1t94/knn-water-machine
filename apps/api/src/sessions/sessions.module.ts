import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenService } from './application/access-token.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { SessionsService } from './application/sessions.service';
import { AccessSessionGuard } from './http/access-session.guard';
import { SessionsController } from './http/sessions.controller';
import { SessionsRepository } from './infrastructure/postgres/sessions.repository';

@Module({
    imports: [JwtModule.register({})],
    controllers: [SessionsController],
    providers: [AccessTokenService, RefreshTokenService, SessionsRepository, SessionsService, AccessSessionGuard],
    exports: [SessionsService, AccessSessionGuard],
})
export class SessionsModule {}
