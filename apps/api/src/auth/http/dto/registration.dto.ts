import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';

export class RegistrationContextDto {
    @ApiPropertyOptional({ nullable: true, maxLength: 64, type: String })
    @ValidateIf((_object, value) => value !== null)
    @IsString()
    @MaxLength(64)
    pendingPromoCode!: string | null;
}

export class RegistrationCompletionDto {
    @ApiProperty({ minLength: 1, maxLength: 128 })
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    setVersion!: string;

    @ApiProperty({ type: [String], format: 'uuid' })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    acceptedDocumentIds!: string[];

    @ApiProperty({ minLength: 16, maxLength: 128 })
    @IsString()
    @MinLength(16)
    @MaxLength(128)
    installationId!: string;
}
