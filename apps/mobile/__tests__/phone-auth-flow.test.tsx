import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthApiError, type AuthApi, type CurrentLegalSet, type SessionCredentials } from '../src/api/auth-api';
import { AuthCompositionRoot } from '../src/auth/auth-composition-root';
import { LegalAcceptanceScreen } from '../src/auth/screens/LegalAcceptanceScreen';
import { OtpVerificationScreen } from '../src/auth/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '../src/auth/screens/PhoneEntryScreen';
import { SessionFlowService } from '../src/auth/services/session-flow.service';
import { OtpStore } from '../src/auth/stores/otp.store';
import { RegistrationStore } from '../src/auth/stores/registration.store';
import { SessionStore } from '../src/auth/stores/session.store';
import { RootNavigator } from '../src/navigation/RootNavigator';

import type { AuthFlowContextValue } from '../src/auth/auth-flow.context';
import type { RegistrationFlowContextValue } from '../src/auth/registration-flow.context';
import type { OtpCommands } from '../src/auth/services/otp-flow.service';
import type { RegistrationCommands } from '../src/auth/services/registration-flow.service';
import type { RegistrationAuthorizationStorage } from '../src/auth/storage/registration-authorization.storage';
import type { SessionStorage } from '../src/auth/storage/session.storage';

const flowContexts = vi.hoisted<{
    auth: unknown;
    registration: unknown;
}>(() => ({
    auth: undefined,
    registration: undefined,
}));

vi.mock('../src/auth/auth-flow.context', () => ({
    AuthFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
    useAuthFlow: () => flowContexts.auth,
}));

vi.mock('../src/auth/registration-flow.context', () => ({
    RegistrationFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
    useRegistrationFlow: () => flowContexts.registration,
}));

vi.mock('../src/navigation/AuthNavigator', () => ({
    AuthNavigator: () => null,
    authNavigationRef: { current: null },
}));

const credentials: SessionCredentials = {
    accessToken: 'access-token',
    accessExpiresAt: '2099-01-01T00:15:00.000Z',
    refreshToken: 'refresh-token',
    refreshExpiresAt: '2099-03-01T00:00:00.000Z',
};

const legalSet: CurrentLegalSet = {
    setVersion: 'legal-set-v1',
    documents: [
        {
            id: 'terms-v1',
            kind: 'TERMS_OF_SERVICE',
            version: '1.0',
            title: 'Conditions générales',
            content: 'Conditions content',
            mandatory: true,
            contentSha256: 'a'.repeat(64),
        },
    ],
};

const navigation = {
    goBack: vi.fn(),
    navigate: vi.fn(),
    popToTop: vi.fn(),
    replace: vi.fn(),
};

