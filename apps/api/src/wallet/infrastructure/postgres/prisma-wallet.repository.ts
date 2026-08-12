import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type WalletLedgerEntry } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { WalletError } from '../../domain/wallet-errors';
import {
    MAX_WATER_MILLILITRES,
    parseWalletBalance,
    parseWaterAmount,
    type WalletBalance,
} from '../../domain/water-amount';

import { paginateWalletOperations } from './wallet-cursor';

import type { WalletMutationRepository, WalletQueryRepository } from '../../application/ports/wallet.repository';
import type {
    ValidatedCompensateWalletCommand,
    ValidatedCreditWalletCommand,
    ValidatedDebitWalletCommand,
    ValidatedWalletCommand,
    WalletCommandResult,
} from '../../application/wallet-command';
import type { WalletHistoryPage, WalletHistoryQuery, WalletOperationFacts } from '../../domain/wallet-operation';

type TransactionClient = Prisma.TransactionClient;

interface LockedUserRow {
    readonly id: string;
    readonly status: string;
}

interface ReferralFeatureStateRow {
    readonly enabled: boolean;
}

interface BalanceRow {
    readonly balanceMl: bigint;
}

interface CompensationOriginRow {
    readonly id: string;
    readonly walletUserId: string;
    readonly direction: string;
}

@Injectable()
export class PrismaWalletRepository implements WalletMutationRepository, WalletQueryRepository {
    public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

    public async getBalance(userId: string): Promise<WalletBalance> {
        try {
            const wallet = await this.prisma.waterWallet.findUnique({
                where: { userId },
                select: { balanceMl: true },
            });
            return parseWalletBalance(wallet?.balanceMl ?? 0n);
        } catch (error: unknown) {
            throw this.mapInfrastructureError(error);
        }
    }

    public async getHistory(query: WalletHistoryQuery): Promise<WalletHistoryPage> {
        try {
            const entries = await this.prisma.walletLedgerEntry.findMany({
                where: {
                    walletUserId: query.userId,
                    ...(query.cursor ? { sequence: { lt: query.cursor.beforeSequence } } : {}),
                },
                orderBy: { sequence: 'desc' },
                take: query.limit + 1,
            });
            return paginateWalletOperations(
                entries.map((entry) => this.toOperationFacts(entry)),
                query.limit,
            );
        } catch (error: unknown) {
            throw this.mapInfrastructureError(error);
        }
    }

    public credit(command: ValidatedCreditWalletCommand): Promise<WalletCommandResult> {
        return this.mutate(command);
    }

    public debit(command: ValidatedDebitWalletCommand): Promise<WalletCommandResult> {
        return this.mutate(command);
    }

    public compensate(command: ValidatedCompensateWalletCommand): Promise<WalletCommandResult> {
        return this.mutate(command);
    }

    public async reconcile(userId: string): Promise<WalletBalance> {
        try {
            const [wallet, entries] = await Promise.all([
                this.prisma.waterWallet.findUnique({ where: { userId }, select: { balanceMl: true } }),
                this.prisma.walletLedgerEntry.findMany({
                    where: { walletUserId: userId },
                    select: { direction: true, amountMl: true },
                    orderBy: { sequence: 'asc' },
                }),
            ]);
            const ledgerBalance = entries.reduce(
                (balance, entry) => balance + (entry.direction === 'CREDIT' ? entry.amountMl : -entry.amountMl),
                0n,
            );
            const projectionBalance = wallet?.balanceMl ?? 0n;
            if (projectionBalance !== ledgerBalance) {
                throw new WalletError(
                    'WALLET_RECONCILIATION_FAILED',
                    'The wallet projection does not match its immutable ledger.',
                );
            }
            return parseWalletBalance(projectionBalance);
        } catch (error: unknown) {
            throw this.mapInfrastructureError(error);
        }
    }

