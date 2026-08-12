import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AppConfigApiError } from '../../api/app-config-api';
import { SessionStore } from '../../auth/stores/session.store';
import { FeatureAvailabilityStore } from '../stores/feature-availability.store';

import { FeatureAvailabilityService } from './feature-availability.service';

import type { AppConfigApi, PublicAppConfig } from '../../api/app-config-api';

describe('FeatureAvailabilityService', () => {
    it('loads, retries, and publishes authoritative availability', () => {
        const session = new SessionStore();
        const store = new FeatureAvailabilityStore();
        const getConfig = vi
            .fn<AppConfigApi['getConfig']>()
            .mockReturnValueOnce(throwError(() => new AppConfigApiError('OFFLINE', true)))
            .mockReturnValueOnce(of(config(false)));
        const service = new FeatureAvailabilityService(store, { getConfig }, session);
        expect(store.state).toBe('error');
        service.retry();
        expect(store.state).toBe('disabled');
        service.dispose();
    });

    it('cancels stale refreshes and refreshes on session replacement', () => {
        const session = new SessionStore();
        const store = new FeatureAvailabilityStore();
        const first = new Subject<PublicAppConfig>();
        const second = new Subject<PublicAppConfig>();
        const getConfig = vi
            .fn<AppConfigApi['getConfig']>()
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(second)
            .mockReturnValue(of(config(true)));
        const service = new FeatureAvailabilityService(store, { getConfig }, session);
        const firstClosed = vi.fn();
        first.subscribe({ complete: firstClosed });
        service.refresh();
        first.next(config(true));
        expect(store.state).toBe('loading');
        second.next(config(false));
        expect(store.state).toBe('disabled');

        session.markAnonymous();
        expect(getConfig).toHaveBeenCalledTimes(3);
        expect(store.state).toBe('enabled');
        service.dispose();
        expect(store.state).toBe('unknown');
        service.refresh();
        expect(getConfig).toHaveBeenCalledTimes(3);
    });
});

function config(enabled: boolean): PublicAppConfig {
    return { features: { referralProgramEnabled: enabled } };
}
