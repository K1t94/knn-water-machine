import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Header,
    Inject,
    Put,
    ServiceUnavailableException,
    UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ReferralFeatureStateService } from '../application/referral-feature-state.service';

import {
    ReferralFeatureOperationResponseDto,
    toReferralFeatureOperationResponse,
} from './dto/referral-feature-operation.dto';
import { ReferralOperationsGuard } from './referral-operations.guard';

@ApiExcludeController()
@Controller('internal/feature-flags/referral-program')
@UseGuards(ReferralOperationsGuard)
export class ReferralFeatureOperationsController {
    constructor(
        @Inject(ReferralFeatureStateService)
        private readonly featureState: ReferralFeatureStateService,
    ) {}

    @Get()
    @Header('Cache-Control', 'no-store')
    async getState(): Promise<ReferralFeatureOperationResponseDto> {
        try {
            return toReferralFeatureOperationResponse(await this.featureState.readAvailability());
        } catch {
            throw new ServiceUnavailableException('Referral feature state is unavailable.');
        }
    }

    @Put()
    @Header('Cache-Control', 'no-store')
    async setState(@Body() input: unknown): Promise<ReferralFeatureOperationResponseDto> {
        if (!isStrictFeatureBody(input)) {
            throw new BadRequestException('enabled must be a boolean.');
        }
        try {
            return toReferralFeatureOperationResponse(await this.featureState.setEnabled({ enabled: input.enabled }));
        } catch {
            throw new ServiceUnavailableException('Referral feature state is unavailable.');
        }
    }
}

function isStrictFeatureBody(value: unknown): value is { enabled: boolean } {
    return (
        typeof value === 'object' &&
        value !== null &&
        Object.keys(value).length === 1 &&
        typeof (value as Record<string, unknown>).enabled === 'boolean'
    );
}
