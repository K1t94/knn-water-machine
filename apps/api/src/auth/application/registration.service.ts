import { Inject, Injectable, Optional } from '@nestjs/common';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { LegalVersionStaleError, LegalService } from '../../legal/application/legal.service';
import { LegalRepository } from '../../legal/infrastructure/postgres/legal.repository';
import { AuthMetrics } from '../../observability/auth-metrics';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService } from '../../sessions/application/sessions.service';
import { UsersRepository } from '../../users/infrastructure/postgres/users.repository';
import {
    RegistrationAuthorizationError,
    RegistrationAuthorizationStore,
    type RegistrationCompletion,
    type RegistrationResult,
} from '../infrastructure/redis/registration-authorization.store';

import { DependencyUnavailableError } from './auth-application.error';

export interface CompleteRegistrationCommand {
    registrationAuthorization: string;
    idempotencyKey: string;
    setVersion: string;
    acceptedDocumentIds: readonly string[];
    installationId: string;
    ipAddress?: string;
    userAgentFamily?: string;
}

@Injectable()
export class RegistrationService {
    constructor(
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(RegistrationAuthorizationStore)
        private readonly registrations: RegistrationAuthorizationStore,
        @Inject(LegalService) private readonly legal: LegalService,
        @Inject(LegalRepository) private readonly legalRepository: LegalRepository,
        @Inject(UsersRepository) private readonly users: UsersRepository,
        @Inject(SessionsService) private readonly sessions: SessionsService,
        @Inject(CredentialCryptoService) private readonly crypto: CredentialCryptoService,
        @Optional() @Inject(AuthMetrics) private readonly metrics?: AuthMetrics,
    ) {}

    async updatePendingPromo(registrationAuthorization: string, pendingPromoCode: string | null): Promise<void> {
        await this.registrations.updatePromo(registrationAuthorization, normalizePendingPromo(pendingPromoCode));
    }

    async complete(command: CompleteRegistrationCommand): Promise<RegistrationResult> {
        try {
            const result = await this.completeRegistration(command);
            this.metrics?.registrationCompletion('success');
            return result;
        } catch (error) {
            this.metrics?.registrationCompletion('failure');
            if (
                error instanceof RegistrationAuthorizationError ||
                error instanceof LegalVersionStaleError ||
                error instanceof DependencyUnavailableError
            ) {
                throw error;
            }
            throw new DependencyUnavailableError({ cause: error });
        }
    }

    private async completeRegistration(command: CompleteRegistrationCommand): Promise<RegistrationResult> {
        const authorization = await this.registrations.inspect(command.registrationAuthorization);
        const installationFingerprint = this.crypto.fingerprintInstallation(command.installationId).digest;
        if (!this.crypto.compareDigests(authorization.installationFingerprint, installationFingerprint)) {
            throw new RegistrationAuthorizationError('REGISTRATION_AUTH_INVALID');
        }

        await this.legal.assertCurrentSet(command.setVersion, command.acceptedDocumentIds, 'fr-SN');

        if (authorization.state === 'COMPLETED') {
            return this.registrations.recoverResult(command.registrationAuthorization, command.idempotencyKey);
        }

        let completion = await this.registrations.beginCompletion(
            command.registrationAuthorization,
            command.idempotencyKey,
        );
        if (completion.status === 'recover') {
            return this.registrations.recoverResult(command.registrationAuthorization, command.idempotencyKey);
        }

        let credentials =
            completion.status === 'started'
                ? await this.prepareCredentials(command.registrationAuthorization, completion)
                : await this.waitForPreparedResult(command.registrationAuthorization, completion);
        if (!credentials && Date.now() >= completion.leaseExpiresAt.getTime()) {
            completion = await this.registrations.beginCompletion(
                command.registrationAuthorization,
                command.idempotencyKey,
            );
            credentials =
                completion.status === 'started'
                    ? await this.prepareCredentials(command.registrationAuthorization, completion)
                    : await this.registrations.readPreparedResult(command.registrationAuthorization, completion);
        }
        if (!credentials) {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }

        const acceptedAt = new Date();
        const ipFingerprint = command.ipAddress ? this.crypto.fingerprintIp(command.ipAddress).digest : undefined;

        await this.prisma.$transaction(
            async (transaction) => {
                const currentDocuments = await this.legalRepository.currentMandatoryInTransaction(transaction, 'fr-SN');
                const exactDocuments = this.legal.assertDocumentSet(
                    currentDocuments,
                    command.setVersion,
                    command.acceptedDocumentIds,
                );
                const user = await this.users.upsertConfirmedInTransaction(transaction, {
                    id: completion.userId,
                    phoneE164: authorization.phoneE164,
                    phoneConfirmedAt: authorization.phoneConfirmedAt,
                });
                if (user.id !== completion.userId) {
                    throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
                }
                await this.legalRepository.createAcceptancesInTransaction(transaction, {
                    userId: user.id,
                    documentIds: exactDocuments.map(({ id }) => id),
                    registrationFlowId: completion.flowId,
                    acceptedAt,
                    installationFingerprint,
                    ...(ipFingerprint ? { ipFingerprint } : {}),
                    ...(command.userAgentFamily ? { userAgentFamily: command.userAgentFamily.slice(0, 100) } : {}),
                });
                await this.sessions.createInitialInTransaction(transaction, {
                    credentials,
                    sessionId: completion.sessionId,
                    familyId: completion.familyId,
                    userId: user.id,
                    installationFingerprint,
                    creationKeyDigest: completion.completionKeyDigest,
                });
            },
            { isolationLevel: 'Serializable' },
        );

        await this.registrations.complete(command.registrationAuthorization, completion);
        return credentials;
    }

    private async waitForPreparedResult(
        registrationAuthorization: string,
        completion: RegistrationCompletion,
    ): Promise<RegistrationResult | undefined> {
        const deadline = Math.min(completion.leaseExpiresAt.getTime(), Date.now() + 2_000);
        do {
            const prepared = await this.registrations.readPreparedResult(registrationAuthorization, completion);
            if (prepared) return prepared;
            await new Promise((resolve) => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        return undefined;
    }

    private async prepareCredentials(
        registrationAuthorization: string,
        completion: RegistrationCompletion,
    ): Promise<RegistrationResult> {
        const result = await this.sessions.prepareInitialCredentials({
            userId: completion.userId,
            sessionId: completion.sessionId,
        });
        await this.registrations.prepareResult(registrationAuthorization, completion, result);
        return result;
    }
}

function normalizePendingPromo(value: string | null): string | null {
    if (value === null || value.trim() === '') return null;
    const normalized = value.trim();
    if (normalized.length > 64 || !/^[\x20-\x7E]+$/.test(normalized)) {
        throw new RegistrationAuthorizationError('REGISTRATION_AUTH_INVALID');
    }
    return normalized;
}
