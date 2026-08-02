import { action, computed, makeObservable, observable } from 'mobx';

import type { CurrentLegalSet, SessionCredentials } from '../../api/auth-api';

export type RegistrationState =
    'idle' | 'loading' | 'ready' | 'incomplete' | 'submitting' | 'stale' | 'offline' | 'error' | 'success';

export class RegistrationStore {
    pendingPromoCode: string | undefined = undefined;
    legalSet: CurrentLegalSet | undefined = undefined;
    acceptedDocumentIds = new Set<string>();
    state: RegistrationState = 'idle';
    errorMessage: string | undefined = undefined;
    session: SessionCredentials | undefined = undefined;

    constructor() {
        makeObservable(this, {
            pendingPromoCode: observable,
            legalSet: observable.ref,
            acceptedDocumentIds: observable,
            state: observable,
            errorMessage: observable,
            session: observable.ref,
            canComplete: computed,
            setPendingPromoCode: action.bound,
            removePendingPromoCode: action.bound,
            beginLoading: action.bound,
            finishLoading: action.bound,
            toggleAcceptance: action.bound,
            markIncomplete: action.bound,
            beginCompletion: action.bound,
            finishCompletion: action.bound,
            fail: action.bound,
            reset: action.bound,
            setStateForTest: action.bound,
        });
    }

    get canComplete(): boolean {
        const mandatory = this.legalSet?.documents.filter(({ mandatory }) => mandatory) ?? [];
        return (
            mandatory.length > 0 &&
            mandatory.every(({ id }) => this.acceptedDocumentIds.has(id)) &&
            this.state !== 'submitting'
        );
    }

    setPendingPromoCode(value: string): void {
        const normalized = value.trim().slice(0, 64);
        this.pendingPromoCode = normalized || undefined;
    }

    removePendingPromoCode(): void {
        this.pendingPromoCode = undefined;
    }

    beginLoading(): void {
        this.state = 'loading';
        this.errorMessage = undefined;
    }

    finishLoading(legalSet: CurrentLegalSet): void {
        this.legalSet = legalSet;
        this.acceptedDocumentIds.clear();
        this.state = 'ready';
        this.errorMessage = undefined;
    }

    toggleAcceptance(documentId: string): void {
        if (this.acceptedDocumentIds.has(documentId)) {
            this.acceptedDocumentIds.delete(documentId);
        } else {
            this.acceptedDocumentIds.add(documentId);
        }
        if (this.state === 'incomplete') this.state = 'ready';
    }

    markIncomplete(): void {
        this.state = 'incomplete';
        this.errorMessage = 'Accept all mandatory documents to continue.';
    }

    beginCompletion(): void {
        this.state = 'submitting';
        this.errorMessage = undefined;
    }

    finishCompletion(session: SessionCredentials): void {
        this.session = session;
        this.pendingPromoCode = undefined;
        this.state = 'success';
        this.errorMessage = undefined;
    }

    fail(state: Extract<RegistrationState, 'stale' | 'offline' | 'error'>, message: string): void {
        this.state = state;
        this.errorMessage = message;
    }

    reset(): void {
        this.legalSet = undefined;
        this.acceptedDocumentIds.clear();
        this.state = 'idle';
        this.errorMessage = undefined;
        this.session = undefined;
    }

    setStateForTest(state: RegistrationState): void {
        this.state = state;
    }
}
