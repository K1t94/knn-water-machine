import { WalletError } from './wallet-errors';

declare const waterAmountBrand: unique symbol;
declare const walletBalanceBrand: unique symbol;

export type WaterAmount = bigint & { readonly [waterAmountBrand]: true };
export type WalletBalance = bigint & { readonly [walletBalanceBrand]: true };

export const MAX_WATER_MILLILITRES = 9_223_372_036_854_775_807n;

function invalidAmount(): WalletError {
    return new WalletError('WALLET_INVALID_AMOUNT', 'Water amount must be an exact bigint millilitre value.');
}

export function parseWaterAmount(value: unknown): WaterAmount {
    if (typeof value !== 'bigint' || value <= 0n || value > MAX_WATER_MILLILITRES) {
        throw invalidAmount();
    }

    return value as WaterAmount;
}

export function parseWalletBalance(value: unknown): WalletBalance {
    if (typeof value !== 'bigint' || value < 0n || value > MAX_WATER_MILLILITRES) {
        throw invalidAmount();
    }

    return value as WalletBalance;
}

export function applyWalletDelta(balanceValue: bigint, delta: bigint): WalletBalance {
    const balance = parseWalletBalance(balanceValue);

    if (delta < -MAX_WATER_MILLILITRES || delta > MAX_WATER_MILLILITRES) {
        throw invalidAmount();
    }

    const result = balance + delta;
    if (result < 0n) {
        throw new WalletError('WALLET_INSUFFICIENT_BALANCE', 'The wallet has insufficient water balance.');
    }
    if (result > MAX_WATER_MILLILITRES) {
        throw new WalletError('WALLET_BALANCE_LIMIT_EXCEEDED', 'The wallet balance limit would be exceeded.');
    }

    return result as WalletBalance;
}

export function serializeMillilitres(value: bigint): string {
    return parseWalletBalance(value).toString(10);
}
