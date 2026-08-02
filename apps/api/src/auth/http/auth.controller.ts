import {
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Inject,
    Ip,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Res,
    ValidationPipe,
} from '@nestjs/common';
import {
    ApiAcceptedResponse,
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiHeader,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiSecurity,
    ApiServiceUnavailableResponse,
    ApiTooManyRequestsResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { OtpService } from '../../otp/application/otp.service';
import { SessionCredentialsDto } from '../../sessions/http/dto/session.dto';
import { AuthService } from '../application/auth.service';
import { RegistrationService } from '../application/registration.service';

import {
    authErrorResponse,
    idempotencyHeader,
    noStoreHeader,
    requestIdHeader,
    requireIdempotencyKey,
    requireRegistrationAuthorization,
    withAuthErrors,
} from './auth-http.helpers';
import {
    OtpIssuedResponseDto,
    OtpRequestDto,
    OtpResendDto,
    OtpVerificationDto,
    OtpVerifiedResponseDto,
} from './dto/otp.dto';
import { RegistrationCompletionDto, RegistrationContextDto } from './dto/registration.dto';

import type { Response } from 'express';

@ApiTags('auth')
@Controller('v1/auth/otp')
export class AuthController {
    constructor(
        @Inject(OtpService) private readonly otp: OtpService,
        @Inject(AuthService) private readonly auth: AuthService,
    ) {}

    @Post('requests')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Request the first OTP for a Senegal phone' })
    @ApiHeader(requestIdHeader)
    @ApiAcceptedResponse({
        description: 'SMS accepted or delivery outcome uncertain',
        type: OtpIssuedResponseDto,
    })
    @ApiBadRequestResponse(authErrorResponse)
    @ApiTooManyRequestsResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    request(
        @Body(new ValidationPipe(dtoValidation(OtpRequestDto))) body: OtpRequestDto,
        @Ip() ip: string,
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<OtpIssuedResponseDto> {
        return this.withErrors(headers['x-request-id'], async () =>
            this.shapeIssued(await this.otp.request({ ...body, ipAddress: ip })),
        );
    }

    @Post('requests/:challengeId/resend')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Replace an active OTP after cooldown' })
    @ApiHeader(requestIdHeader)
    @ApiAcceptedResponse({
        description: 'New challenge accepted; previous challenge is invalid',
        type: OtpIssuedResponseDto,
    })
    @ApiBadRequestResponse(authErrorResponse)
    @ApiConflictResponse(authErrorResponse)
    @ApiTooManyRequestsResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    resend(
        @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
        @Body(new ValidationPipe(dtoValidation(OtpResendDto))) body: OtpResendDto,
        @Ip() ip: string,
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<OtpIssuedResponseDto> {
        return this.withErrors(headers['x-request-id'], async () =>
            this.shapeIssued(await this.otp.resend({ ...body, previousChallengeId: challengeId, ipAddress: ip })),
        );
    }

    @Post('verifications')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify one OTP and choose the next auth step' })
    @ApiHeader(requestIdHeader)
    @ApiOkResponse({
        description: 'Authenticated or scoped legal completion required',
        headers: noStoreHeader,
        type: OtpVerifiedResponseDto,
    })
    @ApiBadRequestResponse(authErrorResponse)
    @ApiConflictResponse(authErrorResponse)
    @ApiTooManyRequestsResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    verify(
        @Body(new ValidationPipe(dtoValidation(OtpVerificationDto))) body: OtpVerificationDto,
        @Ip() ip: string,
        @Res({ passthrough: true }) response: Response,
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<OtpVerifiedResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        return this.withErrors(headers['x-request-id'], async () => {
            const verified = await this.otp.verify({ ...body, ipAddress: ip });
            return this.auth.routeVerifiedOtp(verified);
        });
    }

    private shapeIssued(value: Awaited<ReturnType<OtpService['request']>>): OtpIssuedResponseDto {
        return {
            challengeId: value.challengeId,
            delivery: value.delivery,
            expiresAt: value.expiresAt.toISOString(),
            resendAvailableAt: value.resendAvailableAt.toISOString(),
        };
    }

    private async withErrors<T>(requestId: string | undefined, work: () => Promise<T>): Promise<T> {
        return withAuthErrors(requestId, work);
    }
}

@ApiTags('auth', 'legal')
@Controller('v1/auth/registration')
export class RegistrationController {
    constructor(
        @Inject(RegistrationService)
        private readonly registration: RegistrationService,
    ) {}

    @Patch('context')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Replace or remove pending promo context without applying it' })
    @ApiSecurity('RegistrationAuth')
    @ApiHeader(requestIdHeader)
    @ApiNoContentResponse({ description: 'Context updated without referral side effects' })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiConflictResponse(authErrorResponse)
    async updateContext(
        @Headers() headers: Record<string, string | undefined>,
        @Body(new ValidationPipe(dtoValidation(RegistrationContextDto)))
        body: RegistrationContextDto,
    ): Promise<void> {
        await withAuthErrors(headers['x-request-id'], () =>
            this.registration.updatePendingPromo(
                requireRegistrationAuthorization(headers['x-registration-authorization']),
                body.pendingPromoCode,
            ),
        );
    }

    @Post('complete')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Atomically register, accept legal documents, and start a session' })
    @ApiSecurity('RegistrationAuth')
    @ApiHeader(idempotencyHeader)
    @ApiHeader(requestIdHeader)
    @ApiOkResponse({
        description: 'Registration completed or same-key result recovered',
        headers: noStoreHeader,
        type: SessionCredentialsDto,
    })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiConflictResponse(authErrorResponse)
    @ApiServiceUnavailableResponse(authErrorResponse)
    complete(
        @Headers() headers: Record<string, string | undefined>,
        @Body(new ValidationPipe(dtoValidation(RegistrationCompletionDto)))
        body: RegistrationCompletionDto,
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

function dtoValidation(expectedType: new () => object) {
    return {
        expectedType,
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
    };
}
