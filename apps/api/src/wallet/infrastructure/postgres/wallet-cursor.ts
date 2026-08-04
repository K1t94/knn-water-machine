import { WalletError } from '../../domain/wallet-errors';

import type { WalletHistoryCursor, WalletHistoryPage, WalletOperationFacts } from '../../domain/wallet-operation';

export const DEFAULT_WALLET_HISTORY_LIMIT = 20;
export const MAX_WALLET_HISTORY_LIMIT = 100;
export const MAX_WALLET_CURSOR_LENGTH = 512;

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseWalletHistoryLimit(value: unknown): number {
    if (value === undefined) return DEFAULT_WALLET_HISTORY_LIMIT;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_WALLET_HISTORY_LIMIT) {
        throw invalidCursor();
    }
    return value;
}

export function encodeWalletHistoryCursor(cursor: WalletHistoryCursor): string {
    assertSequence(cursor.beforeSequence);
    return Buffer.from(JSON.stringify({ v: 1, beforeSequence: cursor.beforeSequence.toString() })).toString(
        'base64url',
    );
}

export function decodeWalletHistoryCursor(value: unknown): WalletHistoryCursor | null {
    if (value === undefined || value === null) return null;
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_WALLET_CURSOR_LENGTH ||
        !BASE64URL.test(value)
    ) {
        throw invalidCursor();
    }

    try {
        const decoded = Buffer.from(value, 'base64url').toString('utf8');
        if (Buffer.from(decoded).toString('base64url') !== value) throw invalidCursor();
        const candidate: unknown = JSON.parse(decoded);
        if (!isCursorPayload(candidate)) throw invalidCursor();
        const beforeSequence = BigInt(candidate.beforeSequence);
        assertSequence(beforeSequence);
        return { beforeSequence };
    } catch (error: unknown) {
        if (error instanceof WalletError) throw error;
        throw invalidCursor();
    }
}

export function paginateWalletOperations(
    operations: readonly WalletOperationFacts[],
    limit: number,
): WalletHistoryPage {
    parseWalletHistoryLimit(limit);
    for (let index = 1; index < operations.length; index += 1) {
        if (operations[index - 1].sequence <= operations[index].sequence) throw invalidCursor();
    }
    const page = operations.slice(0, limit);
    return {
        operations: page,
        nextCursor: operations.length > limit ? { beforeSequence: page.at(-1)!.sequence } : null,
    };
}

function isCursorPayload(value: unknown): value is { v: 1; beforeSequence: string } {
    if (typeof value !== 'object' || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !keys.includes('v') || !keys.includes('beforeSequence')) return false;
    const candidate = value as Record<string, unknown>;
    return (
        candidate.v === 1 &&
        typeof candidate.beforeSequence === 'string' &&
        POSITIVE_DECIMAL.test(candidate.beforeSequence)
    );
}

function assertSequence(value: bigint): void {
    if (value < 1n || value > MAX_POSTGRES_BIGINT) throw invalidCursor();
}

function invalidCursor(): WalletError {
    return new WalletError('WALLET_CURSOR_INVALID', 'The wallet history cursor or limit is invalid.');
}
