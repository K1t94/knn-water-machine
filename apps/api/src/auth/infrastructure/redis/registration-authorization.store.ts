import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { CredentialCryptoService, type SealedCredential } from '../../../common/security/credential-crypto.service';
import { loadEnv } from '../../../config/env';
import { type RedisScript, RedisScriptRunner } from '../../../infrastructure/redis/redis-script-runner';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export type RegistrationAuthorizationState = 'ACTIVE' | 'COMPLETING' | 'COMPLETED';

export interface RegistrationAuthorization {
    tokenDigest: string;
    flowId: string;
    challengeId: string;
    phoneE164: string;
    phoneConfirmedAt: Date;
    installationFingerprint: string;
    pendingPromoCode?: string;
    existingUserId?: string;
    state: RegistrationAuthorizationState;
    expiresAt: Date;
}

export interface RegistrationCompletion {
    status: 'started' | 'existing' | 'recover';
    tokenDigest: string;
    flowId: string;
    owner: string;
    completionKeyDigest: string;
    userId: string;
    sessionId: string;
    familyId: string;
    leaseExpiresAt: Date;
}

export interface RegistrationResult {
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    refreshExpiresAt: string;
}

interface RegistrationHash extends Record<string, string> {
    state: RegistrationAuthorizationState;
    flowId: string;
    challengeId: string;
    phone: string;
    phoneConfirmedAt: string;
    installation: string;
    expiresAt: string;
}

export class RegistrationAuthorizationError extends Error {
    constructor(
        public readonly code:
            'REGISTRATION_AUTH_INVALID' | 'REGISTRATION_AUTH_EXPIRED' | 'REGISTRATION_ALREADY_COMPLETING',
    ) {
        super(code);
    }
}

const beginCompletionScript: RedisScript<string[]> = {
    name: 'registration-begin-completion',
    version: 2,
    source: `
local values = redis.call('HGETALL', KEYS[1])
if #values == 0 then return {'MISSING'} end
local state = redis.call('HGET', KEYS[1], 'state')
local storedKey = redis.call('HGET', KEYS[1], 'completionKeyDigest')
if state == 'COMPLETED' then
  if storedKey == ARGV[1] then return {'RECOVER'} end
  return {'CONFLICT'}
end
if state == 'COMPLETING' then
  if storedKey == ARGV[1] then
    local prepared = redis.call('HGET', KEYS[1], 'resultCiphertext')
    local leaseExpiresAt = tonumber(redis.call('HGET', KEYS[1], 'leaseExpiresAt') or '0')
    if not prepared and leaseExpiresAt <= tonumber(ARGV[6]) then
      redis.call('HSET', KEYS[1],
        'owner', ARGV[2],
        'leaseExpiresAt', ARGV[7])
      return {
        'STARTED',
        ARGV[2],
        redis.call('HGET', KEYS[1], 'userId'),
        redis.call('HGET', KEYS[1], 'sessionId'),
        redis.call('HGET', KEYS[1], 'familyId'),
        ARGV[7]
      }
    end
    return {
      'EXISTING',
      redis.call('HGET', KEYS[1], 'owner'),
      redis.call('HGET', KEYS[1], 'userId'),
      redis.call('HGET', KEYS[1], 'sessionId'),
      redis.call('HGET', KEYS[1], 'familyId'),
      redis.call('HGET', KEYS[1], 'leaseExpiresAt')
    }
  end
  return {'CONFLICT'}
end
redis.call('HSET', KEYS[1],
  'state', 'COMPLETING',
  'completionKeyDigest', ARGV[1],
  'owner', ARGV[2],
  'userId', ARGV[3],
  'sessionId', ARGV[4],
  'familyId', ARGV[5],
  'leaseExpiresAt', ARGV[7])
return {'STARTED', ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[7]}
`,
    parse(result) {
        if (!Array.isArray(result)) throw new Error('Invalid Redis response');
        return result.map(String);
    },
};

const prepareResultScript: RedisScript<string> = {
    name: 'registration-prepare-result',
    version: 1,
    source: `
if redis.call('HGET', KEYS[1], 'state') ~= 'COMPLETING' then return 'INVALID' end
if redis.call('HGET', KEYS[1], 'completionKeyDigest') ~= ARGV[1] then return 'INVALID' end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then return 'INVALID' end
redis.call('HSET', KEYS[1],
  'resultKeyVersion', ARGV[3],
  'resultCiphertext', ARGV[4],
  'resultNonce', ARGV[5],
  'resultAuthenticationTag', ARGV[6])
return 'PREPARED'
`,
    parse: String,
};

const completeScript: RedisScript<string> = {
    name: 'registration-complete',
    version: 1,
    source: `
if redis.call('HGET', KEYS[1], 'completionKeyDigest') ~= ARGV[1] then return 'INVALID' end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then return 'INVALID' end
if not redis.call('HGET', KEYS[1], 'resultCiphertext') then return 'INVALID' end
redis.call('HSET', KEYS[1], 'state', 'COMPLETED')
redis.call('HDEL', KEYS[1], 'phone', 'promo')
return 'COMPLETED'
`,
    parse: String,
};

