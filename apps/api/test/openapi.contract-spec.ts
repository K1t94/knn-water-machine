import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTH_ERROR_CODES } from '../src/auth/http/auth-error-code';

type OpenApiOperation = {
    parameters?: Array<{ name?: string; required?: boolean }>;
    responses?: Record<string, unknown>;
    security?: Array<Record<string, unknown>>;
};

type OpenApiDocument = {
    paths: Record<string, Record<string, OpenApiOperation>>;
    components: {
        schemas: Record<string, Record<string, unknown>>;
    };
};

const featureTwoContracts = resolve(__dirname, '../../../specs/002-phone-otp-auth/contracts');
const featureFourContracts = resolve(__dirname, '../../../specs/004-water-wallet-ledger/contracts');
const featureFiveContracts = resolve(__dirname, '../../../specs/005-referral-program/contracts');
const generated = JSON.parse(
    readFileSync(resolve(featureFiveContracts, 'openapi.generated.json'), 'utf8'),
) as OpenApiDocument;
const authSourceContract = readFileSync(resolve(featureTwoContracts, 'openapi.yaml'), 'utf8');
const walletSourceContract = readFileSync(resolve(featureFourContracts, 'openapi.yaml'), 'utf8');
const referralSourceContract = readFileSync(resolve(featureFiveContracts, 'openapi.yaml'), 'utf8');

const publicPaths = [
    '/v1/auth/otp/requests',
    '/v1/auth/otp/requests/{challengeId}/resend',
    '/v1/auth/otp/verifications',
    '/v1/auth/registration/context',
    '/v1/legal/documents/current',
    '/v1/auth/registration/complete',
    '/v1/auth/legal/acceptances',
    '/v1/auth/sessions/refresh',
    '/v1/auth/sessions/current',
    '/v1/integrations/orange/sms/delivery-receipts',
] as const;

function operation(path: string, method: string): OpenApiOperation {
    const result = generated.paths[path][method];
    expect(result, `${method.toUpperCase()} ${path}`).toBeDefined();
    return result;
}

