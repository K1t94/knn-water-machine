import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthMetrics } from './auth-metrics';

const secret = Buffer.alloc(32, 7).toString('base64url');

describe('AuthMetrics', () => {
  beforeEach(() => configure());
  afterEach(() => vi.unstubAllEnvs());

  it('exports stable lifecycle series without sensitive or high-cardinality labels', async () => {
    const mGet = vi.fn().mockResolvedValue(['12', '240']);
    const metrics = new AuthMetrics({ commandClient: { mGet } } as never);
    metrics.otpRequested('request');
    metrics.smsSend('fake', 'accepted');
    metrics.otpVerification('confirmed');
    metrics.rateLimited('phone_hour');
    metrics.budgetLimited();
    metrics.registrationCompletion('success');
    metrics.sessionRefresh('success');
    metrics.sessionRefresh('replayed');
    metrics.deliveryReceipt('delivered', 3);

    const output = await metrics.render(new Date('2030-01-02T23:59:59.000Z'));

    expect(mGet).toHaveBeenCalledWith([
      'auth:otp:budget:count:2030-01-02',
      'auth:otp:budget:xof:2030-01-02',
    ]);
    expect(output).toContain('otp_requests_total{operation="request"} 1');
    expect(output).toContain('sms_send_total{provider="fake",outcome="accepted",category="none"} 1');
    expect(output).toContain('otp_verifications_total{outcome="confirmed"} 1');
    expect(output).toContain('auth_rate_limit_total{dimension="phone_hour"} 1');
    expect(output).toContain('sms_budget_limit_total 1');
    expect(output).toContain('registration_completion_total{outcome="success"} 1');
    expect(output).toContain('session_refresh_total{outcome="success"} 1');
    expect(output).toContain('session_refresh_total{outcome="replayed"} 1');
    expect(output).toContain('session_replay_total 1');
    expect(output).toContain('sms_delivery_receipt_total{status="delivered"} 1');
    expect(output).toContain('sms_delivery_receipt_latency_seconds_count{status="delivered"} 1');
    expect(output).toContain('sms_daily_count_current 12');
    expect(output).toContain('sms_daily_spend_xof_current 240');
    expect(output).not.toMatch(/(?:phone|installation|request_id|token|promo|otp_code)=/i);
  });

  it('exports hard limits and ceil-derived absolute warning and critical thresholds', async () => {
    const metrics = new AuthMetrics({
      commandClient: { mGet: vi.fn().mockResolvedValue([null, null]) },
    } as never);

    const output = await metrics.render(new Date('2030-01-03T00:00:00.000Z'));

    expect(output).toContain('sms_daily_count_limit 500');
    expect(output).toContain('sms_daily_count_alert_threshold{severity="warning"} 400');
    expect(output).toContain('sms_daily_count_alert_threshold{severity="critical"} 475');
    expect(output).toContain('sms_daily_spend_xof_limit 10000');
    expect(output).toContain('sms_daily_spend_xof_alert_threshold{severity="warning"} 8000');
    expect(output).toContain('sms_daily_spend_xof_alert_threshold{severity="critical"} 9500');
  });

  it('switches authoritative Redis counters at the UTC day boundary', async () => {
    const mGet = vi.fn()
      .mockResolvedValueOnce(['499', '9980'])
      .mockResolvedValueOnce([null, null]);
    const metrics = new AuthMetrics({ commandClient: { mGet } } as never);

    await metrics.render(new Date('2030-01-03T23:59:59.999Z'));
    const nextDay = await metrics.render(new Date('2030-01-04T00:00:00.000Z'));

    expect(mGet).toHaveBeenNthCalledWith(2, [
      'auth:otp:budget:count:2030-01-04',
      'auth:otp:budget:xof:2030-01-04',
    ]);
    expect(nextDay).toContain('sms_daily_count_current 0');
    expect(nextDay).toContain('sms_daily_spend_xof_current 0');
  });
});

function configure(): void {
  const values = {
    NODE_ENV: 'test', APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379', MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'metrics-test', SMS_PROVIDER: 'fake',
    OTP_HMAC_KEY: secret, CREDENTIAL_HMAC_KEY: secret,
    FINGERPRINT_HMAC_KEY: secret, REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
    JWT_ACCESS_SIGNING_KEY: secret,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
