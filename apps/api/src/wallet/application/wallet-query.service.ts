import { Inject, Injectable } from '@nestjs/common';

import { serializeMillilitres } from '../domain/water-amount';
import {
    decodeWalletHistoryCursor,
    encodeWalletHistoryCursor,
    parseWalletHistoryLimit,
} from '../infrastructure/postgres/wallet-cursor';

import { WALLET_REPOSITORY } from './ports/wallet.repository';

import type { WalletQueryRepository } from './ports/wallet.repository';
import type { WalletDirection } from '../domain/wallet-operation';
import type { WalletBalance } from '../domain/water-amount';

export interface WalletHistoryRequest {
    readonly limit?: number;
    readonly cursor?: string;
}

export interface PublicWalletOperation {
    readonly id: string;
    readonly direction: WalletDirection;
    readonly amountMl: string;
    readonly operationKind: string;
    readonly source: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
}

export interface PublicWalletHistoryPage {
    readonly items: readonly PublicWalletOperation[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
}

@Injectable()
export class WalletQueryService {
    public constructor(
        @Inject(WALLET_REPOSITORY)
        private readonly repository: WalletQueryRepository,
    ) {}

    public getBalance(userId: string): Promise<WalletBalance> {
        return this.repository.getBalance(userId);
    }

    public async getHistory(userId: string, request: WalletHistoryRequest): Promise<PublicWalletHistoryPage> {
        const limit = parseWalletHistoryLimit(request.limit);
        const cursor = decodeWalletHistoryCursor(request.cursor);
        const page = await this.repository.getHistory({ userId, limit, cursor });
        return {
            items: page.operations.map((operation) => ({
                id: operation.id,
                direction: operation.direction,
                amountMl: serializeMillilitres(operation.amountMl),
                operationKind: operation.operationKind,
                source: operation.source,
                occurredAt: operation.occurredAt.toISOString(),
                recordedAt: operation.recordedAt.toISOString(),
            })),
            nextCursor: page.nextCursor ? encodeWalletHistoryCursor(page.nextCursor) : null,
            hasMore: page.nextCursor !== null,
        };
    }
}
