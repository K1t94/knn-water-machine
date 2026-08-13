import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import expo from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import reactNative from 'eslint-plugin-react-native';
import rxjs from 'eslint-plugin-rxjs-x';
import testingLibrary from 'eslint-plugin-testing-library';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];
const importFiles = ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'];
const mobileFiles = ['apps/mobile/**/*.{js,jsx,ts,tsx}'];
const mobileTestFiles = [
    'apps/mobile/app.config.spec.ts',
    'apps/mobile/__tests__/**/*.{ts,tsx}',
    'apps/mobile/src/**/*.{test,spec}.{ts,tsx}',
    'apps/mobile/.eslint-fixtures/invalid-mobile.spec.tsx',
];
const mobileStandaloneTestHelperFiles = ['apps/mobile/src/testing/**/*.{ts,tsx}'];
const apiFiles = ['apps/api/**/*.{js,ts}'];
const apiTestFiles = [
    'apps/api/src/**/*.{spec,integration-spec}.ts',
    'apps/api/test/**/*.ts',
    'apps/api/.eslint-fixtures/tests/**/*.ts',
];
const typedApplicationFiles = [
    'apps/mobile/index.ts',
    'apps/mobile/index.e2e.ts',
    'apps/mobile/app.config.ts',
    'apps/mobile/app.config.spec.ts',
    'apps/mobile/src/**/*.{ts,tsx}',
    'apps/mobile/__tests__/**/*.{ts,tsx}',
    'apps/mobile/.eslint-fixtures/**/*.{ts,tsx}',
    'apps/api/src/**/*.ts',
    'apps/api/test/**/*.ts',
    'apps/api/.eslint-fixtures/**/*.ts',
];
const testFiles = [
    'apps/mobile/app.config.spec.ts',
    'apps/mobile/__tests__/**/*.{ts,tsx}',
    'apps/mobile/src/**/*.{test,spec}.{ts,tsx}',
    ...apiTestFiles,
];
const mockAndFixtureFiles = ['**/{mocks,fixtures}/**/*.{js,jsx,ts,tsx}', '**/*.{mock,fixture}.{js,jsx,ts,tsx}'];
const migrationAndSeedFiles = ['**/{migrations,seeds}/**/*.{js,ts}', '**/*.{migration,seed}.{js,ts}'];
const toolingFiles = [
    '*.config.{js,cjs,mjs,ts}',
    'scripts/**/*.{js,cjs,mjs,ts}',
    'apps/*/vitest.config.ts',
    'apps/*/{babel,metro}.config.{js,cjs,mjs,ts}',
    'apps/*/.eslint-fixtures/*.config.{js,cjs,mjs,ts}',
    'apps/api/.eslint-fixtures/scripts/**/*.ts',
    'apps/mobile/vitest.setup.ts',
    'apps/api/src/main.ts',
    'apps/api/src/openapi/generate-openapi.ts',
];
const apiSpecialTypeAwareFiles = [
    ...apiTestFiles,
    'apps/api/src/**/{testing,fixtures,mocks}/**/*.ts',
    'apps/api/src/openapi/generate-openapi.ts',
    'apps/api/.eslint-fixtures/{fixtures,migrations,mocks,openapi,scripts,seeds}/**/*.ts',
];

const apiCrossApplicationPattern = {
    message: 'API code must not import mobile application code.',
    regex: '^(?:\\.\\./)+mobile/src/',
};
const apiPrivateProviderPattern = {
    message:
        'Private Orange implementation imports are limited to its infrastructure folder, tests, and SmsModule composition root.',
    regex: '(?:^|/)(?:sms/)?infrastructure/orange(?:/|$)',
};

function restrictedApiImports(...patterns) {
    return [
        'error',
        {
            patterns: [apiCrossApplicationPattern, apiPrivateProviderPattern, ...patterns],
        },
    ];
}

function compositionRootApiImports(...patterns) {
    return ['error', { patterns: [apiCrossApplicationPattern, ...patterns] }];
}

const globalIgnores = {
    name: 'global-ignores',
    ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.expo/**',
        '**/ios/**',
        '**/android/**',
        '**/.cache/**',
        '**/.turbo/**',
        '**/.eslintcache',
        '**/tmp/**',
        '**/temp/**',
        '**/*.tmp',
        '**/*.temp',
        '**/*.log',
        '**/.prisma/**',
        '**/generated/**',
        '**/*.generated.*',
        '**/.eslint-fixtures/**',
    ],
};

