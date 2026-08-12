import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletError } from '../domain/wallet-errors';
import { parseWalletBalance } from '../domain/water-amount';

import { WalletCommandService } from './wallet-command.service';

import type { WalletMutationRepository } from './ports/wallet.repository';
import type { CompensateWalletCommand, CreditWalletCommand, DebitWalletCommand } from './wallet-command';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const OCCURRED_AT = new Date('2026-08-04T10:00:00.000Z');

function credit(overrides: Partial<CreditWalletCommand> = {}): CreditWalletCommand {
    return {
        userId: USER_ID,
        businessEventKey: 'tests:credit-1',
        amountMl: 1_000n,
        operationKind: 'PACKAGE_CREDIT',
        source: 'TEST_SUITE',
        occurredAt: OCCURRED_AT,
        ...overrides,
    };
}

function debit(overrides: Partial<DebitWalletCommand> = {}): DebitWalletCommand {
    return {
        ...credit(),
        businessEventKey: 'tests:debit-1',
        operationKind: 'DISPENSE_DEBIT',
        ...overrides,
    };
}

function compensation(overrides: Partial<CompensateWalletCommand> = {}): CompensateWalletCommand {
    return {
        ...credit(),
        businessEventKey: 'tests:compensation-1',
        operationKind: 'COMPENSATION',
        compensatesEntryId: ENTRY_ID,
        ...overrides,
    };
}

function expectSynchronousWalletError(action: () => unknown, code: WalletError['code']): void {
    try {
        action();
        throw new Error('Expected a WalletError.');
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(WalletError);
        if (error instanceof WalletError) {
            expect(error.code).toBe(code);
        }
    }
}

