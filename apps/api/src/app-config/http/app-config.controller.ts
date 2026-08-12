import { Controller, Get, Header, Inject, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { noStoreHeader } from '../../auth/http/auth-http.helpers';
import { ReferralFeatureStateService } from '../../referral/application/referral-feature-state.service';
import { ReferralPublicErrorResponseDto } from '../../referral/http/dto/referral-response.dto';
import { ReferralErrorFilter } from '../../referral/http/referral-error.filter';

import { AppConfigResponseDto } from './dto/app-config-response.dto';

@ApiTags('app-config')
@UseFilters(ReferralErrorFilter)
@Controller('v1/app-config')
export class AppConfigController {
    constructor(
        @Inject(ReferralFeatureStateService)
        private readonly referralFeatureState: ReferralFeatureStateService,
    ) {}

    @Get()
    @Header('Cache-Control', 'no-store')
    @ApiOperation({ summary: 'Get privacy-safe runtime feature availability' })
    @ApiOkResponse({ headers: noStoreHeader, type: AppConfigResponseDto })
    @ApiResponse({ status: 503, type: ReferralPublicErrorResponseDto })
    async getConfig(): Promise<AppConfigResponseDto> {
        const referral = await this.referralFeatureState.readAvailability();
        return { features: { referralProgramEnabled: referral.enabled } };
    }
}
