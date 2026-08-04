import type { WalletHistoryPage, WalletHistoryQuery } from '../../domain/wallet-operation';
import type { WalletBalance } from '../../domain/water-amount';
import type {
    ValidatedCompensateWalletCommand,
    ValidatedCreditWalletCommand,
    ValidatedDebitWalletCommand,
    WalletCommandResult,
} from '../wallet-command';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface WalletMutationRepository {
    credit(command: ValidatedCreditWalletCommand): Promise<WalletCommandResult>;
    debit(command: ValidatedDebitWalletCommand): Promise<WalletCommandResult>;
    compensate(command: ValidatedCompensateWalletCommand): Promise<WalletCommandResult>;
    reconcile(userId: string): Promise<WalletBalance>;
}

export interface WalletBalanceRepository {
    getBalance(userId: string): Promise<WalletBalance>;
}

export interface WalletHistoryRepository {
    getHistory(query: WalletHistoryQuery): Promise<WalletHistoryPage>;
}

export interface WalletQueryRepository extends WalletBalanceRepository, WalletHistoryRepository {}

export interface WalletRepository extends WalletMutationRepository, WalletQueryRepository {}
