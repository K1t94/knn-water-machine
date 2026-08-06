import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ApplyReferralCodeRequestDto {
    @ApiProperty({ minLength: 1, maxLength: 64, example: '3A7K9MN2QTVW' })
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    promoCode!: string;
}

export class ReferralInvitationQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(512)
    cursor?: string;
}