const javascriptBaseline = {
    name: 'javascript-baseline',
    languageOptions: {
        globals: {
            AbortSignal: 'readonly',
            clearTimeout: 'readonly',
            console: 'readonly',
            fetch: 'readonly',
            process: 'readonly',
            setTimeout: 'readonly',
        },
    },
    rules: {
        ...eslint.configs.recommended.rules,
        'no-console': 'error',
    },
};

function scopeExpoPattern(pattern) {
    return pattern.startsWith('**/') ? `apps/mobile/${pattern}` : `apps/mobile/**/${pattern}`;
}

const mobileExpo = expo.map((config, index) => {
    const plugins = Object.fromEntries(
        Object.entries(config.plugins ?? {}).filter(([name]) => name !== 'import' && name !== '@typescript-eslint'),
    );

    return {
        ...config,
        name: `mobile-expo/${config.name ?? index}`,
        files: config.files ? config.files.map(scopeExpoPattern) : mobileFiles,
        plugins,
    };
});

const typescriptSyntaxBaseline = tseslint.configs.recommended.map((config, index) => ({
    ...config,
    name: `typescript-syntax-baseline/${config.name ?? index}`,
    files: typescriptFiles,
}));

const typescriptTypeAware = {
    name: 'typescript-type-aware',
    files: typedApplicationFiles,
    languageOptions: {
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
        },
    },
};

const typescriptSharedSyntaxPolicies = {
    name: 'typescript-shared-syntax-policies',
    files: typescriptFiles,
    plugins: {
        'unused-imports': unusedImports,
    },
    rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'unused-imports/no-unused-imports': 'error',
        'unused-imports/no-unused-vars': [
            'error',
            {
                args: 'after-used',
                argsIgnorePattern: '^_',
                caughtErrors: 'all',
                caughtErrorsIgnorePattern: '^_',
                vars: 'all',
                varsIgnorePattern: '^_',
            },
        ],
        '@typescript-eslint/consistent-type-imports': [
            'error',
            {
                fixStyle: 'separate-type-imports',
                prefer: 'type-imports',
            },
        ],
        '@typescript-eslint/naming-convention': [
            'error',
            {
                selector: 'variableLike',
                format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
                leadingUnderscore: 'allow',
            },
            {
                selector: 'typeLike',
                format: ['PascalCase'],
            },
        ],
        '@typescript-eslint/no-explicit-any': [
            'error',
            {
                fixToUnknown: false,
                ignoreRestArgs: true,
            },
        ],
        'no-unreachable': 'error',
    },
};

const typescriptSharedTypeAwarePolicies = {
    name: 'typescript-shared-type-aware-policies',
    files: typedApplicationFiles,
    rules: {
        '@typescript-eslint/no-floating-promises': [
            'error',
            {
                ignoreIIFE: false,
                ignoreVoid: false,
            },
        ],
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/no-unnecessary-condition': [
            'error',
            {
                allowConstantLoopConditions: 'only-allowed-literals',
            },
        ],
        '@typescript-eslint/no-unnecessary-type-assertion': 'error',
        '@typescript-eslint/no-unnecessary-type-parameters': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
        '@typescript-eslint/no-unsafe-assignment': 'error',
        '@typescript-eslint/no-unsafe-call': 'error',
        '@typescript-eslint/no-unsafe-member-access': 'error',
        '@typescript-eslint/no-unsafe-return': 'error',
        '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
};

const typescriptImportPolicies = {
    name: 'typescript-import-policies',
    files: importFiles,
    plugins: {
        import: importPlugin,
    },
    settings: {
        'import/extensions': ['.js', '.jsx', '.ts', '.tsx'],
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        'import/resolver': {
            typescript: {
                alwaysTryTypes: true,
                extensions: [
                    '.ios.ts',
                    '.android.ts',
                    '.native.ts',
                    '.ios.tsx',
                    '.android.tsx',
                    '.native.tsx',
                    '.ts',
                    '.tsx',
                    '.js',
                    '.jsx',
                ],
                noWarnOnMultipleProjects: true,
                project: ['./apps/mobile/tsconfig.json', './apps/api/tsconfig.json'],
            },
        },
    },
    rules: {
        'import/no-duplicates': 'error',
        'import/no-unresolved': [
            'error',
            {
                caseSensitive: true,
                commonjs: true,
            },
        ],
        'import/order': [
            'error',
            {
                alphabetize: {
                    caseInsensitive: true,
                    order: 'asc',
                },
                groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
                'newlines-between': 'always',
                warnOnUnassignedImports: false,
            },
        ],
    },
};

