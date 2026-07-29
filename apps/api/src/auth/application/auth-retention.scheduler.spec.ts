import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { AuthRetentionService } from './auth-retention.service';
import { AUTH_RETENTION_CRON, AuthRetentionScheduler } from './auth-retention.scheduler';

describe('AuthRetentionScheduler', () => {
  it('uses the daily 03:00 UTC six-field cron expression', () => {
    expect(AUTH_RETENTION_CRON).toBe('0 0 3 * * *');
  });

  it('suppresses overlap in the same process', async () => {
    let finish!: () => void;
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const scheduler = new AuthRetentionScheduler({ run } as never);
    const first = scheduler.run();
    await scheduler.run();
    expect(run).toHaveBeenCalledOnce();
    finish();
    await first;
    await scheduler.run();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('registers the named cron provider', async () => {
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        AuthRetentionScheduler,
        { provide: AuthRetentionService, useValue: { run: vi.fn() } },
      ],
    }).compile();
    await module.init();
    const registry = module.get(SchedulerRegistry);
    expect(registry.doesExist('cron', 'auth-retention')).toBe(true);
    registry.getCronJob('auth-retention').stop();
    await module.close();
  });
});
