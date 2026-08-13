import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { MachineApplicationError } from '../../src/machines/application/machine-application.error';
// T066 supplies this runtime token; its absence is the intended RED state.
// eslint-disable-next-line import/no-unresolved
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
import { AccessTokenService } from '../../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../../src/sessions/infrastructure/postgres/sessions.repository';
import { httpServer, responseRecord } from '../http-test-helpers';

import type { INestApplication } from '@nestjs/common';

const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicDetail = {
    machineId: MACHINE_ID,
    displayName: 'Fontaine Plateau',
    address: '12 Rue de Dakar',
    coordinates: { latitude: 14.7167, longitude: -17.4677 },
    price: { amountPerLiter: '125.0700', currency: 'XOF' },
    status: 'ONLINE',
    machineRevision: '21',
    selectable: true,
    refreshedAt: '2026-08-15T12:00:00.000Z',
};

const internalFields =
    /internalId|machineInternalId|identifier|mapping|publicationState|deletedAt|serviceAreaCode|evidence|topic|credential/i;

type ResolveInput = Readonly<{ source: 'QR'; value: string }> | Readonly<{ source: 'MANUAL'; value: string }>;

type OpenApiOperation = {
    requestBody?: unknown;
    responses?: Record<string, unknown>;
    security?: Array<Record<string, unknown>>;
};

