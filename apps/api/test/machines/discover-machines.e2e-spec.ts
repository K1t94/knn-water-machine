import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { MachineApplicationError } from '../../src/machines/application/machine-application.error';
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
import { MACHINE_DISCOVERY_CONFIG } from '../../src/machines/machines.module';
import { AccessTokenService } from '../../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../../src/sessions/infrastructure/postgres/sessions.repository';
import { httpServer, responseRecord } from '../http-test-helpers';

import type { INestApplication } from '@nestjs/common';

const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const SECOND_MACHINE_ID = 'BcDeFgHiJkLmNoPqRsTuVw';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const serviceArea = {
    north: 14.9,
    east: -17.2,
    south: 14.5,
    west: -17.7,
};

const publicSummary = {
    machineId: MACHINE_ID,
    displayName: 'Fontaine Plateau',
    address: '12 Rue de Dakar',
    coordinates: { latitude: 14.7167, longitude: -17.4677 },
    distanceMeters: 1250,
    price: { amountPerLiter: '125.0700', currency: 'XOF' },
    status: 'ONLINE',
    machineRevision: '17',
};

const internalFields = /internalId|machineInternalId|serviceAreaCode|selectionRevision|evidence|topic|credential/i;

type OpenApiOperation = {
    parameters?: Array<{ name?: string }>;
    responses?: Record<string, unknown>;
    security?: Array<Record<string, unknown>>;
};

type DiscoveryInput = {
    context: Record<string, unknown>;
    limit: number;
    cursor: string | null;
};

