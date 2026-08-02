import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const supportedGroups = new Set(['shared', 'mobile', 'api', 'commands']);

const sharedInvalidRuleIds = [
    '@typescript-eslint/consistent-type-imports',
    '@typescript-eslint/naming-convention',
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/no-floating-promises',
    '@typescript-eslint/no-misused-promises',
    '@typescript-eslint/no-unnecessary-condition',
    '@typescript-eslint/no-unnecessary-type-assertion',
    '@typescript-eslint/no-unnecessary-type-parameters',
    '@typescript-eslint/no-unsafe-argument',
    '@typescript-eslint/no-unsafe-assignment',
    '@typescript-eslint/no-unsafe-call',
    '@typescript-eslint/no-unsafe-member-access',
    '@typescript-eslint/no-unsafe-return',
    '@typescript-eslint/return-await',
    'import/no-unresolved',
    'import/order',
    'no-console',
    'no-dupe-else-if',
    'no-duplicate-case',
    'no-restricted-imports',
    'no-unreachable',
    'unused-imports/no-unused-imports',
    'unused-imports/no-unused-vars',
];

const fixtureCases = [
    {
        name: 'mobile-shared-invalid',
        group: 'shared',
        files: ['apps/mobile/.eslint-fixtures/invalid-shared.ts'],
        expectedRuleIds: sharedInvalidRuleIds,
        forbiddenRuleIds: ['@typescript-eslint/no-unused-vars', 'no-unused-vars'],
        expectedExitCode: 1,
    },
    {
        name: 'mobile-shared-valid',
        group: 'shared',
        files: ['apps/mobile/.eslint-fixtures/valid-shared.ts'],
        expectedRuleIds: [],
        forbiddenRuleIds: ['@typescript-eslint/no-unused-vars', 'no-unused-vars'],
        expectedExitCode: 0,
    },
    {
        name: 'api-shared-invalid',
        group: 'shared',
        files: ['apps/api/.eslint-fixtures/invalid-shared.ts'],
        expectedRuleIds: sharedInvalidRuleIds,
        forbiddenRuleIds: ['@typescript-eslint/no-unused-vars', 'no-unused-vars'],
        expectedExitCode: 1,
    },
    {
        name: 'api-shared-valid',
        group: 'shared',
        files: ['apps/api/.eslint-fixtures/valid-shared.ts'],
        expectedRuleIds: [],
        forbiddenRuleIds: ['@typescript-eslint/no-unused-vars', 'no-unused-vars'],
        expectedExitCode: 0,
    },
    {
        name: 'shared-console-allowed',
        group: 'shared',
        files: ['apps/mobile/.eslint-fixtures/allowed-console.config.ts'],
        expectedRuleIds: [],
        forbiddenRuleIds: ['no-console'],
        expectedExitCode: 0,
    },
    {
        name: 'mobile-production-invalid',
        group: 'mobile',
        files: ['apps/mobile/.eslint-fixtures/invalid-mobile.tsx'],
        expectedRuleIds: [
            '@typescript-eslint/no-floating-promises',
            '@typescript-eslint/no-misused-promises',
            'no-restricted-imports',
            'react-hooks/exhaustive-deps',
            'react-hooks/rules-of-hooks',
            'react/jsx-key',
            'react-native/no-raw-text',
            'react-native/no-unused-styles',
            'rxjs-x/no-async-subscribe',
            'rxjs-x/no-floating-observables',
            'rxjs-x/no-misused-observables',
        ],
        forbiddenRuleIds: ['jsx-a11y/alt-text', 'jsx-a11y/tabindex-no-positive', 'react-native/no-inline-styles'],
        expectedExitCode: 1,
    },
    {
        name: 'mobile-test-invalid',
        group: 'mobile',
        files: ['apps/mobile/.eslint-fixtures/invalid-mobile.spec.tsx'],
        expectedRuleIds: ['testing-library/no-await-sync-queries', 'vitest/no-focused-tests'],
        expectedExitCode: 1,
    },
    {
        name: 'mobile-platform-valid',
        group: 'mobile',
        files: [
            'apps/mobile/.eslint-fixtures/valid-platform-import.tsx',
            'apps/mobile/.eslint-fixtures/platform-target.ios.ts',
            'apps/mobile/.eslint-fixtures/platform-target.android.ts',
        ],
        expectedRuleIds: [],
        forbiddenRuleIds: ['jsx-a11y/alt-text', 'jsx-a11y/tabindex-no-positive', 'react-native/no-inline-styles'],
        expectedExitCode: 0,
    },
    {
        name: 'api-production-invalid',
        group: 'api',
        files: ['apps/api/.eslint-fixtures/invalid-api.ts'],
        expectedRuleIds: [
            '@typescript-eslint/no-floating-promises',
            '@typescript-eslint/no-misused-promises',
            'no-console',
            'no-restricted-imports',
        ],
        expectedExitCode: 1,
    },
    {
        name: 'api-nest-runtime-valid',
        group: 'api',
        files: ['apps/api/.eslint-fixtures/valid-nest-runtime-import.ts'],
        expectedRuleIds: [],
        forbiddenRuleIds: ['@typescript-eslint/consistent-type-imports'],
        expectedExitCode: 0,
    },
    {
        name: 'api-special-paths-valid',
        group: 'api',
        files: [
            'apps/api/.eslint-fixtures/migrations/valid-migration.ts',
            'apps/api/.eslint-fixtures/seeds/valid-seed.ts',
            'apps/api/.eslint-fixtures/scripts/valid-script.ts',
            'apps/api/.eslint-fixtures/mocks/valid-mock.ts',
        ],
        expectedRuleIds: [],
        forbiddenRuleIds: ['@typescript-eslint/no-explicit-any', 'no-console'],
        expectedExitCode: 0,
    },
];

