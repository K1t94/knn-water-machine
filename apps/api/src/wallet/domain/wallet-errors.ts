export type WalletErrorCode =
    | 'WALLET_BALANCE_LIMIT_EXCEEDED'
    | 'WALLET_CURSOR_INVALID'
    | 'WALLET_EVENT_CONFLICT'
    | 'WALLET_INSUFFICIENT_BALANCE'
    | 'WALLET_INVALID_AMOUNT'
    | 'WALLET_INVALID_COMPENSATION_ORIGIN'
    | 'WALLET_INVALID_EVENT'
    | 'WALLET_RECONCILIATION_FAILED'
    | 'WALLET_TEMPORARILY_UNAVAILABLE'
    | 'WALLET_USER_INELIGIBLE';

export class WalletError extends Error {
    public readonly name = 'WalletError';

    public constructor(
        public readonly code: WalletErrorCode,
        message: string,
    ) {
        super(message);
    }
}