const mobileFoundation = {
    name: 'mobile-foundation',
    files: mobileFiles,
    rules: {
        'react-hooks/exhaustive-deps': 'error',
        'no-restricted-imports': [
            'error',
            {
                patterns: [
                    {
                        message: 'Mobile code must not import API application code.',
                        regex: '^(?:\\.\\./)+api/src/',
                    },
                ],
            },
        ],
    },
};

const mobileNativePolicies = {
    name: 'mobile-native-policies',
    files: mobileFiles,
    plugins: {
        'react-native': reactNative,
    },
    rules: {
        'react-native/no-inline-styles': 'off',
        'react-native/no-raw-text': 'error',
        'react-native/no-unused-styles': 'error',
    },
};

const mobileReactivePolicies = {
    name: 'mobile-reactive-policies',
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/mobile/.eslint-fixtures/invalid-mobile.tsx'],
    plugins: {
        'rxjs-x': rxjs,
    },
    rules: {
        'rxjs-x/no-async-subscribe': 'error',
        'rxjs-x/no-floating-observables': [
            'error',
            {
                ignoreVoid: false,
            },
        ],
        'rxjs-x/no-misused-observables': 'error',
    },
};

const mobileTestPolicies = {
    name: 'mobile-test-policies',
    files: mobileTestFiles,
    plugins: {
        'testing-library': testingLibrary,
        vitest,
    },
    rules: {
        'testing-library/await-async-queries': 'error',
        'testing-library/no-await-sync-queries': 'error',
        'testing-library/no-promise-in-fire-event': 'error',
        'testing-library/no-wait-for-side-effects': 'error',
        'vitest/no-focused-tests': 'error',
        'vitest/no-identical-title': 'error',
        'vitest/valid-expect': 'error',
        'vitest/valid-title': 'error',
    },
};

const mobileStandaloneTestHelperPolicies = {
    name: 'mobile-standalone-test-helper-policies',
    files: mobileStandaloneTestHelperFiles,
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
    },
};

const apiFoundation = {
    name: 'api-foundation',
    files: apiFiles,
    rules: {
        'no-restricted-imports': restrictedApiImports(),
    },
};

const apiHttpBoundaryPolicies = {
    name: 'api-http-boundary-policies',
    files: ['apps/api/src/**/http/**/*.ts'],
    ignores: [
        ...apiTestFiles,
        'apps/api/src/auth/http/auth-http.helpers.ts',
        'apps/api/src/legal/http/dto/legal.dto.ts',
        'apps/api/src/legal/http/legal.controller.ts',
        'apps/api/src/sessions/http/access-session.guard.ts',
    ],
    rules: {
        'no-restricted-imports': restrictedApiImports(
            {
                message:
                    'HTTP code must delegate through application/domain ports instead of importing infrastructure.',
                regex: '(?:^|/)infrastructure(?:/|$)',
            },
            {
                message: 'HTTP code must not access Prisma or Redis directly.',
                regex: '^(?:@prisma/client|redis|(?:\\.\\./)+prisma(?:/|$))',
            },
        ),
    },
};

const apiApplicationBoundaryPolicies = {
    name: 'api-application-boundary-policies',
    files: ['apps/api/src/**/application/**/*.ts'],
    ignores: apiTestFiles,
    rules: {
        'no-restricted-imports': restrictedApiImports({
            message: 'Application code must not depend on the HTTP transport layer.',
            regex: '(?:^|/)http(?:/|$)',
        }),
    },
};

const apiDomainBoundaryPolicies = {
    name: 'api-domain-boundary-policies',
    files: ['apps/api/src/**/domain/**/*.ts'],
    ignores: apiTestFiles,
    rules: {
        'no-restricted-imports': restrictedApiImports({
            message: 'Domain code must not depend on application, HTTP, or infrastructure layers.',
            regex: '(?:^|/)(?:application|http|infrastructure)(?:/|$)',
        }),
    },
};

