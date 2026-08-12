import { render } from '@testing-library/react-native';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthCompositionRoot } from './auth-composition-root';
import { AuthFlowProvider } from './auth-flow.context';
import { RegistrationFlowProvider } from './registration-flow.context';
import { OtpFlowService } from './services/otp-flow.service';
import { RegistrationFlowService } from './services/registration-flow.service';
import { SessionFlowService } from './services/session-flow.service';

import type { AuthApi } from '../api/auth-api';
import type { RegistrationAuthorizationStorage } from './storage/registration-authorization.storage';
import type { SessionStorage } from './storage/session.storage';

const api = {} as AuthApi;
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

describe('AuthCompositionRoot child scope lifetime', () => {
    it('does not retain child scopes and providers dispose them on unmount', async () => {
        const root = new AuthCompositionRoot(api, sessionStorage, registrationStorage);
        const otpDispose = vi.spyOn(OtpFlowService.prototype, 'dispose');
        const registrationDispose = vi.spyOn(RegistrationFlowService.prototype, 'dispose');

        const otpView = await render(
            <AuthFlowProvider api={api} root={root}>
                {null}
            </AuthFlowProvider>,
        );
        const registrationView = await render(
            <RegistrationFlowProvider api={api} root={root}>
                {null}
            </RegistrationFlowProvider>,
        );

        expect(Object.keys(root)).toEqual([
            'api',
            'registrationStorage',
            'sessionStore',
            'featureAvailabilityStore',
            'sessionFlow',
            'featureAvailabilityService',
        ]);

        await otpView.unmount();
        await registrationView.unmount();

        expect(otpDispose).toHaveBeenCalledOnce();
        expect(registrationDispose).toHaveBeenCalledOnce();
        root.dispose();
    });

    it('replaces child scopes without disposing the application session scope', async () => {
        const firstRoot = new AuthCompositionRoot(api, sessionStorage, registrationStorage);
        const secondRoot = new AuthCompositionRoot(api, sessionStorage, registrationStorage);
        const otpDispose = vi.spyOn(OtpFlowService.prototype, 'dispose');
        const registrationDispose = vi.spyOn(RegistrationFlowService.prototype, 'dispose');
        const sessionDispose = vi.spyOn(SessionFlowService.prototype, 'dispose');

        const otpView = await render(
            <AuthFlowProvider api={api} root={firstRoot}>
                {null}
            </AuthFlowProvider>,
        );
        const registrationView = await render(
            <RegistrationFlowProvider api={api} root={firstRoot}>
                {null}
            </RegistrationFlowProvider>,
        );

        await otpView.rerender(
            <AuthFlowProvider api={api} root={secondRoot}>
                {null}
            </AuthFlowProvider>,
        );
        await registrationView.rerender(
            <RegistrationFlowProvider api={api} root={secondRoot}>
                {null}
            </RegistrationFlowProvider>,
        );

        expect(otpDispose).toHaveBeenCalledOnce();
        expect(registrationDispose).toHaveBeenCalledOnce();
        expect(sessionDispose).not.toHaveBeenCalled();

        await otpView.unmount();
        await registrationView.unmount();
        expect(otpDispose).toHaveBeenCalledTimes(2);
        expect(registrationDispose).toHaveBeenCalledTimes(2);
        expect(sessionDispose).not.toHaveBeenCalled();

        firstRoot.dispose();
        secondRoot.dispose();
        expect(sessionDispose).toHaveBeenCalledTimes(2);
    });
});
