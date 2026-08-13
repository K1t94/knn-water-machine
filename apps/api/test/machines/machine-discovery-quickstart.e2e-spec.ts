import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/testing/fixed-clock';
import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
import { RevalidateMachineSelectionService } from '../../src/machines/application/revalidate-machine-selection.service';
import type {
    LocatedMachineCatalogRecord,
    LocatedMachineCatalogQuery,
    MachineCatalogRecord,
    MachineCatalogQueryPage,
    MachineIdentifierLookup,
    MachineRepository,
    ServiceAreaMachineCatalogQuery,
} from '../../src/machines/application/ports/machine.repository';
import type {
    CatalogRevision,
    MachineIdentifierKind,
    MachineId,
    MachinePublicationState,
    MachineServiceMode,
} from '../../src/machines/domain/machine.types';
import { MachineAvailabilityProjector } from '../../src/machines/domain/availability-projector';
import { EmulatedMachineGateway } from '../../src/machines/infrastructure/emulated-machine-gateway';
import { CatalogOrderingRevisionMismatchError } from '../../src/machines/infrastructure/postgres/prisma-machine.repository';
import { SignedCatalogCursor } from '../../src/machines/infrastructure/signed-catalog-cursor';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
import { MachineSelectionController } from '../../src/machines/http/machine-selection.controller';
import { AccessSessionGuard } from '../../src/sessions/http/access-session.guard';
import { AccessTokenService } from '../../src/sessions/application/access-token.service';
import { SessionsRepository } from '../../src/sessions/infrastructure/postgres/sessions.repository';
import { httpServer } from '../http-test-helpers';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_ID = fixtureMachineId(0);
const SECONDARY_ID = fixtureMachineId(23);
const INVALID_PRICE_ID = fixtureMachineId(24);
const NO_COORDINATES_ID = fixtureMachineId(25);
const HIDDEN_ID = fixtureMachineId(26);
const ARCHIVED_ID = fixtureMachineId(27);
const DELETED_ID = fixtureMachineId(28);
const PAGE_LIMIT = 5;

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

interface FixtureIdentifier {
    readonly enabled: boolean;
    readonly kind: MachineIdentifierKind;
    readonly normalizedValue: string;
}

interface FixtureEvidence {
    readonly observedAt: Date;
    readonly reachable: boolean;
    readonly readyToSell: boolean;
    readonly salesAllowed: boolean;
    readonly state: 'READY' | 'OFFLINE' | 'UNKNOWN';
}

interface FixtureMachine extends Mutable<MachineCatalogRecord> {
    readonly identifiers: FixtureIdentifier[];
    serviceAreaCode: string;
}

interface RevisionAwareQuery {
    readonly catalogRevision?: CatalogRevision;
}

class InMemoryMachineRepository implements MachineRepository {
    private catalogRevision = 1;
    private failure: Error | undefined;

    constructor(private readonly machines: FixtureMachine[]) {}

    async getCatalogRevision(): Promise<CatalogRevision> {
        this.throwPendingFailure();
        return String(this.catalogRevision) as CatalogRevision;
    }

    async findLocated(query: LocatedMachineCatalogQuery): Promise<MachineCatalogQueryPage<LocatedMachineCatalogRecord>> {
        this.throwPendingFailure();
        this.assertRevision(query);

        const located = this.publiclyDiscoverable()
            .filter((machine) => insideViewport(machine, query.viewport))
            .map((machine) => ({
                ...catalogRecord(machine),
                coordinates: machine.coordinates!,
                distanceMeters: distanceMeters(query.position, machine.coordinates!),
            }))
            .sort(
                (left, right) =>
                    left.distanceMeters - right.distanceMeters || left.machineId.localeCompare(right.machineId),
            )
            .filter(
                (machine) =>
                    query.after === null ||
                    machine.distanceMeters > query.after.distanceMeters ||
                    (machine.distanceMeters === query.after.distanceMeters &&
                        machine.machineId.localeCompare(query.after.machineId) > 0),
            );

        return page(located, query.limit);
    }