const updatePromoScript: RedisScript<string> = {
    name: 'registration-update-promo',
    version: 1,
    source: `
if redis.call('HGET', KEYS[1], 'state') ~= 'ACTIVE' then return 'INVALID' end
if ARGV[1] == '' then
  redis.call('HDEL', KEYS[1], 'promo')
else
  redis.call('HSET', KEYS[1], 'promo', ARGV[1])
end
return 'UPDATED'
`,
    parse: String,
};

@Injectable()
export class RegistrationAuthorizationStore {
    private readonly ttlMs = loadEnv().REGISTRATION_AUTH_TTL_SECONDS * 1_000;
    private readonly completionLeaseMs = 30_000;

    constructor(
        @Inject(RedisService) private readonly redis: RedisService,
        @Inject(RedisScriptRunner) private readonly scripts: RedisScriptRunner,
        @Inject(CredentialCryptoService) private readonly crypto: CredentialCryptoService,
    ) {}

    async issue(input: {
        challengeId: string;
        phoneE164: string;
        phoneConfirmedAt: Date;
        installationId: string;
        pendingPromoCode?: string;
        existingUserId?: string;
    }): Promise<{ token: string; expiresAt: Date }> {
        const token = this.crypto.generateOpaqueCredential();
        const tokenDigest = this.tokenDigest(token);
        const now = Date.now();
        const expiresAt = new Date(now + this.ttlMs);
        const installation = this.crypto.fingerprintInstallation(input.installationId).digest;
        await this.redis.commandClient
            .multi()
            .hSet(this.key(tokenDigest), {
                state: 'ACTIVE',
                flowId: randomUUID(),
                challengeId: input.challengeId,
                phone: input.phoneE164,
                phoneConfirmedAt: input.phoneConfirmedAt.toISOString(),
                installation,
                expiresAt: expiresAt.toISOString(),
                ...(input.pendingPromoCode ? { promo: input.pendingPromoCode } : {}),
                ...(input.existingUserId ? { existingUserId: input.existingUserId } : {}),
            })
            .pExpireAt(this.key(tokenDigest), expiresAt.getTime())
            .exec();
        return { token, expiresAt };
    }

