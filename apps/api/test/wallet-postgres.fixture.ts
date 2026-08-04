import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, type UserStatus } from '@prisma/client';

import { WalletCommandService } from '../src/wallet/application/wallet-command.service';
import { PrismaWalletRepository } from '../src/wallet/infrastructure/postgres/prisma-wallet.repository';

import type { PrismaService } from '../src/prisma/prisma.service';

export const walletPostgresEnabled =
    process.env.RUN_POSTGRES_INTEGRATION === '1' && typeof process.env.DATABASE_URL === 'string';

export interface WalletPostgresFixture {
    readonly prisma: PrismaClient;
    readonly repository: PrismaWalletRepository;
    readonly service: WalletCommandService;
    createUser(status?: UserStatus): Promise<string>;
    createConnection(): Promise<{
        prisma: PrismaClient;
        repository: PrismaWalletRepository;
        service: WalletCommandService;
    }>;
    dispose(): Promise<void>;
}

export async function createWalletPostgresFixture(label: string): Promise<WalletPostgresFixture> {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
        throw new Error('DATABASE_URL is required for wallet PostgreSQL tests.');
    }

    const schema = `wallet_${label}_${randomUUID().replaceAll('-', '')}`;
    const admin = new PrismaClient({ datasourceUrl: baseUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

    const schemaUrl = new URL(baseUrl);
    schemaUrl.searchParams.set('schema', schema);
    schemaUrl.searchParams.set('connection_limit', '1');
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: schemaUrl.toString() },
        stdio: 'pipe',
    });

    const clients: PrismaClient[] = [];
    const createConnection = async () => {
        const prisma = new PrismaClient({ datasourceUrl: schemaUrl.toString() });
        await prisma.$connect();
        clients.push(prisma);
        const repository = new PrismaWalletRepository(prisma as unknown as PrismaService);
        return { prisma, repository, service: new WalletCommandService(repository) };
    };
    const primary = await createConnection();

    return {
        ...primary,
        async createUser(status: UserStatus = 'ACTIVE'): Promise<string> {
            const suffix = Math.floor(Math.random() * 10_000_000)
                .toString()
                .padStart(7, '0');
            const user = await primary.prisma.user.create({
                data: {
                    phoneE164: `+22177${suffix}`,
                    phoneConfirmedAt: new Date('2026-08-04T00:00:00.000Z'),
                    status,
                },
                select: { id: true },
            });
            return user.id;
        },
        createConnection,
        async dispose(): Promise<void> {
            await Promise.all(clients.map((client) => client.$disconnect()));
            await admin.$executeRaw(Prisma.raw(`DROP SCHEMA "${schema}" CASCADE`));
            await admin.$disconnect();
        },
    };
}

export function walletCommand(userId: string, businessEventKey: string, amountMl: bigint) {
    return {
        userId,
        businessEventKey,
        amountMl,
        operationKind: 'TEST_OPERATION',
        source: 'TEST_SUITE',
        occurredAt: new Date('2026-08-04T10:00:00.000Z'),
    };
}