const apiInfrastructureBoundaryPolicies = {
    name: 'api-infrastructure-boundary-policies',
    files: ['apps/api/src/**/infrastructure/**/*.ts'],
    ignores: apiTestFiles,
    rules: {
        'no-restricted-imports': restrictedApiImports({
            message: 'Infrastructure code must not depend on the HTTP transport layer.',
            regex: '(?:^|/)http(?:/|$)',
        }),
    },
};

const apiCommonBoundaryPolicies = {
    name: 'api-common-boundary-policies',
    files: ['apps/api/src/common/**/*.ts'],
    ignores: [...apiTestFiles, 'apps/api/src/common/testing/**/*.ts'],
    rules: {
        'no-restricted-imports': restrictedApiImports({
            message: 'Common code must not depend on feature-owned layers.',
            regex: '^(?:\\.\\./)+(?:auth|health|legal|observability|otp|sessions|sms|users)(?:/|$)',
        }),
    },
};

const apiPrivateProviderExceptionPolicies = {
    name: 'api-private-provider-exception-policies',
    files: ['apps/api/src/sms/infrastructure/orange/**/*.ts', 'apps/api/src/sms/sms.module.ts'],
    rules: {
        'no-restricted-imports': compositionRootApiImports({
            message: 'Orange infrastructure must not depend on the HTTP layer.',
            regex: '(?:^|/)http(?:/|$)',
        }),
    },
};

const apiTestBoundaryPolicies = {
    name: 'api-test-boundary-policies',
    files: apiTestFiles,
    rules: {
        'no-restricted-imports': compositionRootApiImports(),
    },
};

const apiInvalidFixtureBoundaryPolicies = {
    name: 'api-invalid-fixture-boundary-policies',
    files: ['apps/api/.eslint-fixtures/invalid-api.ts'],
    rules: {
        'no-restricted-imports': restrictedApiImports(
            {
                message: 'HTTP fixtures must not import infrastructure directly.',
                regex: '(?:^|/)infrastructure(?:/|$)',
            },
            {
                message: 'Domain fixtures must not import application code.',
                regex: '(?:^|/)application(?:/|$)',
            },
        ),
    },
};

const testPolicies = {
    name: 'test-policies',
    files: testFiles,
    plugins: {
        vitest,
    },
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
        'vitest/no-focused-tests': 'error',
        'vitest/no-identical-title': 'error',
        'vitest/valid-title': 'error',
    },
};

const mockAndFixturePolicies = {
    name: 'mock-and-fixture-policies',
    files: mockAndFixtureFiles,
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
    },
};

const migrationAndSeedPolicies = {
    ...tseslint.configs.disableTypeChecked,
    name: 'migration-and-seed-policies',
    files: migrationAndSeedFiles,
    rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        'no-console': 'off',
    },
};

const toolingPolicies = {
    ...tseslint.configs.disableTypeChecked,
    name: 'tooling-policies',
    files: toolingFiles,
    rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        'no-console': 'off',
    },
};

const apiSpecialTypeAwarePolicies = {
    name: 'api-special-type-aware-policies',
    files: apiSpecialTypeAwareFiles,
    languageOptions: {
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
        },
    },
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-floating-promises': [
            'error',
            {
                ignoreIIFE: false,
                ignoreVoid: false,
            },
        ],
        '@typescript-eslint/no-misused-promises': 'error',
        'no-console': 'off',
    },
};

const prettierCompatibility = {
    ...prettier,
    name: 'prettier-compatibility',
};

export default tseslint.config(
    globalIgnores,
    javascriptBaseline,
    ...typescriptSyntaxBaseline,
    ...mobileExpo,
    typescriptSharedSyntaxPolicies,
    typescriptTypeAware,
    typescriptSharedTypeAwarePolicies,
    typescriptImportPolicies,
    mobileFoundation,
    mobileNativePolicies,
    mobileReactivePolicies,
    apiFoundation,
    apiHttpBoundaryPolicies,
    apiApplicationBoundaryPolicies,
    apiDomainBoundaryPolicies,
    apiInfrastructureBoundaryPolicies,
    apiCommonBoundaryPolicies,
    apiPrivateProviderExceptionPolicies,
    apiTestBoundaryPolicies,
    apiInvalidFixtureBoundaryPolicies,
    testPolicies,
    mobileTestPolicies,
    mobileStandaloneTestHelperPolicies,
    mockAndFixturePolicies,
    migrationAndSeedPolicies,
    toolingPolicies,
    apiSpecialTypeAwarePolicies,
    prettierCompatibility,
);
