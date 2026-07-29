import { afterEach, describe, expect, it } from 'vitest';

import { OrangeOAuthClient } from '../src/sms/infrastructure/orange/orange-oauth-client';
import { OrangeSmsProvider } from '../src/sms/infrastructure/orange/orange-sms.provider';
import { OrangeMockServer } from '../src/sms/infrastructure/orange/testing/orange-mock-server';

describe('Orange offline safety', () => {
  const servers: OrangeMockServer[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => server.stop())));

  it('executes the full adapter only against a loopback mock host', async () => {
    const server = new OrangeMockServer();
    servers.push(server);
    await server.start();
    const localOnlyFetch: typeof fetch = (input, init) => {
      const host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('External Orange network is forbidden in automated tests');
      return fetch(input, init);
    };
    const oauth = new OrangeOAuthClient({ clientId: 'not-live', clientSecret: 'not-live', oauthUrl: server.oauthUrl }, localOnlyFetch);
    const provider = new OrangeSmsProvider(oauth, {
      apiUrl: server.apiUrl, senderAddress: 'tel:+2210000', senderName: 'KAYNANN',
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    }, localOnlyFetch);
    await expect(provider.send({ recipientE164: '+221771234567', message: 'KAYNANN code: 000000. Valid for 5 minutes.', correlationId: '00000000-0000-4000-8000-000000000001' })).resolves.toMatchObject({ status: 'accepted' });
    expect(() => localOnlyFetch('https://api.orange.com/oauth/v3/token')).toThrow(/forbidden/);
  });
});
