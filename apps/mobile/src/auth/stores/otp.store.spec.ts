import { isAction } from 'mobx';
import { describe, expect, it } from 'vitest';

import { OtpStore, type PhoneState, type VerificationState } from './otp.store';

const challenge = {
  challengeId: '00000000-0000-4000-8000-000000000001',
  delivery: 'accepted' as const,
  expiresAt: '2030-01-01T00:05:00.000Z',
  resendAvailableAt: '2030-01-01T00:01:00.000Z',
};

describe('OtpStore', () => {
  it('owns validated phone and code state through actions', () => {
    const store = new OtpStore();
    [
      store.setPhone,
      store.setCode,
      store.beginSend,
      store.finishSend,
      store.failSend,
      store.beginVerify,
      store.finishVerify,
      store.failVerify,
      store.tick,
    ].forEach((mutation) => expect(isAction(mutation)).toBe(true));
    store.setPhone('77 123 45 67');
    expect(store.phoneInput).toBe('771234567');
    expect(store.canSubmitPhone).toBe(true);
    store.finishSend(challenge);
    store.setCode('12x34567');
    expect(store.code).toBe('123456');
    expect(store.canSubmitCode).toBe(true);
  });

  it.each<Exclude<PhoneState, 'idle' | 'sending' | 'sent'>>([
    'invalid',
    'rateLimited',
    'offline',
    'unavailable',
  ])('represents the %s phone failure state', (state) => {
    const store = new OtpStore();
    store.beginSend();
    expect(store.phoneState).toBe('sending');
    store.failSend(state, `${state} message`);
    expect(store.phoneState).toBe(state);
    expect(store.errorMessage).toBe(`${state} message`);
  });

  it.each<Exclude<VerificationState, 'idle' | 'checking' | 'success'>>([
    'invalid',
    'expired',
    'exhausted',
    'offline',
    'unavailable',
  ])('represents the %s verification failure state', (state) => {
    const store = new OtpStore();
    store.beginVerify();
    expect(store.verificationState).toBe('checking');
    store.failVerify(state, `${state} message`);
    expect(store.verificationState).toBe(state);
    expect(store.errorMessage).toBe(`${state} message`);
  });

  it('represents successful send and verification states', () => {
    const store = new OtpStore();
    store.finishSend(challenge);
    expect(store.phoneState).toBe('sent');
    expect(store.verificationState).toBe('idle');
    store.finishVerify();
    expect(store.verificationState).toBe('success');
  });

  it('derives resend state from the server timestamp', () => {
    const store = new OtpStore();
    store.finishSend(challenge);
    store.tick(Date.parse('2030-01-01T00:00:30.000Z'));
    expect(store.resendSeconds).toBe(30);
    expect(store.canResend).toBe(false);
    store.tick(Date.parse('2030-01-01T00:01:00.000Z'));
    expect(store.canResend).toBe(true);
  });

  it('does not expose any persistence operation for OTP values', () => {
    expect(Object.getOwnPropertyNames(OtpStore.prototype)).not.toContain('persist');
  });
});
