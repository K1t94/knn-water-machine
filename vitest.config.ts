import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['apps/**/test/**/*.spec.ts', 'apps/**/src/**/*.spec.ts', 'apps/**/__tests__/**/*.test.tsx'],
    },
});
