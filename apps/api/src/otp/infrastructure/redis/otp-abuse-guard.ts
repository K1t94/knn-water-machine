import { Inject, Injectable, Optional } from '@nestjs/common';

import { CredentialCryptoService } from '../../../common/security/credential-crypto.service';
import { loadEnv } from '../../../config/env';
import { RedisScriptRunner } from '../../../infrastructure/redis/redis-script-runner';
import { AuthMetrics } from '../../../observability/auth-metrics';
import {
  recordOtpExhaustionScript,
  refundOtpBudgetScript,
  releaseOtpSemaphoreScript,
  reserveOtpSendScript,
  type AbuseReservationResult,
} from './otp-send.scripts';

export interface OtpAbuseContext {
  phoneE164: string;
  ipAddress: string;
  installationId: string;
  now: Date;
}

@Injectable()
export class OtpAbuseGuard {
  private readonly env = loadEnv();

  constructor(
    @Inject(RedisScriptRunner) private readonly scripts: RedisScriptRunner,
    @Inject(CredentialCryptoService) private readonly crypto: CredentialCryptoService,
    @Optional() @Inject(AuthMetrics) private readonly metrics?: AuthMetrics,
  ) {}

  async reserve(context: OtpAbuseContext): Promise<void> {
    const keys = this.keys(context);
    const result = await this.scripts.invoke(reserveOtpSendScript, {
      keys: [
        keys.block, keys.phoneHour, keys.phoneDay, keys.ipHour,
        keys.installationHour, keys.installationDay, keys.second,
        keys.globalCount, keys.globalCost, keys.parallel,
      ],
      arguments: [
        String(this.env.OTP_SENDS_PER_PHONE_HOUR),
        String(this.env.OTP_SENDS_PER_PHONE_DAY),
        String(this.env.OTP_SENDS_PER_IP_HOUR),
        String(this.env.OTP_SENDS_PER_INSTALLATION_HOUR),
        String(this.env.OTP_SENDS_PER_INSTALLATION_DAY),
        String(this.env.SMS_MAX_SENDS_PER_SECOND),
        String(this.env.SMS_DAILY_COUNT_LIMIT),
        String(this.env.SMS_ESTIMATED_UNIT_COST_XOF),
        String(this.env.SMS_DAILY_XOF_LIMIT),
        String(this.env.OTP_MAX_PARALLEL_SENDS_GLOBAL),
        String(60 * 60_000),
        String(48 * 60 * 60_000),
      ],
    });
    if (result !== 'ok') {
      if (isBudgetResult(result)) this.metrics?.budgetLimited();
      else this.metrics?.rateLimited(result);
      throw new OtpAbuseError(
        isBudgetResult(result) ? 'SMS_BUDGET_EXHAUSTED' : 'RATE_LIMITED',
        retryGuidance(result),
      );
    }
  }

  release(context: OtpAbuseContext): Promise<void> {
    return this.scripts.invoke(releaseOtpSemaphoreScript, { keys: [this.keys(context).parallel] });
  }

  refundDefinitiveFailure(context: OtpAbuseContext): Promise<void> {
    const keys = this.keys(context);
    return this.scripts.invoke(refundOtpBudgetScript, {
      keys: [keys.globalCount, keys.globalCost],
      arguments: [String(this.env.SMS_ESTIMATED_UNIT_COST_XOF)],
    });
  }

  recordExhaustion(phoneE164: string, now: Date): Promise<boolean> {
    const phone = this.crypto.fingerprintPhone(phoneE164).digest;
    const day = now.toISOString().slice(0, 10);
    return this.scripts.invoke(recordOtpExhaustionScript, {
      keys: [`auth:otp:exhausted:${phone}:${day}`, `auth:otp:block:${phone}`],
      arguments: [
        String(this.env.OTP_EXHAUSTED_CHALLENGES_PER_DAY),
        String(this.env.OTP_PHONE_BLOCK_SECONDS * 1000),
      ],
    });
  }

  private keys(context: OtpAbuseContext): Record<string, string> {
    const phone = this.crypto.fingerprintPhone(context.phoneE164).digest;
    const ip = this.crypto.fingerprintIp(context.ipAddress).digest;
    const installation = this.crypto.fingerprintInstallation(context.installationId).digest;
    const hour = context.now.toISOString().slice(0, 13);
    const day = context.now.toISOString().slice(0, 10);
    const second = Math.floor(context.now.getTime() / 1000);
    return {
      block: `auth:otp:block:${phone}`,
      phoneHour: `auth:otp:rate:phone:${phone}:h:${hour}`,
      phoneDay: `auth:otp:rate:phone:${phone}:d:${day}`,
      ipHour: `auth:otp:rate:ip:${ip}:h:${hour}`,
      installationHour: `auth:otp:rate:install:${installation}:h:${hour}`,
      installationDay: `auth:otp:rate:install:${installation}:d:${day}`,
      second: `auth:otp:rate:global:s:${second}`,
      globalCount: `auth:otp:budget:count:${day}`,
      globalCost: `auth:otp:budget:xof:${day}`,
      parallel: 'auth:otp:parallel',
    };
  }
}

export class OtpAbuseError extends Error {
  constructor(
    public readonly code: 'RATE_LIMITED' | 'SMS_BUDGET_EXHAUSTED',
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

function isBudgetResult(
  result: AbuseReservationResult,
): result is 'count_budget' | 'cost_budget' {
  return result === 'count_budget' || result === 'cost_budget';
}

function retryGuidance(result: AbuseReservationResult): number | undefined {
  if (result === 'throughput' || result === 'busy') return 1;
  if (result === 'blocked') return 60;
  if (result.endsWith('_hour')) return 60;
  return undefined;
}