    private async mutate(command: ValidatedWalletCommand): Promise<WalletCommandResult> {
        try {
            return await this.prisma.$transaction(
                async (transaction) => {
                    await this.assertFeatureEnabled(transaction, command.featureGuard);
                    await this.assertEligibleOwner(transaction, command.userId, command.ownerStatusPolicy);
                    await this.createProjectionIfAbsent(transaction, command.userId);

                    const existing = await transaction.walletLedgerEntry.findUnique({
                        where: { businessEventKey: command.businessEventKey },
                    });
                    if (existing) {
                        return this.classifyExisting(existing, command);
                    }

                    if (command.compensatesEntryId !== null) {
                        await this.assertCompensationOrigin(transaction, command);
                    }

                    const balanceAfterMl = await this.updateProjection(transaction, command);
                    const entry = await transaction.walletLedgerEntry.create({
                        data: {
                            walletUserId: command.userId,
                            businessEventKey: command.businessEventKey,
                            direction: command.direction,
                            amountMl: command.amountMl,
                            operationKind: command.operationKind,
                            source: command.source,
                            balanceAfterMl,
                            occurredAt: command.occurredAt,
                            compensatesEntryId: command.compensatesEntryId,
                        },
                    });
                    return this.toResult(this.toOperationFacts(entry), false);
                },
                {
                    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
                    maxWait: 20_000,
                    timeout: 30_000,
                },
            );
        } catch (error: unknown) {
            if (this.isUniqueConstraintError(error)) {
                return this.classifyCommittedWinner(command);
            }
            throw this.mapInfrastructureError(error);
        }
    }

    private async assertFeatureEnabled(
        transaction: TransactionClient,
        guard: ValidatedWalletCommand['featureGuard'],
    ): Promise<void> {
        if (guard === null) return;
        const rows = await transaction.$queryRaw<ReferralFeatureStateRow[]>(Prisma.sql`
            SELECT "enabled"
            FROM "ReferralFeatureState"
            WHERE "key" = 'REFERRAL_PROGRAM'::"ReferralFeatureKey"
            FOR SHARE
        `);
        if (rows.at(0)?.enabled !== true) {
            throw new WalletError('WALLET_FEATURE_DISABLED', 'The guarded wallet feature is disabled.');
        }
    }

    private async classifyCommittedWinner(command: ValidatedWalletCommand): Promise<WalletCommandResult> {
        try {
            const winner = await this.prisma.walletLedgerEntry.findUnique({
                where: { businessEventKey: command.businessEventKey },
            });
            if (!winner) {
                throw new WalletError(
                    'WALLET_TEMPORARILY_UNAVAILABLE',
                    'The wallet operation is temporarily unavailable.',
                );
            }
            return this.classifyExisting(winner, command);
        } catch (error: unknown) {
            throw this.mapInfrastructureError(error);
        }
    }

    private async assertEligibleOwner(
        transaction: TransactionClient,
        userId: string,
        ownerStatusPolicy: ValidatedWalletCommand['ownerStatusPolicy'],
    ): Promise<void> {
        const users = await transaction.$queryRaw<LockedUserRow[]>(Prisma.sql`
            SELECT "id", "status"::text
            FROM "User"
            WHERE "id" = ${userId}::uuid
            FOR UPDATE
        `);
        const owner = users.at(0);
        if (owner === undefined || (ownerStatusPolicy === 'ACTIVE_ONLY' && owner.status !== 'ACTIVE')) {
            throw new WalletError('WALLET_USER_INELIGIBLE', 'The user is not eligible for wallet operations.');
        }
    }

    private async createProjectionIfAbsent(transaction: TransactionClient, userId: string): Promise<void> {
        await transaction.$executeRaw(Prisma.sql`
            INSERT INTO "WaterWallet" ("userId", "balanceMl", "createdAt", "updatedAt")
            VALUES (${userId}::uuid, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT ("userId") DO NOTHING
        `);
    }

    private async assertCompensationOrigin(
        transaction: TransactionClient,
        command: ValidatedWalletCommand,
    ): Promise<void> {
        const origins = await transaction.$queryRaw<CompensationOriginRow[]>(Prisma.sql`
            SELECT "id", "walletUserId", "direction"::text
            FROM "WalletLedgerEntry"
            WHERE "id" = ${command.compensatesEntryId}::uuid
            FOR SHARE
        `);
        const origin = origins.at(0);
        if (!origin || origin.walletUserId !== command.userId || origin.direction !== 'DEBIT') {
            throw new WalletError('WALLET_INVALID_COMPENSATION_ORIGIN', 'The wallet compensation origin is invalid.');
        }
    }

