import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

const requiredPaths = [
  'apps/api/src/main.ts',
  'apps/api/src/health/health.controller.ts',
  'apps/api/src/config/env.ts',
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/migrations/20260722000000_bootstrap_connectivity/migration.sql',
  'apps/mobile/index.ts',
  'apps/mobile/src/App.tsx',
  'apps/mobile/__tests__/App.test.tsx',
  'infra/compose.yaml',
  'infra/mosquitto/mosquitto.conf',
  'scripts/verify-startup.mjs',
  'scripts/mobile-doctor.mjs',
  'docs/local-development.md',
  'specs/000-project-onboarding/repo-map.md',
  '.env.example',
];
const requiredScripts = [
  'services:up',
  'services:down',
  'db:migrate',
  'dev',
  'dev:api',
  'dev:mobile',
  'verify:start',
  'lint',
  'typecheck',
  'test',
  'build:api',
  'build:mobile:js',
  'check:env',
  'check:repo',
];
const ignoredPaths = [
  ['.env', '.env'],
  ['dist', 'apps/api/dist/.bootstrap-ignore-probe'],
  ['dist', 'apps/mobile/dist/.bootstrap-ignore-probe'],
  ['node_modules', 'node_modules/.bootstrap-ignore-probe'],
  ['coverage', 'coverage/.bootstrap-ignore-probe'],
];

const errors = [];
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const gitignore = await readFile('.gitignore', 'utf8');
const repoMap = await readFile('specs/000-project-onboarding/repo-map.md', 'utf8');

for (const path of requiredPaths) {
  try {
    await access(path);
  } catch {
    errors.push(`missing required path: ${path}`);
  }
}

for (const script of requiredScripts) {
  if (typeof rootPackage.scripts?.[script] !== 'string') {
    errors.push(`missing root script: ${script}`);
  }
}

for (const [rule, probe] of ignoredPaths) {
  if (!gitignore.includes(rule) && !(rule === 'node_modules' && gitignore.includes('node_modules/'))) {
    errors.push(`missing ignore rule: ${rule}`);
  }
  const result = await import('node:child_process').then(({ execFileSync }) => {
    try {
      execFileSync('git', ['check-ignore', '-q', probe]);
      return true;
    } catch {
      return false;
    }
  });
  if (!result) errors.push(`path is not ignored by git: ${probe}`);
}

for (const marker of ['apps/api/src/main.ts', 'apps/mobile/index.ts', 'infra/compose.yaml', 'pnpm verify:start']) {
  if (!repoMap.includes(marker)) errors.push(`repo map is missing factual marker: ${marker}`);
}

if (errors.length > 0) {
  console.error(['Repository bootstrap check failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
  process.exit(1);
}

console.log('Repository bootstrap check passed: paths, commands, map, and ignore rules are present.');