describe('phone authentication component flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders phone states from a real MobX store and suppresses duplicate submission', async () => {
        const store = new OtpStore();
        const registrationStore = new RegistrationStore();
        const commands = createOtpCommands({
            requestOtp: () => store.beginSend(),
        });
        setContexts(store, commands, registrationStore);
        const view = await render(<PhoneEntryScreen navigation={navigation as never} route={{} as never} />);

        expect(Object.keys(flowContexts.auth as object).sort()).toEqual(['commands', 'store']);
        expect(Object.values(commands).some((value) => value instanceof Subject)).toBe(false);
        expect(view.getByLabelText('Numéro de téléphone')).toBeTruthy();
        expect(view.getByLabelText('Code promo facultatif')).toBeTruthy();
        const submit = view.getByText('Continuer').parent!;
        expect(submit.props.accessibilityRole).toBe('button');
        expect(submit.props.disabled).toBe(true);

        await fireEvent.changeText(view.getByLabelText('Numéro de téléphone'), '77 123 45 67');
        await fireEvent.press(submit);
        expect(commands.requestOtp).toHaveBeenCalledOnce();
        expect(JSON.stringify(view.toJSON())).toContain('ActivityIndicator');

        for (const [state, message] of [
            ['invalid', 'Invalid phone'],
            ['rateLimited', 'Rate limited'],
            ['offline', 'Offline'],
            ['unavailable', 'Unavailable'],
        ] as const) {
            await act(() => store.failSend(state, message));
            expect(view.getByRole('alert').props.children).toBe(message);
        }

        await act(() => store.finishSend(issue()));
        await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Otp'));
    });

    it('renders OTP autofill, countdown, retry, validation states, and suppresses duplicate verification', async () => {
        const store = new OtpStore();
        const registrationStore = new RegistrationStore();
        store.setPhone('771234567');
        store.finishSend(issue(Date.now() + 60_000));
        const commands = createOtpCommands({
            verifyOtp: () => store.beginVerify(),
            resendOtp: () => store.beginSend(),
        });
        setContexts(store, commands, registrationStore);
        const view = await render(<OtpVerificationScreen navigation={navigation as never} route={{} as never} />);
        const input = view.getByLabelText('Code de vérification');
        expect(view.getByLabelText('Retour')).toBeTruthy();
        expect(input.props.autoComplete).toBe('sms-otp');
        expect(input.props.textContentType).toBe('oneTimeCode');
        expect(view.getByText(/Renvoyer dans 0:/)).toBeTruthy();

        await fireEvent.changeText(input, '123456');
        const verifyButton = view.getByText('Vérifier').parent!;
        expect(verifyButton.props.accessibilityRole).toBe('button');
        await fireEvent.press(verifyButton);
        expect(commands.verifyOtp).toHaveBeenCalledOnce();
        expect(JSON.stringify(view.toJSON())).toContain('ActivityIndicator');

        for (const [state, message] of [
            ['invalid', 'Invalid OTP'],
            ['expired', 'Expired OTP'],
            ['exhausted', 'Exhausted OTP'],
            ['offline', 'Offline'],
            ['unavailable', 'Unavailable'],
        ] as const) {
            await act(() => store.failVerify(state, message));
            expect(view.getByRole('alert').props.children).toBe(message);
        }

        await act(() => store.tick(Date.now() + 61_000));
        await fireEvent.press(view.getByText('Renvoyer le code'));
        expect(commands.resendOtp).toHaveBeenCalledOnce();

        await act(() => registrationStore.setStateForTest('ready'));
        await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Legal'));
    });

    it('renders legal loading, acceptance, errors, success, cancellation, and duplicate-submit guards', async () => {
        const otpStore = new OtpStore();
        const store = new RegistrationStore();
        const commands = createRegistrationCommands({
            complete: () => store.beginCompletion(),
        });
        setContexts(otpStore, createOtpCommands(), store, commands);
        const view = await render(<LegalAcceptanceScreen navigation={navigation as never} route={{} as never} />);

        expect(view.getByLabelText('Retour')).toBeTruthy();
        await act(() => store.beginLoading());
        expect(view.getByText('Chargement des documents…')).toBeTruthy();
        await act(() => store.finishLoading(legalSet));
        const checkbox = view.getByText(/J’accepte/).parent!;
        expect(checkbox.props.accessibilityRole).toBe('checkbox');
        expect(checkbox.props.accessibilityState).toEqual({ checked: false });
        await fireEvent.press(checkbox);
        expect(commands.toggleAcceptance).toHaveBeenCalledWith('terms-v1');

        await act(() => store.toggleAcceptance('terms-v1'));
        const submit = view.getByText('Accepter et continuer').parent!;
        expect(submit.props.accessibilityRole).toBe('button');
        await fireEvent.press(submit);
        expect(commands.complete).toHaveBeenCalledOnce();
        expect(JSON.stringify(view.toJSON())).toContain('ActivityIndicator');

        for (const [state, message] of [
            ['offline', 'Offline'],
            ['error', 'Unavailable'],
            ['stale', 'Documents changed'],
        ] as const) {
            await act(() => store.fail(state, message));
            expect(view.getByRole('alert').props.children).toBe(message);
            expect(view.getByText('Réessayer')).toBeTruthy();
        }

        await act(() => store.finishCompletion(credentials));
        expect(view.getByText('Inscription terminée')).toBeTruthy();
        await act(() => store.finishLoading(legalSet));
        await fireEvent.press(view.getByLabelText('Retour'));
        expect(commands.cancel).toHaveBeenCalledOnce();
        expect(navigation.popToTop).toHaveBeenCalledOnce();
    });

    it('renders startup, offline recovery, and authenticated routes from SessionStore', async () => {
        const root = createRoot();
        const retry = vi.spyOn(root.sessionFlow, 'retryRestore').mockImplementation(() => undefined);
        const logout = vi.spyOn(root.sessionFlow, 'logout').mockImplementation(() => undefined);
        const view = await render(<RootNavigator api={{} as AuthApi} root={root} />);

        expect(JSON.stringify(view.toJSON())).toContain('ActivityIndicator');
        await act(() => root.sessionStore.markOffline(credentials.refreshExpiresAt));
        expect(view.getByText('Connection unavailable')).toBeTruthy();
        const retryButton = view.getByText('Try again').parent!;
        expect(retryButton.props.accessibilityRole).toBe('button');
        await fireEvent.press(retryButton);
        expect(retry).toHaveBeenCalledOnce();

        await act(() => root.sessionStore.authenticate(credentials));
        expect(view.getByText('Session restored')).toBeTruthy();
        const logoutButton = view.getByText('Log out').parent!;
        expect(logoutButton.props.accessibilityRole).toBe('button');
        await fireEvent.press(logoutButton);
        expect(logout).toHaveBeenCalledOnce();
        root.dispose();
    });

    it('shares one refresh operation and preserves offline state on a retryable failure', () => {
        const store = new SessionStore();
        const refresh = new Subject<SessionCredentials>();
        const storage: SessionStorage = {
            load: () =>
                of({
                    refreshToken: credentials.refreshToken,
                    refreshExpiresAt: credentials.refreshExpiresAt,
                }),
            replace: () => of(undefined),
            clear: () => of(undefined),
        };
        const api = {
            refreshSession: vi.fn(() => refresh.asObservable()),
            logoutCurrentSession: vi.fn(() => of(undefined)),
        };
        const flow = new SessionFlowService(store, api, storage);
        const first = flow.withAccess((token) => of(token)).subscribe();
        const second = flow.withAccess((token) => of(token)).subscribe();
        expect(api.refreshSession).toHaveBeenCalledOnce();
        refresh.next(credentials);
        refresh.complete();
        expect(store.state).toBe('authenticated');
        first.unsubscribe();
        second.unsubscribe();
        flow.dispose();

        const offlineStore = new SessionStore();
        const offlineFlow = new SessionFlowService(
            offlineStore,
            {
                refreshSession: () => throwError(() => new AuthApiError('OFFLINE', true)),
                logoutCurrentSession: () => of(undefined),
            },
            storage,
        );
        offlineFlow.restore();
        expect(offlineStore.rootRoute).toBe('offline');
        offlineFlow.dispose();
    });
});

