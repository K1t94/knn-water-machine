import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

import { SafeAuthLogger } from './security/safe-auth-logger';

import type { Request, Response } from 'express';

@Catch()
export class RedactedExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger = new SafeAuthLogger()) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const response = http.getResponse<Response>();
        const request = http.getRequest<
            Request & {
                authSecurity?: {
                    startedAt?: number;
                    phoneFingerprint?: string;
                    installationFingerprint?: string;
                };
            }
        >();
        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

        const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
        const safeAuthResponse = authErrorResponse(exceptionResponse);
        const category =
            safeAuthResponse?.error.code ??
            (exception instanceof HttpException ? 'HTTP_REQUEST_ERROR' : 'UNEXPECTED_ERROR');
        this.logger.exception({
            requestId: request.headers['x-request-id'] as string | undefined,
            category,
            route: request.route?.path ?? request.path,
            statusCode: status,
            ...(request.authSecurity?.startedAt !== undefined
                ? { latencyMs: Date.now() - request.authSecurity.startedAt }
                : {}),
            ...(request.authSecurity?.phoneFingerprint
                ? { phoneFingerprint: request.authSecurity.phoneFingerprint }
                : {}),
            ...(request.authSecurity?.installationFingerprint
                ? { installationFingerprint: request.authSecurity.installationFingerprint }
                : {}),
        });
        if (safeAuthResponse) {
            response.status(status).json(safeAuthResponse);
            return;
        }

        response.status(status).json({
            statusCode: status,
            error: status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal Server Error' : 'Request Error',
        });
    }
}

function authErrorResponse(value: unknown):
    | {
          error: { code: string; message: string; retryable: boolean; requestId: string; retryAfterSeconds?: number };
      }
    | undefined {
    if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
    const error = (value as { error?: unknown }).error;
    if (!error || typeof error !== 'object') return undefined;
    const candidate = error as Record<string, unknown>;
    if (
        typeof candidate.code !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(candidate.code) ||
        typeof candidate.message !== 'string' ||
        candidate.message.length > 200 ||
        typeof candidate.retryable !== 'boolean' ||
        typeof candidate.requestId !== 'string' ||
        candidate.requestId.length > 128
    )
        return undefined;
    return {
        error: {
            code: candidate.code,
            message: candidate.message,
            retryable: candidate.retryable,
            requestId: candidate.requestId,
            ...(typeof candidate.retryAfterSeconds === 'number' && candidate.retryAfterSeconds > 0
                ? { retryAfterSeconds: Math.ceil(candidate.retryAfterSeconds) }
                : {}),
        },
    };
}