describe('WalletCommandService', () => {
    let repository: WalletMutationRepository;
    let service: WalletCommandService;

    beforeEach(() => {
        repository = {
            credit: vi.fn(),
            debit: vi.fn(),
            compensate: vi.fn(),
            reconcile: vi.fn(),
        };
        service = new WalletCommandService(repository);
    });

    it('validates and normalizes a credit before calling the repository', async () => {
        vi.mocked(repository.credit).mockResolvedValue({
            entryId: ENTRY_ID,
            balanceAfterMl: parseWalletBalance(1_000n),
            idempotentReplay: false,
        });

        await expect(service.credit(credit())).resolves.toEqual({
            entryId: ENTRY_ID,
            balanceAfterMl: 1_000n,
            idempotentReplay: false,
        });
        expect(repository.credit).toHaveBeenCalledWith(
            expect.objectContaining({
                direction: 'CREDIT',
                compensatesEntryId: null,
                amountMl: 1_000n,
                ownerStatusPolicy: 'ACTIVE_ONLY',
            }),
        );
    });

    it('preserves the explicit existing-owner policy for a committed internal credit', async () => {
        vi.mocked(repository.credit).mockResolvedValue({
            entryId: ENTRY_ID,
            balanceAfterMl: parseWalletBalance(1_000n),
            idempotentReplay: false,
        });

        await service.credit(credit({ ownerStatusPolicy: 'EXISTING_OWNER' }));

        expect(repository.credit).toHaveBeenCalledWith(
            expect.objectContaining({ ownerStatusPolicy: 'EXISTING_OWNER' }),
        );
    });

    it('passes the trusted referral feature guard to the repository', async () => {
        vi.mocked(repository.credit).mockResolvedValue({
            entryId: ENTRY_ID,
            balanceAfterMl: parseWalletBalance(1_000n),
            idempotentReplay: false,
        });

        await service.credit(credit({ featureGuard: 'REFERRAL_PROGRAM_ENABLED' }));

        expect(repository.credit).toHaveBeenCalledWith(
            expect.objectContaining({ featureGuard: 'REFERRAL_PROGRAM_ENABLED' }),
        );
    });

    it.each(['REFERRAL_WELCOME_BONUS', 'REFERRAL_INVITER_BONUS'] as const)(
        'accepts referral credit classifier %s without a wallet-domain allowlist',
        async (operationKind) => {
            vi.mocked(repository.credit).mockResolvedValue({
                entryId: ENTRY_ID,
                balanceAfterMl: parseWalletBalance(1_000n),
                idempotentReplay: false,
            });

            await service.credit(
                credit({
                    businessEventKey: 'referral_bonus:11111111-1111-4111-8111-111111111111',
                    operationKind,
                    source: 'REFERRAL_PROGRAM',
                }),
            );

            expect(repository.credit).toHaveBeenCalledWith(
                expect.objectContaining({
                    businessEventKey: 'referral_bonus:11111111-1111-4111-8111-111111111111',
                    operationKind,
                    source: 'REFERRAL_PROGRAM',
                }),
            );
        },
    );

    it('returns the repository idempotent result without creating a second outcome', async () => {
        const replay = {
            entryId: ENTRY_ID,
            balanceAfterMl: parseWalletBalance(1_000n),
            idempotentReplay: true,
        };
        vi.mocked(repository.credit).mockResolvedValue(replay);

        await expect(service.credit(credit())).resolves.toBe(replay);
        expect(repository.credit).toHaveBeenCalledTimes(1);
    });

    it.each([
        'WALLET_USER_INELIGIBLE',
        'WALLET_EVENT_CONFLICT',
        'WALLET_INSUFFICIENT_BALANCE',
        'WALLET_BALANCE_LIMIT_EXCEEDED',
    ] as const)('preserves stable repository error %s', async (code) => {
        vi.mocked(repository.debit).mockRejectedValue(new WalletError(code, 'safe message'));

        await expect(service.debit(debit())).rejects.toMatchObject({ code, message: 'safe message' });
    });

    it('maps an unknown repository failure to a stable unavailable error', async () => {
        vi.mocked(repository.credit).mockRejectedValue(new Error('database host and SQL details'));

        await expect(service.credit(credit())).rejects.toMatchObject({
            code: 'WALLET_TEMPORARILY_UNAVAILABLE',
            message: 'The wallet operation is temporarily unavailable.',
        });
    });

    it.each([
        ['invalid owner', () => credit({ userId: 'not-a-uuid' })],
        ['invalid key', () => credit({ businessEventKey: 'invalid' })],
        ['number amount', () => credit({ amountMl: 1 as unknown as bigint })],
        ['zero amount', () => credit({ amountMl: 0n })],
        ['invalid kind', () => credit({ operationKind: 'lowercase' })],
        ['invalid source', () => credit({ source: 'web-client' })],
        ['invalid timestamp', () => credit({ occurredAt: new Date(Number.NaN) })],
        ['invalid feature guard', () => credit({ featureGuard: 'LOCAL_FLAG' as 'REFERRAL_PROGRAM_ENABLED' })],
        ['compensation kind without origin', () => credit({ operationKind: 'COMPENSATION' })],
        ['non-object command', () => null as unknown as CreditWalletCommand],
    ])('rejects malformed credit (%s) before repository access', (_label, makeCommand) => {
        expect(() => service.credit(makeCommand())).toThrow(WalletError);
        expect(repository.credit).not.toHaveBeenCalled();
    });

    it('rejects malformed debit before repository access', () => {
        expectSynchronousWalletError(() => service.debit(debit({ amountMl: -1n })), 'WALLET_INVALID_AMOUNT');
        expect(repository.debit).not.toHaveBeenCalled();
    });

    it.each([
        ['missing origin', () => compensation({ compensatesEntryId: '' })],
        [
            'wrong operation kind',
            () => ({ ...compensation(), operationKind: 'PACKAGE_CREDIT' }) as unknown as CompensateWalletCommand,
        ],
    ])('rejects malformed compensation (%s) before repository access', (_label, makeCommand) => {
        expectSynchronousWalletError(() => service.compensate(makeCommand()), 'WALLET_INVALID_COMPENSATION_ORIGIN');
        expect(repository.compensate).not.toHaveBeenCalled();
    });

    it('passes a normalized compensation to the repository', async () => {
        vi.mocked(repository.compensate).mockResolvedValue({
            entryId: '33333333-3333-4333-8333-333333333333',
            balanceAfterMl: parseWalletBalance(500n),
            idempotentReplay: false,
        });

        await service.compensate(compensation({ amountMl: 500n }));

        expect(repository.compensate).toHaveBeenCalledWith(
            expect.objectContaining({
                direction: 'CREDIT',
                operationKind: 'COMPENSATION',
                compensatesEntryId: ENTRY_ID,
            }),
        );
    });
});
