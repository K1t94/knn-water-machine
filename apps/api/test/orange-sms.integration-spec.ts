import { SmsDeliveryStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SmsDeliveryService } from '../src/sms/application/sms-delivery.service';
import { OrangeOAuthClient } from '../src/sms/infrastructure/orange/orange-oauth-client';
import { OrangeSmsProvider } from '../src/sms/infrastructure/orange/orange-sms.provider';
import { OrangeMockServer } from '../src/sms/infrastructure/orange/testing/orange-mock-server';

describe('mocked Orange integration', () => {
  let server: OrangeMockServer;
  beforeEach(async () => { server = new OrangeMockServer(); await server.start(); });
  afterEach(async () => server.stop());

  it('acquires a token, retries, persists acceptance, and applies an optional receipt', async () => {
    const row: { id: string; status: SmsDeliveryStatus; acceptedAt: Date | null } = {
      id: 'delivery-1', status: SmsDeliveryStatus.PREPARED, acceptedAt: null,
    };
    const repository = {
      prepare: vi.fn().mockResolvedValue(row),
      markAccepted: vi.fn(async (_id, _messageId, acceptedAt) => { row.status = SmsDeliveryStatus.ACCEPTED; row.acceptedAt = acceptedAt; }),
      markFailed: vi.fn(),
      findReceiptTarget: vi.fn(async () => row),
      transitionReceipt: vi.fn(async (_id, expected, next) => {
        if (row.status !== expected) return { count: 0 };
        row.status = next;
        return { count: 1 };
      }),
    };
    const deliveries = new SmsDeliveryService(repository as never, { fingerprintPhone: () => ({ digest: 'f'.repeat(64) }) } as never);
    server.enqueueSms({ status: 503, body: { message: 'temporary failure' } });
    const oauth = new OrangeOAuthClient({ clientId: 'client', clientSecret: 'secret', oauthUrl: server.oauthUrl });
    const provider = deliveries.recorded(new OrangeSmsProvider(oauth, {
      apiUrl: server.apiUrl, senderAddress: 'tel:+2210000', senderName: 'KAYNANN',
      receiptCallbackUrl: 'https://callback.example.test/receipts',
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined },
    }));
    const result = await provider.send({
      recipientE164: '+221771234567', message: 'KAYNANN code: 123456. Valid for 5 minutes.',
      correlationId: '00000000-0000-4000-8000-000000000001',
    });
    expect(result).toMatchObject({ status: 'accepted', providerMessageId: 'mock-message-1' });
    expect(repository.prepare).toHaveBeenCalledOnce();
    expect(repository.markAccepted).toHaveBeenCalledOnce();
    expect(JSON.parse(server.requests.at(-1)!.body).outboundSMSMessageRequest.receiptRequest).toEqual({
      notifyURL: 'https://callback.example.test/receipts',
      callbackData: '00000000-0000-4000-8000-000000000001',
    });
    await expect(deliveries.applyReceipt('00000000-0000-4000-8000-000000000001', 'delivered')).resolves.toEqual({ known: true, changed: true });
    expect(row.status).toBe(SmsDeliveryStatus.DELIVERED);
  });
});
