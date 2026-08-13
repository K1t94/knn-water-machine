import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
    MACHINE_APPLICATION_ERROR_CODES,
    MachineApplicationError,
    type MachineApplicationErrorCode,
} from '../application/machine-application.error';

import { MachineErrorFilter } from './machine-error.filter';

import type { ArgumentsHost } from '@nestjs/common';

const CORRELATION_ID = '12345678-1234-4234-9234-123456789abc';

const expectedProblems: Record<MachineApplicationErrorCode, { message: string; retryable: boolean; status: number }> = {
    AUTHENTICATION_REQUIRED: {
        message: 'Authentication is required.',
        retryable: false,
        status: HttpStatus.UNAUTHORIZED,
    },
    SESSION_INVALID: {
        message: 'The session is invalid. Sign in again.',
        retryable: false,
        status: HttpStatus.UNAUTHORIZED,
    },
    VALIDATION_ERROR: {
        message: 'The request is invalid.',
        retryable: false,
        status: HttpStatus.BAD_REQUEST,
    },
    MACHINE_CODE_INVALID: {
        message: 'The machine code format is not supported.',
        retryable: false,
        status: HttpStatus.BAD_REQUEST,
    },
    MACHINE_NOT_FOUND: {
        message: 'Machine not found.',
        retryable: false,
        status: HttpStatus.NOT_FOUND,
    },
    DISCOVERY_CONTEXT_STALE: {
        message: 'The machine list changed. Refresh to continue.',
        retryable: true,
        status: HttpStatus.CONFLICT,
    },
    MACHINE_CONTEXT_CHANGED: {
        message: 'Machine information changed. Review it before continuing.',
        retryable: false,
        status: HttpStatus.CONFLICT,
    },
    MACHINE_NOT_SELECTABLE: {
        message: 'This machine is not currently available for selection.',
        retryable: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
    DISCOVERY_TEMPORARILY_UNAVAILABLE: {
        message: 'Machine information is temporarily unavailable.',
        retryable: true,
        status: HttpStatus.SERVICE_UNAVAILABLE,
    },
};

describe('MachineErrorFilter', () => {
    it('defines one exhaustive consumer-safe application error taxonomy', () => {
        expect(MACHINE_APPLICATION_ERROR_CODES).toEqual(Object.keys(expectedProblems));
    });

    it.each(MACHINE_APPLICATION_ERROR_CODES)('maps %s to its fixed public problem', (code) => {
        const response = responseMock();
        const filter = new MachineErrorFilter();

        filter.catch(
            new MachineApplicationError(code, {
                cause: new Error('internal implementation detail'),
                internalDetails: { repositoryState: 'private' },
            }),
            hostMock(response),
        );

        expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(response.type).toHaveBeenCalledWith('application/problem+json');
        expect(response.status).toHaveBeenCalledWith(expectedProblems[code].status);
        expect(response.json).toHaveBeenCalledWith({
            code,
            message: expectedProblems[code].message,
            retryable: expectedProblems[code].retryable,
            correlationId: CORRELATION_ID,
        });
    });

    it.each([
        ['database', 'P2024 pool timeout at MachineIdentifierMapping_normalizedValue_key'],
        ['mapping', 'legacy alias KNNLEGACY:4821 maps to internal uuid'],
        ['telemetry', '{"modemImei":"353490000000001","rawState":17}'],
        ['topic', 'machines/private/serial-42/state'],
        ['credential', 'mqtt-password=super-secret'],
        ['internal state', 'publication=ARCHIVED deletedAt=2026-08-14'],
    ])('redacts %s details from typed and unexpected failures', (_label, secret) => {
        const typedResponse = responseMock();
        const unexpectedResponse = responseMock();
        const filter = new MachineErrorFilter();

        filter.catch(
            new MachineApplicationError('MACHINE_NOT_FOUND', {
                cause: new Error(secret),
                internalDetails: { secret },
            }),
            hostMock(typedResponse),
        );
        filter.catch(new Error(secret), hostMock(unexpectedResponse));

        expect(JSON.stringify(typedResponse.json.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(unexpectedResponse.json.mock.calls)).not.toContain(secret);
        expect(unexpectedResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
        expect(unexpectedResponse.json).toHaveBeenCalledWith({
            code: 'DISCOVERY_TEMPORARILY_UNAVAILABLE',
            message: 'Machine information is temporarily unavailable.',
            retryable: true,
            correlationId: CORRELATION_ID,
        });
    });

    it('does not trust an unnormalized request-id header as a correlation ID', () => {
        const response = responseMock();
        const filter = new MachineErrorFilter();

        filter.catch(
            new MachineApplicationError('VALIDATION_ERROR'),
            hostMock(response, undefined, 'database-secret-injected-as-request-id'),
        );

        const serializedResponse = JSON.stringify(response.json.mock.calls);
        expect(serializedResponse).toMatch(
            /"correlationId":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/i,
        );
        expect(serializedResponse).not.toContain('database-secret-injected-as-request-id');
    });

    it.each([
        [HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR'],
        [HttpStatus.UNAUTHORIZED, 'AUTHENTICATION_REQUIRED'],
    ] as const)('normalizes framework status %s without preserving its response body', (status, code) => {
        const response = responseMock();
        const filter = new MachineErrorFilter();

        filter.catch(
            new HttpException({ message: 'private mapping and database details' }, status),
            hostMock(response),
        );

        expect(response.status).toHaveBeenCalledWith(expectedProblems[code].status);
        expect(response.json).toHaveBeenCalledWith({
            code,
            message: expectedProblems[code].message,
            retryable: expectedProblems[code].retryable,
            correlationId: CORRELATION_ID,
        });
        expect(JSON.stringify(response.json.mock.calls)).not.toContain('private mapping and database details');
    });
});

function responseMock() {
    const response = {
        json: vi.fn(),
        setHeader: vi.fn(),
        status: vi.fn(),
        type: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    return response;
}

function hostMock(
    response: ReturnType<typeof responseMock>,
    correlationId: string | undefined = CORRELATION_ID,
    requestIdHeader?: string,
): ArgumentsHost {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                authRequestMetadata: correlationId ? { requestId: correlationId } : undefined,
                headers: requestIdHeader ? { 'x-request-id': requestIdHeader } : {},
            }),
            getResponse: () => response,
        }),
    } as ArgumentsHost;
}
