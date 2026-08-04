import { WalletFlowService } from './services/wallet-flow.service';
import { WalletStore } from './stores/wallet.store';

import type { AuthenticatedRequestScope } from './services/wallet-flow.service';
import type { WalletApi } from '../api/wallet-api';
import type { SessionStore } from '../auth/stores/session.store';

export class WalletCompositionRoot {
    readonly store = new WalletStore();
    readonly flow: WalletFlowService;

    constructor(api: WalletApi, sessionStore: SessionStore, access: AuthenticatedRequestScope) {
        this.flow = new WalletFlowService(this.store, api, sessionStore, access);
    }

    dispose(): void {
        this.flow.dispose();
    }
}
