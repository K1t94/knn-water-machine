import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^react-native$/,
                replacement: resolve(__dirname, 'src/testing/react-native.ts'),
            },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.spec.{ts,tsx}', '__tests__/**/*.test.tsx'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
