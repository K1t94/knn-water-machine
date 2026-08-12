import { pathToFileURL } from 'node:url';

const FEATURE_PATH = '/internal/feature-flags/referral-program';

export async function setReferralFeature(
    target,
    { env = process.env, fetchImpl = globalThis.fetch, output = process.stdout } = {},
) {
    if (target !== 'enabled' && target !== 'disabled') {
        throw new Error('Usage: set-referral-feature.mjs <enabled|disabled>');
    }

    const apiUrl = requiredEnv(env, 'REFERRAL_OPERATIONS_URL');
    const token = requiredEnv(env, 'REFERRAL_OPERATIONS_TOKEN');
    const endpoint = new globalThis.URL(FEATURE_PATH, ensureTrailingSlash(apiUrl));
    const enabled = target === 'enabled';

    await requestState(fetchImpl, endpoint, token, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
    });
    const state = await requestState(fetchImpl, endpoint, token, { method: 'GET' });
    if (state.enabled !== enabled) {
        throw new Error(`Referral feature verification failed: expected enabled=${enabled}.`);
    }

    output.write(`Referral feature is ${enabled ? 'enabled' : 'disabled'} (revision ${state.revision}).\n`);
    return state;
}

async function requestState(fetchImpl, endpoint, token, init) {
    let response;
    try {
        response = await fetchImpl(endpoint, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
        });
    } catch {
        throw new Error('Referral feature operation failed: server is unreachable.');
    }

    if (!response.ok) {
        throw new Error(`Referral feature operation failed with HTTP ${response.status}.`);
    }

    let state;
    try {
        state = await response.json();
    } catch {
        throw new Error('Referral feature operation returned malformed JSON.');
    }
    if (!isFeatureState(state)) {
        throw new Error('Referral feature operation returned an invalid state.');
    }
    return state;
}

function isFeatureState(value) {
    return (
        typeof value === 'object' &&
        value !== null &&
        value.key === 'REFERRAL_PROGRAM' &&
        typeof value.enabled === 'boolean' &&
        typeof value.revision === 'string' &&
        /^\d+$/.test(value.revision) &&
        typeof value.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(value.updatedAt))
    );
}

function requiredEnv(env, name) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function ensureTrailingSlash(value) {
    return value.endsWith('/') ? value : `${value}/`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    setReferralFeature(process.argv[2]).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Referral feature operation failed.'}\n`);
        process.exitCode = 1;
    });
}
