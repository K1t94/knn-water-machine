import { computed, makeObservable, observable, action } from 'mobx';

import type { OtpIssued } from '../../api/auth-api';

export type PhoneState =
  | 'idle'
  | 'sending'
  | 'sent'
  | 'invalid'
  | 'rateLimited'
  | 'offline'
  | 'unavailable';
export type VerificationState =
  | 'idle'
  | 'checking'
  | 'invalid'
  | 'expired'
  | 'exhausted'
  | 'success'
  | 'offline'
  | 'unavailable';

export class OtpStore {
  phoneInput = '';
  code = '';
  phoneState: PhoneState = 'idle';
  verificationState: VerificationState = 'idle';
  challenge: OtpIssued | undefined = undefined;
  now = Date.now();
  errorMessage: string | undefined = undefined;

  constructor() {
    makeObservable(this, {
      phoneInput: observable,
      code: observable,
      phoneState: observable,
      verificationState: observable,
      challenge: observable,
      now: observable,
      errorMessage: observable,
      canSubmitPhone: computed,
      canSubmitCode: computed,
      resendSeconds: computed,
      canResend: computed,
      setPhone: action,
      setCode: action,
      beginSend: action,
      finishSend: action,
      failSend: action,
      beginVerify: action,
      finishVerify: action,
      failVerify: action,
      tick: action,
    });
  }

  get canSubmitPhone(): boolean {
    return (
      this.phoneInput.replace(/\D/g, '').length === 9 &&
      this.phoneState !== 'sending'
    );
  }

  get canSubmitCode(): boolean {
    return /^\d{6}$/.test(this.code) && this.verificationState !== 'checking';
  }

  get resendSeconds(): number {
    if (!this.challenge) return 0;
    return Math.max(
      0,
      Math.ceil(
        (Date.parse(this.challenge.resendAvailableAt) - this.now) / 1000,
      ),
    );
  }

  get canResend(): boolean {
    return (
      Boolean(this.challenge) &&
      this.resendSeconds === 0 &&
      this.phoneState !== 'sending'
    );
  }

  setPhone(value: string): void {
    this.phoneInput = value.replace(/\D/g, '').slice(0, 9);
    this.phoneState = 'idle';
    this.errorMessage = undefined;
  }

  setCode(value: string): void {
    this.code = value.replace(/\D/g, '').slice(0, 6);
    if (this.verificationState !== 'checking') this.verificationState = 'idle';
  }

  beginSend(): void {
    this.phoneState = 'sending';
    this.errorMessage = undefined;
  }

  finishSend(challenge: OtpIssued): void {
    this.challenge = challenge;
    this.phoneState = 'sent';
    this.code = '';
    this.verificationState = 'idle';
  }

  failSend(
    state: Exclude<PhoneState, 'idle' | 'sending' | 'sent'>,
    message: string,
  ): void {
    this.phoneState = state;
    this.errorMessage = message;
  }

  beginVerify(): void {
    this.verificationState = 'checking';
    this.errorMessage = undefined;
  }

  finishVerify(): void {
    this.verificationState = 'success';
  }

  failVerify(
    state: Exclude<VerificationState, 'idle' | 'checking' | 'success'>,
    message: string,
  ): void {
    this.verificationState = state;
    this.errorMessage = message;
  }

  tick(now: number): void {
    this.now = now;
  }
}
