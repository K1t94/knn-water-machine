import type { AuthApi, OtpVerified, SessionCredentials } from '../api/auth-api';
import { OtpFlowService } from './services/otp-flow.service';
import { RegistrationFlowService } from './services/registration-flow.service';
import { SessionFlowService } from './services/session-flow.service';
import type { RegistrationAuthorizationStorage } from './storage/registration-authorization.storage';
import type { SessionStorage } from './storage/session.storage';
import { OtpStore } from './stores/otp.store';
import { RegistrationStore } from './stores/registration.store';
import { SessionStore } from './stores/session.store';

export interface OtpScope {
  store: OtpStore;
  commands: OtpFlowService;
}

export interface RegistrationScope {
  store: RegistrationStore;
  commands: RegistrationFlowService;
}

export class AuthCompositionRoot {
  readonly sessionStore = new SessionStore();
  readonly sessionFlow: SessionFlowService;

  constructor(
    private readonly api: AuthApi,
    sessionStorage: SessionStorage,
    private readonly registrationStorage:
      RegistrationAuthorizationStorage,
  ) {
    this.sessionFlow = new SessionFlowService(
      this.sessionStore,
      api,
      sessionStorage,
    );
  }

  createRegistrationScope(): RegistrationScope {
    const store = new RegistrationStore();
    return {
      store,
      commands: new RegistrationFlowService(
        store,
        this.api,
        this.registrationStorage,
        (session) => this.sessionFlow.acceptCredentials(session),
      ),
    };
  }

  createOtpScope(
    getPendingPromoCode: () => string | undefined,
    onRegistrationRequired: (result: OtpVerified) => void,
  ): OtpScope {
    const store = new OtpStore();
    return {
      store,
      commands: new OtpFlowService(
        store,
        this.api,
        getPendingPromoCode,
        (result) => {
          if (result.nextStep === 'authenticated' && result.session) {
            this.sessionFlow.acceptCredentials(result.session);
            return;
          }
          this.sessionFlow.requireLegal();
          onRegistrationRequired(result);
        },
      ),
    };
  }

  acceptSession(credentials: SessionCredentials): void {
    this.sessionFlow.acceptCredentials(credentials);
  }

  dispose(): void {
    this.sessionFlow.dispose();
  }
}
