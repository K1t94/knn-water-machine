import { performance } from 'node:perf_hooks';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccessTokenService } from '../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';
import { WALLET_REPOSITORY } from '../src/wallet/application/ports/wallet.repository';
import { WalletQueryService } from '../src/wallet/application/wallet-query.service';
import { WalletController } from '../src/wallet/http/wallet.controller';

import { httpServer } from './http-test-helpers';
import { createWalletPostgresFixture, walletPostgresEnabled } from './wallet-postgres.fixture';

import type { WalletPostgresFixture } from './wallet-postgres.fixture';
import type { INestApplication } from '@nestjs/common';

const warmupRequestCount = 5;
const measuredRequestCount = 20;
const localThresholdMs = 2_000;

describe.skipIf(!walletPostgresEnabled)('wallet read performance on local PostgreSQL', () => {
    let app: INestApplication;
    let fixture: WalletPostgresFixture;
    let ownerId: string;

    beforeAll(async () => {
        fixture = await createWalletPostgresFixture('read_performance');
        ownerId = await fixture.createUser();
        const unrelatedUserId = await fixture.createUser();
        await seedWallet(fixture, ownerId, 250);
        await seedWallet(fixture, unrelatedUserId, 50);

        const accessTokens = {
            validate: vi.fn().mockResolvedValue({
                iss: 'kaynann-api',
                aud: 'kaynann-mobile',
                sub: ownerId,
                sid: '00000000-0000-4000-8000-000000000010',
                jti: 'wallet-performance',
                iat: 1,
                exp: 2,
            }),
        };
        const sessions = {
            findActive: vi.fn().mockResolvedValue({
                id: '00000000-0000-4000-8000-000000000010',
                userId: ownerId,
            }),
        };

        const module = await Test.createTestingModule({
            controllers: [WalletController],
            providers: [
                WalletQueryService,
                AccessSessionGuard,
                { provide: WALLET_REPOSITORY, useValue: fixture.repository },
                { provide: AccessTokenService, useValue: accessTokens },
                { provide: SessionsRepository, useValue: sessions },
            ],
        }).compile();
        app = module.createNestApplication();
        app.useLogger(false);
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.init();
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await fixture.dispose();
    }, 30_000);

    it('keeps authenticated balance and first-page history reads below the local regression threshold', async () => {
        const balanceDurations = await measureRequests('/v1/wallet/balance');
        const historyDurations = await measureRequests('/v1/wallet/operations?limit=20');

        const balanceWithinThreshold = balanceDurations.filter((duration) => duration <= localThresholdMs).length;
        const historyWithinThreshold = historyDurations.filter((duration) => duration <= localThresholdMs).length;

        process.stdout.write(
            `[wallet-read-performance] local regression profile (not production capacity): ` +
                `balance p95=${percentile95(balanceDurations).toFixed(1)}ms max=${Math.max(...balanceDurations).toFixed(1)}ms; ` +
                `history p95=${percentile95(historyDurations).toFixed(1)}ms max=${Math.max(...historyDurations).toFixed(1)}ms\n`,
        );
        expect(balanceWithinThreshold).toBeGreaterThanOrEqual(19);
        expect(historyWithinThreshold).toBeGreaterThanOrEqual(19);
    });

    async function measureRequests(path: string): Promise<number[]> {
        for (let index = 0; index < warmupRequestCount; index += 1) {
            await expectSuccessfulRequest(path);
        }

        const durations: number[] = [];
        for (let index = 0; index < measuredRequestCount; index += 1) {
            const startedAt = performance.now();
            await expectSuccessfulRequest(path);
            durations.push(performance.now() - startedAt);
        }
        return durations;
    }

    async function expectSuccessfulRequest(path: string): Promise<void> {
        const response = await request(httpServer(app)).get(path).set('authorization', 'Bearer performance-token');
        expect(response.status, JSON.stringify(response.body)).toBe(200);
    }
});

function percentile95(durations: readonly number[]): number {
    const sorted = [...durations].sort((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function seedWallet(fixture: WalletPostgresFixture, userId: string, entryCount: number): Promise<void> {
    await fixture.prisma.waterWallet.create({ data: { userId, balanceMl: BigInt(entryCount) } });
    await fixture.prisma.walletLedgerEntry.createMany({
        data: Array.from({ length: entryCount }, (_, index) => ({
            walletUserId: userId,
            businessEventKey: `performance:${userId}-${index}`,
            direction: 'CREDIT' as const,
            amountMl: 1n,
            operationKind: 'TEST_OPERATION',
            source: 'TEST_SUITE',
            balanceAfterMl: BigInt(index + 1),
            occurredAt: new Date('2026-08-04T10:00:00.000Z'),
        })),
    });
}
