import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { REFERRAL_PROGRAM_FEATURE_KEY } from '../../application/ports/referral-feature-state.repository';

import type {
    ReferralFeatureAvailability,
    ReferralFeatureStateRepository,
    SetReferralFeatureAvailabilityInput,
} from '../../application/ports/referral-feature-state.repository';
import type { PrismaClient } from '@prisma/client';

interface ReferralFeatureStateRow {
    readonly key: string;
    readonly enabled: boolean;
    readonly revision: bigint;
    readonly updatedAt: Date;
}

@Injectable()
export class PrismaReferralFeatureStateRepository implements ReferralFeatureStateRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

    async readAvailability(): Promise<ReferralFeatureAvailability> {
        const state = await this.prisma.referralFeatureState.findUniqueOrThrow({
            where: { key: REFERRAL_PROGRAM_FEATURE_KEY },
        });
        return this.toAvailability(state);
    }

    async isEnabledWithSharedLock(transaction: unknown): Promise<boolean> {
        const rows = await this.transactionClient(transaction).$queryRaw<ReferralFeatureStateRow[]>(Prisma.sql`
            SELECT "key", "enabled", "revision", "updatedAt"
            FROM "ReferralFeatureState"
            WHERE "key" = ${REFERRAL_PROGRAM_FEATURE_KEY}::"ReferralFeatureKey"
            FOR SHARE
        `);
        return this.requireState(rows).enabled;
    }

    async setEnabled(input: SetReferralFeatureAvailabilityInput): Promise<ReferralFeatureAvailability> {
        return this.prisma.$transaction(async (transaction) => {
            const currentRows = await transaction.$queryRaw<ReferralFeatureStateRow[]>(Prisma.sql`
                SELECT "key", "enabled", "revision", "updatedAt"
                FROM "ReferralFeatureState"
                WHERE "key" = ${REFERRAL_PROGRAM_FEATURE_KEY}::"ReferralFeatureKey"
                FOR UPDATE
            `);
            const current = this.requireState(currentRows);
            if (current.enabled === input.enabled) return current;

            const updatedRows = await transaction.$queryRaw<ReferralFeatureStateRow[]>(Prisma.sql`
                UPDATE "ReferralFeatureState"
                SET "enabled" = ${input.enabled},
                    "revision" = "revision" + 1,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "key" = ${REFERRAL_PROGRAM_FEATURE_KEY}::"ReferralFeatureKey"
                RETURNING "key", "enabled", "revision", "updatedAt"
            `);
            return this.requireState(updatedRows);
        });
    }

    private transactionClient(transaction: unknown): Prisma.TransactionClient {
        if (typeof transaction !== 'object' || transaction === null || !('$queryRaw' in transaction)) {
            throw new TypeError('A Prisma transaction client is required for the referral feature shared lock.');
        }
        return transaction as Prisma.TransactionClient;
    }

    private requireState(rows: readonly ReferralFeatureStateRow[]): ReferralFeatureAvailability {
        const state = rows.at(0);
        if (state === undefined) throw new Error('Referral program feature state is missing.');
        return this.toAvailability(state);
    }

    private toAvailability(state: ReferralFeatureStateRow): ReferralFeatureAvailability {
        if (state.key !== REFERRAL_PROGRAM_FEATURE_KEY) {
            throw new Error(`Unexpected referral feature key: ${state.key}`);
        }
        return {
            key: REFERRAL_PROGRAM_FEATURE_KEY,
            enabled: state.enabled,
            revision: state.revision,
            updatedAt: state.updatedAt,
        };
    }
}
