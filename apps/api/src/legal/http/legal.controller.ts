import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Inject,
    Ip,
    Post,
    Res,
    ValidationPipe,
} from '@nestjs/common';
import {
    ApiConflictResponse,
    ApiHeader,
    ApiOkResponse,
    ApiOperation,
    ApiSecurity,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RegistrationService } from '../../auth/application/registration.service';
import {
    requireRegistrationAuthorization,
    requireIdempotencyKey,
    withAuthErrors,
    authErrorResponse,
    idempotencyHeader,
    noStoreHeader,
    requestIdHeader,
} from '../../auth/http/auth-http.helpers';
import { RegistrationAuthorizationStore } from '../../auth/infrastructure/redis/registration-authorization.store';
import { SessionCredentialsDto } from '../../sessions/http/dto/session.dto';
import { LegalService } from '../application/legal.service';

import { LegalAcceptanceDto } from './dto/legal-acceptance.dto';
import { CurrentLegalSetDto } from './dto/legal.dto';

import type { Response } from 'express';

@ApiTags('legal')
@Controller('v1/legal/documents')
export class LegalController {
    constructor(
        @Inject(LegalService) private readonly legal: LegalService,
        @Inject(RegistrationAuthorizationStore)
        private readonly registrations: RegistrationAuthorizationStore,
    ) {}

    @Get('current')
    @ApiOperation({ summary: 'Get exact current mandatory legal documents' })
    @ApiSecurity('RegistrationAuth')
    @ApiHeader(requestIdHeader)
    @ApiOkResponse({ description: 'Current mandatory documents', type: CurrentLegalSetDto })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    async current(@Headers() headers: Record<string, string | undefined>): Promise<CurrentLegalSetDto> {
        return withAuthErrors(headers['x-request-id'], async () => {
            await this.registrations.requireActive(
                requireRegistrationAuthorization(headers['x-registration-authorization']),
            );
            const current = await this.legal.currentMandatory('fr-SN');
            return {
                setVersion: current.setVersion,
                documents: current.documents.map((document) => ({
                    id: document.id,
                    kind: document.kind,
                    version: document.version,
                    title: document.title,
                    content: document.content,
                    mandatory: document.mandatory,
                    contentSha256: document.contentSha256,
                })),
            };
        });
    }
}

@ApiTags('auth', 'legal')
@Controller('v1/auth/legal')
export class LegalAcceptanceController {
    constructor(
        @Inject(RegistrationService)
        private readonly registration: RegistrationService,
    ) {}

    @Post('acceptances')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Accept new legal versions and start a session' })
    @ApiSecurity('RegistrationAuth')
    @ApiHeader(idempotencyHeader)
    @ApiHeader(requestIdHeader)
    @ApiOkResponse({
        description: 'Legal compliance restored and session created',
        headers: noStoreHeader,
        type: SessionCredentialsDto,
    })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiConflictResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    accept(
        @Headers() headers: Record<string, string | undefined>,
        @Body(
            new ValidationPipe({
                expectedType: LegalAcceptanceDto,
                forbidNonWhitelisted: true,
                transform: true,
                whitelist: true,
            }),
        )
        body: LegalAcceptanceDto,
        @Ip() ipAddress: string,
        @Res({ passthrough: true }) response: Response,
    ): Promise<SessionCredentialsDto> {
        response.setHeader('Cache-Control', 'no-store');
        const userAgent = headers['user-agent'];
        return withAuthErrors(headers['x-request-id'], () =>
            this.registration.complete({
                ...body,
                registrationAuthorization: requireRegistrationAuthorization(headers['x-registration-authorization']),
                idempotencyKey: requireIdempotencyKey(headers['idempotency-key']),
                ipAddress,
                ...(userAgent ? { userAgentFamily: userAgent.split(/[ /;]/, 1)[0] } : {}),
            }),
        );
    }
}
