import { SmsProviderError } from '../../application/sms-error';
import { smsProviderContract } from '../../testing/sms-provider.contract';

import { OrangeOAuthClient } from './orange-oauth-client';
import { OrangeSmsProvider } from './orange-sms.provider';

const command = {
    recipientE164: '+221771234567',
    message: 'KAYNANN code: 123456. Valid for 5 minutes.',
    correlationId: '00000000-0000-4000-8000-000000000001',
};

smsProviderContract('Orange', () => {
    let fail = false;
    const http = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/oauth')) {
            return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'token', expires_in: 3600 }), {
                status: 200,
            });
        }
        if (fail) return new Response(JSON.stringify({ message: 'service unavailable' }), { status: 503 });
        return new Response(
            JSON.stringify({ outboundSMSMessageRequest: { resourceURL: 'https://api.orange.com/requests/id-1' } }),
            { status: 201 },
        );
    };
    const oauth = new OrangeOAuthClient(
        { clientId: 'client', clientSecret: 'secret', oauthUrl: 'https://local.test/oauth' },
        http,
    );
    const provider = new OrangeSmsProvider(
        oauth,
        {
            apiUrl: 'https://local.test/smsmessaging/v1',
            senderAddress: 'tel:+2210000',
            senderName: 'KAYNANN',
            retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
        },
        http,
    );
    return {
        provider,
        command,
        expectedName: 'orange',
        deliverySupported: true,
        arrangeStableFailure: () => {
            fail = true;
            return new SmsProviderError('TEMPORARY_PROVIDER_FAILURE', true);
        },
    };
});