function issue(resendAt = Date.now()): {
    challengeId: string;
    expiresAt: string;
    resendAvailableAt: string;
    delivery: 'accepted';
} {
    return {
        challengeId: 'challenge-1',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendAvailableAt: new Date(resendAt).toISOString(),
        delivery: 'accepted',
    };
}

function createOtpCommands(overrides: Partial<Record<keyof OtpCommands, () => void>> = {}): OtpCommands {
    return {
        requestOtp: vi.fn(overrides.requestOtp),
        resendOtp: vi.fn(overrides.resendOtp),
        verifyOtp: vi.fn(overrides.verifyOtp),
    };
}

function createRegistrationCommands(
    overrides: Partial<Record<keyof RegistrationCommands, (...args: never[]) => void>> = {},
): RegistrationCommands {
    return {
        begin: vi.fn(),
        restore: vi.fn(),
        retryDocuments: vi.fn(),
        setPendingPromoCode: vi.fn(),
        removePendingPromoCode: vi.fn(),
        toggleAcceptance: vi.fn(),
        complete: vi.fn(overrides.complete),
        cancel: vi.fn(),
    };
}

function setContexts(
    otpStore: OtpStore,
    otpCommands: OtpCommands,
    registrationStore: RegistrationStore,
    registrationCommands = createRegistrationCommands(),
): void {
    flowContexts.auth = {
        store: otpStore,
        commands: otpCommands,
    } satisfies AuthFlowContextValue;
    flowContexts.registration = {
        store: registrationStore,
        commands: registrationCommands,
    } satisfies RegistrationFlowContextValue;
}

function createRoot(): AuthCompositionRoot {
    const sessionStorage: SessionStorage = {
        load: () => of(undefined),
        replace: () => of(undefined),
        clear: () => of(undefined),
    };
    const registrationStorage: RegistrationAuthorizationStorage = {
        load: () => of(undefined),
        save: () => of(undefined),
        clear: () => of(undefined),
    };
    return new AuthCompositionRoot({} as AuthApi, sessionStorage, registrationStorage);
}
