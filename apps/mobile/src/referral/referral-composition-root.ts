import { ReferralLinkCoordinator } from '../navigation/referral-link-coordinator';

import { ReferralNativeActions } from './native/referral-native-actions';
import { ReferralFlowService } from './services/referral-flow.service';
import { ReferralStore } from './stores/referral.store';

import type { ReferralApi } from '../api/referral-api';
import type { SessionStore } from '../auth/stores/session.store';
import type { ReferralLinkSource } from '../navigation/referral-link-coordinator';
import type { ReferralClipboardPort, ReferralSharePort } from './native/referral-native-actions';
import type { AuthenticatedReferralRequestScope } from './services/referral-flow.service';

export interface ReferralCompositionDependencies {
    linkSource?: ReferralLinkSource;
    clipboard?: ReferralClipboardPort;
    share?: ReferralSharePort;
}

export class ReferralCompositionRoot {
    readonly store = new ReferralStore();
    readonly flow: ReferralFlowService;
    readonly nativeActions: ReferralNativeActions;
    readonly linkCoordinator: ReferralLinkCoordinator;

    constructor(
        api: ReferralApi,
        sessionStore: SessionStore,
        access: AuthenticatedReferralRequestScope,
        dependencies: ReferralCompositionDependencies = {},
    ) {
        this.flow = new ReferralFlowService(this.store, api, sessionStore, access);
        this.nativeActions = new ReferralNativeActions(dependencies.clipboard, dependencies.share);
        this.linkCoordinator = new ReferralLinkCoordinator(sessionStore, this.store, dependencies.linkSource);
    }

    dispose(): void {
        this.linkCoordinator.dispose();
        this.flow.dispose();
    }
}
