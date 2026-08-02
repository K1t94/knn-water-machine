import { describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service';

describe('HealthService', () => {
    it('shapes an all-up dependency result as healthy', async () => {
        const dependencyChecks = {
            checkAll: vi.fn().mockResolvedValue({
                postgres: { status: 'up', latencyMs: 3 },
                redis: { status: 'up', latencyMs: 2 },
                mqtt: { status: 'up', latencyMs: 4 },
            }),
        };

        const result = await new HealthService(dependencyChecks as never, 100).check();

        expect(result).toEqual({
            status: 'ok',
            service: 'kaynann-api',
            version: '0.1.0',
            dependencies: {
                postgres: { status: 'up', latencyMs: 3 },
                redis: { status: 'up', latencyMs: 2 },
                mqtt: { status: 'up', latencyMs: 4 },
            },
        });
    });

    it('shapes a partial dependency failure as degraded', async () => {
        const dependencyChecks = {
            checkAll: vi.fn().mockResolvedValue({
                postgres: { status: 'up' },
                redis: { status: 'down', errorCode: 'REDIS_UNAVAILABLE' },
                mqtt: { status: 'up' },
            }),
        };

        const result = await new HealthService(dependencyChecks as never, 100).check();

        expect(result.status).toBe('degraded');
        expect(result.dependencies.redis).toEqual({
            status: 'down',
            errorCode: 'REDIS_UNAVAILABLE',
        });
        expect(result).not.toHaveProperty('error');
    });

    it('keeps driver details out of the public dependency shape', async () => {
        const dependencyChecks = {
            checkAll: vi.fn().mockResolvedValue({
                postgres: {
                    status: 'down',
                    errorCode: 'POSTGRES_UNAVAILABLE',
                    rawError: 'postgresql://user:password@internal.example/secret',
                    stack: 'Error: connection failed',
                },
                redis: { status: 'up', internalUrl: 'redis://:password@internal.example' },
                mqtt: { status: 'up', token: 'secret-token' },
            }),
        };

        const result = await new HealthService(dependencyChecks as never, 100).check();

        expect(result.dependencies).toEqual({
            postgres: { status: 'down', errorCode: 'POSTGRES_UNAVAILABLE' },
            redis: { status: 'up' },
            mqtt: { status: 'up' },
        });
        expect(JSON.stringify(result)).not.toMatch(/password|secret|token|stack|internal\.example/i);
    });
});
