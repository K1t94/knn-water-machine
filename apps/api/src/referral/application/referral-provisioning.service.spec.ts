import { describe, expect, it, vi } from 'vitest';

import { ReferralProvisioningService } from './referral-provisioning.service';

import type {
    ListReferralProvisioningCandidatesInput,
    ProvisionReferralUserInput,
    ReferralProvisioningRepository,
} from './ports/referral.repository';
import type { PromoCode } from '../domain/referral-types';

const createdAt = new Date('2026-08-06T12:00:00.000Z');

function repositoryFixture(rows: readonly { userId: string; provisioned: boolean }[]) {
    const listProvisioningCandidates = vi.fn(
        async ({ afterUserId, limit }: ListReferralProvisioningCandidatesInput) => {
            const start = afterUserId === null ? 0 : rows.findIndex(({ userId }) => userId === afterUserId) + 1;
            return rows.slice(start, start + limit).map((row) => ({ ...row, createdAt }));
        },
    );
    const provisionUser = vi.fn(async (_input: ProvisionReferralUserInput) => ({
        promoCode: '23456789ABCD' as PromoCode,
        created: true,
        collisionCount: 0,
    }));
    const repository: ReferralProvisioningRepository = { listProvisioningCandidates, provisionUser };
    return { repository, listProvisioningCandidates, provisionUser };
}

describe('ReferralProvisioningService', () => {
    it('scans users in bounded UUID-keyset batches', async () => {
        const fixture = repositoryFixture([
            { userId: '00000000-0000-0000-0000-000000000001', provisioned: false },
            { userId: '00000000-0000-0000-0000-000000000002', provisioned: false },
            { userId: '00000000-0000-0000-0000-000000000003', provisioned: false },
        ]);
        const service = new ReferralProvisioningService(fixture.repository);

        const result = await service.run({ batchSize: 2, dryRun: false });

        expect(fixture.listProvisioningCandidates).toHaveBeenNthCalledWith(1, { afterUserId: null, limit: 2 });
        expect(fixture.listProvisioningCandidates).toHaveBeenNthCalledWith(2, {
            afterUserId: '00000000-0000-0000-0000-000000000002',
            limit: 2,
        });
        expect(result).toMatchObject({ scanned: 3, created: 3, batches: 2 });
    });

    it('reports dry-run work without making writes', async () => {
        const fixture = repositoryFixture([
            { userId: '00000000-0000-0000-0000-000000000001', provisioned: false },
            { userId: '00000000-0000-0000-0000-000000000002', provisioned: true },
        ]);
        const service = new ReferralProvisioningService(fixture.repository);

        await expect(service.run({ batchSize: 100, dryRun: true })).resolves.toEqual({
            scanned: 2,
            created: 0,
            wouldCreate: 1,
            alreadyPresent: 1,
            collisions: 0,
            failures: 0,
            batches: 1,
        });
        expect(fixture.provisionUser).not.toHaveBeenCalled();
    });

    it('aggregates collisions and safe rerun results', async () => {
        const fixture = repositoryFixture([
            { userId: '00000000-0000-0000-0000-000000000001', provisioned: false },
            { userId: '00000000-0000-0000-0000-000000000002', provisioned: false },
        ]);
        fixture.provisionUser
            .mockResolvedValueOnce({ promoCode: '23456789ABCD' as PromoCode, created: true, collisionCount: 2 })
            .mockResolvedValueOnce({ promoCode: '3456789ABCDE' as PromoCode, created: false, collisionCount: 0 });
        const service = new ReferralProvisioningService(fixture.repository);

        await expect(service.run({ batchSize: 100, dryRun: false })).resolves.toMatchObject({
            scanned: 2,
            created: 1,
            alreadyPresent: 1,
            collisions: 2,
            failures: 0,
        });
    });

    it('counts an isolated failure and continues the batch', async () => {
        const fixture = repositoryFixture([
            { userId: '00000000-0000-0000-0000-000000000001', provisioned: false },
            { userId: '00000000-0000-0000-0000-000000000002', provisioned: false },
        ]);
        fixture.provisionUser.mockRejectedValueOnce(new Error('temporary database failure'));
        const service = new ReferralProvisioningService(fixture.repository);

        await expect(service.run({ batchSize: 100, dryRun: false })).resolves.toMatchObject({
            scanned: 2,
            created: 1,
            failures: 1,
        });
        expect(fixture.provisionUser).toHaveBeenCalledTimes(2);
    });

    it('uses the same narrow contract for lazy repair', async () => {
        const fixture = repositoryFixture([]);
        const service = new ReferralProvisioningService(fixture.repository);

        await service.ensureProvisioned({ userId: '00000000-0000-0000-0000-000000000001', createdAt });

        expect(fixture.provisionUser).toHaveBeenCalledWith({
            userId: '00000000-0000-0000-0000-000000000001',
            createdAt,
        });
    });

    it.each([0, -1, 1001, 1.5])('rejects unsafe batch size %s', async (batchSize) => {
        const service = new ReferralProvisioningService(repositoryFixture([]).repository);

        await expect(service.run({ batchSize, dryRun: false })).rejects.toThrow('batchSize');
    });
});