    async findByServiceArea(
        query: ServiceAreaMachineCatalogQuery,
    ): Promise<MachineCatalogQueryPage<MachineCatalogRecord>> {
        this.throwPendingFailure();
        this.assertRevision(query);

        const machines = this.publiclyDiscoverable()
            .filter((machine) => machine.serviceAreaCode === query.serviceAreaCode)
            .filter((machine) => insideViewport(machine, query.viewport))
            .sort((left, right) => left.machineId.localeCompare(right.machineId))
            .filter((machine) => query.afterMachineId === null || machine.machineId > query.afterMachineId)
            .map(catalogRecord);

        return page(machines, query.limit);
    }

    async findPublicByMachineId(machineId: MachineId): Promise<MachineCatalogRecord | null> {
        this.throwPendingFailure();
        const machine = this.machines.find((candidate) => candidate.machineId === machineId);
        return machine !== undefined && isPublic(machine) ? catalogRecord(machine) : null;
    }

    async findPublicByIdentifier(lookup: MachineIdentifierLookup): Promise<MachineCatalogRecord | null> {
        this.throwPendingFailure();
        const matches = this.machines.filter(
            (machine) =>
                isPublic(machine) &&
                machine.identifiers.some(
                    (identifier) =>
                        identifier.enabled &&
                        identifier.kind === lookup.kind &&
                        identifier.normalizedValue === lookup.normalizedValue,
                ),
        );
        return matches.length === 1 ? catalogRecord(matches[0]!) : null;
    }

    all(): readonly FixtureMachine[] {
        return this.machines;
    }

    snapshot(): FixtureMachine[] {
        return structuredClone(this.machines);
    }

    setProjection(
        machineId: MachineId,
        projection: Partial<Pick<FixtureMachine, 'evidence' | 'price' | 'serviceMode'>>,
    ): void {
        Object.assign(this.required(machineId), projection);
    }

    changePrice(machineId: MachineId, amount: string): void {
        const machine = this.required(machineId);
        machine.price = { amountPerLiter: amount, currency: 'XOF' };
        machine.selectionRevision += 1n;
    }

    changePublication(machineId: MachineId, publicationState: MachinePublicationState): void {
        const machine = this.required(machineId);
        machine.publicationState = publicationState;
        machine.selectionRevision += 1n;
        this.catalogRevision += 1;
    }

    failNext(error: Error): void {
        this.failure = error;
    }

    private publiclyDiscoverable(): FixtureMachine[] {
        return this.machines.filter(
            (machine) => isPublic(machine) && machine.coordinates !== null && validCoordinates(machine.coordinates),
        );
    }

    private assertRevision(query: RevisionAwareQuery): void {
        if (query.catalogRevision !== undefined && query.catalogRevision !== String(this.catalogRevision)) {
            throw new CatalogOrderingRevisionMismatchError();
        }
    }

    private required(machineId: MachineId): FixtureMachine {
        const machine = this.machines.find((candidate) => candidate.machineId === machineId);
        if (machine === undefined) {
            throw new Error(`Fixture machine ${machineId} does not exist`);
        }
        return machine;
    }

    private throwPendingFailure(): void {
        if (this.failure === undefined) {
            return;
        }
        const failure = this.failure;
        this.failure = undefined;
        throw failure;
    }
}

