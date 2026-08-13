import { Body, Controller, Headers, HttpCode, Inject, Module, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../../src/app.module';
import { RedactedExceptionFilter } from '../../../src/common/redacted-exception.filter';
import { SecurityModule } from '../../../src/common/security/security.module';
import { FixedClock } from '../../../src/common/testing/fixed-clock';
import { CLOCK_PORT } from '../../../src/machines/application/ports/clock.port';
import { EmulatedMachineGateway } from '../../../src/machines/infrastructure/emulated-machine-gateway';
import { PrismaModule } from '../../../src/prisma/prisma.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SessionsService } from '../../../src/sessions/application/sessions.service';
import { SessionsModule } from '../../../src/sessions/sessions.module';

import {
    MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
    MachineDiscoveryE2EControl,
    registerMachineDiscoveryE2EControl,
} from './machine-discovery-e2e-control';

import type {
    ControlCredential,
    MachineDiscoveryE2EBootstrapResponse,
    MachineDiscoveryE2EScenario,
} from './machine-discovery-e2e-control';
import type { DynamicModule, INestApplication } from '@nestjs/common';

export const MACHINE_DISCOVERY_E2E_CONTROL_HEADER = 'x-kaynann-e2e-control';
export const MACHINE_DISCOVERY_E2E_FIXTURE_ACCOUNT_ID = '20000000-0000-4000-8000-000000000124';
const MACHINE_DISCOVERY_E2E_FIXTURE_PHONE = '+221700000124';
const MACHINE_DISCOVERY_E2E_FIXTURE_CATALOG_ID = 'machine-discovery-v1';
const E2E_CONTROL = Symbol('MACHINE_DISCOVERY_E2E_CONTROL');
const E2E_CONFIG = Symbol('MACHINE_DISCOVERY_E2E_CONFIG');
const E2E_CLOCK = Symbol('MACHINE_DISCOVERY_E2E_CLOCK');
const E2E_GATEWAY = Symbol('MACHINE_DISCOVERY_E2E_GATEWAY');

export interface MachineDiscoveryE2EHostConfig {
    readonly allowedFixtureOrigins: readonly string[];
    readonly controlCredential: string;
    readonly fixtureOrigin: string;
    readonly port: number;
}

@Controller('__e2e/machine-discovery')
export class MachineDiscoveryE2EController {
    constructor(@Inject(E2E_CONTROL) private readonly control: MachineDiscoveryE2EControl) {}

    @Post('bootstrap')
    @HttpCode(200)
    bootstrap(
        @Headers(MACHINE_DISCOVERY_E2E_CONTROL_HEADER) secret: string | undefined,
        @Body() body: unknown,
    ): Promise<MachineDiscoveryE2EBootstrapResponse> {
        const input = requireRecord(body);
        return this.control.bootstrap({
            acceptanceTime: requireString(input.acceptanceTime),
            controlCredential: fixtureCredential(secret),
            fixtureAccountId: requireString(input.fixtureAccountId),
            ...(input.scenario === undefined ? {} : { scenario: parseScenario(input.scenario) }),
        });
    }

    @Post('price')
    @HttpCode(204)
    async setPrice(
        @Headers(MACHINE_DISCOVERY_E2E_CONTROL_HEADER) secret: string | undefined,
        @Body() body: unknown,
    ): Promise<void> {
        const input = requireRecord(body);
        const price = requireRecord(input.price);
        await this.control.setPrice({
            controlCredential: fixtureCredential(secret),
            machineId: requireString(input.machineId),
            price: {
                amountPerLiter: requireString(price.amountPerLiter),
                currency: requireString(price.currency),
            },
        });
    }

    @Post('status')
    @HttpCode(204)
    async setStatus(
        @Headers(MACHINE_DISCOVERY_E2E_CONTROL_HEADER) secret: string | undefined,
        @Body() body: unknown,
    ): Promise<void> {
        const input = requireRecord(body);
        const publicationState = optionalEnum(input.publicationState, ['PUBLISHED', 'HIDDEN', 'ARCHIVED'] as const);
        const serviceMode = optionalEnum(input.serviceMode, ['NORMAL', 'SERVICE'] as const);
        await this.control.setStatus({
            controlCredential: fixtureCredential(secret),
            machineId: requireString(input.machineId),
            ...(publicationState === undefined ? {} : { publicationState }),
            ...(serviceMode === undefined ? {} : { serviceMode }),
        });
    }

    @Post('evidence')
    @HttpCode(204)
    async setEvidence(
        @Headers(MACHINE_DISCOVERY_E2E_CONTROL_HEADER) secret: string | undefined,
        @Body() body: unknown,
    ): Promise<void> {
        const input = requireRecord(body);
        const evidence = requireRecord(input.evidence);
        await this.control.setEvidence({
            controlCredential: fixtureCredential(secret),
            machineId: requireString(input.machineId),
            evidence: {
                observedAt: requireString(evidence.observedAt),
                reachable: requireBoolean(evidence.reachable),
                readyToSell: requireBoolean(evidence.readyToSell),
                salesAllowed: requireBoolean(evidence.salesAllowed),
                state: requiredEnum(evidence.state, ['READY', 'OFFLINE', 'UNKNOWN'] as const),
            },
        });
    }

    @Post('time')
    @HttpCode(204)
    async advanceTime(
        @Headers(MACHINE_DISCOVERY_E2E_CONTROL_HEADER) secret: string | undefined,
        @Body() body: unknown,
    ): Promise<void> {
        const input = requireRecord(body);
        if (!Number.isSafeInteger(input.milliseconds)) throw new Error('Invalid E2E control request.');
        await this.control.advanceTime({
            controlCredential: fixtureCredential(secret),
            milliseconds: input.milliseconds as number,
        });
    }
}

@Module({})
class MachineDiscoveryE2EHostModule {
    static register(
        config: MachineDiscoveryE2EHostConfig,
        clock: FixedClock,
        gateway: EmulatedMachineGateway,
    ): DynamicModule {
        return {
            module: MachineDiscoveryE2EHostModule,
            imports: [AppModule, PrismaModule, SecurityModule, SessionsModule],
            controllers: [MachineDiscoveryE2EController],
            providers: [
                { provide: E2E_CONFIG, useValue: config },
                { provide: E2E_CLOCK, useValue: clock },
                { provide: E2E_GATEWAY, useValue: gateway },
                {
                    provide: E2E_CONTROL,
                    inject: [E2E_CONFIG, E2E_CLOCK, E2E_GATEWAY, PrismaService, SessionsService],
                    useFactory: createControl,
                },
            ],
        };
    }
}

export async function createMachineDiscoveryE2EApplication(
    config: MachineDiscoveryE2EHostConfig,
): Promise<INestApplication> {
    const clock = new FixedClock(new Date(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME));
    const gateway = new EmulatedMachineGateway(clock);
    const moduleRef = await Test.createTestingModule({
        imports: [MachineDiscoveryE2EHostModule.register(config, clock, gateway)],
    })
        .overrideProvider(CLOCK_PORT)
        .useValue(clock)
        .overrideProvider(EmulatedMachineGateway)
        .useValue(gateway)
        .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
    app.useGlobalFilters(new RedactedExceptionFilter());
    app.enableCors({ origin: config.allowedFixtureOrigins });
    app.enableShutdownHooks();
    await app.init();
    return app;
}

export function loadMachineDiscoveryE2EHostConfig(env: NodeJS.ProcessEnv = process.env): MachineDiscoveryE2EHostConfig {
    if (
        env.APP_ENV !== 'test' ||
        env.NODE_ENV === 'production' ||
        env.MACHINE_DISCOVERY_E2E_BUILD_VARIANT !== 'machine-discovery-e2e' ||
        env.MACHINE_DISCOVERY_E2E_PRODUCTION_DISTRIBUTABLE !== 'false' ||
        env.MACHINE_GATEWAY_MODE !== 'emulator' ||
        env.MACHINE_FIXTURE_MODE !== 'true'
    ) {
        throw new Error('Machine discovery E2E host requires an isolated non-production fixture environment.');
    }
    const port = Number(env.API_PORT ?? '3000');
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error('Machine discovery E2E host requires a valid API port.');
    }
    const allowedFixtureOrigins = requireString(env.MACHINE_DISCOVERY_E2E_ALLOWED_ORIGINS)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    if (allowedFixtureOrigins.length === 0) throw new Error('Machine discovery E2E host requires fixture origins.');
    return {
        allowedFixtureOrigins,
        controlCredential: requireString(env.MACHINE_DISCOVERY_E2E_CONTROL_CREDENTIAL),
        fixtureOrigin: requireString(env.MACHINE_DISCOVERY_E2E_ORIGIN),
        port,
    };
}

