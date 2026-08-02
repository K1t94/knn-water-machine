import { Inject, Injectable, Optional } from '@nestjs/common';

import { CLOCK, RANDOM_SOURCE, type Clock, type RandomSource } from '../../auth/application/ports';
import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { loadEnv } from '../../config/env';
import { AuthMetrics } from '../../observability/auth-metrics';
import { SMS_PROVIDER, type SmsProvider, type SmsSendStatus } from '../../sms/application/ports/sms-provider';
import { SmsProviderError, type SmsErrorCategory } from '../../sms/application/sms-error';
import { buildOtpSms } from '../../sms/application/sms-message-builder';
import { OtpCrypto } from '../domain/otp-crypto';
import { normalizeSenegalPhone } from '../domain/senegal-phone';
import { OtpAbuseGuard, type OtpAbuseContext } from '../infrastructure/redis/otp-abuse-guard';
import { OtpChallengeStore, OtpStoreError, type PromoUpdate } from '../infrastructure/redis/otp-challenge.store';

export interface OtpRequestCommand {
    phone: string;
    installationId: string;
    ipAddress: string;
    pendingPromoCode?: string | null;
}
export interface OtpResendCommand extends OtpRequestCommand {
    previousChallengeId: string;
}
export interface OtpVerifyCommand extends OtpRequestCommand {
    challengeId: string;
    code: string;
}
export interface OtpIssued {
    challengeId: string;
    expiresAt: Date;
    resendAvailableAt: Date;
    delivery: SmsSendStatus;
}
export interface VerifiedOtp {
    challengeId: string;
    phoneE164: string;
    installationId: string;
    pendingPromoCode?: string;
    verifiedAt: Date;
}

@Injectable()
export class OtpService {
    private readonly env = loadEnv();

    constructor(
        @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
        @Inject(CLOCK) private readonly clock: Clock,
        @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
        @Inject(OtpCrypto) private readonly crypto: OtpCrypto,
        @Inject(CredentialCryptoService) private readonly fingerprints: CredentialCryptoService,
        @Inject(OtpChallengeStore) private readonly store: OtpChallengeStore,
        @Inject(OtpAbuseGuard) private readonly abuse: OtpAbuseGuard,
        @Optional() @Inject(AuthMetrics) private readonly metrics?: AuthMetrics,
    ) {}

    request(command: OtpRequestCommand): Promise<OtpIssued> {
        this.metrics?.otpRequested('request');
        return this.issue(command);
    }

    async resend(command: OtpResendCommand): Promise<OtpIssued> {
        this.metrics?.otpRequested('resend');
        const phoneE164 = normalizeSenegalPhone(command.phone);
        const existing = await this.store.get(command.previousChallengeId, phoneE164);
        if (!existing) throw new OtpApplicationError('OTP_EXPIRED');
        const cooldown = await this.store.cooldownRemaining(phoneE164);
        if (cooldown > 0) {
            this.metrics?.rateLimited('resend_cooldown');
            throw new OtpApplicationError('RATE_LIMITED', Math.ceil(cooldown / 1000));
        }
        const pendingPromoCode =
            command.pendingPromoCode === undefined ? existing.pendingPromoCode : command.pendingPromoCode;
        return this.issue({
            ...command,
            phone: phoneE164,
            ...(pendingPromoCode !== undefined ? { pendingPromoCode } : {}),
        });
    }

    async verify(command: OtpVerifyCommand): Promise<VerifiedOtp> {
        const phoneE164 = normalizeSenegalPhone(command.phone);
        let challenge;
        try {
            challenge = await this.store.get(command.challengeId, phoneE164);
        } catch (error) {
            if (error instanceof OtpStoreError) {
                this.metrics?.otpVerification(error.code === 'OTP_USED' ? 'used' : 'exhausted');
                throw new OtpApplicationError(error.code);
            }
            throw error;
        }
        if (!challenge || challenge.expiresAt <= this.clock.now().getTime()) {
            this.metrics?.otpVerification('expired');
            throw new OtpApplicationError('OTP_EXPIRED');
        }
        const promo = normalizePromoUpdate(command.pendingPromoCode);
        await this.store.updatePromo(command.challengeId, promo);
        const correct = this.crypto.verify(command.challengeId, phoneE164, command.code, {
            digest: challenge.digest,
            keyVersion: challenge.keyVersion,
        });
        if (!correct) {
            const rejected = await this.store.rejectAttempt(command.challengeId, phoneE164);
            if (rejected === 'exhausted') {
                await this.abuse.recordExhaustion(phoneE164, this.clock.now());
                this.metrics?.otpVerification('exhausted');
                throw new OtpApplicationError('OTP_ATTEMPTS_EXHAUSTED');
            }
            this.metrics?.otpVerification(rejected === 'invalid' ? 'invalid' : 'expired');
            throw new OtpApplicationError(rejected === 'invalid' ? 'OTP_INVALID' : 'OTP_EXPIRED');
        }
        const consumed = await this.store.consume(command.challengeId, phoneE164);
        if (consumed !== 'used') {
            this.metrics?.otpVerification('used');
            throw new OtpApplicationError('OTP_USED');
        }
        const finalPromo =
            promo.kind === 'replace' ? promo.value : promo.kind === 'remove' ? undefined : challenge.pendingPromoCode;
        const verified = {
            challengeId: command.challengeId,
            phoneE164,
            installationId: command.installationId,
            ...(finalPromo !== undefined ? { pendingPromoCode: finalPromo } : {}),
            verifiedAt: this.clock.now(),
        };
        this.metrics?.otpVerification('confirmed');
        return verified;
    }

