import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOCK_PORT, type ClockPort } from './application/ports/clock.port';
import { MACHINE_GATEWAY, type MachineGateway } from './application/ports/machine-gateway.port';
import { MachineErrorFilter } from './http/machine-error.filter';
import { EmulatedMachineGateway } from './infrastructure/emulated-machine-gateway';
import { SystemClock } from './infrastructure/system-clock';
import { MACHINE_DISCOVERY_CONFIG, MachinesModule, type MachineDiscoveryConfig } from './machines.module';

const secret = Buffer.alloc(32, 11).toString('base64url');

@Module({ imports: [MachinesModule] })
class ConsumerModule {}

function configureEnvironment(): void {
    const environment = {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'machines-module-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        MACHINE_CURSOR_HMAC_KEY: secret,
        MACHINE_CURSOR_TTL_SECONDS: '120',
        MACHINE_AVAILABILITY_FRESHNESS_SECONDS: '45',
        MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS: '3',
        MACHINE_SERVICE_AREA_NORTH: '14.9',
        MACHINE_SERVICE_AREA_EAST: '-17.1',
        MACHINE_SERVICE_AREA_SOUTH: '14.5',
        MACHINE_SERVICE_AREA_WEST: '-17.6',
        MACHINE_GATEWAY_MODE: 'emulator',
    } as const;

    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
}

beforeEach(configureEnvironment);
afterEach(() => vi.unstubAllEnvs());

describe('MachinesModule', () => {
    it('resolves typed config, clock, error filter, and the read-only gateway', async () => {
        const testingModule = await Test.createTestingModule({ imports: [MachinesModule] }).compile();

        const config = testingModule.get<MachineDiscoveryConfig>(MACHINE_DISCOVERY_CONFIG);
        expect(config).toEqual({
            cursorHmacKey: secret,
            cursorTtlSeconds: 120,
            availabilityFreshnessSeconds: 45,
            availabilityAllowedClockSkewSeconds: 3,
            serviceArea: {
                north: 14.9,
                east: -17.1,
                south: 14.5,
                west: -17.6,
            },
            gatewayMode: 'emulator',
            fixtureMode: false,
            legacyQrEnabled: false,
        });
        expect(testingModule.get<ClockPort>(CLOCK_PORT)).toBeInstanceOf(SystemClock);
        expect(testingModule.get(MachineErrorFilter)).toBeInstanceOf(MachineErrorFilter);

        const gateway = testingModule.get<MachineGateway>(MACHINE_GATEWAY);
        const readOnlyMethods = ['refreshAvailability'] satisfies ReadonlyArray<keyof MachineGateway>;
        expect(Object.keys(gateway)).toEqual(readOnlyMethods);
        expect(gateway).not.toBeInstanceOf(EmulatedMachineGateway);
        expect('setEvidence' in gateway).toBe(false);
        expect('setResponseDelay' in gateway).toBe(false);

        await testingModule.close();
    });

    it('does not export gateway or emulator controls to importing modules', async () => {
        const testingModule = await Test.createTestingModule({ imports: [ConsumerModule] }).compile();
        const consumerContext = testingModule.select(ConsumerModule);

        expect(() => {
            consumerContext.get<unknown>(MACHINE_GATEWAY, { strict: true });
        }).toThrow();

        const exportsMetadata: unknown = Reflect.getMetadata('exports', MachinesModule);
        const exportedProviders = Array.isArray(exportsMetadata) ? (exportsMetadata as unknown[]) : [];
        expect(exportedProviders).not.toContain(MACHINE_GATEWAY);
        expect(exportedProviders).not.toContain(EmulatedMachineGateway);
        expect(exportedProviders.some((provider) => /command|control|fixture|emulat/i.test(String(provider)))).toBe(
            false,
        );

        await testingModule.close();
    });
});