function createControl(
    config: MachineDiscoveryE2EHostConfig,
    clock: FixedClock,
    gateway: EmulatedMachineGateway,
    prisma: PrismaService,
    sessions: SessionsService,
): MachineDiscoveryE2EControl {
    return registerMachineDiscoveryE2EControl({
        acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
        allowedFixtureOrigins: config.allowedFixtureOrigins,
        authenticateFixtureAccount: async (accountId) => {
            await prisma.user.upsert({
                where: { id: accountId },
                create: {
                    id: accountId,
                    phoneConfirmedAt: new Date(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME),
                    phoneE164: MACHINE_DISCOVERY_E2E_FIXTURE_PHONE,
                    status: 'ACTIVE',
                },
                update: {
                    phoneConfirmedAt: new Date(MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME),
                    phoneE164: MACHINE_DISCOVERY_E2E_FIXTURE_PHONE,
                    status: 'ACTIVE',
                },
            });
            await prisma.userSession.deleteMany({ where: { userId: accountId } });
            const credentials = await sessions.issueForUser({
                creationContext: `machine-discovery-e2e:${accountId}`,
                installationId: 'machine-discovery-e2e-installation',
                userId: accountId,
            });
            return { credentialProvenance: 'fixture-e2e', credentials };
        },
        build: { environment: 'test', productionDistributable: false, variant: 'machine-discovery-e2e' },
        clock,
        controlCredential: { provenance: 'fixture-e2e', value: config.controlCredential },
        fixtureAccountId: MACHINE_DISCOVERY_E2E_FIXTURE_ACCOUNT_ID,
        fixtureCatalogId: MACHINE_DISCOVERY_E2E_FIXTURE_CATALOG_ID,
        fixtureEndpoint: { origin: config.fixtureOrigin, provenance: 'fixture' },
        gateway,
        prisma,
    });
}

function fixtureCredential(value: string | undefined): ControlCredential {
    return { provenance: 'fixture-e2e', value: value ?? '' };
}

function parseScenario(value: unknown): MachineDiscoveryE2EScenario {
    const scenario = requireRecord(value);
    return {
        name: requiredEnum(scenario.name, [
            'E2E_MACHINE_IDENTIFICATION_SCENARIO',
            'E2E_MACHINE_SAFE_CURRENT_SCENARIO',
            'E2E_MACHINE_SELECTION_SCENARIO',
            'E2E_MACHINE_SESSION_SCENARIO',
        ] as const),
        value: requireString(scenario.value),
    };
}

function requireRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Invalid E2E control request.');
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('Invalid E2E control request.');
    return value.trim();
}

function requireBoolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Invalid E2E control request.');
    return value;
}

function optionalEnum<const T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
    return value === undefined ? undefined : requiredEnum(value, allowed);
}

function requiredEnum<const T extends string>(value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('Invalid E2E control request.');
    return value as T;
}
