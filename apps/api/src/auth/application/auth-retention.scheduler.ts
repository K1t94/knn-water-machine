import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AuthRetentionService } from './auth-retention.service';

export const AUTH_RETENTION_CRON = '0 0 3 * * *';

@Injectable()
export class AuthRetentionScheduler {
  private running = false;

  constructor(@Inject(AuthRetentionService) private readonly retention: AuthRetentionService) {}

  @Cron(AUTH_RETENTION_CRON, { name: 'auth-retention', timeZone: 'UTC', waitForCompletion: true })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.retention.run();
    } finally {
      this.running = false;
    }
  }
}
