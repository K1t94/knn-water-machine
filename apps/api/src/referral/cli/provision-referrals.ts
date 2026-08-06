import { PrismaService } from '../../prisma/prisma.service';
import { ReferralProvisioningService } from '../application/referral-provisioning.service';
import { ReferralPromoProvisioner } from '../infrastructure/postgres/referral-promo-provisioner';

interface CliOptions {
    readonly batchSize: number;
    readonly dryRun: boolean;
    readonly help: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

function parseOptions(args: readonly string[]): CliOptions {
    let batchSize = DEFAULT_BATCH_SIZE;
    let dryRun = false;
    let help = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--') continue;
        else if (argument === '--dry-run') dryRun = true;
        else if (argument === '--help' || argument === '-h') help = true;
        else if (argument.startsWith('--batch-size=')) batchSize = Number(argument.slice('--batch-size='.length));
        else if (argument === '--batch-size') batchSize = Number(args[(index += 1)]);
        else throw new Error(`Unknown argument: ${argument}`);
    }

    return { batchSize, dryRun, help };
}

function printHelp(): void {
    process.stdout.write(
        [
            'Provision stable referral promo codes for existing users.',
            '',
            'Usage: pnpm --filter @kaynann/api referral:provision -- [options]',
            '',
            'Options:',
            '  --dry-run            Count missing rows without writing',
            '  --batch-size <1-1000>  UUID-keyset batch size (default: 100)',
            '  --help               Show this help',
            '',
        ].join('\n'),
    );
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const prisma = new PrismaService();
    try {
        await prisma.$connect();
        const service = new ReferralProvisioningService(new ReferralPromoProvisioner(prisma));
        const counters = await service.run(options);
        process.stdout.write(`${JSON.stringify({ event: 'referral_provisioning_completed', ...counters })}\n`);
        if (counters.failures > 0) process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown provisioning failure';
    process.stderr.write(`${JSON.stringify({ event: 'referral_provisioning_failed', message })}\n`);
    process.exitCode = 1;
});
