export const orangeFixtures = {
    oauthSuccess: {
        token_type: 'Bearer',
        access_token: 'local-orange-access-token',
        expires_in: '3600',
    },
    oauthExpired: { code: 42, message: 'Expired credentials' },
    smsAccepted: {
        outboundSMSMessageRequest: {
            resourceURL: 'https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2210000/requests/mock-message-1',
        },
    },
    receiptDelivered: {
        deliveryInfoNotification: {
            callbackData: 'mock-message-1',
            deliveryInfo: {
                address: 'tel:+221771234567',
                deliveryStatus: 'DeliveredToTerminal',
            },
        },
    },
} as const;
