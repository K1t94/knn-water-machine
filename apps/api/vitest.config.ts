import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Redis integration files share the production key namespace and clear it per test.
    fileParallelism: process.env.RUN_REDIS_INTEGRATION !== '1',
    include: [
      'src/**/*.spec.ts',
      'src/**/*.integration-spec.ts',
      'test/**/*.spec.ts',
      'test/**/*-spec.ts',
      'test/**/*.integration-spec.ts',
      'test/**/*.e2e-spec.ts',
      'test/**/*.smoke-spec.ts',
    ],
    passWithNoTests: true,
  },
});
