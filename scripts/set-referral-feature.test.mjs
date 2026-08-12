import assert from 'node:assert/strict';
import test from 'node:test';

import { setReferralFeature } from './set-referral-feature.mjs';

const token = 'secret-value-that-must-never-be-printed';
const env = {
    REFERRAL_OPERATIONS_URL: 'https://api.example.test',
    REFERRAL_OPERATIONS_TOKEN: token,
};

test('requires URL and token environment variables', async () => {
    await assert.rejects(
        () => setReferralFeature('enabled', { env: {}, fetchImpl: fetch }),
        /OPERATIONS_URL is required/,
    );
    await assert.rejects(
        () =>
            setReferralFeature('enabled', {
                env: { REFERRAL_OPERATIONS_URL: env.REFERRAL_OPERATIONS_URL },
                fetchImpl: fetch,
            }),
        /TOKEN is required/,
    );
});

test('performs PUT then GET and verifies enabled and disabled states', async () => {
    for (const target of ['enabled', 'disabled']) {
        const calls = [];
        const output = bufferOutput();
        const expected = target === 'enabled';
        const fetchImpl = async (url, init) => {
            calls.push({ url: String(url), init });
            return jsonResponse({
                key: 'REFERRAL_PROGRAM',
                enabled: expected,
                revision: '4',
                updatedAt: '2026-08-12T12:00:00.000Z',
            });
        };
        await setReferralFeature(target, { env, fetchImpl, output });
        assert.deepEqual(
            calls.map(({ init }) => init.method),
            ['PUT', 'GET'],
        );
        assert.equal(calls[0].init.body, JSON.stringify({ enabled: expected }));
        assert.match(output.value, new RegExp(target));
        assert.doesNotMatch(output.value, new RegExp(token));
    }
});

test('fails on non-2xx, malformed responses, mismatch, and network errors without exposing token', async () => {
    const cases = [
        async () => new globalThis.Response('{}', { status: 401 }),
        async () => new globalThis.Response('not-json', { status: 200 }),
        async () => jsonResponse({ key: 'wrong' }),
        async () => {
            throw new Error(token);
        },
    ];
    for (const fetchImpl of cases) {
        await assert.rejects(
            () => setReferralFeature('enabled', { env, fetchImpl, output: bufferOutput() }),
            (error) => error instanceof Error && !error.message.includes(token),
        );
    }

    let call = 0;
    await assert.rejects(
        () =>
            setReferralFeature('enabled', {
                env,
                output: bufferOutput(),
                fetchImpl: async () =>
                    jsonResponse({
                        key: 'REFERRAL_PROGRAM',
                        enabled: call++ === 0,
                        revision: '5',
                        updatedAt: '2026-08-12T12:00:00.000Z',
                    }),
            }),
        /verification failed/,
    );
});

function jsonResponse(body) {
    return new globalThis.Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function bufferOutput() {
    return {
        value: '',
        write(value) {
            this.value += value;
        },
    };
}
