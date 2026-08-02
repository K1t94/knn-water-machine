import { describe, expect, it } from 'vitest';

import type { SendSmsCommand, SmsProvider } from '../application/ports/sms-provider';
import type { SmsProviderError } from '../application/sms-error';

export interface SmsProviderContractHarness {
    provider: SmsProvider;
    command: SendSmsCommand;
    expectedName: string;
    deliverySupported: boolean;
    arrangeStableFailure?(): SmsProviderError;
}

export function smsProviderContract(name: string, createHarness: () => SmsProviderContractHarness): void {
    describe(`${name} SmsProvider contract`, () => {
        it('returns only the normalized provider-neutral success shape', async () => {
            const harness = createHarness();
            const result = await harness.provider.send(harness.command);

            expect(harness.provider.name).toBe(harness.expectedName);
            expect(harness.provider.delivery.supported).toBe(harness.deliverySupported);
            expect(result.status).toMatch(/^(accepted|uncertain)$/);
            expect(result.acceptedAt).toBeInstanceOf(Date);
            if (result.providerMessageId !== undefined) {
                expect(result.providerMessageId.length).toBeGreaterThan(0);
            }

            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain(harness.command.recipientE164);
            expect(serialized).not.toContain(harness.command.message);
            expect(serialized).not.toMatch(/\b\d{6}\b/);
        });

        it('uses the stable error taxonomy without provider payloads', async () => {
            const harness = createHarness();
            const arranged = harness.arrangeStableFailure?.();
            if (!arranged) {
                return;
            }

            await expect(harness.provider.send(harness.command)).rejects.toMatchObject({
                name: 'SmsProviderError',
                category: arranged.category,
                retryable: arranged.retryable,
            });
            expect(arranged.message).not.toContain(harness.command.recipientE164);
            expect(arranged.message).not.toContain(harness.command.message);
        });
    });
}