describe('machine identifier resolution HTTP contract', () => {
    let app: INestApplication;
    const discovery = { execute: vi.fn() };
    const detail = { execute: vi.fn() };
    const resolver = { execute: vi.fn<(input: ResolveInput) => Promise<unknown>>() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        resolver.execute.mockResolvedValue(publicDetail);
        accessTokens.validate.mockResolvedValue({
            iss: 'kaynann-api',
            aud: 'kaynann-mobile',
            sub: USER_ID,
            sid: SESSION_ID,
            jti: 'jti-1',
            iat: 1,
            exp: 2,
        });
        sessions.findActive.mockResolvedValue({ id: SESSION_ID, userId: USER_ID });

        const module = await Test.createTestingModule({
            controllers: [MachineDiscoveryController],
            providers: [
                { provide: DiscoverMachinesService, useValue: discovery },
                { provide: GetMachineDetailService, useValue: detail },
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                { provide: ResolveMachineIdentifierService, useValue: resolver },
                { provide: AccessTokenService, useValue: accessTokens },
                { provide: SessionsRepository, useValue: sessions },
                AccessSessionGuard,
                MachineErrorFilter,
            ],
        }).compile();

        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(
            new ValidationPipe({
                forbidNonWhitelisted: true,
                transform: true,
                whitelist: true,
            }),
        );
        await app.init();
    });

    afterEach(() => app.close());

    function authenticated<T extends request.Test>(pending: T): T {
        return pending.set('authorization', 'Bearer access-token');
    }

    function postResolve(body: unknown): request.Test {
        return authenticated(request(httpServer(app)).post('/v1/machines/resolve').send(body));
    }

    it('requires a current access session before identifier resolution', async () => {
        const response = await request(httpServer(app)).post('/v1/machines/resolve').send({
            source: 'MANUAL',
            value: 'DKR-PLATEAU-01',
        });

        expect(response.status, JSON.stringify(response.body)).toBe(401);
        expect(resolver.execute).not.toHaveBeenCalled();
    });

    it('publishes the authenticated resolve operation and response contract in OpenAPI', () => {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'AccessBearer').build(),
        );
        const operation = document.paths['/v1/machines/resolve'].post as OpenApiOperation | undefined;

        expect(operation?.security).toContainEqual({ AccessBearer: [] });
        expect(operation?.requestBody).toBeDefined();
        expect(Object.keys(operation?.responses ?? {})).toEqual(
            expect.arrayContaining(['200', '400', '401', '404', '503']),
        );
    });

    it.each([
        ['current QR', { source: 'QR', value: `kaynann://machine/v1/${MACHINE_ID}` }],
        ['manual code', { source: 'MANUAL', value: '  dkr-plateau-01  ' }],
    ] as const)('returns only fresh public detail for an authenticated %s request', async (_case, input) => {
        resolver.execute.mockResolvedValueOnce({
            ...publicDetail,
            machineInternalId: 'private-machine-uuid',
            identifierMapping: { normalizedValue: 'PRIVATE-CODE' },
            evidence: { topic: 'private/topic', credential: 'secret' },
        });

        const response = await postResolve(input);

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual(publicDetail);
        expect(JSON.stringify(response.body)).not.toMatch(internalFields);
        expect(resolver.execute).toHaveBeenCalledExactlyOnceWith(input);
    });

    it.each([
        ['missing body', undefined],
        ['missing source', { value: 'DKR-PLATEAU-01' }],
        ['unsupported source', { source: 'NFC', value: 'DKR-PLATEAU-01' }],
        ['missing value', { source: 'MANUAL' }],
        ['empty value', { source: 'MANUAL', value: '' }],
        ['non-string value', { source: 'MANUAL', value: 42 }],
        ['unexpected field', { source: 'MANUAL', value: 'DKR-PLATEAU-01', machineId: MACHINE_ID }],
    ])('rejects malformed input at the HTTP boundary: %s', async (_case, body) => {
        const response = await postResolve(body);
        const problem = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(problem).toEqual({
            code: 'VALIDATION_ERROR',
            message: 'The request is invalid.',
            retryable: false,
            correlationId: problem.correlationId,
        });
        expect(problem.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(resolver.execute).not.toHaveBeenCalled();
    });

    it.each([
        ['arbitrary URL', 'https://example.test/machine/AbCdEfGhIjKlMnOpQrStUv'],
        ['payment QR', 'wave://merchant/qr/12345'],
    ])('returns a safe invalid-code problem for %s content', async (_case, value) => {
        resolver.execute.mockRejectedValueOnce(
            new MachineApplicationError('MACHINE_CODE_INVALID', {
                internalDetails: { value, parser: 'private-parser' },
            }),
        );

        const response = await postResolve({ source: 'QR', value });
        const problem = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(problem).toEqual({
            code: 'MACHINE_CODE_INVALID',
            message: 'The machine code format is not supported.',
            retryable: false,
            correlationId: problem.correlationId,
        });
        expect(problem.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(JSON.stringify(response.body)).not.toMatch(/example\.test|wave|private-parser|stack/i);
    });

    it('returns one indistinguishable not-found body for every inaccessible or unknown identifier', async () => {
        const cases = [
            ['hidden', 'DKR-HIDDEN-01', { publicationState: 'HIDDEN' }],
            ['archived', 'DKR-ARCHIVED-01', { publicationState: 'ARCHIVED' }],
            ['deleted', 'DKR-DELETED-01', { deletedAt: '2026-08-15T12:00:00.000Z' }],
            ['non-customer', 'DKR-INTERNAL-01', { audience: 'INTERNAL' }],
            ['inaccessible', 'DKR-DENIED-01', { accessPolicy: 'DENIED' }],
            ['disabled alias', 'DKR-DISABLED-01', { mappingEnabled: false }],
            ['unknown', 'DKR-UNKNOWN-01', { lookup: 'UNKNOWN' }],
            ['unmapped', 'DKR-UNMAPPED-01', { lookup: 'UNMAPPED' }],
        ] as const;
        const publicBodies: Array<Record<string, unknown>> = [];

        for (const [_case, value, internalDetails] of cases) {
            resolver.execute.mockRejectedValueOnce(
                new MachineApplicationError('MACHINE_NOT_FOUND', { internalDetails }),
            );

            const response = await postResolve({ source: 'MANUAL', value });
            const problem = responseRecord(response);

            expect(response.status, JSON.stringify(response.body)).toBe(404);
            expect(problem.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
            expect(JSON.stringify(response.body)).not.toMatch(internalFields);
            publicBodies.push({ ...problem, correlationId: '<correlation-id>' });
        }

        expect(new Set(publicBodies.map((body) => JSON.stringify(body)))).toEqual(
            new Set([
                JSON.stringify({
                    code: 'MACHINE_NOT_FOUND',
                    message: 'Machine not found.',
                    retryable: false,
                    correlationId: '<correlation-id>',
                }),
            ]),
        );
    });
});
