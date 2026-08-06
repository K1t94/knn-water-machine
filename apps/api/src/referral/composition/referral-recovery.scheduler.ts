import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { ReferralRecoveryService, REFERRAL_RECOVERY_INTERVAL_MS } from '../application/referral-recovery.service';

@Injectable()
export class ReferralRecoveryScheduler implements OnModuleDestroy {
    private running = false;
    private stopped = false;

    constructor(@Inject(ReferralRecoveryService) private readonly recoveryService: ReferralRecoveryService) {}

    @Interval(REFERRAL_RECOVERY_INTERVAL_MS)
    async recover(): Promise<void> {
        if (this.running || this.stopped) return;
        this.running = true;
        try {
            await this.recoveryService.runOnce();
        } finally {
            this.running = false;
        }
    }

    onModuleDestroy(): void {
        this.stopped = true;
    }
}
