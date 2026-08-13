import { randomUUID } from 'node:crypto';

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

import { MachineApplicationError, type MachineApplicationErrorCode } from '../application/machine-application.error';

import type { AuthSecurityRequest } from '../../auth/http/auth-request-context.middleware';
import type { Request, Response } from 'express';

interface MachineProblem {
    code: MachineApplicationErrorCode;
    message: string;
    retryable: boolean;
    status: number;
}

const RETRY_AFTER_SECONDS = 1;

const MACHINE_PROBLEMS: Record<MachineApplicationErrorCode, MachineProblem> = {
    AUTHENTICATION_REQUIRED: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        retryable: false,
        status: HttpStatus.UNAUTHORIZED,
    },
    SESSION_INVALID: {
        code: 'SESSION_INVALID',
        message: 'The session is invalid. Sign in again.',
        retryable: false,
        status: HttpStatus.UNAUTHORIZED,
    },
    VALIDATION_ERROR: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        retryable: false,
        status: HttpStatus.BAD_REQUEST,
    },
    MACHINE_CODE_INVALID: {
        code: 'MACHINE_CODE_INVALID',
        message: 'The machine code format is not supported.',
        retryable: false,
        status: HttpStatus.BAD_REQUEST,
    },
    MACHINE_NOT_FOUND: {
        code: 'MACHINE_NOT_FOUND',
        message: 'Machine not found.',
        retryable: false,
        status: HttpStatus.NOT_FOUND,
    },
    DISCOVERY_CONTEXT_STALE: {
        code: 'DISCOVERY_CONTEXT_STALE',
        message: 'The machine list changed. Refresh to continue.',
        retryable: true,
        status: HttpStatus.CONFLICT,
    },
    MACHINE_CONTEXT_CHANGED: {
        code: 'MACHINE_CONTEXT_CHANGED',
        message: 'Machine information changed. Review it before continuing.',
        retryable: false,
        status: HttpStatus.CONFLICT,
    },
    MACHINE_NOT_SELECTABLE: {
        code: 'MACHINE_NOT_SELECTABLE',
        message: 'This machine is not currently available for selection.',
        retryable: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
    DISCOVERY_TEMPORARILY_UNAVAILABLE: {
        code: 'DISCOVERY_TEMPORARILY_UNAVAILABLE',
        message: 'Machine information is temporarily unavailable.',
        retryable: true,
        status: HttpStatus.SERVICE_UNAVAILABLE,
    },
};

@Catch()
export class MachineErrorFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request & AuthSecurityRequest>();
        const response = http.getResponse<Response>();
        const problem = publicProblem(error);

        response.setHeader('Cache-Control', 'no-store');
        if (problem.code === 'DISCOVERY_TEMPORARILY_UNAVAILABLE') {
            response.setHeader('Retry-After', RETRY_AFTER_SECONDS.toString());
        }
        response
            .type('application/problem+json')
            .status(problem.status)
            .json({
                code: problem.code,
                message: problem.message,
                retryable: problem.retryable,
                correlationId: correlationId(request),
            });
    }
}

function publicProblem(error: unknown): MachineProblem {
    if (error instanceof MachineApplicationError) {
        return MACHINE_PROBLEMS[error.code];
    }
    if (error instanceof HttpException) {
        return frameworkProblem(error.getStatus());
    }
    return MACHINE_PROBLEMS.DISCOVERY_TEMPORARILY_UNAVAILABLE;
}

function frameworkProblem(status: number): MachineProblem {
    if (status === HttpStatus.BAD_REQUEST) return MACHINE_PROBLEMS.VALIDATION_ERROR;
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
        return MACHINE_PROBLEMS.AUTHENTICATION_REQUIRED;
    }
    return MACHINE_PROBLEMS.DISCOVERY_TEMPORARILY_UNAVAILABLE;
}

function correlationId(request: Request & AuthSecurityRequest): string {
    const normalizedRequestId = request.authRequestMetadata?.requestId;
    return normalizedRequestId && isUuid(normalizedRequestId) ? normalizedRequestId : randomUUID();
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
