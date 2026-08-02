import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { loadEnv } from '../../config/env';

export type DigestPurpose = 'otp' | 'credential' | 'fingerprint';

export interface VersionedDigest {
    keyVersion: string;
    digest: string;
}

export interface SealedCredential {
    keyVersion: string;
    ciphertext: string;
    nonce: string;
    authenticationTag: string;
}

@Injectable()
export class CredentialCryptoService {
    private readonly env = loadEnv();

    digest(purpose: DigestPurpose, parts: readonly string[]): VersionedDigest {
        const { key, version } = this.hmacMaterial(purpose);
        const hmac = createHmac('sha256', key);
        for (const part of parts) {
            const encoded = Buffer.from(part, 'utf8');
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(encoded.byteLength);
            hmac.update(length);
            hmac.update(encoded);
        }
        return { keyVersion: version, digest: hmac.digest('hex') };
    }

    compareDigests(leftHex: string, rightHex: string): boolean {
        const left = Buffer.from(leftHex, 'hex');
        const right = Buffer.from(rightHex, 'hex');
        return left.byteLength === 32 && right.byteLength === 32 && timingSafeEqual(left, right);
    }

    generateOpaqueCredential(bytes = 32): string {
        if (!Number.isSafeInteger(bytes) || bytes < 32) {
            throw new RangeError('Opaque credentials require at least 32 bytes');
        }
        return randomBytes(bytes).toString('base64url');
    }

    fingerprintPhone(phoneE164: string): VersionedDigest {
        return this.digest('fingerprint', ['phone', phoneE164]);
    }

    fingerprintIp(ipAddress: string): VersionedDigest {
        return this.digest('fingerprint', ['ip', ipAddress]);
    }

    fingerprintInstallation(installationId: string): VersionedDigest {
        return this.digest('fingerprint', ['installation', installationId]);
    }

    seal(plaintext: Uint8Array, aad: Uint8Array): SealedCredential {
        const key = Buffer.from(this.env.REGISTRATION_RESULT_ENCRYPTION_KEY, 'base64url');
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(aad));
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);

        return {
            keyVersion: this.env.REGISTRATION_RESULT_KEY_VERSION,
            ciphertext: ciphertext.toString('base64url'),
            nonce: nonce.toString('base64url'),
            authenticationTag: cipher.getAuthTag().toString('base64url'),
        };
    }

    open(sealed: SealedCredential, aad: Uint8Array): Buffer {
        if (sealed.keyVersion !== this.env.REGISTRATION_RESULT_KEY_VERSION) {
            throw new Error('Unsupported credential encryption key version');
        }
        const decipher = createDecipheriv(
            'aes-256-gcm',
            Buffer.from(this.env.REGISTRATION_RESULT_ENCRYPTION_KEY, 'base64url'),
            Buffer.from(sealed.nonce, 'base64url'),
        );
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(Buffer.from(sealed.authenticationTag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64url')), decipher.final()]);
    }

    private hmacMaterial(purpose: DigestPurpose): {
        key: Buffer;
        version: string;
    } {
        if (purpose === 'otp') {
            return {
                key: Buffer.from(this.env.OTP_HMAC_KEY, 'base64url'),
                version: this.env.OTP_HMAC_KEY_VERSION,
            };
        }
        if (purpose === 'credential') {
            return {
                key: Buffer.from(this.env.CREDENTIAL_HMAC_KEY, 'base64url'),
                version: this.env.CREDENTIAL_HMAC_KEY_VERSION,
            };
        }
        return {
            key: Buffer.from(this.env.FINGERPRINT_HMAC_KEY, 'base64url'),
            version: this.env.FINGERPRINT_HMAC_KEY_VERSION,
        };
    }
}