    private async issue(command: OtpRequestCommand): Promise<OtpIssued> {
        const phoneE164 = normalizeSenegalPhone(command.phone);
        const now = this.clock.now();
        const phoneFingerprint = this.fingerprints.fingerprintPhone(phoneE164).digest;
        const owner = this.random.uuid();
        if (!(await this.store.acquirePhoneLock(phoneFingerprint, owner))) {
            this.metrics?.rateLimited('phone_lock');
            throw new OtpApplicationError('RATE_LIMITED', 1);
        }
        const abuseContext: OtpAbuseContext = {
            phoneE164,
            ipAddress: command.ipAddress,
            installationId: command.installationId,
            now,
        };
        let reserved = false;
        const challengeId = this.random.uuid();
        const code = this.crypto.generateCode((maximum) => this.random.integer(0, maximum));
        const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);
        try {
            await this.abuse.reserve(abuseContext);
            reserved = true;
            const material = this.crypto.material(challengeId, phoneE164, code);
            const promo = normalizePromoUpdate(command.pendingPromoCode);
            await this.store.prepare({
                challengeId,
                phoneE164,
                digest: material.digest,
                keyVersion: material.keyVersion,
                attempts: this.env.OTP_MAX_ATTEMPTS,
                createdAt: now.getTime(),
                expiresAt: expiresAt.getTime(),
                installationFingerprint: this.fingerprints.fingerprintInstallation(command.installationId).digest,
                ...(promo.kind === 'replace' ? { pendingPromoCode: promo.value } : {}),
            });
            let delivery: SmsSendStatus;
            try {
                delivery = (
                    await this.sms.send({
                        recipientE164: phoneE164,
                        message: buildOtpSms(code),
                        correlationId: challengeId,
                    })
                ).status;
            } catch (error) {
                if (error instanceof SmsProviderError && error.category === 'TIMEOUT') {
                    delivery = 'uncertain';
                } else {
                    await this.store.failPreparation(challengeId);
                    await this.abuse.refundDefinitiveFailure(abuseContext);
                    throw mapProviderError(error);
                }
            }
            const activated = await this.store.activate(
                challengeId,
                phoneE164,
                delivery,
                this.clock.now().getTime(),
                this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
            );
            if (activated !== 'active') throw new OtpApplicationError('OTP_EXPIRED');
            return {
                challengeId,
                expiresAt,
                resendAvailableAt: new Date(this.clock.now().getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000),
                delivery,
            };
        } finally {
            if (reserved) await this.abuse.release(abuseContext).catch(() => undefined);
            await this.store.releasePhoneLock(phoneFingerprint, owner).catch(() => undefined);
        }
    }
}

function normalizePromoUpdate(value: string | null | undefined): PromoUpdate {
    if (value === undefined) return { kind: 'preserve' };
    if (value === null || value.trim() === '') return { kind: 'remove' };
    const normalized = value.trim();
    if (normalized.length > 64 || !/^[\x20-\x7E]+$/.test(normalized)) {
        throw new OtpApplicationError('INVALID_PHONE');
    }
    return { kind: 'replace', value: normalized };
}

function mapProviderError(error: unknown): OtpApplicationError {
    if (!(error instanceof SmsProviderError)) return new OtpApplicationError('SMS_TEMPORARILY_UNAVAILABLE');
    const codes: Record<SmsErrorCategory, OtpErrorCode> = {
        INVALID_CONFIGURATION: 'SMS_CONFIGURATION_ERROR',
        AUTHENTICATION_FAILED: 'SMS_AUTH_FAILED',
        BALANCE_EXHAUSTED: 'SMS_BALANCE_EXHAUSTED',
        PROVIDER_RATE_LIMITED: 'SMS_PROVIDER_RATE_LIMITED',
        INVALID_RECIPIENT: 'SMS_INVALID_RECIPIENT',
        MESSAGE_REJECTED: 'SMS_REJECTED',
        TIMEOUT: 'SMS_TIMEOUT',
        TEMPORARY_PROVIDER_FAILURE: 'SMS_TEMPORARILY_UNAVAILABLE',
    };
    return new OtpApplicationError(codes[error.category], error.retryAfterSeconds);
}

export type OtpErrorCode =
    | 'INVALID_PHONE'
    | 'RATE_LIMITED'
    | 'SMS_BUDGET_EXHAUSTED'
    | 'SMS_CONFIGURATION_ERROR'
    | 'SMS_AUTH_FAILED'
    | 'SMS_BALANCE_EXHAUSTED'
    | 'SMS_PROVIDER_RATE_LIMITED'
    | 'SMS_INVALID_RECIPIENT'
    | 'SMS_REJECTED'
    | 'SMS_TIMEOUT'
    | 'SMS_TEMPORARILY_UNAVAILABLE'
    | 'OTP_INVALID'
    | 'OTP_EXPIRED'
    | 'OTP_USED'
    | 'OTP_ATTEMPTS_EXHAUSTED';

export class OtpApplicationError extends Error {
    constructor(
        public readonly code: OtpErrorCode,
        public readonly retryAfterSeconds?: number,
    ) {
        super(code);
    }
}
