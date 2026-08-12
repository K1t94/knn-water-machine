import { LegalDocumentKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { LegalService } from '../../legal/application/legal.service';
import {
    RegistrationAuthorizationError,
    type RegistrationAuthorizationStore,
    type RegistrationCompletion,
    type RegistrationResult,
} from '../infrastructure/redis/registration-authorization.store';

import { RegistrationService } from './registration.service';

import type { LegalRepository } from '../../legal/infrastructure/postgres/legal.repository';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SessionsService } from '../../sessions/application/sessions.service';
import type { UsersRepository } from '../../users/infrastructure/postgres/users.repository';

configureTestEnvironment();

const installationId = 'installation-concurrency-0001';
const documents = [
    {
        id: '00000000-0000-4000-8000-000000000001',
        kind: LegalDocumentKind.TERMS_OF_SERVICE,
        version: '2026-07',
        locale: 'fr-SN',
        title: 'Conditions',
        content: 'Conditions',
        contentSha256: 'a'.repeat(64),
        mandatory: true,
    },
    {
        id: '00000000-0000-4000-8000-000000000002',
        kind: LegalDocumentKind.PRIVACY_POLICY,
        version: '2026-07',
        locale: 'fr-SN',
        title: 'Confidentialite',
        content: 'Politique',
        contentSha256: 'b'.repeat(64),
        mandatory: true,
    },
];

interface DurableState {
    users: Map<string, string>;
    acceptances: Set<string>;
    sessions: Map<string, { id: string; refreshDigest: string; generation: 0 }>;
}

