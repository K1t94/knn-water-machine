import { ApiProperty } from '@nestjs/swagger';

export class PublicFeatureAvailabilityDto {
    @ApiProperty({ type: Boolean })
    referralProgramEnabled!: boolean;
}

export class AppConfigResponseDto {
    @ApiProperty({ type: PublicFeatureAvailabilityDto })
    features!: PublicFeatureAvailabilityDto;
}
