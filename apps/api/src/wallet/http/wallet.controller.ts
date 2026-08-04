import { Controller, Get, Inject, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import {
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
import { WalletQueryService } from '../application/wallet-query.service';
import { WalletError } from '../domain/wallet-errors';

import { WalletHistoryQueryDto } from './dto/wallet-history-query.dto';
import {
    toWalletBalanceResponse,
    WalletBalanceResponseDto,
    WalletPublicErrorResponseDto,
    WalletHistoryResponseDto,
} from './dto/wallet-response.dto';
import { WalletErrorFilter } from './wallet-error.filter';

import type { AuthenticatedRequest } from '../../sessions/http/access-session.guard';
import type { Response } from 'express';

@ApiTags('wallet')
@Controller('v1/wallet')
export class WalletController {
    constructor(@Inject(WalletQueryService) private readonly walletQuery: WalletQueryService) {}

    @Get('balance')
    @UseGuards(AccessSessionGuard)
    @UseFilters(WalletErrorFilter)
    @ApiOperation({ summary: 'Get the current user water balance' })
    @ApiBearerAuth('AccessBearer')
    @ApiHeader(requestIdHeader)
    @ApiOkResponse({
        description: 'Current balance for the authenticated user',
        headers: noStoreHeader,
        type: WalletBalanceResponseDto,
    })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiResponse({
        status: 503,
        description: 'Wallet data is temporarily unavailable.',
        type: WalletPublicErrorResponseDto,
    })
    async getBalance(
        @Req() request: AuthenticatedRequest,
        @Res({ passthrough: true }) response: Response,
    ): Promise<WalletBalanceResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        const balance = await this.walletQuery.getBalance(request.sessionClaims.sub);
        return toWalletBalanceResponse(balance);
    }

    @Get('operations')
    @UseGuards(AccessSessionGuard)
    @UseFilters(WalletErrorFilter)
    @ApiOperation({ summary: 'List the current user water operations' })
    @ApiBearerAuth('AccessBearer')
    @ApiHeader(requestIdHeader)
    @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100, example: 20 })
    @ApiQuery({ name: 'cursor', required: false, type: String, minLength: 1, maxLength: 512 })
    @ApiOkResponse({
        description: 'Deterministic newest-first wallet history page',
        headers: noStoreHeader,
        type: WalletHistoryResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Invalid limit or cursor.', type: WalletPublicErrorResponseDto })
    @ApiUnauthorizedResponse(authErrorResponse)
    @ApiResponse({
        status: 503,
        description: 'Wallet data is temporarily unavailable.',
        type: WalletPublicErrorResponseDto,
    })
    async getOperations(
        @Req() request: AuthenticatedRequest,
        @Query() query: WalletHistoryQueryDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<WalletHistoryResponseDto> {
        response.setHeader('Cache-Control', 'no-store');
        const limit = normalizeHistoryLimit(query.limit);
        return this.walletQuery.getHistory(request.sessionClaims.sub, {
            limit,
            cursor: query.cursor,
        });
    }
}

function normalizeHistoryLimit(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new WalletError('WALLET_CURSOR_INVALID', 'The wallet history cursor or limit is invalid.');
    }
    return limit;
}
