import { Module } from '@nestjs/common';
import { of } from 'rxjs';

import { SecurityModule } from '../common/security/security.module';
import { loadEnv, type AppEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';

import { DiscoverMachinesService } from './application/discover-machines.service';
import { GetMachineDetailService } from './application/get-machine-detail.service';
import { CLOCK_PORT } from './application/ports/clock.port';
import { MACHINE_GATEWAY, type MachineGateway } from './application/ports/machine-gateway.port';
import { MACHINE_REPOSITORY } from './application/ports/machine.repository';
import { ResolveMachineIdentifierService } from './application/resolve-machine-identifier.service';
import { RevalidateMachineSelectionService } from './application/revalidate-machine-selection.service';
import { MachineAvailabilityProjector } from './domain/availability-projector';
import { MachineDiscoveryController } from './http/machine-discovery.controller';
import { MachineErrorFilter } from './http/machine-error.filter';
import { MachineSelectionController } from './http/machine-selection.controller';
import { EmulatedMachineGateway } from './infrastructure/emulated-machine-gateway';
import { PrismaMachineRepository } from './infrastructure/postgres/prisma-machine.repository';
import { SignedCatalogCursor } from './infrastructure/signed-catalog-cursor';
import { SystemClock } from './infrastructure/system-clock';

import type { ClockPort } from './application/ports/clock.port';
import type { MachineRepository } from './application/ports/machine.repository';
import type { MachineId } from './domain/machine.types';

export const MACHINE_DISCOVERY_CONFIG = Symbol('MACHINE_DISCOVERY_CONFIG');

const localDefaultCursorHmacKey = Buffer.alloc(32).toString('base64url');
const cursorSecretIsolationFields = [
    'OTP_HMAC_KEY',
    'CREDENTIAL_HMAC_KEY',
    'FINGERPRINT_HMAC_KEY',
    'REGISTRATION_RESULT_ENCRYPTION_KEY',
    'JWT_ACCESS_SIGNING_KEY',
    'REFERRAL_OPERATIONS_TOKEN',
    'INTERNAL_METRICS_TOKEN',
] as const satisfies readonly (keyof AppEnv)[];

export interface MachineDiscoveryConfig {
    readonly cursorHmacKey: string;
    readonly cursorTtlSeconds: number;
    readonly availabilityFreshnessSeconds: number;
    readonly availabilityAllowedClockSkewSeconds: number;
    readonly serviceArea: {
        readonly north: number;
        readonly east: number;
        readonly south: number;
        readonly west: number;
    };
    readonly gatewayMode: AppEnv['MACHINE_GATEWAY_MODE'];
    readonly fixtureMode: boolean;
    readonly legacyQrEnabled: boolean;
}

function assertProductionMachineDiscoveryConfig(env: AppEnv): void {
    if (env.APP_ENV !== 'production') {
        return;
    }

    const violations: string[] = [];
    if (env.MACHINE_GATEWAY_MODE === 'emulator') {
        violations.push('MACHINE_GATEWAY_MODE=emulator is forbidden');
    }
    if (env.MACHINE_FIXTURE_MODE) {
        violations.push('MACHINE_FIXTURE_MODE=true is forbidden');
    }
    if (env.MACHINE_LEGACY_QR_ENABLED) {
        violations.push('MACHINE_LEGACY_QR_ENABLED=true is forbidden');
    }
    if (env.MACHINE_CURSOR_HMAC_KEY === localDefaultCursorHmacKey) {
        violations.push('MACHINE_CURSOR_HMAC_KEY must not use the local default');
    }

    const reusedSecretField = cursorSecretIsolationFields.find(
        (field) => env[field] !== undefined && env[field] === env.MACHINE_CURSOR_HMAC_KEY,
    );
    if (reusedSecretField !== undefined) {
        violations.push(`MACHINE_CURSOR_HMAC_KEY must not reuse ${reusedSecretField}`);
    }

    if (violations.length > 0) {
        throw new Error(`Unsafe machine discovery production configuration: ${violations.join(', ')}`);
    }
}

export function createMachineDiscoveryConfig(env: AppEnv): MachineDiscoveryConfig {
    assertProductionMachineDiscoveryConfig(env);

    return Object.freeze({
        cursorHmacKey: env.MACHINE_CURSOR_HMAC_KEY,
        cursorTtlSeconds: env.MACHINE_CURSOR_TTL_SECONDS,
        availabilityFreshnessSeconds: env.MACHINE_AVAILABILITY_FRESHNESS_SECONDS,
        availabilityAllowedClockSkewSeconds: env.MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS,
        serviceArea: Object.freeze({
            north: env.MACHINE_SERVICE_AREA_NORTH,
            east: env.MACHINE_SERVICE_AREA_EAST,
            south: env.MACHINE_SERVICE_AREA_SOUTH,
            west: env.MACHINE_SERVICE_AREA_WEST,
        }),
        gatewayMode: env.MACHINE_GATEWAY_MODE,
        fixtureMode: env.MACHINE_FIXTURE_MODE,
        legacyQrEnabled: env.MACHINE_LEGACY_QR_ENABLED,
    });
}

function loadMachineDiscoveryConfig(): MachineDiscoveryConfig {
    return createMachineDiscoveryConfig(loadEnv());
}

function createMachineGateway(config: MachineDiscoveryConfig, emulator: EmulatedMachineGateway): MachineGateway {
    const refreshAvailability =
        config.gatewayMode === 'emulator'
            ? (machineId: MachineId) => emulator.refreshAvailability(machineId)
            : (_machineId: MachineId) => of(null);

    return Object.freeze({ refreshAvailability });
}

function createAvailabilityProjector(clock: ClockPort, config: MachineDiscoveryConfig): MachineAvailabilityProjector {
    return new MachineAvailabilityProjector(clock, {
        freshnessSeconds: config.availabilityFreshnessSeconds,
        allowedClockSkewSeconds: config.availabilityAllowedClockSkewSeconds,
        supportedCurrencies: new Set(['XOF']),
    });
}

function createCatalogCursor(clock: ClockPort, config: MachineDiscoveryConfig): SignedCatalogCursor {
    return new SignedCatalogCursor(clock, {
        MACHINE_CURSOR_HMAC_KEY: config.cursorHmacKey,
        MACHINE_CURSOR_TTL_SECONDS: config.cursorTtlSeconds,
    });
}

function createDiscoverMachinesService(
    repository: MachineRepository,
    projector: MachineAvailabilityProjector,
    cursor: SignedCatalogCursor,
): DiscoverMachinesService {
    return new DiscoverMachinesService(repository, projector, cursor);
}

function createGetMachineDetailService(
    repository: MachineRepository,
    gateway: MachineGateway,
    projector: MachineAvailabilityProjector,
    clock: ClockPort,
): GetMachineDetailService {
    return new GetMachineDetailService(repository, gateway, projector, clock);
}

function createResolveMachineIdentifierService(
    repository: MachineRepository,
    detailService: GetMachineDetailService,
    config: MachineDiscoveryConfig,
): ResolveMachineIdentifierService {
    return new ResolveMachineIdentifierService(repository, detailService, {
        legacyQrEnabled: config.legacyQrEnabled,
    });
}

function createRevalidateMachineSelectionService(
    repository: MachineRepository,
    gateway: MachineGateway,
    projector: MachineAvailabilityProjector,
    clock: ClockPort,
): RevalidateMachineSelectionService {
    return new RevalidateMachineSelectionService(repository, gateway, projector, clock);
}

@Module({
    imports: [PrismaModule, SecurityModule, SessionsModule],
    controllers: [MachineDiscoveryController, MachineSelectionController],
    providers: [
        {
            provide: MACHINE_DISCOVERY_CONFIG,
            useFactory: loadMachineDiscoveryConfig,
        },
        SystemClock,
        {
            provide: CLOCK_PORT,
            useExisting: SystemClock,
        },
        MachineErrorFilter,
        EmulatedMachineGateway,
        {
            provide: MACHINE_GATEWAY,
            inject: [MACHINE_DISCOVERY_CONFIG, EmulatedMachineGateway],
            useFactory: createMachineGateway,
        },
        PrismaMachineRepository,
        {
            provide: MACHINE_REPOSITORY,
            useExisting: PrismaMachineRepository,
        },
        {
            provide: MachineAvailabilityProjector,
            inject: [CLOCK_PORT, MACHINE_DISCOVERY_CONFIG],
            useFactory: createAvailabilityProjector,
        },
        {
            provide: SignedCatalogCursor,
            inject: [CLOCK_PORT, MACHINE_DISCOVERY_CONFIG],
            useFactory: createCatalogCursor,
        },
        {
            provide: DiscoverMachinesService,
            inject: [MACHINE_REPOSITORY, MachineAvailabilityProjector, SignedCatalogCursor],
            useFactory: createDiscoverMachinesService,
        },
        {
            provide: GetMachineDetailService,
            inject: [MACHINE_REPOSITORY, MACHINE_GATEWAY, MachineAvailabilityProjector, CLOCK_PORT],
            useFactory: createGetMachineDetailService,
        },
        {
            provide: ResolveMachineIdentifierService,
            inject: [MACHINE_REPOSITORY, GetMachineDetailService, MACHINE_DISCOVERY_CONFIG],
            useFactory: createResolveMachineIdentifierService,
        },
        {
            provide: RevalidateMachineSelectionService,
            inject: [MACHINE_REPOSITORY, MACHINE_GATEWAY, MachineAvailabilityProjector, CLOCK_PORT],
            useFactory: createRevalidateMachineSelectionService,
        },
    ],
})
export class MachinesModule {}
