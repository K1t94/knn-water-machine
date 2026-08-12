import {
    Controller,
    Get,
    Inject,
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
import { ReferralQueryService } from '../application/referral-query.service';
import { type ReferralCursor } from '../domain/referral-types';

import { ReferralInvitationQueryDto } from './dto/referral-request.dto';
import {
    MyReferralResponseDto,
    ReferralInvitationPageResponseDto,
    ReferralPublicErrorResponseDto,
} from './dto/referral-response.dto';
import { ReferralErrorFilter } from './referral-error.filter';
import {
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
        @Inject(ReferralQueryService) private readonly queries: ReferralQueryService,
    ) {}

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
