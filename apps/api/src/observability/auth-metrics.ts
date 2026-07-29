import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import { loadEnv } from '../config/env';
import { RedisService } from '../infrastructure/redis/redis.service';

type SmsOutcome = 'accepted' | 'uncertain' | 'failed';
type VerificationOutcome = 'confirmed' | 'invalid' | 'expired' | 'used' | 'exhausted';
type RefreshOutcome = 'success' | 'invalid' | 'expired' | 'replayed';
export type RateLimitDimension =
  | 'blocked' | 'phone_hour' | 'phone_day' | 'ip_hour'
  | 'installation_hour' | 'installation_day' | 'throughput' | 'busy'
  | 'phone_lock' | 'resend_cooldown';
type SmsFailureLabel =
  | 'none' | 'INVALID_CONFIGURATION' | 'AUTHENTICATION_FAILED'
  | 'BALANCE_EXHAUSTED' | 'PROVIDER_RATE_LIMITED' | 'INVALID_RECIPIENT'
  | 'MESSAGE_REJECTED' | 'TIMEOUT' | 'TEMPORARY_PROVIDER_FAILURE';
type ReceiptStatus = 'delivered' | 'pending' | 'uncertain' | 'failed';

@Injectable()
export class AuthMetrics {
  readonly registry = new Registry();
  private readonly env = loadEnv();

  private readonly otpRequests = new Counter({
    name: 'otp_requests_total',
    help: 'OTP issue requests received by operation.',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });
  private readonly smsSends = new Counter({
    name: 'sms_send_total',
    help: 'Normalized SMS send outcomes.',
    labelNames: ['provider', 'outcome', 'category'] as const,
    registers: [this.registry],
  });
  private readonly otpVerifications = new Counter({
    name: 'otp_verifications_total',
    help: 'OTP verification outcomes.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly rateLimits = new Counter({
    name: 'auth_rate_limit_total',
    help: 'Authentication rate-limit activations.',
    labelNames: ['dimension'] as const,
    registers: [this.registry],
  });
  private readonly budgetLimits = new Counter({
    name: 'sms_budget_limit_total',
    help: 'Daily SMS budget-limit activations.',
    registers: [this.registry],
  });
  private readonly registrations = new Counter({
    name: 'registration_completion_total',
    help: 'Registration completion outcomes.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly refreshes = new Counter({
    name: 'session_refresh_total',
    help: 'Refresh-token rotation outcomes.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly replays = new Counter({
    name: 'session_replay_total',
    help: 'Refresh-token replay detections.',
    registers: [this.registry],
  });
  private readonly receipts = new Counter({
    name: 'sms_delivery_receipt_total',
    help: 'Normalized delivery receipt outcomes.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  private readonly receiptLatency = new Histogram({
    name: 'sms_delivery_receipt_latency_seconds',
    help: 'Time from SMS acceptance to delivery receipt.',
    labelNames: ['status'] as const,
    buckets: [1, 5, 15, 30, 60, 120, 300, 900, 3600],
    registers: [this.registry],
  });
  private readonly dailyCountCurrent = this.gauge(
    'sms_daily_count_current',
    'Current accepted or uncertain SMS count in the UTC day.',
  );
  private readonly dailyCountLimit = this.gauge(
    'sms_daily_count_limit',
    'Configured daily SMS count hard limit.',
  );
  private readonly dailyCountThreshold = this.thresholdGauge(
    'sms_daily_count_alert_threshold',
    'Absolute daily SMS count alert thresholds.',
  );
  private readonly dailySpendCurrent = this.gauge(
    'sms_daily_spend_xof_current',
    'Current estimated SMS spend in XOF in the UTC day.',
  );
  private readonly dailySpendLimit = this.gauge(
    'sms_daily_spend_xof_limit',
    'Configured daily SMS spend hard limit in XOF.',
  );
  private readonly dailySpendThreshold = this.thresholdGauge(
    'sms_daily_spend_xof_alert_threshold',
    'Absolute daily SMS spend alert thresholds in XOF.',
  );

  constructor(@Inject(RedisService) private readonly redis: RedisService) {
    this.setBudgetConstants();
  }

  otpRequested(operation: 'request' | 'resend'): void {
    this.otpRequests.inc({ operation });
  }

  smsSend(
    provider: 'fake' | 'orange',
    outcome: SmsOutcome,
    category: SmsFailureLabel = 'none',
  ): void {
    this.smsSends.inc({ provider, outcome, category });
  }

  otpVerification(outcome: VerificationOutcome): void {
    this.otpVerifications.inc({ outcome });
  }

  rateLimited(dimension: RateLimitDimension): void {
    this.rateLimits.inc({ dimension });
  }

  budgetLimited(): void {
    this.budgetLimits.inc();
  }

  registrationCompletion(outcome: 'success' | 'failure'): void {
    this.registrations.inc({ outcome });
  }

  sessionRefresh(outcome: RefreshOutcome): void {
    this.refreshes.inc({ outcome });
    if (outcome === 'replayed') this.replays.inc();
  }

  deliveryReceipt(status: ReceiptStatus, latencySeconds?: number): void {
    this.receipts.inc({ status });
    if (latencySeconds !== undefined && latencySeconds >= 0) {
      this.receiptLatency.observe({ status }, latencySeconds);
    }
  }

  async render(now = new Date()): Promise<string> {
    await this.refreshBudgetSnapshot(now);
    return this.registry.metrics();
  }

  private gauge(name: string, help: string): Gauge {
    return new Gauge({ name, help, registers: [this.registry] });
  }

  private thresholdGauge(name: string, help: string): Gauge<'severity'> {
    return new Gauge({
      name,
      help,
      labelNames: ['severity'] as const,
      registers: [this.registry],
    });
  }

  private setBudgetConstants(): void {
    this.dailyCountLimit.set(this.env.SMS_DAILY_COUNT_LIMIT);
    this.dailySpendLimit.set(this.env.SMS_DAILY_XOF_LIMIT);
    this.dailyCountThreshold.set(
      { severity: 'warning' },
      threshold(this.env.SMS_DAILY_COUNT_LIMIT, this.env.SMS_DAILY_COUNT_WARNING_PERCENT),
    );
    this.dailyCountThreshold.set(
      { severity: 'critical' },
      threshold(this.env.SMS_DAILY_COUNT_LIMIT, this.env.SMS_DAILY_COUNT_CRITICAL_PERCENT),
    );
    this.dailySpendThreshold.set(
      { severity: 'warning' },
      threshold(this.env.SMS_DAILY_XOF_LIMIT, this.env.SMS_DAILY_XOF_WARNING_PERCENT),
    );
    this.dailySpendThreshold.set(
      { severity: 'critical' },
      threshold(this.env.SMS_DAILY_XOF_LIMIT, this.env.SMS_DAILY_XOF_CRITICAL_PERCENT),
    );
  }

  private async refreshBudgetSnapshot(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    const values = await this.redis.commandClient.mGet([
      `auth:otp:budget:count:${day}`,
      `auth:otp:budget:xof:${day}`,
    ]);
    this.dailyCountCurrent.set(parseCounter(values[0]));
    this.dailySpendCurrent.set(parseCounter(values[1]));
  }
}

function threshold(limit: number, percentage: number): number {
  return Math.ceil(limit * percentage / 100);
}

function parseCounter(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
