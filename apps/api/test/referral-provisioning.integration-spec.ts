import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReferralProvisioningService } from '../src/referral/application/referral-provisioning.service';
import { ReferralPromoProvisioner } from '../src/referral/infrastructure/postgres/referral-promo-provisioner';

import {
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    insertReferralTestUser,
    referralPostgresEnabled,
} from './referral-postgres.fixture';

import type { ReferralPostgresSchema } from './referral-postgres.fixture';
import type { PrismaService } from '../src/prisma/prisma.service';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;

describePostgres('existing-user referral provisioning', () => {
    let fixture: ReferralPostgresSchema;
    let service: ReferralProvisioningService;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('provisioning');
        fixture.deploy();
        await Promise.all([
            insertReferralTestUser(fixture.prisma, '2000001'),
            insertReferralTestUser(fixture.prisma, '2000002'),
            insertReferralTestUser(fixture.prisma, '2000003'),
        ]);
        const provisioner = new ReferralPromoProvisioner(fixture.prisma as unknown as PrismaService);
        service = new ReferralProvisioningService(provisioner);
    }, 60_000);

    afterAll(async () => disposeReferralPostgresSchema(fixture));

    it('supports dry run, actual run, and safe rerun without bonus side effects', async () => {
        await expect(service.run({ batchSize: 2, dryRun: true })).resolves.toMatchObject({
            scanned: 3,
            created: 0,
            wouldCreate: 3,
        });
        expect(await fixture.prisma.referralPromoCode.count()).toBe(0);

        await expect(service.run({ batchSize: 2, dryRun: false })).resolves.toMatchObject({
            scanned: 3,
            created: 3,
            failures: 0,
        });
        const firstCodes = await fixture.prisma.referralPromoCode.findMany({ orderBy: { userId: 'asc' } });

        await expect(service.run({ batchSize: 2, dryRun: false })).resolves.toMatchObject({
            scanned: 3,
            created: 0,
            alreadyPresent: 3,
        });
        expect(await fixture.prisma.referralPromoCode.findMany({ orderBy: { userId: 'asc' } })).toEqual(firstCodes);
        expect(await fixture.prisma.referralEligibility.count()).toBe(3);
        expect(await fixture.prisma.referralRelationship.count()).toBe(0);
        expect(await fixture.prisma.referralBonusEntitlement.count()).toBe(0);
        expect(await fixture.prisma.walletLedgerEntry.count()).toBe(0);
    });

    it('concurrent lazy repair converges on one stable promo and OPEN eligibility', async () => {
        const userId = await insertReferralTestUser(fixture.prisma, '2000004');

        const results = await Promise.all(
            Array.from({ length: 20 }, () => service.ensureProvisioned({ userId, createdAt: new Date() })),
        );
        expect(new Set(results.map(({ promoCode }) => promoCode)).size).toBe(1);
        expect(await fixture.prisma.referralPromoCode.count({ where: { userId } })).toBe(1);
        expect(await fixture.prisma.referralEligibility.findUniqueOrThrow({ where: { userId } })).toMatchObject({
            status: 'OPEN',
        });
    });
});
