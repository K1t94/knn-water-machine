const { readFileSync, writeFileSync } = require('fs');
const { dirname, resolve } = require('path');

const manifestPath = resolve(dirname(process.argv[1]), '..', 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

manifest.main = resolveEntryPoint(process.env);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);

function resolveEntryPoint(env) {
    if (env.APP_ENV !== 'e2e') return 'index.ts';

    if (
        env.EAS_BUILD_PROFILE !== 'machine-discovery-e2e' ||
        env.EXPO_PUBLIC_APP_ENV !== 'e2e' ||
        env.EXPO_PUBLIC_BUILD_VARIANT !== 'machine-discovery-e2e' ||
        env.EXPO_PUBLIC_PRODUCTION_DISTRIBUTABLE !== 'false'
    ) {
        throw new Error('Machine discovery E2E entrypoint requires the exact non-distributable EAS build profile.');
    }

    return 'index.e2e.ts';
}
