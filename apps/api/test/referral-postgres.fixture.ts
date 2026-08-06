import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';

export const referralPostgresEnabled =
    process.env.RUN_POSTGRES_INTEGRATION === '1' && typeof process.env.DATABASE_URL === 'string';
export const repositoryRoot = resolve(__dirname, '../../..');
export const apiPrismaDirectory = join(repositoryRoot, 'apps/api/prisma');

export interface ReferralPostgresSchema {
    readonly name: string;
    readonly url: string;
    readonly prisma: PrismaClient;
    deploy(schemaPath?: string): void;
    dispose(): Promise<void>;
}

export function withSchema(databaseUrl: string, schema: string): string {
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    return url.toString();
}

export function deployReferralMigrations(
    databaseUrl: string,
    schemaPath = join(apiPrismaDirectory, 'schema.prisma'),
): void {
    execFileSync('pnpm', ['--filter', '@kaynann/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
        cwd: repositoryRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
    });
}

export function createMigrationSubset(label: string, migrationNames: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), `referral-${label}-`));
    const prismaDirectory = join(root, 'prisma');
    const migrationsDirectory = join(prismaDirectory, 'migrations');
    mkdirSync(migrationsDirectory, { recursive: true });
    writeFileSync(join(prismaDirectory, 'schema.prisma'), readFileSync(join(apiPrismaDirectory, 'schema.prisma')));

    for (const migrationName of migrationNames) {
        cpSync(join(apiPrismaDirectory, 'migrations', migrationName), join(migrationsDirectory, migrationName), {
            recursive: true,
        });
    }

    return root;
}

export function removeMigrationSubset(root: string): void {
    rmSync(root, { recursive: true, force: true });
}

export async function createReferralPostgresSchema(label: string): Promise<ReferralPostgresSchema> {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new Error('DATABASE_URL is required for referral PostgreSQL tests.');

    const name = `referral_${label}_${randomUUID().replaceAll('-', '')}`;
    const admin = new PrismaClient({ datasourceUrl: baseUrl });
    const url = withSchema(baseUrl, name);
    const prisma = new PrismaClient({ datasourceUrl: url });

    try {
        await admin.$executeRaw(Prisma.raw(`CREATE SCHEMA "${name}"`));
        await prisma.$connect();
    } catch (error: unknown) {
        await prisma.$disconnect();
        await admin.$executeRaw(Prisma.raw(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)).catch(() => undefined);
        await admin.$disconnect();
        throw error;
    }

    return {
        name,
        url,
        prisma,
        deploy(schemaPath): void {
            deployReferralMigrations(url, schemaPath);
        },
        async dispose(): Promise<void> {
            await prisma.$disconnect();
            await admin.$executeRaw(Prisma.raw(`DROP SCHEMA IF EXISTS "${name}" CASCADE`));
            await admin.$disconnect();
        },
    };
}

export async function insertReferralTestUser(
    prisma: PrismaClient | Prisma.TransactionClient,
    phoneSuffix: string,
): Promise<string> {
    const user = await prisma.user.create({
        data: {
            phoneE164: `+22177${phoneSuffix.padStart(7, '0').slice(-7)}`,
            phoneConfirmedAt: new Date('2026-08-06T00:00:00.000Z'),
        },
        select: { id: true },
    });
    return user.id;
}

export async function expectPostgresError(operation: Promise<unknown>, marker: string): Promise<void> {
    try {
        await operation;
    } catch (error: unknown) {
        const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (!text.includes(marker)) throw error;
        return;
    }
    throw new Error(`Expected PostgreSQL error containing ${marker}`);
}

export async function disposeReferralPostgresSchema(fixture: ReferralPostgresSchema | undefined): Promise<void> {
    if (fixture !== undefined) await fixture.dispose();
}
