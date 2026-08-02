import { Inject, Injectable } from '@nestjs/common';

import { RedisScriptRunner } from '../../../infrastructure/redis/redis-script-runner';
import { RedisService } from '../../../infrastructure/redis/redis.service';

import {
    activateOtpScript,
    failPreparedOtpScript,
    prepareOtpScript,
    releaseOwnedLockScript,
    updateOtpPromoScript,
} from './otp-send.scripts';
import { consumeOtpScript, rejectOtpAttemptScript } from './otp-verify.scripts';

export type PromoUpdate = { kind: 'preserve' } | { kind: 'remove' } | { kind: 'replace'; value: string };

export interface OtpChallenge {
    challengeId: string;
    phoneE164: string;
    digest: string;
    keyVersion: string;
    attemptsRemaining: number;
    createdAt: number;
    expiresAt: number;
    installationFingerprint: string;
    pendingPromoCode?: string;
    delivery: 'accepted' | 'uncertain';
}

export interface PrepareOtpChallenge extends Omit<OtpChallenge, 'delivery' | 'attemptsRemaining'> {
    attempts: number;
}

const PREFIX = 'auth:otp:';

@Injectable()
export class OtpChallengeStore {
    constructor(
        @Inject(RedisService) private readonly redis: RedisService,
        @Inject(RedisScriptRunner) private readonly scripts: RedisScriptRunner,
    ) {}

    async acquirePhoneLock(phoneFingerprint: string, owner: string): Promise<boolean> {
        const result = await this.redis.commandClient.set(this.lockKey(phoneFingerprint), owner, {
            NX: true,
            PX: 15_000,
        });
        return result === 'OK';
    }

    releasePhoneLock(phoneFingerprint: string, owner: string): Promise<boolean> {
        return this.scripts.invoke(releaseOwnedLockScript, {
            keys: [this.lockKey(phoneFingerprint)],
            arguments: [owner],
        });
    }

    async prepare(challenge: PrepareOtpChallenge): Promise<void> {
        const promo = challenge.pendingPromoCode;
        const result = await this.scripts.invoke(prepareOtpScript, {
            keys: [this.challengeKey(challenge.challengeId), this.currentKey(this.phoneKey(challenge.phoneE164))],
            arguments: [
                challenge.challengeId,
                challenge.phoneE164,
                challenge.digest,
                challenge.keyVersion,
                String(challenge.attempts),
                String(challenge.createdAt),
                String(challenge.expiresAt),
                challenge.installationFingerprint,
                promo === undefined ? 'absent' : 'value',
                promo ?? '',
            ],
        });

        if (result !== 'prepared') {
            throw new Error('OTP challenge could not be prepared');
        }
    }

    activate(
        challengeId: string,
        phoneE164: string,
        delivery: 'accepted' | 'uncertain',
        now: number,
        cooldownMs: number,
    ): Promise<'active' | 'expired' | 'missing'> {
        return this.scripts.invoke(activateOtpScript, {
            keys: [
                this.challengeKey(challengeId),
                this.currentKey(this.phoneKey(phoneE164)),
                this.cooldownKey(this.phoneKey(phoneE164)),
            ],
            arguments: [String(now), challengeId, delivery, String(cooldownMs), `${PREFIX}challenge:`],
        });
    }

    failPreparation(challengeId: string): Promise<boolean> {
        return this.scripts.invoke(failPreparedOtpScript, {
            keys: [this.challengeKey(challengeId)],
        });
    }

    async get(challengeId: string, phoneE164: string): Promise<OtpChallenge | undefined> {
        const tombstone = await this.redis.commandClient.get(this.tombstoneKey(challengeId));
        if (tombstone) throw new OtpStoreError(tombstone === 'USED' ? 'OTP_USED' : 'OTP_ATTEMPTS_EXHAUSTED');
        const values = await this.redis.commandClient.hGetAll(this.challengeKey(challengeId));

        if (!values.challengeId || values.phone !== phoneE164) return undefined;

        const current = await this.redis.commandClient.get(this.currentKey(this.phoneKey(phoneE164)));

        if (current !== challengeId || values.state !== 'ACTIVE') return undefined;

        return {
            challengeId,
            phoneE164,
            digest: values.digest,
            keyVersion: values.keyVersion,
            attemptsRemaining: Number(values.attempts),
            createdAt: Number(values.createdAt),
            expiresAt: Number(values.expiresAt),
            installationFingerprint: values.installation,
            ...(values.promoState === 'value' ? { pendingPromoCode: values.promo } : {}),
            delivery: values.delivery === 'uncertain' ? 'uncertain' : 'accepted',
        };
    }

    async updatePromo(challengeId: string, update: PromoUpdate): Promise<void> {
        if (update.kind === 'preserve') return;
        const state = update.kind === 'remove' ? 'removed' : 'value';
        const value = update.kind === 'replace' ? update.value : '';
        await this.scripts.invoke(updateOtpPromoScript, {
            keys: [this.challengeKey(challengeId)],
            arguments: [state, value],
        });
    }

    async cooldownRemaining(phoneE164: string): Promise<number> {
        const ttl = await this.redis.commandClient.pTTL(this.cooldownKey(this.phoneKey(phoneE164)));
        return Math.max(0, ttl);
    }

    consume(challengeId: string, phoneE164: string): Promise<'used' | 'stale' | 'missing'> {
        return this.scripts.invoke(consumeOtpScript, {
            keys: [
                this.challengeKey(challengeId),
                this.currentKey(this.phoneKey(phoneE164)),
                this.tombstoneKey(challengeId),
            ],
            arguments: [challengeId, String(10 * 60_000)],
        });
    }

    rejectAttempt(challengeId: string, phoneE164: string): Promise<'invalid' | 'exhausted' | 'stale'> {
        return this.scripts.invoke(rejectOtpAttemptScript, {
            keys: [
                this.challengeKey(challengeId),
                this.currentKey(this.phoneKey(phoneE164)),
                this.tombstoneKey(challengeId),
            ],
            arguments: [challengeId, String(30 * 60_000)],
        });
    }

    private phoneKey(phoneE164: string): string {
        return Buffer.from(phoneE164).toString('base64url');
    }

    private challengeKey(id: string): string {
        return `${PREFIX}challenge:${id}`;
    }

    private currentKey(phone: string): string {
        return `${PREFIX}current:${phone}`;
    }

    private cooldownKey(phone: string): string {
        return `${PREFIX}cooldown:${phone}`;
    }

    private lockKey(phone: string): string {
        return `${PREFIX}lock:${phone}`;
    }

    private tombstoneKey(id: string): string {
        return `${PREFIX}tombstone:${id}`;
    }
}

export class OtpStoreError extends Error {
    constructor(public readonly code: 'OTP_USED' | 'OTP_ATTEMPTS_EXHAUSTED') {
        super(code);
    }
}
