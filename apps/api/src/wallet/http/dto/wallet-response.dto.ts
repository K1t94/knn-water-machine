import { ApiProperty } from '@nestjs/swagger';

import { serializeMillilitres } from '../../domain/water-amount';

import type { WalletDirection } from '../../domain/wallet-operation';
import type { WalletBalance } from '../../domain/water-amount';

export class WalletBalanceResponseDto {
    @ApiProperty({
        description: 'Current water balance in exact integer millilitres.',
        example: '12500',
        pattern: '^(0|[1-9][0-9]{0,18})$',
    })
    balanceMl!: string;

    @ApiProperty({
        description: 'Display-only litre representation with three decimals.',
        example: '12.500',
        pattern: '^(0|[1-9][0-9]*)\\.[0-9]{3}$',
    })
    balanceLiters!: string;

    @ApiProperty({ format: 'date-time' })
    observedAt!: string;
}

export class WalletPublicErrorDetailsDto {
    @ApiProperty({ example: 'WALLET_TEMPORARILY_UNAVAILABLE' })
    code!: string;

    @ApiProperty({ example: 'Wallet data is temporarily unavailable.' })
    message!: string;

    @ApiProperty({ example: true })
    retryable!: boolean;

    @ApiProperty({ example: 'request-id' })
    requestId!: string;
}

export class WalletPublicErrorResponseDto {
    @ApiProperty({ type: WalletPublicErrorDetailsDto })
    error!: WalletPublicErrorDetailsDto;
}

export class WalletHistoryEntryResponseDto {
    @ApiProperty({ format: 'uuid' })
    id!: string;

    @ApiProperty({ enum: ['CREDIT', 'DEBIT'] })
    direction!: WalletDirection;

    @ApiProperty({ example: '1250', pattern: '^[1-9][0-9]{0,18}$' })
    amountMl!: string;

    @ApiProperty({ example: 'TEST_OPERATION', pattern: '^[A-Z][A-Z0-9_]{1,63}$' })
    operationKind!: string;

    @ApiProperty({ example: 'TEST_SUITE', pattern: '^[A-Z][A-Z0-9_]{1,63}$' })
    source!: string;

    @ApiProperty({ format: 'date-time' })
    occurredAt!: string;

    @ApiProperty({ format: 'date-time' })
    recordedAt!: string;
}

export class WalletHistoryResponseDto {
    @ApiProperty({ type: WalletHistoryEntryResponseDto, isArray: true, maxItems: 100 })
    readonly items!: readonly WalletHistoryEntryResponseDto[];

    @ApiProperty({ nullable: true, maxLength: 512, type: String })
    nextCursor!: string | null;

    @ApiProperty()
    hasMore!: boolean;
}

export function toWalletBalanceResponse(balance: WalletBalance): WalletBalanceResponseDto {
    const wholeLitres = balance / 1_000n;
    const fractionalLitres = (balance % 1_000n).toString().padStart(3, '0');

    return {
        balanceMl: serializeMillilitres(balance),
        balanceLiters: `${wholeLitres}.${fractionalLitres}`,
        observedAt: new Date().toISOString(),
    };
}
