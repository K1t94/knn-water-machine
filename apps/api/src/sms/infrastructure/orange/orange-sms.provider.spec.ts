import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrangeOAuthClient } from './orange-oauth-client';
import { OrangeSmsProvider } from './orange-sms.provider';
import { OrangeMockServer } from './testing/orange-mock-server';

const command = {
  recipientE164: '+221771234567',
  message: 'KAYNANN code: 123456. Valid for 5 minutes.',
  correlationId: '00000000-0000-4000-8000-000000000001',
};

describe('OrangeSmsProvider', () => {
  let server: OrangeMockServer;
  beforeEach(async () => { server = new OrangeMockServer(); await server.start(); });
  afterEach(async () => server.stop());

  it('uses the official sender path and private outbound shape', async () => {
    const provider = createProvider(server);
    const result = await provider.send(command);
    const request = server.requests[1]!;
    expect(request.url).toBe('/smsmessaging/v1/outbound/tel%3A%2B2210000/requests');
    expect(JSON.parse(request.body)).toEqual({
      outboundSMSMessageRequest: {
        address: 'tel:+221771234567',
        senderAddress: 'tel:+2210000',
        senderName: 'KAYNANN',
        outboundSMSTextMessage: { message: command.message },
      },
    });
    expect(result).toEqual({
      status: 'accepted',
      providerMessageId: 'mock-message-1',
      acceptedAt: new Date('2026-07-29T12:00:00Z'),
    });
    expect(result).not.toHaveProperty('outboundSMSMessageRequest');
  });

  it('refreshes an expired bearer once and rejects malformed success', async () => {
    server.enqueueSms({ status: 401, body: { code: 42, message: 'Expired credentials' } });
    const provider = createProvider(server);
    await expect(provider.send(command)).resolves.toMatchObject({ status: 'accepted' });
    expect(server.requests.filter((request) => request.url === '/oauth/v3/token')).toHaveLength(2);

    server.enqueueSms({ status: 201, body: {} });
    await expect(provider.send(command)).rejects.toMatchObject({ category: 'TEMPORARY_PROVIDER_FAILURE' });
  });

  it('rejects insecure remote API and receipt URLs', () => {
    const oauth = new OrangeOAuthClient({ clientId: 'client', clientSecret: 'secret', oauthUrl: server.oauthUrl });
    expect(() => new OrangeSmsProvider(oauth, {
      apiUrl: 'http://api.example.test/smsmessaging/v1',
      senderAddress: 'tel:+2210000',
      senderName: 'KAYNANN',
    })).toThrow(expect.objectContaining({ category: 'INVALID_CONFIGURATION' }));
    expect(() => new OrangeSmsProvider(oauth, {
      apiUrl: server.apiUrl,
      senderAddress: 'tel:+2210000',
      senderName: 'KAYNANN',
      receiptCallbackUrl: 'http://callback.example.test/receipts',
    })).toThrow(expect.objectContaining({ category: 'INVALID_CONFIGURATION' }));
  });
});

function createProvider(server: OrangeMockServer): OrangeSmsProvider {
  const oauth = new OrangeOAuthClient({ clientId: 'client', clientSecret: 'secret', oauthUrl: server.oauthUrl });
  return new OrangeSmsProvider(oauth, {
    apiUrl: server.apiUrl,
    senderAddress: 'tel:+2210000',
    senderName: 'KAYNANN',
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  }, fetch, () => new Date('2026-07-29T12:00:00Z'));
}
