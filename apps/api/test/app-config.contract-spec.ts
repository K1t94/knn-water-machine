import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppConfigController } from '../src/app-config/http/app-config.controller';
import { ReferralFeatureStateService } from '../src/referral/application/referral-feature-state.service';

import { httpServer } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('public app-config HTTP contract', () => {
    const apps: INestApplication[] = [];

    afterEach(async () => {
        await Promise.all(apps.splice(0).map((app) => app.close()));
    });

    it('returns only privacy-safe authoritative availability with no-store', async () => {
        const app = await createApp({
            readAvailability: vi.fn().mockResolvedValue(availability(false)),
        });
        const response = await request(httpServer(app)).get('/v1/app-config').expect(200);
        expect(response.body).toEqual({ features: { referralProgramEnabled: false } });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(response.body)).not.toMatch(/revision|updatedAt|credential|token/i);
    });

    it('fails closed with a safe 503 when authoritative storage is unavailable', async () => {
        const app = await createApp({
            readAvailability: vi.fn().mockRejectedValue(new Error('postgres password secret')),
        });
        const response = await request(httpServer(app)).get('/v1/app-config').expect(503);
        const body = response.body as unknown as { error: { code: string; retryable: boolean } };
        expect(body.error).toMatchObject({ code: 'REFERRAL_SERVICE_UNAVAILABLE', retryable: true });
        expect(JSON.stringify(response.body)).not.toContain('postgres password secret');
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('shows each shared-state change across three live API instances', async () => {
        const shared = { enabled: true };
        const service = { readAvailability: vi.fn(async () => availability(shared.enabled)) };
        const instances = await Promise.all([createApp(service), createApp(service), createApp(service)]);

        const startedAt = Date.now();
        shared.enabled = false;
        const disabled = await Promise.all(instances.map((app) => request(httpServer(app)).get('/v1/app-config')));
        expect(disabled.every((response) => appConfigEnabled(response.body) === false)).toBe(true);

        shared.enabled = true;
        const enabled = await Promise.all(instances.map((app) => request(httpServer(app)).get('/v1/app-config')));
        expect(enabled.every((response) => appConfigEnabled(response.body) === true)).toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    async function createApp(featureState: { readAvailability: () => Promise<unknown> }): Promise<INestApplication> {
        const module = await Test.createTestingModule({
            controllers: [AppConfigController],
            providers: [{ provide: ReferralFeatureStateService, useValue: featureState }],
        }).compile();
        const app = module.createNestApplication({ logger: false });
        await app.init();
        apps.push(app);
        return app;
    }
});

function availability(enabled: boolean) {
    return { key: 'REFERRAL_PROGRAM' as const, enabled, revision: 1n, updatedAt: new Date() };
}

function appConfigEnabled(body: unknown): boolean | undefined {
    return (body as { features?: { referralProgramEnabled?: boolean } }).features?.referralProgramEnabled;
}
