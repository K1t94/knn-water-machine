import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DependencyChecksService } from '../src/health/dependency-checks.service';
import { HealthModule } from '../src/health/health.module';
import { RedisService } from '../src/infrastructure/redis/redis.service';

import { httpServer, requiredRecord, responseRecord } from './http-test-helpers';

import type { DependencyStatus } from '../src/health/dependency-checks.service';
import type { INestApplication } from '@nestjs/common';

describe('GET /health', () => {
    let app: INestApplication;
    let checks: { checkAll: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        checks = { checkAll: vi.fn() };
        const module = await Test.createTestingModule({
            imports: [HealthModule],
        })
            .overrideProvider(DependencyChecksService)
            .useValue(checks)
            .overrideProvider(RedisService)
            .useValue({ ping: vi.fn() })
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('returns an allow-listed 200 response within 5 seconds when dependencies are up', async () => {
        checks.checkAll.mockResolvedValue(upStatuses());

        const startedAt = performance.now();
        const response = await request(httpServer(app)).get('/health');
        const elapsedMs = performance.now() - startedAt;

        expect(response.status).toBe(200);
        expect(elapsedMs).toBeLessThan(5000);
        expect(response.body).toEqual({
            status: 'ok',
            service: 'kaynann-api',
            version: '0.1.0',
            dependencies: {
                postgres: { status: 'up' },
                redis: { status: 'up' },
                mqtt: { status: 'up' },
            },
        });
        expect(JSON.stringify(response.body)).not.toMatch(/URL|password|token|stack/i);
    });

    it('returns a redacted 503 response within 5 seconds when a dependency is down', async () => {
        checks.checkAll.mockResolvedValue({
            ...upStatuses(),
            redis: { status: 'down', errorCode: 'REDIS_UNAVAILABLE' },
        });

        const startedAt = performance.now();
        const response = await request(httpServer(app)).get('/health');
        const elapsedMs = performance.now() - startedAt;
        const body = responseRecord(response);
        const dependencies = requiredRecord(body, 'dependencies');

        expect(response.status).toBe(503);
        expect(elapsedMs).toBeLessThan(5000);
        expect(body.status).toBe('degraded');
        expect(dependencies.redis).toEqual({
            status: 'down',
            errorCode: 'REDIS_UNAVAILABLE',
        });
        expect(response.body).not.toHaveProperty('error');
    });

    it('converts a dependency-check timeout into a bounded 503 response', async () => {
        checks.checkAll.mockImplementation(() => new Promise(() => undefined));

        const startedAt = performance.now();
        const response = await request(httpServer(app)).get('/health');
        const elapsedMs = performance.now() - startedAt;

        expect(response.status).toBe(503);
        expect(elapsedMs).toBeLessThan(5000);
        expect(response.body).toMatchObject({
            status: 'failed',
            dependencies: {
                postgres: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
                redis: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
                mqtt: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
            },
        });
    });
});

function upStatuses(): Record<string, DependencyStatus> {
    return {
        postgres: { status: 'up' },
        redis: { status: 'up' },
        mqtt: { status: 'up' },
    };
}
