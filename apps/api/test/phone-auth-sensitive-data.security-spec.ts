import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FakeSmsOutbox } from '../src/sms/infrastructure/fake/fake-sms.outbox';

const phone = '+221771234567';
const otp = '314159';

describe('phone authentication sensitive-data boundary', () => {
    it('never writes a fake-provider OTP or full phone to process logs', () => {
        const outbox = new FakeSmsOutbox();
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            outbox.record(
                {
                    recipientE164: phone,
                    message: `KAYNANN code: ${otp}. Valid for 5 minutes.`,
                    correlationId: '00000000-0000-4000-8000-000000000001',
                },
                true,
                true,
            );

            expect(outbox.latestFor(phone)?.otp).toBe(otp);
            for (const logger of [log, info, warn, error]) {
                expect(logger).not.toHaveBeenCalled();
            }
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('keeps provider payloads and credential fields out of public OTP schemas', () => {
        const contractPath = resolve(__dirname, '../../../specs/002-phone-otp-auth/contracts/openapi.generated.json');
        const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
            components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
        };

        for (const name of ['OtpIssuedResponseDto', 'OtpVerifiedResponseDto']) {
            const serialized = JSON.stringify(contract.components.schemas[name]);
            expect(serialized).not.toMatch(/providerPayload|providerMessageId|orange/i);
            expect(Object.keys(contract.components.schemas[name].properties ?? {})).not.toContain('otp');
        }
    });

    it('does not persist forbidden plaintext auth fields in the Prisma schema', () => {
        const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');

        expect(schema).not.toMatch(/^\s*(otp|refreshToken|accessToken|registrationToken)\s+/m);
        expect(schema).not.toMatch(/^\s*(orangeClientSecret|providerPayload)\s+/m);
        expect(schema).toMatch(/^\s*tokenDigest\s+/m);
        expect(schema).toMatch(/^\s*phoneFingerprint\s+/m);
    });
});
