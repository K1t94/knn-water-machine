import { EMPTY, Subject, Subscription, catchError, defer, exhaustMap, interval, map, type Observable, tap } from 'rxjs';

import { AuthApiError, type AuthApi, type OtpVerified } from '../../api/auth-api';

import type { OtpStore, PhoneState, VerificationState } from '../stores/otp.store';

export interface OtpCommands {
    requestOtp(): void;
    resendOtp(): void;
    verifyOtp(): void;
}

type Command = 'request' | 'resend' | 'verify';
export type OtpApi = Pick<AuthApi, 'requestOtp' | 'resendOtp' | 'verifyOtp'>;

export class OtpFlowService implements OtpCommands {
    private readonly commands = new Subject<Command>();
    private readonly subscriptions = new Subscription();
    private disposed = false;

    constructor(
        private readonly store: OtpStore,
        private readonly api: OtpApi,
        private readonly getPendingPromoCode: () => string | undefined = () => undefined,
        private readonly onVerified?: (result: OtpVerified) => void,
    ) {
        this.subscriptions.add(interval(250).subscribe(() => this.store.tick(Date.now())));
        this.subscriptions.add(this.commands.pipe(exhaustMap((command) => this.execute(command))).subscribe());
    }

    requestOtp(): void {
        this.commands.next('request');
    }

    resendOtp(): void {
        this.commands.next('resend');
    }

    verifyOtp(): void {
        this.commands.next('verify');
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subscriptions.unsubscribe();
        this.commands.complete();
    }

    private execute(command: Command): Observable<void> {
        const phone = `+221${this.store.phoneInput}`;
        if (command === 'verify') {
            const challenge = this.store.challenge;
            if (!challenge || !this.store.canSubmitCode) return EMPTY;
            return defer(() => {
                const pendingPromoCode = this.getPendingPromoCode();
                this.store.beginVerify();
                return this.api.verifyOtp({
                    phone,
                    challengeId: challenge.challengeId,
                    code: this.store.code,
                    ...(pendingPromoCode !== undefined ? { pendingPromoCode } : {}),
                });
            }).pipe(
                tap((result) => {
                    this.store.finishVerify();
                    this.onVerified?.(result);
                }),
                map(() => undefined),
                catchError((error: unknown) => {
                    const mapped = mapVerificationError(error);
                    this.store.failVerify(mapped.state, mapped.message);
                    return EMPTY;
                }),
            );
        }

        if (command === 'request' && !this.store.canSubmitPhone) return EMPTY;
        if (command === 'resend' && !this.store.canResend) return EMPTY;

        return defer(() => {
            const pendingPromoCode = this.getPendingPromoCode();
            this.store.beginSend();
            const common = {
                phone,
                ...(pendingPromoCode !== undefined ? { pendingPromoCode } : {}),
            };

            return command === 'resend'
                ? this.api.resendOtp({
                      ...common,
                      challengeId: this.store.challenge!.challengeId,
                  })
                : this.api.requestOtp(common);
        }).pipe(
            tap((issued) => this.store.finishSend(issued)),
            map(() => undefined),
            catchError((error: unknown) => {
                const mapped = mapPhoneError(error);
                this.store.failSend(mapped.state, mapped.message);
                return EMPTY;
            }),
        );
    }
}

function mapPhoneError(error: unknown): {
    state: Exclude<PhoneState, 'idle' | 'sending' | 'sent'>;
    message: string;
} {
    const code = error instanceof AuthApiError ? error.code : 'SERVICE_UNAVAILABLE';
    if (code === 'INVALID_PHONE' || code === 'UNSUPPORTED_COUNTRY') {
        return {
            state: 'invalid',
            message: 'Enter a valid Senegalese phone number.',
        };
    }
    if (code === 'RATE_LIMITED')
        return {
            state: 'rateLimited',
            message: 'Please wait before trying again.',
        };
    if (code === 'OFFLINE') return { state: 'offline', message: 'Check your internet connection.' };
    return {
        state: 'unavailable',
        message: 'SMS service is temporarily unavailable.',
    };
}

function mapVerificationError(error: unknown): {
    state: Exclude<VerificationState, 'idle' | 'checking' | 'success'>;
    message: string;
} {
    const code = error instanceof AuthApiError ? error.code : 'SERVICE_UNAVAILABLE';
    if (code === 'OTP_INVALID') return { state: 'invalid', message: 'The code is incorrect.' };
    if (code === 'OTP_EXPIRED' || code === 'OTP_USED') {
        return {
            state: 'expired',
            message: 'This code has expired. Request a new one.',
        };
    }
    if (code === 'OTP_ATTEMPTS_EXHAUSTED') {
        return {
            state: 'exhausted',
            message: 'Too many attempts. Request a new code.',
        };
    }
    if (code === 'OFFLINE') return { state: 'offline', message: 'Check your internet connection.' };
    return {
        state: 'unavailable',
        message: 'Verification is temporarily unavailable.',
    };
}
