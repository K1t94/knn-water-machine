import { Linking } from 'react-native';

import { parsePendingPromo } from './pending-promo-deep-link';

import type { SessionStore } from '../auth/stores/session.store';
import type { ReferralStore } from '../referral/stores/referral.store';

export interface ReferralLinkSource {
    getInitialUrl(): Promise<string | null>;
    subscribe(listener: (url: string) => void): () => void;
}

export interface PendingRegistrationPromoCommands {
    setPendingPromoCode(value: string): void;
}

export type SignedInReferralNavigation = () => boolean;

export class ReactNativeReferralLinkSource implements ReferralLinkSource {
    getInitialUrl(): Promise<string | null> {
        return Linking.getInitialURL();
    }

    subscribe(listener: (url: string) => void): () => void {
        const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
        return () => subscription.remove();
    }
}

export class ReferralLinkCoordinator {
    private readonly handledPromoCodes = new Set<string>();
    private readonly unsubscribeFromLinks: () => void;
    private registrationCommands: PendingRegistrationPromoCommands | undefined;
    private signedInNavigation: SignedInReferralNavigation | undefined;
    private pendingRegistrationPromo: string | undefined;
    private pendingSignedInNavigation = false;
    private disposed = false;

    constructor(
        private readonly sessionStore: SessionStore,
        private readonly referralStore: ReferralStore,
        source: ReferralLinkSource = new ReactNativeReferralLinkSource(),
    ) {
        this.unsubscribeFromLinks = source.subscribe((url) => this.handleUrl(url));
        void source.getInitialUrl().then(
            (url) => {
                if (!this.disposed && url) this.handleUrl(url);
            },
            () => undefined,
        );
    }

    bindRegistration(commands: PendingRegistrationPromoCommands): () => void {
        this.registrationCommands = commands;
        if (this.sessionStore.state !== 'authenticated' && this.pendingRegistrationPromo) {
            commands.setPendingPromoCode(this.pendingRegistrationPromo);
        }
        return () => {
            if (this.registrationCommands === commands) this.registrationCommands = undefined;
        };
    }

    bindSignedInNavigation(openApplyScreen: SignedInReferralNavigation): () => void {
        this.signedInNavigation = openApplyScreen;
        this.openPendingSignedInPromo();
        return () => {
            if (this.signedInNavigation === openApplyScreen) this.signedInNavigation = undefined;
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribeFromLinks();
        this.registrationCommands = undefined;
        this.signedInNavigation = undefined;
        this.pendingRegistrationPromo = undefined;
        this.pendingSignedInNavigation = false;
        this.handledPromoCodes.clear();
    }

    private handleUrl(url: string): void {
        const promoCode = parsePendingPromo(url)?.toUpperCase();
        if (!promoCode || this.handledPromoCodes.has(promoCode)) return;
        this.handledPromoCodes.add(promoCode);

        if (this.sessionStore.state === 'authenticated') {
            this.referralStore.prefillPromoCode(promoCode);
            this.pendingSignedInNavigation = true;
            this.openPendingSignedInPromo();
            return;
        }

        this.pendingRegistrationPromo = promoCode;
        this.registrationCommands?.setPendingPromoCode(promoCode);
    }

    private openPendingSignedInPromo(): void {
        if (!this.pendingSignedInNavigation || !this.signedInNavigation) return;
        if (this.signedInNavigation()) this.pendingSignedInNavigation = false;
    }
}
