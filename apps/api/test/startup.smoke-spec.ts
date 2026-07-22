import { describe, expect, it } from 'vitest';

import { getRedactedEnvDiagnostics, loadEnv } from '../src/config/env';
import { HealthService } from '../src/health/health.service';

describe('API startup boundaries', () => {
  it('validates local configuration and exposes only redacted diagnostics', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      API_PORT: '3000',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/db',
      REDIS_URL: 'redis://:password@localhost:6379',
      MQTT_URL: 'mqtt://localhost:1883',
      MQTT_CLIENT_ID: 'test-client',
    });

    expect(getRedactedEnvDiagnostics(env)).toEqual({
      nodeEnv: 'test',
      apiPort: 3000,
      database: 'configured',
      redis: 'configured',
      mqtt: 'configured',
    });
    expect(JSON.stringify(getRedactedEnvDiagnostics(env))).not.toMatch(/password|localhost|:\/\//i);
  });

  it('does not hang when health dependencies never resolve', async () => {
    const service = new HealthService(
      { checkAll: () => new Promise(() => undefined) } as never,
      50,
    );

    const startedAt = performance.now();
    const result = await service.check();
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(500);
    expect(result.status).toBe('failed');
    expect(result.dependencies.redis).toEqual({
      status: 'down',
      errorCode: 'HEALTHCHECK_TIMEOUT',
    });
    expect(JSON.stringify(result)).not.toMatch(/URL|password|stack|connection/i);
  });
});
