import { LegalDocumentKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { LegalService } from '../../legal/application/legal.service';

import { RegistrationService } from './registration.service';

import type { LegalRepository } from '../../legal/infrastructure/postgres/legal.repository';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SessionsService } from '../../sessions/application/sessions.service';
import type { UsersRepository } from '../../users/infrastructure/postgres/users.repository';
import type {
    RegistrationAuthorizationStore,
    RegistrationCompletion,
} from '../infrastructure/redis/registration-authorization.store';

const phoneE164 = '+221771234567';
const installationId = 'installation-registration-0001';
const documentIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
const documents = documentIds.map((id, index) => ({
    id,
    kind: index === 0 ? LegalDocumentKind.TERMS_OF_SERVICE : LegalDocumentKind.PRIVACY_POLICY,
    version: '2026-07',
    locale: 'fr-SN',
    title: `Document ${index + 1}`,
    content: `Content ${index + 1}`,
    contentSha256: String(index + 1).repeat(64),
    mandatory: true,
}));

interface DurableState {
    users: string[];
    acceptances: string[];
    sessions: string[];
}

interface TransactionState extends DurableState {
    failSession?: boolean;
}

configureTestEnvironment();

describe('RegistrationService transaction', () => {
    const crypto = new CredentialCryptoService();
    const completion: RegistrationCompletion = {
        status: 'started',
        tokenDigest: 'a'.repeat(64),
        flowId: '00000000-0000-4000-8000-000000000010',
        owner: 'completion-owner',
        completionKeyDigest: 'b'.repeat(64),
        userId: '00000000-0000-4000-8000-000000000020',
        sessionId: '00000000-0000-4000-8000-000000000030',
        familyId: '00000000-0000-4000-8000-000000000040',
        leaseExpiresAt: new Date(Date.now() + 30_000),
    };
    const result = {
        accessToken: 'access-token',
        accessExpiresAt: '2030-01-01T00:15:00.000Z',
        refreshToken: 'refresh-token',
        refreshExpiresAt: '2030-03-01T00:00:00.000Z',
    };

    let durable: DurableState;
    let failSession: boolean;
    let transactionDocuments = documents;
    let service: RegistrationService;
    let registrations: {
        inspect: ReturnType<typeof vi.fn>;
        beginCompletion: ReturnType<typeof vi.fn>;
        prepareResult: ReturnType<typeof vi.fn>;
        complete: ReturnType<typeof vi.fn>;
        readPreparedResult: ReturnType<typeof vi.fn>;
        recoverResult: ReturnType<typeof vi.fn>;
    };
    let legalRepository: {
        currentMandatory: ReturnType<typeof vi.fn>;
        currentMandatoryInTransaction: ReturnType<typeof vi.fn>;
        createAcceptancesInTransaction: ReturnType<typeof vi.fn>;
    };
    let users: { upsertConfirmedInTransaction: ReturnType<typeof vi.fn> };
    let sessions: {
        prepareInitialCredentials: ReturnType<typeof vi.fn>;
        createInitialInTransaction: ReturnType<typeof vi.fn>;
    };
    let prisma: { $transaction: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        durable = { users: [], acceptances: [], sessions: [] };
        failSession = false;
        transactionDocuments = documents;
        registrations = {
            inspect: vi.fn(async () => ({
                tokenDigest: completion.tokenDigest,
                flowId: completion.flowId,
                challengeId: '00000000-0000-4000-8000-000000000050',
                phoneE164,
                phoneConfirmedAt: new Date('2030-01-01T00:00:00.000Z'),
                installationFingerprint: crypto.fingerprintInstallation(installationId).digest,
                state: 'ACTIVE',
                expiresAt: new Date('2030-01-01T00:15:00.000Z'),
            })),
            beginCompletion: vi.fn(async () => completion),
            prepareResult: vi.fn(async () => undefined),
            complete: vi.fn(async () => undefined),
            readPreparedResult: vi.fn(async () => undefined),
            recoverResult: vi.fn(async () => result),
        };
        legalRepository = {
            currentMandatory: vi.fn(async () => documents),
            currentMandatoryInTransaction: vi.fn(async () => transactionDocuments),
            createAcceptancesInTransaction: vi.fn(
                async (
                    transaction: TransactionState,
                    input: {
                        documentIds: readonly string[];
                    },
                ) => {
                    transaction.acceptances.push(...[...input.documentIds].sort());
                    return { count: input.documentIds.length };
                },
            ),
        };
        users = {
            upsertConfirmedInTransaction: vi.fn(async (transaction: TransactionState, input: { id: string }) => {
                transaction.users.push(input.id);
                return { id: input.id };
            }),
        };
        sessions = {
            prepareInitialCredentials: vi.fn(async () => result),
            createInitialInTransaction: vi.fn(async (transaction: TransactionState, input: { sessionId: string }) => {
                if (transaction.failSession) throw new Error('database unavailable');
                transaction.sessions.push(input.sessionId);
                return { id: input.sessionId };
            }),
        };
        prisma = {
            $transaction: vi.fn(
                async (
                    operation: (transaction: TransactionState) => Promise<void>,
                    options: { isolationLevel: string },
                ) => {
                    expect(options).toEqual({ isolationLevel: 'Serializable' });
                    const transaction: TransactionState = {
                        users: [...durable.users],
                        acceptances: [...durable.acceptances],
                        sessions: [...durable.sessions],
                        failSession,
                    };
                    await operation(transaction);
                    durable = {
                        users: transaction.users,
                        acceptances: transaction.acceptances,
                        sessions: transaction.sessions,
                    };
                },
            ),
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
        );
    });

    it('atomically persists the exact legal set, phone confirmation, audit, and initial session', async () => {
        const current = await new LegalService(legalRepository).currentMandatory('fr-SN');

        const completed = await service.complete({
            registrationAuthorization: 'registration-token',
            idempotencyKey: 'registration-attempt-1',
            setVersion: current.setVersion,
            acceptedDocumentIds: [...documentIds].reverse(),
            installationId,
            ipAddress: '203.0.113.10',
            userAgentFamily: 'a'.repeat(150),
        });

        expect(completed).toMatchObject({
            accessToken: result.accessToken,
            accessExpiresAt: result.accessExpiresAt,
            refreshToken: result.refreshToken,
        });
        expect(new Date(completed.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now());
        expect(durable).toEqual({
            users: [completion.userId],
            acceptances: [...documentIds],
            sessions: [completion.sessionId],
        });
        expect(users.upsertConfirmedInTransaction).toHaveBeenCalledWith(expect.anything(), {
            id: completion.userId,
            phoneE164,
            phoneConfirmedAt: new Date('2030-01-01T00:00:00.000Z'),
        });
        expect(legalRepository.createAcceptancesInTransaction).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                userId: completion.userId,
                documentIds: [...documentIds].reverse(),
                registrationFlowId: completion.flowId,
                installationFingerprint: crypto.fingerprintInstallation(installationId).digest,
                ipFingerprint: crypto.fingerprintIp('203.0.113.10').digest,
                userAgentFamily: 'a'.repeat(100),
            }),
        );
        expect(sessions.createInitialInTransaction).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                credentials: result,
                sessionId: completion.sessionId,
                familyId: completion.familyId,
                userId: completion.userId,
                creationKeyDigest: completion.completionKeyDigest,
            }),
        );
        expect(registrations.complete).toHaveBeenCalledOnce();
    });

    it('rolls back the user when the exact legal set changes in the transaction', async () => {
        const current = await new LegalService(legalRepository).currentMandatory('fr-SN');
        transactionDocuments = documents.slice(0, 1);

        await expect(service.complete(command(current.setVersion))).rejects.toMatchObject({
            code: 'LEGAL_VERSION_STALE',
        });

        expect(durable).toEqual({ users: [], acceptances: [], sessions: [] });
        expect(registrations.complete).not.toHaveBeenCalled();
    });

    it('rolls back user and acceptances when initial session creation fails', async () => {
        const current = await new LegalService(legalRepository).currentMandatory('fr-SN');
        failSession = true;

        await expect(service.complete(command(current.setVersion))).rejects.toMatchObject({
            code: 'DEPENDENCY_UNAVAILABLE',
        });

        expect(durable).toEqual({ users: [], acceptances: [], sessions: [] });
        expect(registrations.complete).not.toHaveBeenCalled();
    });

    it('rejects a unique phone already bound to another deterministic user', async () => {
        const current = await new LegalService(legalRepository).currentMandatory('fr-SN');
        users.upsertConfirmedInTransaction.mockImplementationOnce(async (transaction: TransactionState) => {
            transaction.users.push('existing-user');
            return { id: 'existing-user' };
        });

        await expect(service.complete(command(current.setVersion))).rejects.toMatchObject({
            code: 'REGISTRATION_ALREADY_COMPLETING',
        });

        expect(durable).toEqual({ users: [], acceptances: [], sessions: [] });
        expect(registrations.complete).not.toHaveBeenCalled();
    });

    function command(setVersion: string) {
        return {
            registrationAuthorization: 'registration-token',
            idempotencyKey: 'registration-attempt-1',
            setVersion,
            acceptedDocumentIds: documentIds,
            installationId,
        };
    }
});

function configureTestEnvironment(): void {
    const secret = Buffer.alloc(32, 7).toString('base64url');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'registration-service-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
    });
}
