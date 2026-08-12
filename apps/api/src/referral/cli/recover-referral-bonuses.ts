import { PrismaService } from '../../prisma/prisma.service';
import { WalletCommandService } from '../../wallet/application/wallet-command.service';
import { PrismaWalletRepository } from '../../wallet/infrastructure/postgres/prisma-wallet.repository';
import { ReferralBonusDeliveryService } from '../application/referral-bonus-delivery.service';
import { ReferralFeatureStateService } from '../application/referral-feature-state.service';
import { REFERRAL_RECOVERY_BATCH_SIZE, ReferralRecoveryService } from '../application/referral-recovery.service';
import { PrismaReferralFeatureStateRepository } from '../infrastructure/postgres/prisma-referral-feature-state.repository';
import { PrismaReferralRepository } from '../infrastructure/postgres/prisma-referral.repository';

interface CliOptions {
    readonly batchSize: number;
    readonly help: boolean;
}

function parseOptions(args: readonly string[]): CliOptions {
    let batchSize = REFERRAL_RECOVERY_BATCH_SIZE;
    let help = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--') continue;
        else if (argument === '--help' || argument === '-h') help = true;
        else if (argument.startsWith('--batch-size=')) batchSize = Number(argument.slice('--batch-size='.length));
        else if (argument === '--batch-size') batchSize = Number(args[(index += 1)]);
        else throw new Error(`Unknown argument: ${argument}`);
    }

    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
        throw new Error('Batch size must be an integer from 1 to 100.');
    }

    return { batchSize, help };
}

function printHelp(): void {
    process.stdout.write(
        [
            'Recover due referral bonus entitlements through wallet idempotent credits.',
            '',
            'Usage: pnpm --filter @kaynann/api referral:recover -- [options]',
            '',
            'Options:',
            '  --batch-size <1-100>  Claim batch size (default: 25)',
            '  --help                Show this help',
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
        const referralRepository = new PrismaReferralRepository(prisma);
        const walletRepository = new PrismaWalletRepository(prisma);
        const walletCommandService = new WalletCommandService(walletRepository);
        const deliveryService = new ReferralBonusDeliveryService(referralRepository, walletCommandService);
        const featureState = new ReferralFeatureStateService(new PrismaReferralFeatureStateRepository(prisma));
        const recoveryService = new ReferralRecoveryService(referralRepository, deliveryService, featureState);
        const result = await recoveryService.runOnce({ batchSize: options.batchSize });
        process.stdout.write(`${JSON.stringify({ event: 'referral_recovery_completed', ...result })}\n`);
        if (result.permanentFailure > 0) process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown referral recovery failure';
    process.stderr.write(`${JSON.stringify({ event: 'referral_recovery_failed', message })}\n`);
    process.exitCode = 1;
});
