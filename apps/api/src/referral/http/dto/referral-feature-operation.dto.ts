import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

import type { ReferralFeatureAvailability } from '../../application/ports/referral-feature-state.repository';

export class SetReferralFeatureOperationDto {
    @ApiProperty({ type: Boolean })
    @IsBoolean()
    enabled!: unknown;
}

export class ReferralFeatureOperationResponseDto {
    @ApiProperty({ example: 'REFERRAL_PROGRAM' })
    key!: 'REFERRAL_PROGRAM';

    @ApiProperty({ type: Boolean })
    enabled!: boolean;

    @ApiProperty({ example: '1', pattern: '^\\d+$' })
    revision!: string;

    @ApiProperty({ example: '2026-08-12T12:00:00.000Z', format: 'date-time' })
    updatedAt!: string;
}

export function toReferralFeatureOperationResponse(
    availability: ReferralFeatureAvailability,
): ReferralFeatureOperationResponseDto {
    return {
        key: availability.key,
        enabled: availability.enabled,
        revision: availability.revision.toString(10),
        updatedAt: availability.updatedAt.toISOString(),
    };
}
