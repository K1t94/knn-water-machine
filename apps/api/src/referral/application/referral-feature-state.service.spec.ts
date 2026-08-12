import { describe, expect, it, vi } from 'vitest';

import { REFERRAL_PROGRAM_FEATURE_KEY } from './ports/referral-feature-state.repository';
import { ReferralFeatureStateService } from './referral-feature-state.service';

import type {
    ReferralFeatureAvailability,
    ReferralFeatureStateRepository,
} from './ports/referral-feature-state.repository';

function availability(enabled: boolean, revision = 1n): ReferralFeatureAvailability {
    return {
        key: REFERRAL_PROGRAM_FEATURE_KEY,
        enabled,
        revision,
        updatedAt: new Date(`2026-08-12T00:00:0${revision}.000Z`),
    };
}

function createRepository(): ReferralFeatureStateRepository {
    return {
        readAvailability: vi.fn(),
        isEnabledWithSharedLock: vi.fn(),
        setEnabled: vi.fn(),
    };
}

describe('ReferralFeatureStateService', () => {
    it.each([true, false])('returns the authoritative enabled=%s state without caching it', async (enabled) => {
        const repository = createRepository();
        vi.mocked(repository.readAvailability)
            .mockResolvedValueOnce(availability(enabled))
            .mockResolvedValueOnce(availability(!enabled, 2n));
        const service = new ReferralFeatureStateService(repository);

        await expect(service.readAvailability()).resolves.toEqual(availability(enabled));
        await expect(service.readAvailability()).resolves.toEqual(availability(!enabled, 2n));
        expect(repository.readAvailability).toHaveBeenCalledTimes(2);
    });

    it('returns the state observed under the caller transaction shared lock', async () => {
        const repository = createRepository();
        vi.mocked(repository.isEnabledWithSharedLock).mockResolvedValue(false);
        const service = new ReferralFeatureStateService(repository);
        const transaction = {};

        await expect(service.isEnabledWithSharedLock(transaction)).resolves.toBe(false);
        expect(repository.isEnabledWithSharedLock).toHaveBeenCalledWith(transaction);
    });

    it('preserves revision and timestamp for a same-value update', async () => {
        const repository = createRepository();
        const unchanged = availability(true, 7n);
        vi.mocked(repository.setEnabled).mockResolvedValue(unchanged);
        const service = new ReferralFeatureStateService(repository);

        await expect(service.setEnabled({ enabled: true })).resolves.toBe(unchanged);
        expect(repository.setEnabled).toHaveBeenCalledWith({ enabled: true });
    });

    it('returns the monotonic revision produced by a real transition', async () => {
        const repository = createRepository();
        vi.mocked(repository.setEnabled).mockResolvedValue(availability(false, 8n));
        const service = new ReferralFeatureStateService(repository);

        await expect(service.setEnabled({ enabled: false })).resolves.toEqual(availability(false, 8n));
    });

    it.each(['readAvailability', 'isEnabledWithSharedLock', 'setEnabled'] as const)(
        'fails closed when %s cannot reach authoritative storage',
        async (operation) => {
            const repository = createRepository();
            const storageError = new Error('storage unavailable');
            vi.mocked(repository[operation]).mockRejectedValue(storageError);
            const service = new ReferralFeatureStateService(repository);

            const result =
                operation === 'readAvailability'
                    ? service.readAvailability()
                    : operation === 'isEnabledWithSharedLock'
                      ? service.isEnabledWithSharedLock({})
                      : service.setEnabled({ enabled: false });
            await expect(result).rejects.toBe(storageError);
        },
    );
});
