import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthApiError, type OtpIssued } from '../../api/auth-api';
import { OtpStore } from '../stores/otp.store';

import { OtpFlowService, type OtpApi } from './otp-flow.service';

const issued = (): OtpIssued => ({
    challengeId: '00000000-0000-4000-8000-000000000001',
    delivery: 'accepted',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
});

describe('OtpFlowService', () => {
    it('suppresses duplicate submits with exhaustMap and updates through store actions', () => {
        const response$ = new Subject<OtpIssued>();
        const requestOtp = vi.fn(() => response$);
        const api = {
            requestOtp,
            resendOtp: vi.fn(() => of(issued())),
            verifyOtp: vi.fn(() => of({ nextStep: 'completeRegistration' as const })),
        } satisfies OtpApi;
        const store = new OtpStore();
        const flow = new OtpFlowService(store, api);
        store.setPhone('771234567');

        flow.requestOtp();
        flow.requestOtp();
        expect(requestOtp).toHaveBeenCalledTimes(1);

        response$.next(issued());
        response$.complete();
        expect(store.phoneState).toBe('sent');
        flow.dispose();
    });

    it('maps an offline failure without retry and permits an explicit recovery request', () => {
        const requestOtp = vi
            .fn()
            .mockReturnValueOnce(throwError(() => new AuthApiError('OFFLINE', true)))
            .mockReturnValueOnce(of(issued()));
        const api = {
            requestOtp,
            resendOtp: vi.fn(() => of(issued())),
            verifyOtp: vi.fn(() => of({ nextStep: 'completeRegistration' as const })),
        } satisfies OtpApi;
        const store = new OtpStore();
        const flow = new OtpFlowService(store, api);
        store.setPhone('771234567');

        flow.requestOtp();
        expect(requestOtp).toHaveBeenCalledTimes(1);
        expect(store.phoneState).toBe('offline');

        flow.requestOtp();
        expect(requestOtp).toHaveBeenCalledTimes(2);
        expect(store.phoneState).toBe('sent');
        flow.dispose();
    });

    it.each([
        ['OTP_INVALID', 'invalid'],
        ['OTP_EXPIRED', 'expired'],
        ['OTP_USED', 'expired'],
        ['OTP_ATTEMPTS_EXHAUSTED', 'exhausted'],
        ['OFFLINE', 'offline'],
        ['SERVICE_UNAVAILABLE', 'unavailable'],
    ] as const)('maps %s to the %s verification state', (code, state) => {
        const api = {
            requestOtp: vi.fn(() => of(issued())),
            resendOtp: vi.fn(() => of(issued())),
            verifyOtp: vi.fn(() => throwError(() => new AuthApiError(code, false))),
        } satisfies OtpApi;
        const store = new OtpStore();
        const flow = new OtpFlowService(store, api);
        store.finishSend(issued());
        store.setPhone('771234567');
        store.setCode('123456');

        flow.verifyOtp();
        expect(store.verificationState).toBe(state);
        flow.dispose();
    });

    it('updates the resend countdown from server time and stops it on disposal', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
            const api = {
                requestOtp: vi.fn(() => of(issued())),
                resendOtp: vi.fn(() => of(issued())),
                verifyOtp: vi.fn(() => of({ nextStep: 'completeRegistration' as const })),
            } satisfies OtpApi;
            const store = new OtpStore();
            const flow = new OtpFlowService(store, api);
            store.finishSend(issued());
            store.tick(Date.now());
            expect(store.resendSeconds).toBe(60);

            vi.advanceTimersByTime(1_000);
            expect(store.resendSeconds).toBe(59);
            flow.dispose();
            vi.advanceTimersByTime(1_000);
            expect(store.resendSeconds).toBe(59);
        } finally {
            vi.useRealTimers();
        }
    });

    it('unsubscribes in-flight work and is idempotently disposable', () => {
        const teardown = vi.fn();
        const api: OtpApi = {
            requestOtp: vi.fn(() => new Observable<OtpIssued>(() => teardown)),
            resendOtp: vi.fn(() => of(issued())),
            verifyOtp: vi.fn(() => of({ nextStep: 'completeRegistration' as const })),
        };
        const store = new OtpStore();
        const flow = new OtpFlowService(store, api);
        store.setPhone('771234567');
        flow.requestOtp();
        flow.dispose();
        expect(teardown).toHaveBeenCalledOnce();
        expect(() => flow.dispose()).not.toThrow();
    });
});
