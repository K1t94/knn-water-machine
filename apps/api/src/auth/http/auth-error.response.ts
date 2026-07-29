import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AUTH_ERROR_CODES, type AuthErrorCode } from './auth-error-code';

export interface AuthErrorBody {
  code: AuthErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  requestId: string;
}

export interface AuthErrorResponse {
  error: AuthErrorBody;
}

export class AuthErrorBodyDto implements AuthErrorBody {
  @ApiProperty({ enum: AUTH_ERROR_CODES })
  code!: AuthErrorCode;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  retryable!: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  retryAfterSeconds?: number;

  @ApiProperty({ maxLength: 128 })
  requestId!: string;
}

export class AuthErrorResponseDto implements AuthErrorResponse {
  @ApiProperty({ type: AuthErrorBodyDto })
  error!: AuthErrorBodyDto;
}
