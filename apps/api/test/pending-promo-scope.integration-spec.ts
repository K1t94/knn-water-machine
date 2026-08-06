import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RegistrationService } from '../src/auth/application/registration.service';
import { CredentialCryptoService } from '../src/common/security/credential-crypto.service';
import { LegalService } from '../src/legal/application/legal.service';

import type { RegistrationAuthorizationStore } from '../src/auth/infrastructure/redis/registration-authorization.store';
import type { LegalRepository } from '../src/legal/infrastructure/postgres/legal.repository';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { SessionsService } from '../src/sessions/application/sessions.service';
import type { UsersRepository } from '../src/users/infrastructure/postgres/users.repository';

const credentials = {
    accessToken: 'access-token',
    accessExpiresAt: '2030-01-01T00:15:00.000Z',
    refreshToken: 'refresh-token-that-is-long-enough-for-the-contract',
    refreshExpiresAt: '2030-03-01T00:00:00.000Z',
};
const documentId = '00000000-0000-4000-8000-000000000001';

describe('pending promo scope', () => {
    beforeAll(() => configureEnvironment());

    it('does not validate, persist, award, or block on pending promo', async () => {
        const crypto = new CredentialCryptoService();
        const installationId = 'installation-promo-scope-0001';
        const registration = {
            inspect: vi.fn(async () => ({
                tokenDigest: 'a'.repeat(64),
                flowId: '00000000-0000-4000-8000-000000000010',
                challengeId: '00000000-0000-4000-8000-000000000011',
                phoneE164: '+221771234567',
                phoneConfirmedAt: new Date('2030-01-01T00:00:00.000Z'),
                installationFingerprint: crypto.fingerprintInstallation(installationId).digest,
                pendingPromoCode: 'NOT-VALIDATED-BY-THIS-FEATURE',
                state: 'ACTIVE',
                expiresAt: new Date('2030-01-01T00:15:00.000Z'),
            })),
            beginCompletion: vi.fn(async () => ({
                status: 'started',
                tokenDigest: 'a'.repeat(64),
                flowId: '00000000-0000-4000-8000-000000000010',
                owner: 'owner',
                completionKeyDigest: 'b'.repeat(64),
                userId: '00000000-0000-4000-8000-000000000020',
                sessionId: '00000000-0000-4000-8000-000000000030',
                familyId: '00000000-0000-4000-8000-000000000040',
                leaseExpiresAt: new Date(Date.now() + 30_000),
            })),
            prepareResult: vi.fn(async () => undefined),
            complete: vi.fn(async () => undefined),
            recoverResult: vi.fn(async () => credentials),
        };
        const documents = [
            {
                id: documentId,
                kind: 'TERMS_OF_SERVICE',
                version: '1',
                locale: 'fr-SN',
                title: 'Terms',
                content: 'Terms',
                contentSha256: '1'.repeat(64),
                mandatory: true,
            },
        ];
        const legalRepository = {
            currentMandatory: vi.fn(async () => documents),
            currentMandatoryInTransaction: vi.fn(async () => documents),
            createAcceptancesInTransaction: vi.fn(async () => ({ count: 1 })),
        };
        const users = {
            findByPhoneInTransaction: vi.fn(async () => null),
            upsertConfirmedInTransaction: vi.fn(async () => ({
                id: '00000000-0000-4000-8000-000000000020',
            })),
        };
        const sessions = {
            prepareInitialCredentials: vi.fn(async () => credentials),
            createInitialInTransaction: vi.fn(async () => ({
                id: '00000000-0000-4000-8000-000000000030',
            })),
        };
        const prisma = {
            $transaction: vi.fn(async (callback: (transaction: object) => Promise<void>) => callback({})),
        };
        const service = new RegistrationService(
            prisma as unknown as PrismaService,
            registration as unknown as RegistrationAuthorizationStore,
            new LegalService(legalRepository as unknown as LegalRepository),
            legalRepository as unknown as LegalRepository,
            users as unknown as UsersRepository,
            sessions as unknown as SessionsService,
            crypto,
            {
                prevalidatePendingPromo: vi.fn(async () => '23456789ABCD'),
                completeOnboarding: vi.fn(async () => ({
                    promoCode: '23456789ABCD',
                    relationshipCreated: true,
                    entitlementIds: [],
                })),
                deliverAfterCommit: vi.fn(async () => undefined),
            } as never,
        );

        await expect(
            service.complete({
                registrationAuthorization: 'registration-authorization',
                idempotencyKey: 'pending-promo-scope-attempt',
                setVersion: await currentSetVersion(documents),
                acceptedDocumentIds: [documentId],
                installationId,
            }),
        ).resolves.toEqual(expect.objectContaining(credentials));

        const durableCalls = JSON.stringify([
            users.upsertConfirmedInTransaction.mock.calls,
            legalRepository.createAcceptancesInTransaction.mock.calls,
            sessions.createInitialInTransaction.mock.calls,
        ]);
        expect(durableCalls).not.toContain('NOT-VALIDATED-BY-THIS-FEATURE');
        expect(durableCalls).not.toMatch(/referral|bonus|award/i);
    });

    it('contains the referral persistence introduced by feature 005', () => {
        const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
        expect(schema).toMatch(/^model\s+ReferralPromoCode\b/m);
        expect(schema).toMatch(/^model\s+ReferralBonusEntitlement\b/m);
    });
});

async function currentSetVersion(
    documents: Array<{ id: string; version: string; contentSha256: string }>,
): Promise<string> {
    const repository = { currentMandatory: vi.fn(async () => documents) };
    return (await new LegalService(repository as unknown as LegalRepository).currentMandatory('fr-SN')).setVersion;
}

function configureEnvironment(): void {
    const secret = Buffer.alloc(32, 9).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'pending-promo-scope-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
    });
}
