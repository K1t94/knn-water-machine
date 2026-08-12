import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFeatureStateService } from '../src/referral/application/referral-feature-state.service';
import { ReferralFeatureOperationsController } from '../src/referral/http/referral-feature-operations.controller';
import { ReferralOperationsGuard } from '../src/referral/http/referral-operations.guard';

import { httpServer } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

const token = Buffer.alloc(32, 7).toString('base64url');

describe('referral feature operational HTTP contract', () => {
    let app: INestApplication;
    let state: { key: 'REFERRAL_PROGRAM'; enabled: boolean; revision: bigint; updatedAt: Date };
    const featureState = { readAvailability: vi.fn(), setEnabled: vi.fn() };

    beforeEach(async () => {
        configureEnvironment();
        state = { key: 'REFERRAL_PROGRAM', enabled: true, revision: 1n, updatedAt: new Date() };
        featureState.readAvailability.mockImplementation(async () => state);
        featureState.setEnabled.mockImplementation(async ({ enabled }: { enabled: boolean }) => {
            if (state.enabled !== enabled) {
                state = { ...state, enabled, revision: state.revision + 1n, updatedAt: new Date() };
            }
            return state;
        });
        const module = await Test.createTestingModule({
            controllers: [ReferralFeatureOperationsController],
            providers: [ReferralOperationsGuard, { provide: ReferralFeatureStateService, useValue: featureState }],
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
        vi.resetAllMocks();
        vi.unstubAllEnvs();
    });

    it('matches the standalone protected GET/PUT contract', () => {
        const contract = readFileSync(
            resolve(__dirname, '../../../specs/005-referral-program/contracts/operational-feature-flag.openapi.yaml'),
            'utf8',
        );

        expect(contract).toContain('  /internal/feature-flags/referral-program:');
        expect(contract).toContain('    get:');
        expect(contract).toContain('    put:');
        expect(contract).toContain('      additionalProperties: false');
        expect(contract).toContain('  - operationsBearer: []');
        expect(contract).toContain('const: REFERRAL_PROGRAM');
        expect(contract).toContain('const: no-store');
    });

    it('authenticates before reads or mutations and never reflects credentials', async () => {
        const server = httpServer(app);
        const missing = await request(server).get('/internal/feature-flags/referral-program').expect(401);
        const invalid = await request(server)
            .put('/internal/feature-flags/referral-program')
            .set('Authorization', 'Bearer wrong-secret')
            .send({ enabled: false })
            .expect(401);

        expect(featureState.readAvailability).not.toHaveBeenCalled();
        expect(featureState.setEnabled).not.toHaveBeenCalled();
        expect(JSON.stringify([missing.body, invalid.body])).not.toContain('wrong-secret');
        expect(JSON.stringify([missing.body, invalid.body])).not.toContain(token);
    });

    it('strictly validates boolean-only input', async () => {
        const server = httpServer(app);
        for (const body of [{ enabled: 'false' }, { enabled: false, extra: true }, {}, { enabled: null }]) {
            await request(server)
                .put('/internal/feature-flags/referral-program')
                .set('Authorization', `Bearer ${token}`)
                .send(body)
                .expect(400);
        }
        expect(featureState.setEnabled).not.toHaveBeenCalled();
    });

    it('returns no-store state and keeps revision stable for repeated changes', async () => {
        const server = httpServer(app);
        const startedAt = Date.now();
        const first = await request(server)
            .put('/internal/feature-flags/referral-program')
            .set('Authorization', `Bearer ${token}`)
            .send({ enabled: false })
            .expect(200);
        const repeated = await request(server)
            .put('/internal/feature-flags/referral-program')
            .set('Authorization', `Bearer ${token}`)
            .send({ enabled: false })
            .expect(200);
        const read = await request(server)
            .get('/internal/feature-flags/referral-program')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(first.body).toMatchObject({ key: 'REFERRAL_PROGRAM', enabled: false, revision: '2' });
        expect((repeated.body as unknown as { revision: string }).revision).toBe('2');
        expect(read.body).toEqual(repeated.body);
        expect([first, repeated, read].every((response) => response.headers['cache-control'] === 'no-store')).toBe(
            true,
        );
        expect(Date.now() - startedAt).toBeLessThan(30_000);
    });

    it('returns a safe 503 when authoritative storage is unavailable', async () => {
        featureState.readAvailability.mockRejectedValueOnce(new Error(`database failed with ${token}`));
        featureState.setEnabled.mockRejectedValueOnce(new Error(`database failed with ${token}`));
        const server = httpServer(app);

        const read = await request(server)
            .get('/internal/feature-flags/referral-program')
            .set('Authorization', `Bearer ${token}`)
            .expect(503);
        const update = await request(server)
            .put('/internal/feature-flags/referral-program')
            .set('Authorization', `Bearer ${token}`)
            .send({ enabled: false })
            .expect(503);

        expect(JSON.stringify([read.body, update.body])).not.toContain(token);
        expect((read.body as unknown as { message: string }).message).toBe('Referral feature state is unavailable.');
        expect((update.body as unknown as { message: string }).message).toBe('Referral feature state is unavailable.');
    });
});

function configureEnvironment(): void {
    const values = {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'referral-ops-contract',
        SMS_PROVIDER: 'fake',
        OTP_HMAC_KEY: token,
        CREDENTIAL_HMAC_KEY: token,
        FINGERPRINT_HMAC_KEY: token,
        REGISTRATION_RESULT_ENCRYPTION_KEY: token,
        JWT_ACCESS_SIGNING_KEY: token,
        REFERRAL_OPERATIONS_TOKEN: token,
    };
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
