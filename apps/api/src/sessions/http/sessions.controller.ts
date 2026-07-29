import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import {
  authErrorResponse,
  noStoreHeader,
  requestIdHeader,
  withAuthErrors,
} from '../../auth/http/auth-http.helpers';
import { SessionsService } from '../application/sessions.service';
import {
  AccessSessionGuard,
  type AuthenticatedRequest,
} from './access-session.guard';
import {
  RefreshSessionDto,
  SessionCredentialsDto,
} from './dto/session.dto';

@ApiTags('sessions')
@Controller('v1/auth/sessions')
export class SessionsController {
  constructor(
    @Inject(SessionsService)
    private readonly sessions: SessionsService,
  ) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh credential and issue access' })
  @ApiHeader(requestIdHeader)
  @ApiOkResponse({
    description: 'Rotated credentials with unchanged absolute session expiry',
    headers: noStoreHeader,
    type: SessionCredentialsDto,
  })
  @ApiUnauthorizedResponse(authErrorResponse)
  @ApiResponse({ status: 503, ...authErrorResponse })
  refresh(
    @Body(new ValidationPipe({
      expectedType: RefreshSessionDto,
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }))
    body: RefreshSessionDto,
    @Res({ passthrough: true }) response: Response,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<SessionCredentialsDto> {
    response.setHeader('Cache-Control', 'no-store');
    return withAuthErrors(headers['x-request-id'], () =>
      this.sessions.refresh(body.refreshToken));
  }

  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessSessionGuard)
  @ApiOperation({ summary: 'Revoke only the current device session' })
  @ApiBearerAuth('AccessBearer')
  @ApiNoContentResponse({ description: 'Session revoked or already revoked' })
  @ApiUnauthorizedResponse(authErrorResponse)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.sessions.logout(request.sessionClaims.sid);
  }
}