describe('generated aggregate OpenAPI contract', () => {
    it('retains every feature 002 endpoint without exposing internal metrics', () => {
        for (const path of publicPaths) {
            expect(generated.paths).toHaveProperty(path);
            expect(authSourceContract).toContain(`  ${path}:`);
        }

        expect(generated.paths).not.toHaveProperty('/internal/metrics');
    });

    it('publishes the feature 004 balance read contract without wallet writes', () => {
        expect(walletSourceContract).toContain('    /v1/wallet/balance:');
        const balance = operation('/v1/wallet/balance', 'get');

        expect(balance.security).toContainEqual({ AccessBearer: [] });
        expect(Object.keys(balance.responses ?? {})).toEqual(['200', '401', '503']);
        expect(generated.paths['/v1/wallet/balance']).not.toHaveProperty('post');
        expect(generated.paths['/v1/wallet/balance']).not.toHaveProperty('patch');
        expect(generated.paths['/v1/wallet/balance']).not.toHaveProperty('delete');

        const response = generated.components.schemas.WalletBalanceResponseDto as {
            properties: Record<string, { pattern?: string }>;
            required: string[];
        };
        expect(response.required).toEqual(['balanceMl', 'balanceLiters', 'observedAt']);
        expect(response.properties.balanceMl.pattern).toBe('^(0|[1-9][0-9]{0,18})$');
        expect(response.properties.balanceLiters.pattern).toBe('^(0|[1-9][0-9]*)\\.[0-9]{3}$');
    });

    it('publishes owner-scoped wallet history pagination without public write commands', () => {
        expect(walletSourceContract).toContain('    /v1/wallet/operations:');
        const history = operation('/v1/wallet/operations', 'get');

        expect(history.security).toContainEqual({ AccessBearer: [] });
        expect(Object.keys(history.responses ?? {})).toEqual(['200', '400', '401', '503']);
        expect(history.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'limit', required: false }),
                expect.objectContaining({ name: 'cursor', required: false }),
            ]),
        );

        for (const path of Object.keys(generated.paths).filter((path) => path.startsWith('/v1/wallet'))) {
            expect(Object.keys(generated.paths[path])).toEqual(['get']);
        }
        for (const forbidden of ['credit', 'debit', 'compensate', 'adjust']) {
            expect(Object.keys(generated.paths).join(' ')).not.toContain(`/v1/wallet/${forbidden}`);
        }

        const response = generated.components.schemas.WalletHistoryResponseDto as {
            properties: Record<string, unknown>;
            required: string[];
        };
        expect(response.required).toEqual(['items', 'nextCursor', 'hasMore']);
        expect(Object.keys(response.properties)).toEqual(['hasMore', 'items', 'nextCursor']);

        const entry = generated.components.schemas.WalletHistoryEntryResponseDto as {
            properties: Record<string, unknown>;
        };
        expect(Object.keys(entry.properties)).toEqual([
            'amountMl',
            'direction',
            'id',
            'occurredAt',
            'operationKind',
            'recordedAt',
            'source',
        ]);
    });

    it('publishes authenticated referral reads and natural-idempotency application', () => {
        for (const path of ['/v1/referrals/me', '/v1/referrals/applications', '/v1/referrals/invitations']) {
            expect(generated.paths).toHaveProperty(path);
            expect(referralSourceContract).toContain(`  ${path}:`);
        }

        const me = operation('/v1/referrals/me', 'get');
        const application = operation('/v1/referrals/applications', 'post');
        const invitations = operation('/v1/referrals/invitations', 'get');

        for (const endpoint of [me, application, invitations]) {
            expect(endpoint.security).toContainEqual({ AccessBearer: [] });
        }
        expect(Object.keys(me.responses ?? {})).toEqual(['200', '401', '503']);
        expect(Object.keys(application.responses ?? {})).toEqual(['200', '400', '401', '409', '503']);
        expect(Object.keys(invitations.responses ?? {})).toEqual(['200', '400', '401', '503']);
        expect(application.parameters ?? []).not.toContainEqual(expect.objectContaining({ name: 'Idempotency-Key' }));
        expect(invitations.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'limit', required: false }),
                expect.objectContaining({ name: 'cursor', required: false }),
            ]),
        );
    });

    it('exposes only privacy-safe referral response fields and no operational endpoints', () => {
        const summary = generated.components.schemas.MyReferralResponseDto as {
            properties: Record<string, unknown>;
        };
        expect(Object.keys(summary.properties)).toEqual([
            'attachedPromoCode',
            'creditedInvitationCount',
            'creditedInviterBonusMl',
            'currentInviterRewardMl',
            'eligibility',
            'promoCode',
            'referralLink',
        ]);

        const invitation = generated.components.schemas.ReferralInvitationResponseDto as {
            properties: Record<string, unknown>;
        };
        expect(Object.keys(invitation.properties)).toEqual([
            'appliedAt',
            'creditedAmountMl',
            'id',
            'inviteeLabel',
            'status',
        ]);

        const allPaths = Object.keys(generated.paths).join(' ');
        for (const forbidden of [
            '/v1/referrals/recovery',
            '/v1/referrals/provisioning',
            '/v1/referrals/eligibility',
            '/v1/referrals/bonuses',
            '/v1/referrals/relationships',
            '/v1/wallet/credit',
        ]) {
            expect(allPaths).not.toContain(forbidden);
        }
    });

    it('keeps status codes, authorization, and idempotency explicit', () => {
        expect(Object.keys(operation('/v1/auth/otp/requests', 'post').responses ?? {})).toEqual([
            '202',
            '400',
            '429',
            '503',
        ]);
        expect(Object.keys(operation('/v1/auth/otp/verifications', 'post').responses ?? {})).toEqual([
            '200',
            '400',
            '409',
            '429',
            '503',
        ]);

        for (const path of [
            '/v1/auth/registration/context',
            '/v1/legal/documents/current',
            '/v1/auth/registration/complete',
            '/v1/auth/legal/acceptances',
        ]) {
            const method = path.endsWith('/context') ? 'patch' : path.endsWith('/current') ? 'get' : 'post';
            expect(operation(path, method).security).toContainEqual({ RegistrationAuth: [] });
        }

        expect(operation('/v1/auth/sessions/current', 'delete').security).toContainEqual({
            AccessBearer: [],
        });

        for (const path of ['/v1/auth/registration/complete', '/v1/auth/legal/acceptances']) {
            expect(operation(path, 'post').parameters).toContainEqual(
                expect.objectContaining({ name: 'Idempotency-Key', required: true }),
            );
        }

        expect(Object.keys(operation('/v1/integrations/orange/sms/delivery-receipts', 'post').responses ?? {})).toEqual(
            ['200', '400', '403', '404'],
        );
    });

    it('documents no-store token responses and correct read/write token direction', () => {
        for (const [path, method] of [
            ['/v1/auth/otp/verifications', 'post'],
            ['/v1/auth/registration/complete', 'post'],
            ['/v1/auth/legal/acceptances', 'post'],
            ['/v1/auth/sessions/refresh', 'post'],
        ] as const) {
            const success = operation(path, method).responses?.['200'] as {
                headers?: Record<string, unknown>;
            };
            expect(success.headers).toHaveProperty('Cache-Control');
        }

        const credentials = generated.components.schemas.SessionCredentialsDto as {
            properties: Record<string, { writeOnly?: boolean }>;
            required: string[];
        };
        expect(credentials.required).toEqual(['accessToken', 'accessExpiresAt', 'refreshToken', 'refreshExpiresAt']);
        expect(credentials.properties.accessToken.writeOnly).not.toBe(true);
        expect(credentials.properties.refreshToken.writeOnly).not.toBe(true);

        const refreshRequest = generated.components.schemas.RefreshSessionDto as {
            properties: Record<string, { writeOnly?: boolean }>;
        };
        expect(refreshRequest.properties.refreshToken.writeOnly).toBe(true);
    });

    it('publishes stable product errors without OTP or provider response fields', () => {
        const errorBody = generated.components.schemas.AuthErrorBodyDto as {
            properties: { code: { enum: string[] } };
        };
        expect(errorBody.properties.code.enum).toEqual(AUTH_ERROR_CODES);

        for (const schemaName of ['OtpIssuedResponseDto', 'OtpVerifiedResponseDto']) {
            const schema = generated.components.schemas[schemaName] as {
                properties?: Record<string, unknown>;
            };
            const fields = Object.keys(schema.properties ?? {}).map((field) => field.toLowerCase());
            expect(fields).not.toContain('code');
            expect(fields).not.toContain('otp');
            expect(fields).not.toContain('providermessageid');
            expect(fields).not.toContain('providerpayload');
        }
    });
});