describe('RegistrationService concurrency and repair', () => {
    const crypto = new CredentialCryptoService();
    const baseCompletion: RegistrationCompletion = {
        status: 'started',
        tokenDigest: 'a'.repeat(64),
        flowId: '00000000-0000-4000-8000-000000000010',
        owner: 'stable-owner',
        completionKeyDigest: 'b'.repeat(64),
        userId: '00000000-0000-4000-8000-000000000020',
        sessionId: '00000000-0000-4000-8000-000000000030',
        familyId: '00000000-0000-4000-8000-000000000040',
        leaseExpiresAt: new Date(Date.now() + 30_000),
    };

    let durable: DurableState;
    let prepared: RegistrationResult | undefined;
    let registrationState: 'ACTIVE' | 'COMPLETING' | 'COMPLETED';
    let startedKey: string | undefined;
    let failNextCompletionTransition: boolean;
    let transactionQueue: Promise<void>;
    let service: RegistrationService;
    let accessIssue: Mock<() => Promise<{ token: string; expiresAt: Date }>>;
    let refreshGenerate: Mock<() => string>;
    let refreshDigest: Mock<(token: string) => string>;
    let registrations: {
        inspect: ReturnType<typeof vi.fn>;
        beginCompletion: ReturnType<typeof vi.fn>;
        prepareResult: ReturnType<typeof vi.fn>;
        readPreparedResult: ReturnType<typeof vi.fn>;
        complete: ReturnType<typeof vi.fn>;
        recoverResult: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        durable = {
            users: new Map(),
            acceptances: new Set(),
            sessions: new Map(),
        };
        prepared = undefined;
        registrationState = 'ACTIVE';
        startedKey = undefined;
        failNextCompletionTransition = false;
        transactionQueue = Promise.resolve();

        registrations = {
            inspect: vi.fn(async () => ({
                tokenDigest: baseCompletion.tokenDigest,
                flowId: baseCompletion.flowId,
                challengeId: '00000000-0000-4000-8000-000000000050',
                phoneE164: '+221771234567',
                phoneConfirmedAt: new Date('2030-01-01T00:00:00.000Z'),
                installationFingerprint: crypto.fingerprintInstallation(installationId).digest,
                state: registrationState,
                expiresAt: new Date('2030-01-01T00:15:00.000Z'),
            })),
            beginCompletion: vi.fn(async (_token: string, idempotencyKey: string) => {
                if (startedKey && startedKey !== idempotencyKey) {
                    throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
                }
                if (registrationState === 'COMPLETED') {
                    return { ...baseCompletion, status: 'recover' as const };
                }
                if (!startedKey) {
                    startedKey = idempotencyKey;
                    registrationState = 'COMPLETING';
                    return { ...baseCompletion, status: 'started' as const };
                }
                return { ...baseCompletion, status: 'existing' as const };
            }),
            prepareResult: vi.fn(
                async (_token: string, _completion: RegistrationCompletion, result: RegistrationResult) => {
                    prepared = result;
                },
            ),
            readPreparedResult: vi.fn(async () => prepared),
            complete: vi.fn(async () => {
                if (failNextCompletionTransition) {
                    failNextCompletionTransition = false;
                    throw new Error('redis transition unavailable');
                }
                registrationState = 'COMPLETED';
            }),
            recoverResult: vi.fn(async () => {
                if (registrationState !== 'COMPLETED' || !prepared) {
                    throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
                }
                return prepared;
            }),
        };

        accessIssue = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return {
                token: 'one-access-token',
                expiresAt: new Date('2030-01-01T00:15:00.000Z'),
            };
        });
        refreshGenerate = vi.fn(() => 'one-refresh-token');
        refreshDigest = vi.fn(() => 'c'.repeat(64));

        const legalRepository = {
            currentMandatory: vi.fn(async () => documents),
            currentMandatoryInTransaction: vi.fn(async () => documents),
            createAcceptancesInTransaction: vi.fn(
                async (transaction: DurableState, input: { userId: string; documentIds: readonly string[] }) => {
                    for (const documentId of input.documentIds) {
                        transaction.acceptances.add(`${input.userId}:${documentId}`);
                    }
                    return { count: input.documentIds.length };
                },
            ),
        };
        const users = {
            findByPhoneInTransaction: vi.fn(async (transaction: DurableState, phoneE164: string) => {
                const id = transaction.users.get(phoneE164);
                return id === undefined ? null : { id };
            }),
            upsertConfirmedInTransaction: vi.fn(
                async (transaction: DurableState, input: { id: string; phoneE164: string }) => {
                    const existingId = transaction.users.get(input.phoneE164);
                    if (existingId) return { id: existingId };
                    transaction.users.set(input.phoneE164, input.id);
                    return { id: input.id };
                },
            ),
        };
        const sessions = {
            prepareInitialCredentials: vi.fn(async () => {
                const access = await accessIssue();
                const refreshToken = refreshGenerate();
                return {
                    accessToken: access.token,
                    accessExpiresAt: access.expiresAt.toISOString(),
                    refreshToken,
                    refreshExpiresAt: '2030-03-01T00:00:00.000Z',
                };
            }),
            createInitialInTransaction: vi.fn(
                async (
                    transaction: DurableState,
                    input: {
                        credentials: RegistrationResult;
                        sessionId: string;
                        creationKeyDigest: string;
                    },
                ) => {
                    const refreshTokenDigest = refreshDigest(input.credentials.refreshToken);
                    const existing = transaction.sessions.get(input.creationKeyDigest);
                    if (existing) {
                        if (existing.refreshDigest !== refreshTokenDigest) {
                            throw new Error('credential lineage changed');
                        }
                        return existing;
                    }
                    const created = {
                        id: input.sessionId,
                        refreshDigest: refreshTokenDigest,
                        generation: 0 as const,
                    };
                    transaction.sessions.set(input.creationKeyDigest, created);
                    return created;
                },
            ),
        };
        const prisma = {
            $transaction: vi.fn(async (operation: (transaction: DurableState) => Promise<void>) => {
                const previous = transactionQueue;
                let releaseTransaction: () => void = () => undefined;
                transactionQueue = new Promise<void>((resolve) => {
                    releaseTransaction = resolve;
                });
                await previous;
                const transaction: DurableState = {
                    users: new Map(durable.users),
                    acceptances: new Set(durable.acceptances),
                    sessions: new Map(durable.sessions),
                };
                try {
                    await operation(transaction);
                    durable = transaction;
                } finally {
                    releaseTransaction();
                }
            }),
        };
        const legal = new LegalService(legalRepository);

        service = new RegistrationService(
            prisma as unknown as PrismaService,
            registrations as unknown as RegistrationAuthorizationStore,
            legal,
            legalRepository as unknown as LegalRepository,
            users as unknown as UsersRepository,
            sessions as unknown as SessionsService,
            crypto,
            {
                completeOnboarding: vi.fn(async () => ({
                    promoCode: '23456789ABCD',
                    relationshipCreated: false,
                    inviterEntitlementIds: [],
                })),
                deliverAfterCommit: vi.fn(async () => undefined),
            } as never,
        );
    });

    it('returns byte-identical credentials and persists one generation-zero lineage for concurrent same-key requests', async () => {
        const command = await completionCommand('same-key');

        const [first, second] = await Promise.all([service.complete(command), service.complete(command)]);

        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(durable.users.size).toBe(1);
        expect(durable.acceptances.size).toBe(documents.length);
        expect(durable.sessions.size).toBe(1);
        expect([...durable.sessions.values()][0]).toMatchObject({
            id: baseCompletion.sessionId,
            refreshDigest: 'c'.repeat(64),
            generation: 0,
        });
        expect(accessIssue).toHaveBeenCalledOnce();
        expect(refreshGenerate).toHaveBeenCalledOnce();
        expect(refreshDigest).toHaveBeenCalledTimes(2);
    });

    it('repairs the post-commit Redis boundary with the original result and no rotation', async () => {
        const command = await completionCommand('repair-key');
        failNextCompletionTransition = true;

        await expect(service.complete(command)).rejects.toMatchObject({
            code: 'DEPENDENCY_UNAVAILABLE',
        });
        const committedResult = prepared;
        expect(durable.users.size).toBe(1);
        expect(durable.acceptances.size).toBe(documents.length);
        expect(durable.sessions.size).toBe(1);
        expect(registrationState).toBe('COMPLETING');

        const repaired = await service.complete(command);

        expect(repaired).toEqual(committedResult);
        expect(registrationState).toBe('COMPLETED');
        expect(durable.users.size).toBe(1);
        expect(durable.acceptances.size).toBe(documents.length);
        expect(durable.sessions.size).toBe(1);
        expect(accessIssue).toHaveBeenCalledOnce();
        expect(refreshGenerate).toHaveBeenCalledOnce();
    });

    it('rejects a different idempotency key while preserving the first lineage', async () => {
        const firstCommand = await completionCommand('first-key');
        failNextCompletionTransition = true;
        await expect(service.complete(firstCommand)).rejects.toThrow();

        await expect(
            service.complete({
                ...firstCommand,
                idempotencyKey: 'different-key',
            }),
        ).rejects.toMatchObject({
            code: 'REGISTRATION_ALREADY_COMPLETING',
        });

        expect(durable.users.size).toBe(1);
        expect(durable.sessions.size).toBe(1);
        expect(refreshGenerate).toHaveBeenCalledOnce();
    });

    async function completionCommand(idempotencyKey: string) {
        const legal = new LegalService({
            currentMandatory: vi.fn(async () => documents),
        });
        const current = await legal.currentMandatory('fr-SN');
        return {
            registrationAuthorization: 'registration-token',
            idempotencyKey,
            setVersion: current.setVersion,
            acceptedDocumentIds: documents.map(({ id }) => id),
            installationId,
        };
    }
});

function configureTestEnvironment(): void {
    const secret = Buffer.alloc(32, 9).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'registration-concurrency-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
    });
}