describe('machine discovery HTTP contract', () => {
    let app: INestApplication;
    const discovery = { execute: vi.fn<(input: DiscoveryInput) => Promise<unknown>>() };
    const detail = { execute: vi.fn<(machineId: string) => Promise<unknown>>() };
    const resolver = { execute: vi.fn() };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        discovery.execute.mockResolvedValue({
            items: [],
            hasMore: false,
            catalogRevision: '41',
        });
        detail.execute.mockResolvedValue({
            ...publicSummary,
            selectable: true,
            refreshedAt: '2026-08-15T12:00:00.000Z',
        });
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
                { provide: ResolveMachineIdentifierService, useValue: resolver },
                { provide: AccessTokenService, useValue: accessTokens },
                { provide: SessionsRepository, useValue: sessions },
                {
                    provide: MACHINE_DISCOVERY_CONFIG,
                    useValue: { serviceArea },
                },
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

    it('requires a current access session for catalog and detail reads', async () => {
        const catalog = await request(httpServer(app)).get('/v1/machines');
        const machine = await request(httpServer(app)).get(`/v1/machines/${MACHINE_ID}`);

        expect([catalog.status, machine.status]).toEqual([401, 401]);
        expect(discovery.execute).not.toHaveBeenCalled();
        expect(detail.execute).not.toHaveBeenCalled();
    });

    it('publishes both authenticated read operations in OpenAPI', () => {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'AccessBearer').build(),
        );
        const catalog = document.paths['/v1/machines'].get as OpenApiOperation | undefined;
        const machine = document.paths['/v1/machines/{machineId}'].get as OpenApiOperation | undefined;

        expect(catalog?.security).toContainEqual({ AccessBearer: [] });
        expect(machine?.security).toContainEqual({ AccessBearer: [] });
        expect(catalog?.parameters?.map(({ name }) => name)).toEqual(
            expect.arrayContaining(['limit', 'cursor', 'latitude', 'longitude', 'north', 'east', 'south', 'west']),
        );
        expect(machine?.parameters?.map(({ name }) => name)).toEqual(
            expect.arrayContaining(['machineId', 'latitude', 'longitude']),
        );
        expect(Object.keys(catalog?.responses ?? {})).toEqual(
            expect.arrayContaining(['200', '400', '401', '409', '503']),
        );
        expect(Object.keys(machine?.responses ?? {})).toEqual(
            expect.arrayContaining(['200', '400', '401', '404', '503']),
        );
    });

    it('discovers by location and returns only allowlisted summary fields', async () => {
        discovery.execute.mockResolvedValueOnce({
            items: [
                {
                    ...publicSummary,
                    internalId: 'internal-machine-uuid',
                    serviceAreaCode: 'DKR-CENTRE',
                    selectionRevision: 17n,
                    evidence: { topic: 'private/topic', credential: 'secret' },
                },
            ],
            hasMore: false,
            catalogRevision: '41',
        });

        const response = await authenticated(
            request(httpServer(app)).get('/v1/machines').query({
                latitude: 14.7167,
                longitude: -17.4677,
                limit: 20,
            }),
        );

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({
            items: [publicSummary],
            hasMore: false,
            catalogRevision: '41',
        });
        expect(JSON.stringify(response.body)).not.toMatch(internalFields);
        expect(discovery.execute).toHaveBeenCalledExactlyOnceWith({
            context: {
                mode: 'USER_LOCATION',
                position: { latitude: 14.7167, longitude: -17.4677 },
                viewport: null,
            },
            limit: 20,
            cursor: null,
        });
    });

    it('uses a complete viewport without persisting or returning request coordinates', async () => {
        const viewport = { north: 14.8, east: -17.3, south: 14.6, west: -17.6 };

        const response = await authenticated(request(httpServer(app)).get('/v1/machines').query(viewport));
        const input = discovery.execute.mock.calls[0]?.[0];

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(input.context).toEqual(expect.objectContaining({ viewport }));
        expect(JSON.stringify(response.body)).not.toMatch(/latitude|longitude/);
    });

    it('falls back to the configured service area when location is absent', async () => {
        const response = await authenticated(request(httpServer(app)).get('/v1/machines'));
        const input = discovery.execute.mock.calls[0]?.[0];

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({ items: [], hasMore: false, catalogRevision: '41' });
        expect(input).toMatchObject({ limit: 20, cursor: null });
        expect(input.context).toEqual(expect.objectContaining({ mode: 'SERVICE_AREA', viewport: null }));
    });

    it('forwards an opaque continuation cursor and exposes the next page contract', async () => {
        discovery.execute.mockResolvedValueOnce({
            items: [{ ...publicSummary, machineId: SECOND_MACHINE_ID, distanceMeters: 2400 }],
            nextCursor: 'signed-next-cursor',
            hasMore: true,
            catalogRevision: '41',
        });

        const response = await authenticated(
            request(httpServer(app)).get('/v1/machines').query({
                latitude: 14.7167,
                longitude: -17.4677,
                limit: 1,
                cursor: 'signed-current-cursor',
            }),
        );

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual(
            expect.objectContaining({ nextCursor: 'signed-next-cursor', hasMore: true, catalogRevision: '41' }),
        );
        expect(discovery.execute).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ limit: 1, cursor: 'signed-current-cursor' }),
        );
    });

    it('opens the same fresh public detail from marker and list actions', async () => {
        detail.execute.mockResolvedValue({
            ...publicSummary,
            selectable: true,
            refreshedAt: '2026-08-15T12:00:00.000Z',
            machineInternalId: 'internal-machine-uuid',
            selectionRevision: 17n,
            evidence: { topic: 'private/topic' },
        });

        const marker = await authenticated(
            request(httpServer(app))
                .get(`/v1/machines/${MACHINE_ID}`)
                .query({ latitude: 14.7167, longitude: -17.4677 }),
        );
        const list = await authenticated(request(httpServer(app)).get(`/v1/machines/${MACHINE_ID}`));

        for (const response of [marker, list]) {
            expect(response.status, JSON.stringify(response.body)).toBe(200);
            expect(response.body).toEqual({
                ...publicSummary,
                selectable: true,
                refreshedAt: '2026-08-15T12:00:00.000Z',
            });
            expect(JSON.stringify(response.body)).not.toMatch(internalFields);
        }
        expect(detail.execute).toHaveBeenCalledTimes(2);
        expect(detail.execute).toHaveBeenNthCalledWith(1, MACHINE_ID);
        expect(detail.execute).toHaveBeenNthCalledWith(2, MACHINE_ID);
    });

    it('rejects incomplete coordinates before calling application services', async () => {
        const catalog = await authenticated(request(httpServer(app)).get('/v1/machines').query({ latitude: 14.7167 }));
        const machine = await authenticated(
            request(httpServer(app)).get(`/v1/machines/${MACHINE_ID}`).query({ longitude: -17.4677 }),
        );

        expect([catalog.status, machine.status]).toEqual([400, 400]);
        expect(discovery.execute).not.toHaveBeenCalled();
        expect(detail.execute).not.toHaveBeenCalled();
    });

    it.each([
        ['stale cursor', 'DISCOVERY_CONTEXT_STALE', 409, true],
        ['catalog dependency failure', 'DISCOVERY_TEMPORARILY_UNAVAILABLE', 503, true],
    ] as const)('returns a safe %s error', async (_case, code, status, retryable) => {
        discovery.execute.mockRejectedValueOnce(
            new MachineApplicationError(code, {
                internalDetails: { sql: 'P2024 Machine_internalId_idx', topic: 'private/topic' },
            }),
        );

        const response = await authenticated(request(httpServer(app)).get('/v1/machines'));
        const body = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(status);
        expect(body).toEqual({
            code,
            message:
                code === 'DISCOVERY_CONTEXT_STALE'
                    ? 'The machine list changed. Refresh to continue.'
                    : 'Machine information is temporarily unavailable.',
            retryable,
            correlationId: body.correlationId,
        });
        expect(body.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(JSON.stringify(response.body)).not.toMatch(/P2024|internalId|private\/topic|sql|stack/i);
    });

    it('returns uniform safe not-found detail without revealing catalog state', async () => {
        detail.execute.mockRejectedValueOnce(
            new MachineApplicationError('MACHINE_NOT_FOUND', {
                internalDetails: { publicationState: 'HIDDEN', deletedAt: '2026-08-15T12:00:00.000Z' },
            }),
        );

        const response = await authenticated(request(httpServer(app)).get(`/v1/machines/${MACHINE_ID}`));

        expect(response.status, JSON.stringify(response.body)).toBe(404);
        const body = responseRecord(response);
        expect(body).toEqual({
            code: 'MACHINE_NOT_FOUND',
            message: 'Machine not found.',
            retryable: false,
            correlationId: body.correlationId,
        });
        expect(body.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(JSON.stringify(response.body)).not.toMatch(/HIDDEN|deletedAt|publicationState|stack/i);
    });
});
