import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { SessionCredentialsDto } from '../../../sessions/http/dto/session.dto';

export class OtpRequestDto {
  @ApiProperty({ example: '+221771234567', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ minLength: 16, maxLength: 128 })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  installationId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 64, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pendingPromoCode?: string | null;
}

export class OtpResendDto extends OtpRequestDto {}

export class OtpVerificationDto extends OtpRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ pattern: '^\\d{6}$', writeOnly: true })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}

export class OtpIssuedResponseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  resendAvailableAt!: string;

  @ApiProperty({ enum: ['accepted', 'uncertain'] })
  @IsIn(['accepted', 'uncertain'])
  delivery!: 'accepted' | 'uncertain';
}

export class OtpVerifiedResponseDto {
  @ApiProperty({
    enum: ['authenticated', 'completeRegistration', 'acceptLegal'],
  })
  nextStep!: 'authenticated' | 'completeRegistration' | 'acceptLegal';

  @ApiPropertyOptional({ minLength: 32, maxLength: 512 })
  registrationAuthorization?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  expiresAt?: string;

  @ApiPropertyOptional({ type: SessionCredentialsDto })
  session?: SessionCredentialsDto;
}
