import { reaction } from 'mobx';
import { Linking } from 'react-native';

import { parsePendingPromo } from './pending-promo-deep-link';

import type { SessionStore } from '../auth/stores/session.store';
import type { FeatureAvailabilityStore } from '../features/stores/feature-availability.store';

export interface ReferralLinkSource {
    getInitialUrl(): Promise<string | null>;
    subscribe(listener: (url: string) => void): () => void;
}

export interface PendingRegistrationPromoCommands {
    setPendingPromoCode(value: string): void;
    removePendingPromoCode(): void;
}

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
    private readonly unsubscribeFromLinks: () => void;
    private readonly disposeAvailabilityReaction: () => void;
    private registrationCommands: PendingRegistrationPromoCommands | undefined;
    private pendingRegistrationPromo: string | undefined;
    private disposed = false;

    constructor(
        private readonly sessionStore: SessionStore,
        private readonly availability: FeatureAvailabilityStore,
        source: ReferralLinkSource = new ReactNativeReferralLinkSource(),
    ) {
        this.unsubscribeFromLinks = source.subscribe((url) => this.handleUrl(url));
        this.disposeAvailabilityReaction = reaction(
            () => availability.referralProgramEnabled,
            (enabled) => {
                if (enabled) return;
                this.pendingRegistrationPromo = undefined;
                this.registrationCommands?.removePendingPromoCode();
            },
        );
        void source.getInitialUrl().then(
            (url) => {
                if (!this.disposed && url) this.handleUrl(url);
            },
            () => undefined,
        );
    }

    bindRegistration(commands: PendingRegistrationPromoCommands): () => void {
        this.registrationCommands = commands;
        if (this.acceptsAnonymousLinks() && this.pendingRegistrationPromo) {
            commands.setPendingPromoCode(this.pendingRegistrationPromo);
        }
        return () => {
            if (this.registrationCommands === commands) this.registrationCommands = undefined;
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribeFromLinks();
        this.disposeAvailabilityReaction();
        this.registrationCommands = undefined;
        this.pendingRegistrationPromo = undefined;
    }

    private handleUrl(url: string): void {
        if (!this.acceptsAnonymousLinks()) return;
        const promoCode = parsePendingPromo(url)?.toUpperCase();
        if (!promoCode) return;
        this.pendingRegistrationPromo = promoCode;
        this.registrationCommands?.setPendingPromoCode(promoCode);
    }

    private acceptsAnonymousLinks(): boolean {
        return this.availability.referralProgramEnabled && this.sessionStore.state !== 'authenticated';
    }
}
