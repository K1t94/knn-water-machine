import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { MachineApplicationError } from '../../src/machines/application/machine-application.error';
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
// T083 supplies this runtime token; its absence is the intended RED state.
// eslint-disable-next-line import/no-unresolved
import { RevalidateMachineSelectionService } from '../../src/machines/application/revalidate-machine-selection.service';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
// T085 supplies this controller; its absence is the intended RED state.
// eslint-disable-next-line import/no-unresolved
import { MachineSelectionController } from '../../src/machines/http/machine-selection.controller';
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
    machineRevision: '18',
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

const internalFields =
    /internalId|machineInternalId|identifier|mapping|publicationState|deletedAt|selectionRevision|evidence|topic|credential|serviceAreaCode/i;

type OpenApiOperation = {
    parameters?: Array<{ name?: string }>;
    requestBody?: unknown;
    responses?: Record<string, unknown>;
    security?: Array<Record<string, unknown>>;
};

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1' && databaseUrl !== undefined;
const databaseTest = runPostgres ? it : it.skip;
const prisma = runPostgres ? new PrismaClient({ datasourceUrl: databaseUrl }) : null;

describe('machine detail and selection HTTP contract', () => {
    let app: INestApplication;
    const discovery = { execute: vi.fn() };
    const detail = { execute: vi.fn<(machineId: string) => Promise<unknown>>() };
    const resolver = { execute: vi.fn() };
    const selection = {
        execute: vi.fn<(machineId: string, expectedMachineRevision: string) => Promise<unknown>>(),
    };
    const accessTokens = { validate: vi.fn() };
    const sessions = { findActive: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        detail.execute.mockResolvedValue(publicDetail);
        selection.execute.mockResolvedValue(publicHandoff);
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
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    afterAll(async () => prisma?.$disconnect());

    function authenticated<T extends request.Test>(pending: T): T {
        return pending.set('authorization', 'Bearer access-token');
    }

    function getDetail(machineId = MACHINE_ID): request.Test {
        return authenticated(request(httpServer(app)).get(`/v1/machines/${machineId}`));
    }

    function revalidate(body: unknown, machineId = MACHINE_ID): request.Test {
        return authenticated(
            request(httpServer(app)).post(`/v1/machines/${machineId}/selection-revalidation`).send(body),
        );
    }

    it('requires a current access session for detail refresh and selection revalidation', async () => {
        const machine = await request(httpServer(app)).get(`/v1/machines/${MACHINE_ID}`);
        const confirmation = await request(httpServer(app))
            .post(`/v1/machines/${MACHINE_ID}/selection-revalidation`)
            .send({ expectedMachineRevision: '18' });

        expect([machine.status, confirmation.status]).toEqual([401, 401]);
        expect(detail.execute).not.toHaveBeenCalled();
        expect(selection.execute).not.toHaveBeenCalled();
    });

    it('publishes both authenticated operations and their response contracts in OpenAPI', () => {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'AccessBearer').build(),
        );
        const machine = document.paths['/v1/machines/{machineId}'].get as OpenApiOperation | undefined;
        const confirmation = document.paths['/v1/machines/{machineId}/selection-revalidation'].post as
            OpenApiOperation | undefined;

        expect(machine?.security).toContainEqual({ AccessBearer: [] });
        expect(confirmation?.security).toContainEqual({ AccessBearer: [] });
        expect(machine?.parameters?.map(({ name }) => name)).toEqual(
            expect.arrayContaining(['machineId', 'latitude', 'longitude']),
        );
        expect(confirmation?.parameters?.map(({ name }) => name)).toContain('machineId');
        expect(confirmation?.requestBody).toBeDefined();
        expect(Object.keys(machine?.responses ?? {})).toEqual(
            expect.arrayContaining(['200', '400', '401', '404', '503']),
        );
        expect(Object.keys(confirmation?.responses ?? {})).toEqual(
            expect.arrayContaining(['200', '400', '401', '404', '409', '422', '503']),
        );
    });

    it.each(['short', '++++++++++++++++++++++', `${MACHINE_ID}x`])(
        'rejects an invalid public machine ID before application services: %s',
        async (machineId) => {
            const machine = await getDetail(machineId);
            const confirmation = await revalidate({ expectedMachineRevision: '18' }, machineId);

            expect([machine.status, confirmation.status]).toEqual([400, 400]);
            expect(detail.execute).not.toHaveBeenCalled();
            expect(selection.execute).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['missing body', undefined],
        ['missing revision', {}],
        ['zero revision', { expectedMachineRevision: '0' }],
        ['leading zero', { expectedMachineRevision: '018' }],
        ['non-numeric revision', { expectedMachineRevision: 'current' }],
        ['numeric revision', { expectedMachineRevision: 18 }],
        ['unexpected field', { expectedMachineRevision: '18', machineInternalId: 'private' }],
    ])('rejects invalid expected revision at the HTTP boundary: %s', async (_case, body) => {
        const response = await revalidate(body);

        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(selection.execute).not.toHaveBeenCalled();
    });

    it('returns each freshly refreshed public detail and hides publication state changes', async () => {
        detail.execute
            .mockResolvedValueOnce({
                ...publicDetail,
                machineInternalId: 'private-machine-uuid',
                selectionRevision: 18n,
                evidence: { topic: 'private/topic', credential: 'secret' },
            })
            .mockResolvedValueOnce({
                ...publicDetail,
                price: { amountPerLiter: '140.250000', currency: 'XOF' },
                status: 'SERVICE',
                machineRevision: '19',
                selectable: false,
                refreshedAt: '2026-08-15T12:00:05.000Z',
                publicationState: 'PUBLISHED',
            })
            .mockRejectedValueOnce(
                new MachineApplicationError('MACHINE_NOT_FOUND', {
                    internalDetails: { publicationState: 'HIDDEN', deletedAt: null },
                }),
            );

        const initial = await getDetail();
        const changed = await getDetail();
        const hidden = await getDetail();

        expect(initial.status, JSON.stringify(initial.body)).toBe(200);
        expect(initial.body).toEqual(publicDetail);
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
        expect(changed.body).toEqual({
            ...publicDetail,
            price: { amountPerLiter: '140.250000', currency: 'XOF' },
            status: 'SERVICE',
            machineRevision: '19',
            selectable: false,
            refreshedAt: '2026-08-15T12:00:05.000Z',
        });
        expect(hidden.status, JSON.stringify(hidden.body)).toBe(404);
        expect(JSON.stringify([initial.body, changed.body, hidden.body])).not.toMatch(internalFields);
        expect(detail.execute).toHaveBeenCalledTimes(3);
    });

    it('returns only an ephemeral ONLINE handoff for a current revision', async () => {
        selection.execute.mockResolvedValueOnce({
            ...publicHandoff,
            machineInternalId: 'private-machine-uuid',
            selectionRevision: 18n,
            evidence: { topic: 'private/topic' },
        });

        const response = await revalidate({ expectedMachineRevision: '18' });

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual(publicHandoff);
        expect(JSON.stringify(response.body)).not.toMatch(internalFields);
        expect(selection.execute).toHaveBeenCalledExactlyOnceWith(MACHINE_ID, '18');
    });

    it('returns a fresh allowlisted card when selection context changed', async () => {
        const changedDetail = {
            ...publicDetail,
            price: { amountPerLiter: '140.250000', currency: 'XOF' },
            machineRevision: '19',
            refreshedAt: '2026-08-15T12:00:05.000Z',
        };
        selection.execute.mockRejectedValueOnce(
            Object.assign(
                new MachineApplicationError('MACHINE_CONTEXT_CHANGED', {
                    internalDetails: { selectionRevision: 19n, evidence: { topic: 'private/topic' } },
                }),
                {
                    currentMachine: {
                        ...changedDetail,
                        machineInternalId: 'private-machine-uuid',
                        publicationState: 'PUBLISHED',
                    },
                },
            ),
        );

        const response = await revalidate({ expectedMachineRevision: '18' });
        const problem = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(409);
        expect(problem).toEqual({
            code: 'MACHINE_CONTEXT_CHANGED',
            message: 'Machine information changed. Review it before continuing.',
            retryable: false,
            correlationId: problem.correlationId,
            currentMachine: changedDetail,
        });
        expect(problem.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(JSON.stringify(response.body)).not.toMatch(internalFields);
    });

    it.each([
        ['hidden machine', 'MACHINE_NOT_FOUND', 404, false],
        ['non-selectable machine', 'MACHINE_NOT_SELECTABLE', 422, false],
        ['gateway failure', 'DISCOVERY_TEMPORARILY_UNAVAILABLE', 503, true],
    ] as const)('returns a safe %s problem', async (_case, code, status, retryable) => {
        selection.execute.mockRejectedValueOnce(
            new MachineApplicationError(code, {
                internalDetails: { publicationState: 'HIDDEN', sql: 'P2024', topic: 'private/topic' },
            }),
        );

        const response = await revalidate({ expectedMachineRevision: '18' });
        const problem = responseRecord(response);

        expect(response.status, JSON.stringify(response.body)).toBe(status);
        expect(problem).toEqual({
            code,
            message:
                code === 'MACHINE_NOT_FOUND'
                    ? 'Machine not found.'
                    : code === 'MACHINE_NOT_SELECTABLE'
                      ? 'This machine is not currently available for selection.'
                      : 'Machine information is temporarily unavailable.',
            retryable,
            correlationId: problem.correlationId,
        });
        expect(problem.correlationId).toEqual(expect.stringMatching(CORRELATION_ID_PATTERN));
        expect(JSON.stringify(response.body)).not.toMatch(/HIDDEN|P2024|private\/topic|sql|stack/i);
    });

    databaseTest('does not change machine, session, or wallet database row counts', async () => {
        if (prisma === null) throw new Error('PostgreSQL test was enabled without a client');
        const before = await databaseRowCounts(prisma);

        const response = await revalidate({ expectedMachineRevision: '18' });

        expect(response.status, JSON.stringify(response.body)).toBe(200);
        await expect(databaseRowCounts(prisma)).resolves.toEqual(before);
    });
});

async function databaseRowCounts(database: PrismaClient): Promise<readonly number[]> {
    return Promise.all([
        database.machine.count(),
        database.machineLocation.count(),
        database.machinePrice.count(),
        database.machineIdentifierMapping.count(),
        database.machineAvailabilityEvidence.count(),
        database.machineCatalogState.count(),
        database.userSession.count(),
        database.walletLedgerEntry.count(),
    ]);
}