const expectedScripts = {
    root: {
        lint: 'eslint --max-warnings=0 .',
        'lint:mobile': 'pnpm --filter @kaynann/mobile lint',
        'lint:api': 'pnpm --filter @kaynann/api lint',
        'lint:fix': 'eslint --max-warnings=0 . --fix',
        'lint:rules:test': 'node scripts/verify-eslint-rules.mjs',
        'format:check': 'prettier --check .',
    },
    mobile: {
        lint: 'eslint --max-warnings=0 src __tests__ index.ts app.config.ts vitest.config.ts vitest.setup.ts',
        'lint:fix':
            'eslint --max-warnings=0 src __tests__ index.ts app.config.ts vitest.config.ts vitest.setup.ts --fix',
    },
    api: {
        lint: 'eslint --max-warnings=0 src test vitest.config.ts',
        'lint:fix': 'eslint --max-warnings=0 src test vitest.config.ts --fix',
    },
};

const commandCases = [
    {
        name: 'command-script-contract',
        run() {
            const manifests = {
                root: 'package.json',
                mobile: 'apps/mobile/package.json',
                api: 'apps/api/package.json',
            };

            for (const [scope, manifestPath] of Object.entries(manifests)) {
                const manifest = JSON.parse(readFileSync(new URL(manifestPath, new URL('../', import.meta.url))));

                for (const [name, expected] of Object.entries(expectedScripts[scope])) {
                    const actual = manifest.scripts?.[name];
                    if (actual !== expected) {
                        throw new Error(
                            `${manifestPath} script ${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
                        );
                    }
                }
            }
        },
    },
    {
        name: 'command-fixture-isolation',
        run() {
            const ignored = runEslint(['apps/api/.eslint-fixtures/invalid-api.ts']);
            const ignoredMessages = ignored.reports.flatMap((report) => report.messages);
            if (
                ignored.exitCode !== 0 ||
                ignoredMessages.length !== 1 ||
                !ignoredMessages[0].message.includes('File ignored')
            ) {
                throw new Error('Normal ESLint execution did not ignore API fixtures');
            }

            const invalid = runEslint(['apps/api/.eslint-fixtures/invalid-api.ts'], true);
            if (invalid.exitCode === 0) {
                throw new Error('Explicit invalid fixture execution returned zero');
            }

            const valid = runEslint(['apps/api/.eslint-fixtures/valid-nest-runtime-import.ts'], true);
            if (valid.exitCode !== 0) {
                throw new Error('Explicit valid fixture execution returned non-zero');
            }
        },
    },
];

function runEslint(files, noIgnore = false) {
    const arguments_ = ['exec', 'eslint'];
    if (noIgnore) {
        arguments_.push('--no-ignore');
    }
    arguments_.push('--format', 'json', ...files);

    const result = spawnSync('pnpm', arguments_, {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    if (result.error) {
        throw result.error;
    }

    try {
        return {
            exitCode: result.status ?? 1,
            reports: JSON.parse(result.stdout),
        };
    } catch {
        throw new Error(`ESLint did not return JSON.\n${result.stderr || result.stdout}`);
    }
}

function parseArguments(arguments_) {
    const selection = {};

    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        const value = arguments_[index + 1];

        if (argument === '--group') {
            if (!value || value.startsWith('--') || !supportedGroups.has(value)) {
                throw new Error(`--group must be one of: ${[...supportedGroups].join(', ')}`);
            }
            selection.group = value;
            index += 1;
            continue;
        }

        if (argument === '--case') {
            if (!value || value.startsWith('--')) {
                throw new Error('--case requires a case name');
            }
            selection.caseName = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${argument}`);
    }

    return selection;
}

function selectCases(selection) {
    if (!selection.group) {
        const selected = [...fixtureCases, ...commandCases].filter(
            (testCase) => !selection.caseName || testCase.name === selection.caseName,
        );
        if (selection.caseName && selected.length === 0) {
            throw new Error(`Unknown fixture case: ${selection.caseName}`);
        }
        return selected;
    }

    if (selection.group === 'commands') {
        const selected = commandCases.filter(
            (commandCase) => !selection.caseName || commandCase.name === selection.caseName,
        );
        if (selection.caseName && selected.length === 0) {
            throw new Error(`Unknown fixture case: ${selection.caseName}`);
        }
        return selected;
    }

    const selected = fixtureCases.filter(
        (fixtureCase) =>
            fixtureCase.group === selection.group && (!selection.caseName || fixtureCase.name === selection.caseName),
    );

    if (selection.caseName && selected.length === 0) {
        throw new Error(`Unknown fixture case: ${selection.caseName}`);
    }

    return selected;
}

function runCase(fixtureCase) {
    if (fixtureCase.run) {
        fixtureCase.run();
        console.log(`PASS commands/${fixtureCase.name}`);
        return;
    }

    const { exitCode: actualExitCode, reports } = runEslint(fixtureCase.files, true);

    const actualRuleIds = [
        ...new Set(reports.flatMap((report) => report.messages.map((message) => message.ruleId ?? '<fatal>'))),
    ].sort();
    const expectedRuleIds = [...fixtureCase.expectedRuleIds].sort();
    const forbiddenRuleIds = fixtureCase.forbiddenRuleIds ?? [];
    const unexpectedRuleIds = actualRuleIds.filter((ruleId) => !expectedRuleIds.includes(ruleId));
    const missingRuleIds = expectedRuleIds.filter((ruleId) => !actualRuleIds.includes(ruleId));
    const presentForbiddenRuleIds = forbiddenRuleIds.filter((ruleId) => actualRuleIds.includes(ruleId));
    const mismatches = [];

    if (actualExitCode !== fixtureCase.expectedExitCode) {
        mismatches.push(`exit ${actualExitCode}, expected ${fixtureCase.expectedExitCode}`);
    }
    if (missingRuleIds.length > 0) {
        mismatches.push(`missing rules: ${missingRuleIds.join(', ')}`);
    }
    if (unexpectedRuleIds.length > 0) {
        mismatches.push(`unexpected rules: ${unexpectedRuleIds.join(', ')}`);
    }
    if (presentForbiddenRuleIds.length > 0) {
        mismatches.push(`forbidden rules: ${presentForbiddenRuleIds.join(', ')}`);
    }

    if (mismatches.length > 0) {
        throw new Error(`Case ${fixtureCase.name} failed: ${mismatches.join('; ')}`);
    }

    console.log(`PASS ${fixtureCase.group}/${fixtureCase.name}`);
}

try {
    const selection = parseArguments(process.argv.slice(2));
    const selectedCases = selectCases(selection);

    if (selectedCases.length === 0) {
        console.log('No ESLint rule fixtures registered.');
    }

    for (const fixtureCase of selectedCases) {
        runCase(fixtureCase);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
