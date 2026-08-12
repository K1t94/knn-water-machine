import { ApiProperty } from '@nestjs/swagger';

import { REFERRAL_PUBLIC_ERROR_CODES, type ReferralPublicErrorCode } from '../../domain/referral-errors';

function promoCodeProperty() {
    return {
        pattern: '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$',
        example: '3A7K9MN2QTVW',
    } as const;
}

function millilitresProperty() {
    return {
        pattern: '^(0|[1-9][0-9]*)$',
        example: '5000',
    } as const;
}

export class MyReferralResponseDto {
    @ApiProperty(promoCodeProperty())
    promoCode!: string;

    @ApiProperty({ pattern: '^kaynann://register\\?promo=[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$' })
    referralLink!: string;

    @ApiProperty(millilitresProperty())
    currentInviterRewardMl!: string;

    @ApiProperty(millilitresProperty())
    creditedInviterBonusMl!: string;

    @ApiProperty({ minimum: 0 })
    creditedInvitationCount!: number;
}

export class ReferralInvitationResponseDto {
    @ApiProperty({ format: 'uuid' })
    id!: string;

    @ApiProperty({ pattern: '^\\*\\*[0-9]{0,2}$', example: '**42' })
    inviteeLabel!: string;

    @ApiProperty({ format: 'date-time' })
    appliedAt!: string;

    @ApiProperty({ enum: ['CREDITED'] })
    status!: 'CREDITED';

    @ApiProperty(millilitresProperty())
    creditedAmountMl!: string;
}

export class ReferralInvitationPageResponseDto {
    @ApiProperty({ type: ReferralInvitationResponseDto, isArray: true, maxItems: 100 })
    items!: readonly ReferralInvitationResponseDto[];

    @ApiProperty({ nullable: true, type: String, minLength: 1, maxLength: 512 })
    nextCursor!: string | null;

    @ApiProperty()
    hasMore!: boolean;
}

export class ReferralPublicErrorDetailsDto {
    @ApiProperty({ enum: [...REFERRAL_PUBLIC_ERROR_CODES, 'REFERRAL_CURSOR_INVALID'] })
    code!: ReferralPublicErrorCode | 'REFERRAL_CURSOR_INVALID';

    @ApiProperty({ maxLength: 200 })
    message!: string;

    @ApiProperty()
    retryable!: boolean;

    @ApiProperty({ maxLength: 128 })
    requestId!: string;
}

export class ReferralPublicErrorResponseDto {
    @ApiProperty({ type: ReferralPublicErrorDetailsDto })
    error!: ReferralPublicErrorDetailsDto;
}
