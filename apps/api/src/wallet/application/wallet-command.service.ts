import { Inject, Injectable } from '@nestjs/common';

import { WalletError } from '../domain/wallet-errors';
import {
    parseBusinessEventKey,
    parseWalletOperationKind,
    parseWalletOperationSource,
    type WalletDirection,
} from '../domain/wallet-operation';
import { parseWaterAmount } from '../domain/water-amount';

import { WALLET_REPOSITORY, type WalletMutationRepository } from './ports/wallet.repository';
import {
    type CompensateWalletCommand,
    type CreditWalletCommand,
    type DebitWalletCommand,
    type ValidatedCompensateWalletCommand,
    type ValidatedCreditWalletCommand,
    type ValidatedDebitWalletCommand,
    type ValidatedWalletCommand,
    type WalletCommandResult,
} from './wallet-command';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class WalletCommandService {
    public constructor(@Inject(WALLET_REPOSITORY) private readonly repository: WalletMutationRepository) {}

    public credit(command: CreditWalletCommand): Promise<WalletCommandResult> {
        const validated = this.validate(
            command,
            'CREDIT',
            null,
            this.creditOwnerStatusPolicy(command),
        ) as ValidatedCreditWalletCommand;
        if (validated.operationKind === 'COMPENSATION') {
            throw this.invalidEvent();
        }
        return this.run(() => this.repository.credit(validated));
    }

    public debit(command: DebitWalletCommand): Promise<WalletCommandResult> {
        const validated = this.validate(command, 'DEBIT', null, 'ACTIVE_ONLY') as ValidatedDebitWalletCommand;
        if (validated.operationKind === 'COMPENSATION') {
            throw this.invalidEvent();
        }
        return this.run(() => this.repository.debit(validated));
    }

    public compensate(command: CompensateWalletCommand): Promise<WalletCommandResult> {
        const runtimeCommand = this.asRecord(command);
        if (runtimeCommand.operationKind !== 'COMPENSATION' || !this.isUuid(runtimeCommand.compensatesEntryId)) {
            throw new WalletError('WALLET_INVALID_COMPENSATION_ORIGIN', 'The wallet compensation origin is invalid.');
        }
        const validated = this.validate(
            command,
            'CREDIT',
            command.compensatesEntryId,
            'ACTIVE_ONLY',
        ) as ValidatedCompensateWalletCommand;
        return this.run(() => this.repository.compensate(validated));
    }

    private validate(
        input: CreditWalletCommand | DebitWalletCommand | CompensateWalletCommand,
        direction: WalletDirection,
        compensatesEntryId: string | null,
        ownerStatusPolicy: 'ACTIVE_ONLY' | 'EXISTING_OWNER',
    ): ValidatedWalletCommand {
        const command = this.asRecord(input);
        if (!this.isUuid(command.userId) || !(command.occurredAt instanceof Date)) {
            throw this.invalidEvent();
        }
        if (Number.isNaN(command.occurredAt.getTime())) {
            throw this.invalidEvent();
        }

        return {
            userId: command.userId,
            businessEventKey: parseBusinessEventKey(command.businessEventKey),
            amountMl: parseWaterAmount(command.amountMl),
            operationKind: parseWalletOperationKind(command.operationKind),
            source: parseWalletOperationSource(command.source),
            occurredAt: new Date(command.occurredAt.getTime()),
            direction,
            compensatesEntryId,
            ownerStatusPolicy,
            featureGuard: this.featureGuard(command),
        } as ValidatedWalletCommand;
    }

    private async run(action: () => Promise<WalletCommandResult>): Promise<WalletCommandResult> {
        try {
            return await action();
        } catch (error: unknown) {
            if (error instanceof WalletError) {
                throw error;
            }
            throw new WalletError('WALLET_TEMPORARILY_UNAVAILABLE', 'The wallet operation is temporarily unavailable.');
        }
    }

    private isUuid(value: unknown): value is string {
        return typeof value === 'string' && UUID_PATTERN.test(value);
    }

    private creditOwnerStatusPolicy(command: CreditWalletCommand): 'ACTIVE_ONLY' | 'EXISTING_OWNER' {
        const policy = this.asRecord(command).ownerStatusPolicy;
        if (policy === undefined) {
            return 'ACTIVE_ONLY';
        }
        if (policy === 'ACTIVE_ONLY' || policy === 'EXISTING_OWNER') {
            return policy;
        }
        throw this.invalidEvent();
    }

    private featureGuard(command: Record<string, unknown>): 'REFERRAL_PROGRAM_ENABLED' | null {
        const guard = command.featureGuard;
        if (guard === undefined) return null;
        if (guard === 'REFERRAL_PROGRAM_ENABLED') return guard;
        throw this.invalidEvent();
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (typeof value !== 'object' || value === null) {
            throw this.invalidEvent();
        }
        return value as Record<string, unknown>;
    }

    private invalidEvent(): WalletError {
        return new WalletError('WALLET_INVALID_EVENT', 'The wallet event is invalid.');
    }
}
