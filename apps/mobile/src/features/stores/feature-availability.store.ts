import { action, computed, makeObservable, observable } from 'mobx';

export type FeatureAvailabilityState = 'unknown' | 'loading' | 'enabled' | 'disabled' | 'error';

export interface FeatureAvailabilityError {
    code: string;
    retryable: boolean;
}

export class FeatureAvailabilityStore {
    state: FeatureAvailabilityState = 'unknown';
    error: FeatureAvailabilityError | undefined = undefined;

    private generation = 0;
    private requestToken: number | undefined;

    constructor() {
        makeObservable(this, {
            state: observable,
            error: observable.ref,
            referralProgramEnabled: computed,
            referralUiVisible: computed,
            beginRefresh: action.bound,
            finishRefresh: action.bound,
            failRefresh: action.bound,
            disableFromReferralResponse: action.bound,
            resetForSessionReplacement: action.bound,
        });
    }

    get referralProgramEnabled(): boolean {
        return this.state === 'enabled';
    }

    get referralUiVisible(): boolean {
        return this.referralProgramEnabled;
    }

    beginRefresh(): number {
        const token = ++this.generation;
        this.requestToken = token;
        this.state = 'loading';
        this.error = undefined;
        return token;
    }

    finishRefresh(token: number, enabled: boolean): void {
        if (token !== this.requestToken) return;
        this.requestToken = undefined;
        this.state = enabled ? 'enabled' : 'disabled';
        this.error = undefined;
    }

    failRefresh(token: number, error: FeatureAvailabilityError): void {
        if (token !== this.requestToken) return;
        this.requestToken = undefined;
        this.state = 'error';
        this.error = error;
    }

    disableFromReferralResponse(): void {
        this.generation += 1;
        this.requestToken = undefined;
        this.state = 'disabled';
        this.error = undefined;
    }

    resetForSessionReplacement(): void {
        this.generation += 1;
        this.requestToken = undefined;
        this.state = 'unknown';
        this.error = undefined;
    }
}