    async requireActive(token: string): Promise<RegistrationAuthorization> {
        const authorization = await this.read(token);
        if (authorization.state !== 'ACTIVE') {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
        return authorization;
    }

    async inspect(token: string): Promise<RegistrationAuthorization> {
        return this.read(token);
    }

    async updatePromo(token: string, pendingPromoCode: string | null): Promise<void> {
        const status = await this.scripts.invoke(updatePromoScript, {
            keys: [this.key(this.tokenDigest(token))],
            arguments: [pendingPromoCode ?? ''],
        });
        if (status !== 'UPDATED') {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
    }

    async beginCompletion(token: string, idempotencyKey: string): Promise<RegistrationCompletion> {
        const tokenDigest = this.tokenDigest(token);
        const current = await this.read(token);
        const completionKeyDigest = this.crypto.digest('credential', [
            'registration-completion',
            current.flowId,
            idempotencyKey,
        ]).digest;
        const owner = this.crypto.generateOpaqueCredential();
        const userId = current.existingUserId ?? this.stableUserId(current.phoneE164);
        const sessionId = randomUUID();
        const familyId = randomUUID();
        const now = Date.now();
        const leaseExpiresAt = new Date(now + this.completionLeaseMs);
        const result = await this.scripts.invoke(beginCompletionScript, {
            keys: [this.key(tokenDigest)],
            arguments: [
                completionKeyDigest,
                owner,
                userId,
                sessionId,
                familyId,
                now.toString(),
                leaseExpiresAt.getTime().toString(),
            ],
        });

        if (result[0] === 'MISSING') {
            throw new RegistrationAuthorizationError('REGISTRATION_AUTH_EXPIRED');
        }
        if (result[0] === 'CONFLICT') {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
        if (result[0] === 'RECOVER') {
            return {
                status: 'recover',
                tokenDigest,
                flowId: current.flowId,
                owner: '',
                completionKeyDigest,
                userId: current.existingUserId ?? '',
                sessionId: '',
                familyId: '',
                leaseExpiresAt: current.expiresAt,
            };
        }
        return {
            status: result[0] === 'STARTED' ? 'started' : 'existing',
            tokenDigest,
            flowId: current.flowId,
            completionKeyDigest,
            owner: result[1] ?? owner,
            userId: result[2] ?? userId,
            sessionId: result[3] ?? sessionId,
            familyId: result[4] ?? familyId,
            leaseExpiresAt: new Date(Number(result[5] ?? leaseExpiresAt.getTime())),
        };
    }

    async readPreparedResult(
        token: string,
        completion: RegistrationCompletion,
    ): Promise<RegistrationResult | undefined> {
        const values = await this.readHash(this.tokenDigest(token));
        if (values.completionKeyDigest !== completion.completionKeyDigest || !values.resultCiphertext) {
            return undefined;
        }
        return this.openResult(
            values,
            completion.tokenDigest,
            completion.completionKeyDigest,
            completion.flowId,
            completion.sessionId,
        );
    }

    async prepareResult(token: string, completion: RegistrationCompletion, result: RegistrationResult): Promise<void> {
        const sealed = this.crypto.seal(
            Buffer.from(JSON.stringify(result), 'utf8'),
            this.aad(completion.tokenDigest, completion.completionKeyDigest, completion.flowId, completion.sessionId),
        );
        const status = await this.scripts.invoke(prepareResultScript, {
            keys: [this.key(this.tokenDigest(token))],
            arguments: [
                completion.completionKeyDigest,
                completion.owner,
                sealed.keyVersion,
                sealed.ciphertext,
                sealed.nonce,
                sealed.authenticationTag,
            ],
        });
        if (status !== 'PREPARED') {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
    }

    async complete(token: string, completion: RegistrationCompletion): Promise<void> {
        const status = await this.scripts.invoke(completeScript, {
            keys: [this.key(this.tokenDigest(token))],
            arguments: [completion.completionKeyDigest, completion.owner],
        });
        if (status !== 'COMPLETED') {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
    }

    async recoverResult(token: string, idempotencyKey: string): Promise<RegistrationResult> {
        const tokenDigest = this.tokenDigest(token);
        const values = await this.readHash(tokenDigest);
        const expected = this.crypto.digest('credential', [
            'registration-completion',
            values.flowId,
            idempotencyKey,
        ]).digest;
        if (
            values.state !== 'COMPLETED' ||
            !values.completionKeyDigest ||
            !this.crypto.compareDigests(values.completionKeyDigest, expected)
        ) {
            throw new RegistrationAuthorizationError('REGISTRATION_ALREADY_COMPLETING');
        }
        return this.openResult(values, tokenDigest, expected, values.flowId, values.sessionId ?? '');
    }

    private async read(token: string): Promise<RegistrationAuthorization> {
        const tokenDigest = this.tokenDigest(token);
        const values = await this.readHash(tokenDigest);
        return {
            tokenDigest,
            flowId: values.flowId,
            challengeId: values.challengeId,
            phoneE164: values.phone,
            phoneConfirmedAt: new Date(values.phoneConfirmedAt),
            installationFingerprint: values.installation,
            ...(values.promo ? { pendingPromoCode: values.promo } : {}),
            ...(values.existingUserId ? { existingUserId: values.existingUserId } : {}),
            state: values.state,
            expiresAt: new Date(values.expiresAt),
        };
    }

    private async readHash(tokenDigest: string): Promise<RegistrationHash> {
        const values = await this.redis.commandClient.hGetAll(this.key(tokenDigest));
        if (!values.flowId) {
            throw new RegistrationAuthorizationError('REGISTRATION_AUTH_INVALID');
        }
        if (Date.parse(values.expiresAt ?? '') <= Date.now()) {
            throw new RegistrationAuthorizationError('REGISTRATION_AUTH_EXPIRED');
        }
        return values as RegistrationHash;
    }

    private tokenDigest(token: string): string {
        if (!token) {
            throw new RegistrationAuthorizationError('REGISTRATION_AUTH_INVALID');
        }
        return this.crypto.digest('credential', ['registration-authorization', token]).digest;
    }

    private key(tokenDigest: string): string {
        return `auth:registration:${tokenDigest}`;
    }

    private aad(tokenDigest: string, completionKeyDigest: string, flowId: string, sessionId: string): Buffer {
        return Buffer.from(`registration-result:${tokenDigest}:${flowId}:${completionKeyDigest}:${sessionId}`, 'utf8');
    }

    private openResult(
        values: RegistrationHash,
        tokenDigest: string,
        completionKeyDigest: string,
        flowId: string,
        sessionId: string,
    ): RegistrationResult {
        const sealed: SealedCredential = {
            keyVersion: values.resultKeyVersion ?? '',
            ciphertext: values.resultCiphertext ?? '',
            nonce: values.resultNonce ?? '',
            authenticationTag: values.resultAuthenticationTag ?? '',
        };
        const plaintext = this.crypto.open(sealed, this.aad(tokenDigest, completionKeyDigest, flowId, sessionId));
        return JSON.parse(plaintext.toString('utf8')) as RegistrationResult;
    }

    private stableUserId(phoneE164: string): string {
        const hex = this.crypto.digest('credential', ['registration-user-id', phoneE164]).digest;
        const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}`;
        const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            versioned.slice(12, 16),
            `${variant}${hex.slice(17, 20)}`,
            hex.slice(20, 32),
        ].join('-');
    }
}
