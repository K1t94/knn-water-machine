import type {
    BusinessEventKey,
    WalletDirection,
    WalletOperationKind,
    WalletOperationSource,
} from '../domain/wallet-operation';
import type { WalletBalance, WaterAmount } from '../domain/water-amount';

interface WalletCommandBase {
    readonly userId: string;
    readonly businessEventKey: string;
    readonly amountMl: bigint;
    readonly operationKind: string;
    readonly source: string;
    readonly occurredAt: Date;
}

export interface CreditWalletCommand extends WalletCommandBase {
    readonly ownerStatusPolicy?: 'ACTIVE_ONLY' | 'EXISTING_OWNER';
    readonly featureGuard?: 'REFERRAL_PROGRAM_ENABLED';
}

export type DebitWalletCommand = WalletCommandBase;

export interface CompensateWalletCommand extends Omit<WalletCommandBase, 'operationKind'> {
    readonly operationKind: 'COMPENSATION';
    readonly compensatesEntryId: string;
}

export type WalletCommand = CreditWalletCommand | DebitWalletCommand | CompensateWalletCommand;

interface ValidatedWalletCommandBase {
    readonly userId: string;
    readonly businessEventKey: BusinessEventKey;
    readonly amountMl: WaterAmount;
    readonly operationKind: WalletOperationKind;
    readonly source: WalletOperationSource;
    readonly occurredAt: Date;
    readonly direction: WalletDirection;
    readonly ownerStatusPolicy: 'ACTIVE_ONLY' | 'EXISTING_OWNER';
    readonly featureGuard: 'REFERRAL_PROGRAM_ENABLED' | null;
}

export interface ValidatedCreditWalletCommand extends ValidatedWalletCommandBase {
    readonly direction: 'CREDIT';
    readonly compensatesEntryId: null;
}

export interface ValidatedDebitWalletCommand extends ValidatedWalletCommandBase {
    readonly direction: 'DEBIT';
    readonly compensatesEntryId: null;
}

export interface ValidatedCompensateWalletCommand extends ValidatedWalletCommandBase {
    readonly direction: 'CREDIT';
    readonly compensatesEntryId: string;
}

export type ValidatedWalletCommand =
    ValidatedCreditWalletCommand | ValidatedDebitWalletCommand | ValidatedCompensateWalletCommand;

export interface WalletCommandResult {
    readonly entryId: string;
    readonly balanceAfterMl: WalletBalance;
    readonly idempotentReplay: boolean;
}