describe('machine discovery controlled quickstart scenarios', () => {
    let app: INestApplication;
    let clock: FixedClock;
    let gateway: EmulatedMachineGateway;
    let repository: InMemoryMachineRepository;
    let sessions: { findActive: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        clock = new FixedClock(NOW);
        repository = new InMemoryMachineRepository(machineFixtures());
        gateway = new EmulatedMachineGateway(clock);
        for (const machine of repository.all()) {
            if (machine.evidence !== null) {
                gateway.setEvidence(machine.machineId, machine.evidence);
            }
        }

        const projector = new MachineAvailabilityProjector(clock, {
            allowedClockSkewSeconds: 5,
            freshnessSeconds: 60,
            supportedCurrencies: new Set(['XOF']),
        });
        const cursor = new SignedCatalogCursor(clock, {
            MACHINE_CURSOR_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
            MACHINE_CURSOR_TTL_SECONDS: 300,
        });
        const discovery = new DiscoverMachinesService(repository, projector, cursor);
        const detail = new GetMachineDetailService(repository, gateway, projector, clock);
        const resolver = new ResolveMachineIdentifierService(repository, detail, { legacyQrEnabled: false });
        const selection = new RevalidateMachineSelectionService(repository, gateway, projector, clock);
        const accessTokens = {
            validate: vi.fn().mockResolvedValue({
                aud: 'kaynann-mobile',
                exp: 2,
                iat: 1,
                iss: 'kaynann-api',
                jti: 'access-jti',
                sid: SESSION_ID,
                sub: USER_ID,
            }),
        };
        sessions = {
            findActive: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
        };

        const moduleRef = await Test.createTestingModule({
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

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                forbidNonWhitelisted: true,
                transform: true,
                whitelist: true,
            }),
        );
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('requires a current session and rejects malformed discovery inputs without leaking details', async () => {
        const server = httpServer(app);
        const unauthenticated = await Promise.all([
            request(server).get('/v1/machines'),
            request(server).get(`/v1/machines/${PRIMARY_ID}`),
            request(server).post('/v1/machines/resolve').send({ source: 'MANUAL', value: 'DKR-PLATEAU-01' }),
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: '1' }),
        ]);
        expect(unauthenticated.map((response) => response.status)).toEqual([401, 401, 401, 401]);

        const malformedRequests = [
            authenticated(request(server).get('/v1/machines').query({ latitude: 14.7 })),
            authenticated(request(server).get('/v1/machines').query({ north: 14.8, south: 14.6, east: -17.3 })),
            authenticated(request(server).get('/v1/machines').query({ latitude: 91, longitude: -17.4 })),
            authenticated(request(server).get('/v1/machines/not-a-machine-id')),
            authenticated(
                request(server)
                    .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                    .send({ expectedMachineRevision: '-1' }),
            ),
        ];
        const malformed = await Promise.all(malformedRequests);
        expect(malformed.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
        for (const response of malformed) {
            expect(JSON.stringify(response.body)).not.toMatch(/sql|stack|credential|evidence|publicationState/i);
        }

        sessions.findActive.mockResolvedValueOnce(null);
        const expired = await authenticated(request(server).get('/v1/machines')).expect(401);
        expect(expired.body).not.toHaveProperty('items');
    });

    it('paginates deterministically, refreshes projections, and invalidates only changed ordering contexts', async () => {
        const server = httpServer(app);
        const query = { latitude: 14.7167, limit: PAGE_LIMIT, longitude: -17.4677 };
        const first = await authenticated(request(server).get('/v1/machines').query(query)).expect(200);
        const repeat = await authenticated(request(server).get('/v1/machines').query(query)).expect(200);
        expect(repeat.body.items).toEqual(first.body.items);

        const items = [...first.body.items];
        let nextCursor: string | undefined = first.body.nextCursor;
        while (nextCursor !== undefined) {
            const next = await authenticated(
                request(server).get('/v1/machines').query({ ...query, cursor: nextCursor }),
            ).expect(200);
            items.push(...next.body.items);
            nextCursor = next.body.nextCursor;
        }

        expect(items).toHaveLength(25);
        expect(new Set(items.map((item) => item.machineId)).size).toBe(items.length);
        for (let index = 1; index < items.length; index += 1) {
            const previous = items[index - 1];
            const current = items[index];
            expect(
                current.distanceMeters > previous.distanceMeters ||
                    (current.distanceMeters === previous.distanceMeters && current.machineId > previous.machineId),
            ).toBe(true);
        }

        const originalCursor = first.body.nextCursor as string;
        repository.changePrice(PRIMARY_ID, '130.0700');
        repository.setProjection(PRIMARY_ID, { evidence: readyEvidence(NOW, 'OFFLINE') });
        const refreshed = await authenticated(request(server).get('/v1/machines').query(query)).expect(200);
        const refreshedPrimary = refreshed.body.items.find((item) => item.machineId === PRIMARY_ID);
        expect(refreshedPrimary).toMatchObject({
            status: 'OFFLINE',
            price: { amountPerLiter: '130.0700', currency: 'XOF' },
        });
        await authenticated(
            request(server).get('/v1/machines').query({ ...query, cursor: originalCursor }),
        ).expect(200);

        repository.changePublication(PRIMARY_ID, 'HIDDEN');
        const stale = await authenticated(
            request(server).get('/v1/machines').query({ ...query, cursor: originalCursor }),
        ).expect(409);
        expect(stale.body).toMatchObject({ code: 'DISCOVERY_CONTEXT_STALE', retryable: true });
    });

    it('preserves coordinates and exact money while enforcing service-area and viewport boundaries', async () => {
        const server = httpServer(app);
        const serviceArea = await authenticated(
            request(server).get('/v1/machines').query({ limit: 100 }),
        ).expect(200);
        expect(serviceArea.body.items).toHaveLength(25);
        expect(serviceArea.body.items.map((item) => item.machineId)).toEqual(
            [...serviceArea.body.items.map((item) => item.machineId)].sort(),
        );
        expect(serviceArea.body.items.every((item) => item.distanceMeters === undefined)).toBe(true);

        const primary = serviceArea.body.items.find((item) => item.machineId === PRIMARY_ID);
        expect(primary).toMatchObject({
            coordinates: { latitude: 14.7167, longitude: -17.4677 },
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
        });

        const viewport = { east: -17.46, north: 14.72, south: 14.71, west: -17.48 };
        const bounded = await authenticated(request(server).get('/v1/machines').query({ ...viewport, limit: 100 })).expect(
            200,
        );
        expect(bounded.body.items.length).toBeGreaterThan(0);
        expect(bounded.body.items.some((item) => item.machineId === NO_COORDINATES_ID)).toBe(false);
        for (const item of bounded.body.items) {
            expect(item.coordinates.latitude).toBeGreaterThanOrEqual(viewport.south);
            expect(item.coordinates.latitude).toBeLessThanOrEqual(viewport.north);
            expect(item.coordinates.longitude).toBeGreaterThanOrEqual(viewport.west);
            expect(item.coordinates.longitude).toBeLessThanOrEqual(viewport.east);
        }
    });

    it('projects readiness, service, stale, future, and invalid evidence without persisting freshness changes', async () => {
        const server = httpServer(app);
        const cases: Array<{
            evidence: FixtureEvidence | null;
            expected: 'ONLINE' | 'OFFLINE' | 'SERVICE';
            price?: MachineCatalogRecord['price'];
            serviceMode?: MachineServiceMode;
        }> = [
            { evidence: readyEvidence(NOW), expected: 'ONLINE' },
            { evidence: readyEvidence(new Date(NOW.getTime() - 60_000)), expected: 'ONLINE' },
            { evidence: readyEvidence(new Date(NOW.getTime() - 60_001)), expected: 'OFFLINE' },
            { evidence: readyEvidence(new Date(NOW.getTime() + 5_000)), expected: 'ONLINE' },
            { evidence: readyEvidence(new Date(NOW.getTime() + 5_001)), expected: 'OFFLINE' },
            { evidence: readyEvidence(NOW, 'OFFLINE'), expected: 'OFFLINE' },
            { evidence: readyEvidence(NOW, 'UNKNOWN'), expected: 'OFFLINE' },
            { evidence: null, expected: 'OFFLINE' },
            { evidence: readyEvidence(NOW), expected: 'SERVICE', serviceMode: 'SERVICE' },
            {
                evidence: readyEvidence(NOW),
                expected: 'OFFLINE',
                price: { amountPerLiter: 'NaN', currency: 'XOF' },
            },
            {
                evidence: readyEvidence(NOW),
                expected: 'OFFLINE',
                price: { amountPerLiter: '125.0000', currency: 'USD' },
            },
        ];

        for (const scenario of cases) {
            repository.setProjection(PRIMARY_ID, {
                evidence: scenario.evidence,
                price: scenario.price ?? { amountPerLiter: '125.0700', currency: 'XOF' },
                serviceMode: scenario.serviceMode ?? 'NORMAL',
            });
            gateway.setEvidence(PRIMARY_ID, scenario.evidence);
            const detail = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
            expect(detail.body.status).toBe(scenario.expected);
            expect(detail.body.selectable).toBe(scenario.expected === 'ONLINE');
        }

        const evidence = readyEvidence(NOW);
        repository.setProjection(PRIMARY_ID, {
            evidence,
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
            serviceMode: 'NORMAL',
        });
        gateway.setEvidence(PRIMARY_ID, evidence);
        const online = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
        const before = repository.snapshot();
        clock.advance(60_001);
        const stale = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
        expect(stale.body).toMatchObject({ status: 'OFFLINE', selectable: false });
        await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: online.body.machineRevision }),
        ).expect(422);
        expect(repository.snapshot()).toEqual(before);
    });

    it('resolves exact current identifiers and makes unsafe, disabled, ambiguous, and hidden identifiers indistinguishable', async () => {
        const server = httpServer(app);
        const qr = await authenticated(
            request(server)
                .post('/v1/machines/resolve')
                .send({ source: 'QR', value: `kaynann://machine/v1/${PRIMARY_ID}` }),
        ).expect(200);
        const manual = await authenticated(
            request(server).post('/v1/machines/resolve').send({ source: 'MANUAL', value: '  dkr-plateau-01  ' }),
        ).expect(200);
        expect(qr.body).toEqual(manual.body);

        const invalid = [
            { source: 'QR', value: 'https://payments.example/collect?machine=secret' },
            { source: 'QR', value: `kaynann://v2/machine/${PRIMARY_ID}` },
            { source: 'MANUAL', value: 'DKR‐PLATEAU‐01' },
        ];
        for (const input of invalid) {
            const response = await authenticated(request(server).post('/v1/machines/resolve').send(input)).expect(400);
            expect(JSON.stringify(response.body)).not.toMatch(/secret|mapping|identifier|publication|deleted/i);
        }

        const unavailableValues = [
            'DKR-PLATEAU-0',
            'DKR-UNKNOWN-01',
            'DKR-DISABLED-01',
            'DKR-AMBIGUOUS-01',
            'DKR-HIDDEN-01',
            'DKR-ARCHIVED-01',
            'DKR-DELETED-01',
        ];
        const unavailable = [];
        for (const value of unavailableValues) {
            unavailable.push(
                await authenticated(
                    request(server).post('/v1/machines/resolve').send({ source: 'MANUAL', value }),
                ).expect(404),
            );
        }
        expect(unavailable.map((response) => publicProblem(response.body))).toEqual(
            unavailable.map(() => ({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found.', retryable: false })),
        );

        const legacy = await authenticated(
            request(server).post('/v1/machines/resolve').send({ source: 'QR', value: `machine:${PRIMARY_ID}` }),
        ).expect(400);
        expect(legacy.body.code).toBe('MACHINE_CODE_INVALID');
    });

    it('returns fresh detail and prevents changed, unavailable, hidden, or deleted selections from advancing', async () => {
        const server = httpServer(app);
        const detail = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
        const before = repository.snapshot();
        const selected = await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: detail.body.machineRevision }),
        ).expect(200);
        expect(selected.body).toMatchObject({
            availability: 'ONLINE',
            machineId: PRIMARY_ID,
            price: { amountPerLiter: '125.0700', currency: 'XOF' },
        });
        expect(repository.snapshot()).toEqual(before);

        repository.changePrice(PRIMARY_ID, '140.0000');
        const changed = await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: detail.body.machineRevision }),
        ).expect(409);
        expect(changed.body).toMatchObject({
            code: 'MACHINE_CONTEXT_CHANGED',
            currentMachine: { price: { amountPerLiter: '140.0000', currency: 'XOF' } },
        });
        expect(changed.body).not.toHaveProperty('validatedAt');

        const refreshed = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
        const offlineEvidence = readyEvidence(NOW, 'OFFLINE');
        repository.setProjection(PRIMARY_ID, { evidence: offlineEvidence });
        gateway.setEvidence(PRIMARY_ID, offlineEvidence);
        const offline = await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: refreshed.body.machineRevision }),
        ).expect(422);
        expect(offline.body).not.toHaveProperty('validatedAt');

        repository.changePublication(PRIMARY_ID, 'HIDDEN');
        await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(404);
        await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: refreshed.body.machineRevision }),
        ).expect(404);
        await authenticated(request(server).get(`/v1/machines/${DELETED_ID}`)).expect(404);
        await authenticated(
            request(server)
                .post(`/v1/machines/${DELETED_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: '1' }),
        ).expect(404);
    });

    it('rejects cursor tampering and context reuse, maps dependency failures safely, and creates no side effects', async () => {
        const server = httpServer(app);
        const query = { latitude: 14.7167, limit: PAGE_LIMIT, longitude: -17.4677 };
        const first = await authenticated(request(server).get('/v1/machines').query(query)).expect(200);
        const cursor = first.body.nextCursor as string;

        const tamperedCursor = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`;
        const tampered = await authenticated(
            request(server).get('/v1/machines').query({ ...query, cursor: tamperedCursor }),
        ).expect(400);
        expect(tampered.body.code).toBe('VALIDATION_ERROR');
        const reused = await authenticated(
            request(server).get('/v1/machines').query({ cursor, latitude: 14.8, limit: PAGE_LIMIT, longitude: -17.4 }),
        ).expect(400);
        expect(reused.body.code).toBe('VALIDATION_ERROR');

        repository.failNext(new Error('postgresql://private-user:private-password@database/internal'));
        const dependencyFailure = await authenticated(request(server).get('/v1/machines')).expect(503);
        expect(dependencyFailure.body).toMatchObject({
            code: 'DISCOVERY_TEMPORARILY_UNAVAILABLE',
            retryable: true,
        });
        expect(JSON.stringify(dependencyFailure.body)).not.toMatch(/postgres|private|database|stack/i);

        const detail = await authenticated(request(server).get(`/v1/machines/${PRIMARY_ID}`)).expect(200);
        const before = repository.snapshot();
        const firstSelection = await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: detail.body.machineRevision }),
        ).expect(200);
        const retrySelection = await authenticated(
            request(server)
                .post(`/v1/machines/${PRIMARY_ID}/selection-revalidation`)
                .send({ expectedMachineRevision: detail.body.machineRevision }),
        ).expect(200);
        expect(retrySelection.body).toEqual(firstSelection.body);
        expect(repository.snapshot()).toEqual(before);
        expect(JSON.stringify(firstSelection.body)).not.toMatch(
            /purchase|reservation|wallet|dispens|mqtt|topic|credential|identifier|publication|deleted|evidence/i,
        );
    });
});

