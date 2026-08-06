import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Post,
    Query,
    Req,
    Res,
    UseFilters,
    UseGuards,
    ValidationPipe,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiHeader,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { authErrorResponse, noStoreHeader, requestIdHeader } from '../../auth/http/auth-http.helpers';
import { AccessSessionGuard } from '../../sessions/http/access-session.guard';
import { ReferralApplicationService } from '../application/referral-application.service';
import { ReferralQueryService } from '../application/referral-query.service';
import { type ReferralCursor } from '../domain/referral-types';

import { ApplyReferralCodeRequestDto, ReferralInvitationQueryDto } from './dto/referral-request.dto';
import {
    ApplyReferralCodeResponseDto,
    MyReferralResponseDto,
    ReferralInvitationPageResponseDto,
    ReferralPublicErrorResponseDto,
} from './dto/referral-response.dto';
import { ReferralErrorFilter } from './referral-error.filter';
import {
    toApplyReferralCodeResponse,
    toMyReferralResponse,
    toReferralInvitationPageResponse,
} from './referral-response.mapper';

import type { AuthenticatedRequest } from '../../sessions/http/access-session.guard';
import type { Response } from 'express';

@ApiTags('referrals')
@ApiBearerAuth('AccessBearer')
@ApiHeader(requestIdHeader)
@UseGuards(AccessSessionGuard)
@UseFilters(ReferralErrorFilter)
@Controller('v1/referrals')
export class ReferralController {
    constructor(
        @Inject(ReferralApplicationService) private readonly applications: ReferralApplicationService,
        @Inject(ReferralQueryService) private readonly queries: ReferralQueryService,
    ) {}

    @Post('applications')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Attach a referral promo code to the current user' })
    @ApiBody({ type: ApplyReferralCodeRequestDto })
    @ApiOkResponse({ headers: noStoreHeader, type: ApplyReferralCodeResponseDto })
    @ApiBadRequestResponse({ type: ReferralPublicErrorResponseDto })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiConflictResponse({ type: ReferralPublicErrorResponseDto })
    @ApiResponse({ status: 503, type: ReferralPublicErrorResponseDto })
    async apply(
        @Req() request: AuthenticatedRequest,
        @Body(new ValidationPipe(dtoValidation(ApplyReferralCodeRequestDto))) body: ApplyReferralCodeRequestDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<ApplyReferralCodeResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        const result = await this.applications.apply({
            inviteeUserId: request.sessionClaims.sub,
            promoCode: body.promoCode,
        });
        return toApplyReferralCodeResponse(result);
    }

    @Get('me')
    @ApiOperation({ summary: "Get the current user's referral code and summary" })
    @ApiOkResponse({ headers: noStoreHeader, type: MyReferralResponseDto })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiResponse({ status: 503, type: ReferralPublicErrorResponseDto })
    async getMe(
        @Req() request: AuthenticatedRequest,
        @Res({ passthrough: true }) response: Response,
    ): Promise<MyReferralResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        return toMyReferralResponse(await this.queries.getMyReferral(request.sessionClaims.sub));
    }

    @Get('invitations')
    @ApiOperation({ summary: 'Get credited invitation history for the current user' })
    @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100, example: 20 })
    @ApiQuery({ name: 'cursor', required: false, type: String, minLength: 1, maxLength: 512 })
    @ApiOkResponse({ headers: noStoreHeader, type: ReferralInvitationPageResponseDto })
    @ApiBadRequestResponse({ type: ReferralPublicErrorResponseDto })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiResponse({ status: 503, type: ReferralPublicErrorResponseDto })
    async getInvitations(
        @Req() request: AuthenticatedRequest,
        @Query(new ValidationPipe(dtoValidation(ReferralInvitationQueryDto))) query: ReferralInvitationQueryDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<ReferralInvitationPageResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        const page = await this.queries.getInvitations(
            request.sessionClaims.sub,
            query.limit ?? 20,
            (query.cursor ?? null) as ReferralCursor | null,
        );
        return toReferralInvitationPageResponse(page);
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
