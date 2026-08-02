import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthMetrics } from '../src/observability/auth-metrics';
import { InternalMetricsGuard } from '../src/observability/internal-metrics.guard';
import { MetricsController } from '../src/observability/metrics.controller';

import { httpServer } from './http-test-helpers';

import type { INestApplication } from '@nestjs/common';

const token = Buffer.alloc(32, 9).toString('base64url');
const secret = Buffer.alloc(32, 7).toString('base64url');

describe('internal metrics HTTP contract', () => {
    let app: INestApplication | undefined;
    afterEach(async () => {
        await app?.close();
        app = undefined;
        vi.unstubAllEnvs();
    });

    it('returns 404 when disabled', async () => {
        app = await createApp(false);
        await request(httpServer(app)).get('/internal/metrics').expect(404);
    });

    it('requires the independent bearer and ignores spoofed proxy headers', async () => {
        app = await createApp(true);
        const server = httpServer(app);
        await request(server).get('/internal/metrics').expect(401);
        await request(server)
            .get('/internal/metrics')
            .set('Authorization', 'Bearer wrong-token')
            .set('X-Forwarded-For', '127.0.0.1')
            .set('X-Forwarded-Proto', 'https')
            .expect(401);
    });

    it('returns Prometheus text only for the valid bearer', async () => {
        app = await createApp(true);
        const response = await request(httpServer(app))
            .get('/internal/metrics')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(response.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
        expect(response.text).toContain('sms_daily_count_limit 500');
        expect(response.text).not.toContain(token);
    });
});

async function createApp(enabled: boolean): Promise<INestApplication> {
    configure(enabled);
    const metrics = new AuthMetrics({
        commandClient: { mGet: vi.fn().mockResolvedValue(['0', '0']) },
    } as never);
    const module = await Test.createTestingModule({
        controllers: [MetricsController],
        providers: [InternalMetricsGuard, { provide: AuthMetrics, useValue: metrics }],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    return app;
}

function configure(enabled: boolean): void {
    const values = {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'metrics-contract',
        SMS_PROVIDER: 'fake',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        INTERNAL_METRICS_ENABLED: String(enabled),
        INTERNAL_METRICS_TOKEN: token,
    };
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
