import { randomUUID } from 'node:crypto';

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

import { ReferralError } from '../domain/referral-errors';

import type { ReferralPublicErrorResponseDto } from './dto/referral-response.dto';
import type { Request, Response } from 'express';

@Catch()
export class ReferralErrorFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();
        response.setHeader('Cache-Control', 'no-store');

        if (error instanceof HttpException && error.getStatus() === HttpStatus.UNAUTHORIZED) {
            response.status(HttpStatus.UNAUTHORIZED).json(error.getResponse());
            return;
        }

        const mapped = mapReferralError(error, request.path);
        const header = request.headers['x-request-id'];
        const suppliedRequestId = Array.isArray(header) ? header[0] : header;
        const body: ReferralPublicErrorResponseDto = {
            error: {
                code: mapped.code,
                message: mapped.message,
                retryable: mapped.retryable ?? mapped.status === HttpStatus.SERVICE_UNAVAILABLE,
                requestId: suppliedRequestId?.slice(0, 128) || randomUUID(),
            },
        };

        response.status(mapped.status).json(body);
    }
}

function mapReferralError(
    error: unknown,
    path: string,
): {
    code: ReferralPublicErrorResponseDto['error']['code'];
    message: string;
    status: number;
    retryable?: boolean;
} {
    if (error instanceof ReferralError) {
        if (error.code === 'FEATURE_DISABLED') {
            return {
                code: 'FEATURE_DISABLED',
                message: 'Referral program is disabled.',
                status: HttpStatus.SERVICE_UNAVAILABLE,
                retryable: false,
            };
        }
        if (error.code === 'REFERRAL_CODE_UNAVAILABLE') {
            return unavailableCode();
        }
        if (error.code === 'REFERRAL_SELF_NOT_ALLOWED') {
            return conflict(error.code, 'You cannot use your own referral code.');
        }
        if (error.code === 'REFERRAL_CURSOR_INVALID') {
            return invalidCursor();
        }
    }

    if (error instanceof HttpException && error.getStatus() === HttpStatus.BAD_REQUEST) {
        return path.endsWith('/invitations') ? invalidCursor() : unavailableCode();
    }

    return {
        code: 'REFERRAL_SERVICE_UNAVAILABLE',
        message: 'Referral service is temporarily unavailable.',
        status: HttpStatus.SERVICE_UNAVAILABLE,
    };
}

function unavailableCode() {
    return {
        code: 'REFERRAL_CODE_UNAVAILABLE' as const,
        message: 'Referral code is unavailable.',
        status: HttpStatus.BAD_REQUEST,
    };
}

function invalidCursor() {
    return {
        code: 'REFERRAL_CURSOR_INVALID' as const,
        message: 'The referral history cursor or limit is invalid.',
        status: HttpStatus.BAD_REQUEST,
    };
}

function conflict(code: 'REFERRAL_SELF_NOT_ALLOWED', message: string) {
    return { code, message, status: HttpStatus.CONFLICT };
}
