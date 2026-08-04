import { randomUUID } from 'node:crypto';

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';

import { WalletError } from '../domain/wallet-errors';

import type { WalletPublicErrorResponseDto } from './dto/wallet-response.dto';
import type { Request, Response } from 'express';

@Catch(WalletError)
export class WalletErrorFilter implements ExceptionFilter {
    catch(error: WalletError, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();
        const header = request.headers['x-request-id'];
        const suppliedRequestId = Array.isArray(header) ? header[0] : header;
        const cursorInvalid = error.code === 'WALLET_CURSOR_INVALID';
        const body: WalletPublicErrorResponseDto = {
            error: {
                code: cursorInvalid ? 'WALLET_CURSOR_INVALID' : 'WALLET_TEMPORARILY_UNAVAILABLE',
                message: cursorInvalid
                    ? 'The wallet history cursor or limit is invalid.'
                    : 'Wallet data is temporarily unavailable.',
                retryable: !cursorInvalid,
                requestId: suppliedRequestId?.slice(0, 128) || randomUUID(),
            },
        };

        response.status(cursorInvalid ? HttpStatus.BAD_REQUEST : HttpStatus.SERVICE_UNAVAILABLE).json(body);
    }
}
