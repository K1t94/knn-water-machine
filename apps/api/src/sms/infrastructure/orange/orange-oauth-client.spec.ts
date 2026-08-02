import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrangeOAuthClient } from './orange-oauth-client';
import { orangeFixtures } from './testing/orange-fixtures';
import { OrangeMockServer } from './testing/orange-mock-server';

describe('OrangeOAuthClient', () => {
    let server: OrangeMockServer;
    beforeEach(async () => {
        server = new OrangeMockServer();
        await server.start();
    });
    afterEach(async () => server.stop());

    it('uses Basic credentials, caches with skew, and synchronizes refresh', async () => {
        let now = 0;
        const client = new OrangeOAuthClient(
            { clientId: 'client', clientSecret: 'secret', oauthUrl: server.oauthUrl, safetySkewSeconds: 30 },
            fetch,
            () => now,
        );
        expect(await Promise.all([client.getAccessToken(), client.getAccessToken(), client.getAccessToken()])).toEqual(
            Array(3).fill('local-orange-access-token'),
        );
        expect(server.requests).toHaveLength(1);
        expect(server.requests[0]?.headers.authorization).toBe(
            `Basic ${Buffer.from('client:secret').toString('base64')}`,
        );
        expect(server.requests[0]?.body).toBe('grant_type=client_credentials');
        now = 3_571_000;
        await client.getAccessToken();
        expect(server.requests).toHaveLength(2);
    });

    it('supports explicit invalidation and normalizes auth failure', async () => {
        const client = new OrangeOAuthClient({ clientId: 'client', clientSecret: 'secret', oauthUrl: server.oauthUrl });
        const token = await client.getAccessToken();
        client.invalidate(token);
        server.enqueueOAuth({ status: 401, body: orangeFixtures.oauthExpired });
        await expect(client.getAccessToken()).rejects.toMatchObject({ category: 'AUTHENTICATION_FAILED' });
    });

    it('rejects credentials over non-loopback HTTP', () => {
        expect(
            () =>
                new OrangeOAuthClient({
                    clientId: 'client',
                    clientSecret: 'secret',
                    oauthUrl: 'http://api.example.test/oauth/v3/token',
                }),
        ).toThrow(expect.objectContaining({ category: 'INVALID_CONFIGURATION' }));
    });
});