function fixtureMachineId(index: number): MachineId {
    return `M${String(index).padStart(21, '0')}` as MachineId;
}

function readyEvidence(
    observedAt: Date,
    state: FixtureEvidence['state'] = 'READY',
): FixtureEvidence {
    return {
        observedAt,
        reachable: state === 'READY',
        readyToSell: state === 'READY',
        salesAllowed: state === 'READY',
        state,
    };
}

function machineFixtures(): FixtureMachine[] {
    const generated = Array.from({ length: 22 }, (_, index) =>
        machineFixture(fixtureMachineId(index + 1), {
            coordinates: { latitude: 14.701 + index * 0.001, longitude: -17.45 + index * 0.0005 },
            displayName: `Point d'eau ${String(index + 1).padStart(2, '0')}`,
        }),
    );

    return [
        machineFixture(PRIMARY_ID, {
            address: 'Avenue Georges Pompidou, Dakar',
            coordinates: { latitude: 14.7167, longitude: -17.4677 },
            displayName: 'Point d\'eau Plateau',
            identifiers: [
                { enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-PLATEAU-01' },
                { enabled: false, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-DISABLED-01' },
            ],
        }),
        ...generated,
        machineFixture(SECONDARY_ID, {
            coordinates: { latitude: 14.7167, longitude: -17.4677 },
            identifiers: [{ enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-AMBIGUOUS-01' }],
        }),
        machineFixture(INVALID_PRICE_ID, {
            identifiers: [{ enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-AMBIGUOUS-01' }],
            price: { amountPerLiter: 'invalid', currency: 'XOF' },
        }),
        machineFixture(NO_COORDINATES_ID, { coordinates: null }),
        machineFixture(HIDDEN_ID, {
            identifiers: [{ enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-HIDDEN-01' }],
            publicationState: 'HIDDEN',
        }),
        machineFixture(ARCHIVED_ID, {
            identifiers: [{ enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-ARCHIVED-01' }],
            publicationState: 'ARCHIVED',
        }),
        machineFixture(DELETED_ID, {
            deletedAt: new Date('2026-08-01T00:00:00.000Z'),
            identifiers: [{ enabled: true, kind: 'CURRENT_MANUAL', normalizedValue: 'DKR-DELETED-01' }],
        }),
    ];
}

function machineFixture(
    machineId: MachineId,
    overrides: Partial<FixtureMachine> = {},
): FixtureMachine {
    return {
        address: 'Dakar, Senegal',
        coordinates: { latitude: 14.74, longitude: -17.42 },
        deletedAt: null,
        displayName: `Point d'eau ${machineId.slice(-2)}`,
        evidence: readyEvidence(NOW),
        identifiers: [],
        machineId,
        price: { amountPerLiter: '125.0700', currency: 'XOF' },
        publicationState: 'PUBLISHED',
        selectionRevision: 1n,
        serviceAreaCode: 'DKR-CENTRE',
        serviceMode: 'NORMAL',
        ...overrides,
    };
}

function catalogRecord(machine: FixtureMachine): MachineCatalogRecord {
    return {
        address: machine.address,
        coordinates: machine.coordinates,
        deletedAt: machine.deletedAt,
        displayName: machine.displayName,
        evidence: machine.evidence,
        machineId: machine.machineId,
        price: machine.price,
        publicationState: machine.publicationState,
        selectionRevision: machine.selectionRevision,
        serviceMode: machine.serviceMode,
    };
}

function isPublic(machine: FixtureMachine): boolean {
    return machine.publicationState === 'PUBLISHED' && machine.deletedAt === null;
}

function validCoordinates(coordinates: NonNullable<MachineCatalogRecord['coordinates']>): boolean {
    return (
        Number.isFinite(coordinates.latitude) &&
        Number.isFinite(coordinates.longitude) &&
        coordinates.latitude >= -90 &&
        coordinates.latitude <= 90 &&
        coordinates.longitude >= -180 &&
        coordinates.longitude <= 180
    );
}

function insideViewport(
    machine: FixtureMachine,
    viewport: LocatedMachineCatalogQuery['viewport'],
): boolean {
    if (viewport === null || machine.coordinates === null) {
        return true;
    }
    return (
        machine.coordinates.latitude >= viewport.south &&
        machine.coordinates.latitude <= viewport.north &&
        machine.coordinates.longitude >= viewport.west &&
        machine.coordinates.longitude <= viewport.east
    );
}

function distanceMeters(
    origin: LocatedMachineCatalogQuery['position'],
    target: NonNullable<MachineCatalogRecord['coordinates']>,
): number {
    const latitudeDelta = radians(target.latitude - origin.latitude);
    const longitudeDelta = radians(target.longitude - origin.longitude);
    const originLatitude = radians(origin.latitude);
    const targetLatitude = radians(target.latitude);
    const haversine =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(originLatitude) * Math.cos(targetLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

function radians(value: number): number {
    return (value * Math.PI) / 180;
}

function page<T extends MachineCatalogRecord>(items: T[], limit: number): MachineCatalogQueryPage<T> {
    return {
        hasMore: items.length > limit,
        items: items.slice(0, limit),
    };
}

function authenticated<T extends request.Test>(pending: T): T {
    return pending.set('authorization', 'Bearer access-token');
}

function publicProblem(body: Record<string, unknown>): Record<string, unknown> {
    const { correlationId: _correlationId, ...problem } = body;
    return problem;
}
