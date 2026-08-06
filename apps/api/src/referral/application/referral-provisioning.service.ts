import { Inject, Injectable } from '@nestjs/common';

import {
    REFERRAL_REPOSITORY,
    type ReferralProvisioningRepository,
    type ProvisionReferralUserInput,
    type ProvisionReferralUserResult,
} from './ports/referral.repository';

export interface ReferralProvisioningOptions {
    readonly batchSize: number;
    readonly dryRun: boolean;
}

export interface ReferralProvisioningCounters {
    readonly scanned: number;
    readonly created: number;
    readonly wouldCreate: number;
    readonly alreadyPresent: number;
    readonly collisions: number;
    readonly failures: number;
    readonly batches: number;
}

const MAX_PROVISIONING_BATCH_SIZE = 1_000;

@Injectable()
export class ReferralProvisioningService {
    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralProvisioningRepository,
    ) {}

    ensureProvisioned(input: ProvisionReferralUserInput): Promise<ProvisionReferralUserResult> {
        return this.repository.provisionUser(input);
    }

    async run(options: ReferralProvisioningOptions): Promise<ReferralProvisioningCounters> {
        if (
            !Number.isInteger(options.batchSize) ||
            options.batchSize < 1 ||
            options.batchSize > MAX_PROVISIONING_BATCH_SIZE
        ) {
            throw new Error(`batchSize must be an integer between 1 and ${MAX_PROVISIONING_BATCH_SIZE}`);
        }

        const counters = {
            scanned: 0,
            created: 0,
            wouldCreate: 0,
            alreadyPresent: 0,
            collisions: 0,
            failures: 0,
            batches: 0,
        };
        let afterUserId: string | null = null;

        while (true) {
            const users = await this.repository.listProvisioningCandidates({
                afterUserId,
                limit: options.batchSize,
            });
            if (users.length === 0) break;

            counters.batches += 1;
            for (const user of users) {
                counters.scanned += 1;
                if (user.provisioned) {
                    counters.alreadyPresent += 1;
                    continue;
                }
                if (options.dryRun) {
                    counters.wouldCreate += 1;
                    continue;
                }

                try {
                    const result = await this.repository.provisionUser({
                        userId: user.userId,
                        createdAt: user.createdAt,
                    });
                    counters.collisions += result.collisionCount;
                    if (result.created) counters.created += 1;
                    else counters.alreadyPresent += 1;
                } catch {
                    counters.failures += 1;
                }
            }

            afterUserId = users.at(-1)?.userId ?? afterUserId;
            if (users.length < options.batchSize) break;
        }

        return counters;
    }
}
