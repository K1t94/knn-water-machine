import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { MachineApplicationError } from '../../src/machines/application/machine-application.error';
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
import { RevalidateMachineSelectionService } from '../../src/machines/application/revalidate-machine-selection.service';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
import { MachineSelectionController } from '../../src/machines/http/machine-selection.controller';
import { AccessTokenService } from '../../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../../src/sessions/infrastructure/postgres/sessions.repository';
import { httpServer, responseRecord } from '../http-test-helpers';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { Response } from 'supertest';

const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_PUBLIC_DATA =
    /00000000-0000-4000-8000-000000000099|internalId|machineInternalId|identifierMapping|orderingRevision|selectionRevision|serviceAreaCode|sourceRevision|evidence|topic|credential|latitudeRequested|longitudeRequested|sql|stack/i;

const publicSummary = {
    machineId: MACHINE_ID,
    displayName: 'Fontaine Plateau',
    address: '12 Rue de Dakar',
    coordinates: { latitude: 14.7167, longitude: -17.4677 },
    distanceMeters: 1250,
    price: { amountPerLiter: '125.0700', currency: 'XOF' },
    status: 'ONLINE',
    machineRevision: '18',
};

const publicDetail = {
    ...publicSummary,
    selectable: true,
    refreshedAt: '2026-08-15T12:00:00.000Z',
};

const publicHandoff = {
    machineId: MACHINE_ID,
    machineRevision: '18',
    price: { amountPerLiter: '125.0700', currency: 'XOF' },
    availability: 'ONLINE',
    validatedAt: '2026-08-15T12:00:00.000Z',
};

const privateData = {
    internalId: '00000000-0000-4000-8000-000000000099',
    identifierMapping: { normalizedValue: 'DKR-PRIVATE-01' },
    orderingRevision: 41n,
    selectionRevision: 18n,
    serviceAreaCode: 'DKR-CENTRE',
    evidence: { sourceRevision: 'private-source', topic: 'private/topic', credential: 'secret' },
    latitudeRequested: 14.7,
    longitudeRequested: -17.4,
};

const contractPath = resolve(
    __dirname,
    '../../../../specs/006-machine-discovery-and-selection/contracts/machine-discovery.openapi.yaml',
);

type OperationMethod = 'get' | 'post';

interface ExpectedResponseContract {
    readonly method: OperationMethod;
    readonly path: string;
    readonly responses: Readonly<Record<string, string>>;
}