    private async updateProjection(
        transaction: TransactionClient,
        command: ValidatedWalletCommand,
    ): Promise<WalletBalance> {
        const rows =
            command.direction === 'CREDIT'
                ? await transaction.$queryRaw<BalanceRow[]>(Prisma.sql`
                      UPDATE "WaterWallet"
                      SET "balanceMl" = "balanceMl" + ${command.amountMl}, "updatedAt" = CURRENT_TIMESTAMP
                      WHERE "userId" = ${command.userId}::uuid
                        AND "balanceMl" <= ${MAX_WATER_MILLILITRES - command.amountMl}
                      RETURNING "balanceMl"
                  `)
                : await transaction.$queryRaw<BalanceRow[]>(Prisma.sql`
                      UPDATE "WaterWallet"
                      SET "balanceMl" = "balanceMl" - ${command.amountMl}, "updatedAt" = CURRENT_TIMESTAMP
                      WHERE "userId" = ${command.userId}::uuid
                        AND "balanceMl" >= ${command.amountMl}
                      RETURNING "balanceMl"
                  `);

        const updated = rows.at(0);
        if (!updated) {
            if (command.direction === 'DEBIT') {
                throw new WalletError('WALLET_INSUFFICIENT_BALANCE', 'The wallet has insufficient water balance.');
            }
            throw new WalletError('WALLET_BALANCE_LIMIT_EXCEEDED', 'The wallet balance limit would be exceeded.');
        }
        return parseWalletBalance(updated.balanceMl);
    }

    private classifyExisting(entry: WalletLedgerEntry, command: ValidatedWalletCommand): WalletCommandResult {
        const facts = this.toOperationFacts(entry);
        if (!this.hasSameFacts(facts, command)) {
            throw new WalletError('WALLET_EVENT_CONFLICT', 'The wallet business event key has conflicting facts.');
        }
        return this.toResult(facts, true);
    }

    private hasSameFacts(entry: WalletOperationFacts, command: ValidatedWalletCommand): boolean {
        return (
            entry.userId === command.userId &&
            entry.businessEventKey === command.businessEventKey &&
            entry.direction === command.direction &&
            entry.amountMl === command.amountMl &&
            entry.operationKind === command.operationKind &&
            entry.source === command.source &&
            entry.occurredAt.getTime() === command.occurredAt.getTime() &&
            entry.compensatesEntryId === command.compensatesEntryId
        );
    }

    private toResult(entry: WalletOperationFacts, idempotentReplay: boolean): WalletCommandResult {
        return {
            entryId: entry.id,
            balanceAfterMl: parseWalletBalance(entry.balanceAfterMl),
            idempotentReplay,
        };
    }

    private toOperationFacts(entry: WalletLedgerEntry): WalletOperationFacts {
        return {
            id: entry.id,
            sequence: entry.sequence,
            userId: entry.walletUserId,
            businessEventKey: entry.businessEventKey as WalletOperationFacts['businessEventKey'],
            direction: entry.direction,
            amountMl: parseWaterAmount(entry.amountMl),
            operationKind: entry.operationKind as WalletOperationFacts['operationKind'],
            source: entry.source as WalletOperationFacts['source'],
            balanceAfterMl: parseWalletBalance(entry.balanceAfterMl),
            occurredAt: entry.occurredAt,
            recordedAt: entry.createdAt,
            compensatesEntryId: entry.compensatesEntryId,
        };
    }

    private isUniqueConstraintError(error: unknown): boolean {
        return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    }

    private mapInfrastructureError(error: unknown): WalletError {
        if (error instanceof WalletError) {
            return error;
        }
        return new WalletError('WALLET_TEMPORARILY_UNAVAILABLE', 'The wallet operation is temporarily unavailable.');
    }
}
