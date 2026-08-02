import { Inject, Injectable, Optional } from '@nestjs/common';
import { SmsDeliveryStatus } from '@prisma/client';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { AuthMetrics } from '../../observability/auth-metrics';
import {
    SmsDeliveryRepository,
    type PrepareSmsDelivery,
    type SmsDeliveryReceiptRecord,
} from '../infrastructure/postgres/sms-delivery.repository';

import { SmsProviderError } from './sms-error';

import type { SendSmsCommand, SendSmsResult, SmsProvider } from './ports/sms-provider';
import type { SmsErrorCategory } from './sms-error';

export interface SmsDeliveryPersistence {
    prepare(input: PrepareSmsDelivery): Promise<unknown>;
    markAccepted(
        challengeId: string,
        providerMessageId: string | undefined,
        acceptedAt: Date,
        uncertain?: boolean,
    ): Promise<unknown>;
    markFailed(challengeId: string, category: SmsErrorCategory): Promise<unknown>;
    findReceiptTarget(challengeId: string): Promise<SmsDeliveryReceiptRecord | null>;
    transitionReceipt(
        id: string,
        expectedStatus: SmsDeliveryStatus,
        nextStatus: SmsDeliveryStatus,
        receivedAt: Date,
    ): Promise<{ count: number }>;
}

export type SmsReceiptStatus = 'delivered' | 'pending' | 'uncertain' | 'failed';

@Injectable()
export class SmsDeliveryService {
    constructor(
        @Inject(SmsDeliveryRepository)
        private readonly repository: SmsDeliveryPersistence,
        @Inject(CredentialCryptoService)
        private readonly fingerprints: CredentialCryptoService,
        @Optional() @Inject(AuthMetrics) private readonly metrics?: AuthMetrics,
    ) {}

    recorded(provider: SmsProvider): SmsProvider {
        return {
            name: provider.name,
            delivery: provider.delivery,
            send: (command) => this.recordSend(provider, command),
        };
    }

    private async recordSend(provider: SmsProvider, command: SendSmsCommand) {
        try {
            await this.repository.prepare({
                challengeId: command.correlationId,
                provider: provider.name === 'orange' ? 'orange' : 'fake',
                phoneFingerprint: this.fingerprints.fingerprintPhone(command.recipientE164).digest,
                requestedAt: new Date(),
            });
        } catch {
            throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
        }
        let result: SendSmsResult;
        try {
            result = await provider.send(command);
        } catch (error) {
            const normalized =
                error instanceof SmsProviderError ? error : new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
            try {
                if (normalized.category === 'TIMEOUT') {
                    await this.repository.markAccepted(command.correlationId, undefined, new Date(), true);
                } else {
                    await this.repository.markFailed(command.correlationId, normalized.category);
                }
            } catch {
                // Preserve the provider category even if technical delivery recording also fails.
            }
            this.metrics?.smsSend(
                providerName(provider.name),
                normalized.category === 'TIMEOUT' ? 'uncertain' : 'failed',
                normalized.category,
            );
            throw normalized;
        }
        try {
            await this.repository.markAccepted(
                command.correlationId,
                result.providerMessageId,
                result.acceptedAt,
                result.status === 'uncertain',
            );
        } catch {
            // Do not misclassify an SMS already accepted by the provider as a send failure.
            throw new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
        }
        this.metrics?.smsSend(providerName(provider.name), result.status);
        return result;
    }

    async applyReceipt(
        callbackData: string,
        deliveryStatus: SmsReceiptStatus,
        receivedAt = new Date(),
    ): Promise<{ known: boolean; changed: boolean }> {
        const current = await this.repository.findReceiptTarget(callbackData);
        if (!current) return { known: false, changed: false };
        const next = nextStatus(current.status, deliveryStatus);
        if (next === current.status) return { known: true, changed: false };
        const result = await this.repository.transitionReceipt(current.id, current.status, next, receivedAt);
        if (result.count === 1) {
            const latency = current.acceptedAt
                ? Math.max(0, (receivedAt.getTime() - current.acceptedAt.getTime()) / 1_000)
                : undefined;
            this.metrics?.deliveryReceipt(deliveryStatus, latency);
        }
        return { known: true, changed: result.count === 1 };
    }
}

function providerName(name: string): 'fake' | 'orange' {
    return name === 'orange' ? 'orange' : 'fake';
}

function nextStatus(current: SmsDeliveryStatus, receipt: SmsReceiptStatus): SmsDeliveryStatus {
    if (current === SmsDeliveryStatus.DELIVERED || current === SmsDeliveryStatus.FAILED) return current;
    if (receipt === 'delivered') return SmsDeliveryStatus.DELIVERED;
    if (receipt === 'failed') return SmsDeliveryStatus.FAILED;
    if (receipt === 'uncertain') return SmsDeliveryStatus.UNCERTAIN;
    if (current === SmsDeliveryStatus.PREPARED) return SmsDeliveryStatus.ACCEPTED;
    return current;
}