const expectedResponseContracts: readonly ExpectedResponseContract[] = [
    {
        method: 'get',
        path: '/v1/machines',
        responses: {
            '200': 'MachineCatalogPage',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '409': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'get',
        path: '/v1/machines/{machineId}',
        responses: {
            '200': 'MachineDetail',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '404': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'post',
        path: '/v1/machines/resolve',
        responses: {
            '200': 'MachineDetail',
            '400': 'Problem',
            '401': 'Problem',
            '404': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'post',
        path: '/v1/machines/{machineId}/selection-revalidation',
        responses: {
            '200': 'MachineSelectionHandoff',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '404': 'Problem',
            '409': 'MachineContextChangedProblem',
            '422': 'Problem',
            '503': 'Problem',
        },
    },
] as const;

describe('machine public HTTP boundary', () => {
    let app: INestApplication;
    const discovery = { execute: vi.fn() };
    const detail = { execute: vi.fn() };
    const resolver = { execute: vi.fn() };
    const selection = { execute: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        discovery.execute.mockResolvedValue({
            items: [{ ...publicSummary, ...privateData }],
            hasMore: false,
            catalogRevision: '41',
            ...privateData,
        });
        detail.execute.mockResolvedValue({ ...publicDetail, ...privateData });
        resolver.execute.mockResolvedValue({ ...publicDetail, ...privateData });
        selection.execute.mockResolvedValue({ ...publicHandoff, ...privateData });
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
            controllers: [MachineDiscoveryController, MachineSelectionController],
            providers: [
                { provide: DiscoverMachinesService, useValue: discovery },
                { provide: GetMachineDetailService, useValue: detail },
                { provide: ResolveMachineIdentifierService, useValue: resolver },
                { provide: RevalidateMachineSelectionService, useValue: selection },
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

    it('publishes the standalone OpenAPI response schemas for all four routes', () => {
        const sourceContract = readFileSync(contractPath, 'utf8');
        const runtimeContract = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'AccessBearer').build(),
        );

        for (const expected of expectedResponseContracts) {
            expect(sourceContract).toContain(`  ${expected.path}:`);
            for (const [status, schema] of Object.entries(expected.responses)) {
                expect(sourceContract).toContain(`#/components/schemas/${schema}`);
                expect(responseSchemaRef(runtimeContract, expected.path, expected.method, status)).toBe(
                    `#/components/schemas/${schema}`,
                );
            }
        }
    });

    it('returns only allowlisted OpenAPI success payloads from every route', async () => {
        const server = httpServer(app);
        const responses = await Promise.all([
            authenticated(request(server).get('/v1/machines')),
            authenticated(request(server).get(`/v1/machines/${MACHINE_ID}`)),
            authenticated(request(server).post('/v1/machines/resolve')).send({
                source: 'MANUAL',
                value: 'DKR-PLATEAU-01',
            }),
            authenticated(request(server).post(`/v1/machines/${MACHINE_ID}/selection-revalidation`)).send({
                expectedMachineRevision: '18',
            }),
        ]);

        expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
        expect(responseRecord(responses[0])).toEqual({
            items: [publicSummary],
            hasMore: false,
            catalogRevision: '41',
        });
        expect(responseRecord(responses[1])).toEqual(publicDetail);
        expect(responseRecord(responses[2])).toEqual(publicDetail);
        expect(responseRecord(responses[3])).toEqual(publicHandoff);
        expectPublic(responses);
    });

    it('returns the exact context-changed problem with an allowlisted current machine', async () => {
        selection.execute.mockRejectedValueOnce(
            Object.assign(
                new MachineApplicationError('MACHINE_CONTEXT_CHANGED', {
                    internalDetails: privateData,
                }),
                {
                    currentMachine: {
                        ...publicDetail,
                        machineRevision: '19',
                        status: 'SERVICE',
                        selectable: false,
                        ...privateData,
                    },
                },
            ),
        );

        const response = await authenticated(
            request(httpServer(app)).post(`/v1/machines/${MACHINE_ID}/selection-revalidation`),
        ).send({ expectedMachineRevision: '18' });
        const body = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(409);
        expect(body).toEqual({
            code: 'MACHINE_CONTEXT_CHANGED',
            message: 'Machine information changed. Review it before continuing.',
            retryable: false,
            correlationId: body.correlationId,
            currentMachine: {
                ...publicDetail,
                machineRevision: '19',
                status: 'SERVICE',
                selectable: false,
            },
        });
        expect(body.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
        expectPublic([response]);
    });

    it('returns the same safe problem envelope for errors across all four routes', async () => {
        discovery.execute.mockRejectedValueOnce(
            new MachineApplicationError('DISCOVERY_CONTEXT_STALE', { internalDetails: privateData }),
        );
        detail.execute.mockRejectedValueOnce(
            new MachineApplicationError('MACHINE_NOT_FOUND', { internalDetails: privateData }),
        );
        resolver.execute.mockRejectedValueOnce(
            new MachineApplicationError('MACHINE_CODE_INVALID', { internalDetails: privateData }),
        );
        selection.execute.mockRejectedValueOnce(new Error('sql private/topic credential secret'));

        const server = httpServer(app);
        const responses = await Promise.all([
            authenticated(request(server).get('/v1/machines')),
            authenticated(request(server).get(`/v1/machines/${MACHINE_ID}`)),
            authenticated(request(server).post('/v1/machines/resolve')).send({
                source: 'QR',
                value: 'kaynann://machine/v1/invalid',
            }),
            authenticated(request(server).post(`/v1/machines/${MACHINE_ID}/selection-revalidation`)).send({
                expectedMachineRevision: '18',
            }),
        ]);

        expect(responses.map(({ status }) => status)).toEqual([409, 404, 400, 503]);
        expectProblem(responses[0], 'DISCOVERY_CONTEXT_STALE', true);
        expectProblem(responses[1], 'MACHINE_NOT_FOUND', false);
        expectProblem(responses[2], 'MACHINE_CODE_INVALID', false);
        expectProblem(responses[3], 'DISCOVERY_TEMPORARILY_UNAVAILABLE', true);
        expect(responses.every(({ headers }) => /^application\/problem\+json/.test(headers['content-type']))).toBe(
            true,
        );
        expectPublic(responses);
    });
});

function responseSchemaRef(
    document: OpenAPIObject,
    path: string,
    method: OperationMethod,
    status: string,
): string | undefined {
    const operation = document.paths[path][method];
    const response = operation.responses[status];
    if (!response || '$ref' in response) return undefined;
    const media = response.content?.[status === '200' ? 'application/json' : 'application/problem+json'];
    const schema = media?.schema;
    return schema && '$ref' in schema ? schema.$ref : undefined;
}

function expectProblem(response: Response, code: string, retryable: boolean): void {
    const body = responseRecord(response);
    expect(Object.keys(body).sort()).toEqual(['code', 'correlationId', 'message', 'retryable']);
    expect(body).toMatchObject({ code, retryable });
    expect(body.message).toEqual(expect.any(String));
    expect(body.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
}

function expectPublic(responses: readonly Response[]): void {
    expect(JSON.stringify(responses.map((response) => response.body as unknown))).not.toMatch(FORBIDDEN_PUBLIC_DATA);
}
