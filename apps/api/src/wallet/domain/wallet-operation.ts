import { WalletError } from './wallet-errors';

import type { WalletBalance, WaterAmount } from './water-amount';

declare const businessEventKeyBrand: unique symbol;
declare const operationKindBrand: unique symbol;
declare const operationSourceBrand: unique symbol;

export type BusinessEventKey = string & { readonly [businessEventKeyBrand]: true };
export type WalletOperationKind = string & { readonly [operationKindBrand]: true };
export type WalletOperationSource = string & { readonly [operationSourceBrand]: true };
export type WalletDirection = 'CREDIT' | 'DEBIT';

const BUSINESS_EVENT_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._~-]{1,167}$/;
const CLASSIFIER_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function parseBusinessEventKey(value: unknown): BusinessEventKey {
    if (typeof value !== 'string' || !BUSINESS_EVENT_KEY_PATTERN.test(value)) {
        throw new WalletError('WALLET_INVALID_EVENT', 'The wallet business event key is invalid.');
    }
    return value as BusinessEventKey;
}

export function parseWalletOperationKind(value: unknown): WalletOperationKind {
    if (typeof value !== 'string' || !CLASSIFIER_PATTERN.test(value)) {
        throw new WalletError('WALLET_INVALID_EVENT', 'The wallet operation kind is invalid.');
    }
    return value as WalletOperationKind;
}

export function parseWalletOperationSource(value: unknown): WalletOperationSource {
    if (typeof value !== 'string' || !CLASSIFIER_PATTERN.test(value)) {
        throw new WalletError('WALLET_INVALID_EVENT', 'The wallet operation source is invalid.');
    }
    return value as WalletOperationSource;
}

export interface WalletCompensationOrigin {
    readonly entryId: string;
    readonly userId: string;
    readonly direction: 'DEBIT';
    readonly amountMl: WaterAmount;
}

export interface WalletOperationFacts {
    readonly id: string;
    readonly sequence: bigint;
    readonly userId: string;
    readonly businessEventKey: BusinessEventKey;
    readonly direction: WalletDirection;
    readonly amountMl: WaterAmount;
    readonly operationKind: WalletOperationKind;
    readonly source: WalletOperationSource;
    readonly balanceAfterMl: WalletBalance;
    readonly occurredAt: Date;
    readonly recordedAt: Date;
    readonly compensatesEntryId: string | null;
}

export interface WalletHistoryCursor {
    readonly beforeSequence: bigint;
}

export interface WalletHistoryQuery {
    readonly userId: string;
    readonly limit: number;
    readonly cursor: WalletHistoryCursor | null;
}

export interface WalletHistoryPage {
    readonly operations: readonly WalletOperationFacts[];
    readonly nextCursor: WalletHistoryCursor | null;
}
