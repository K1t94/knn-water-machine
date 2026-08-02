import { Test } from '@nestjs/testing';
import { SmsDeliveryStatus } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SmsDeliveryService, type SmsDeliveryPersistence } from '../src/sms/application/sms-delivery.service';
import { OrangeDeliveryReceiptController } from '../src/sms/infrastructure/orange/orange-delivery-receipt.controller';
import { orangeFixtures } from '../src/sms/infrastructure/orange/testing/orange-fixtures';

import type { INestApplication } from '@nestjs/common';

const secret = Buffer.alloc(32, 7).toString('base64url');
const applyReceipt = vi.fn().mockResolvedValue({ known: false, changed: false });

describe('disabled Orange Delivery Receipt', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('returns not found before touching delivery state', async () => {
        configure({ ORANGE_SMS_DR_ENABLED: 'false' });
        const controller = new OrangeDeliveryReceiptController({ applyReceipt } as never);
        await expect(controller.receive({} as never, orangeFixtures.receiptDelivered as never)).rejects.toMatchObject({
            status: 404,
        });
        expect(applyReceipt).not.toHaveBeenCalled();
    });
});

describe('Orange Delivery Receipt HTTP contract', () => {
    let app: INestApplication;
    beforeEach(async () => {
        configure({ ORANGE_SMS_DR_ENABLED: 'true' });
        const module = await Test.createTestingModule({
            controllers: [OrangeDeliveryReceiptController],
            providers: [{ provide: SmsDeliveryService, useValue: { applyReceipt } }],
        }).compile();
        app = module.createNestApplication();
        app.getHttpAdapter().getInstance().set('trust proxy', ['127.0.0.1']);
        await app.init();
    });
    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it('validates source network, HTTPS, and schema', async () => {
        await request(app.getHttpAdapter().getInstance())
            .post('/v1/integrations/orange/sms/delivery-receipts')
            .set('x-forwarded-proto', 'https')
            .send(orangeFixtures.receiptDelivered)
            .expect(200);
        expect(applyReceipt).toHaveBeenCalledWith('mock-message-1', 'delivered');

        await request(app.getHttpAdapter().getInstance())
            .post('/v1/integrations/orange/sms/delivery-receipts')
            .set('x-forwarded-for', '198.51.100.20')
            .set('x-forwarded-proto', 'https')
            .send(orangeFixtures.receiptDelivered)
            .expect(403);

        await request(app.getHttpAdapter().getInstance())
            .post('/v1/integrations/orange/sms/delivery-receipts')
            .set('x-forwarded-proto', 'https')
            .send({
                deliveryInfoNotification: {
                    callbackData: 'x',
                    deliveryInfo: { address: 'full-number', deliveryStatus: 'invented' },
                },
            })
            .expect(400);
        await request(app.getHttpAdapter().getInstance())
            .post('/v1/integrations/orange/sms/delivery-receipts')
            .send(orangeFixtures.receiptDelivered)
            .expect(403);
    });
});

describe('Orange Delivery Receipt state machine', () => {
    it('acknowledges unknown IDs and makes duplicate or late terminal events no-ops without OTP access', async () => {
        let record: { id: string; status: SmsDeliveryStatus; acceptedAt: Date | null } | null = null;
        const persistence: SmsDeliveryPersistence = {
            prepare: vi.fn(),
            markAccepted: vi.fn(),
            markFailed: vi.fn(),
            findReceiptTarget: vi.fn(async () => record),
            transitionReceipt: vi.fn(async (_id, expected, next) => {
                if (!record || record.status !== expected) return { count: 0 };
                record.status = next;
                return { count: 1 };
            }),
        };
        const service = new SmsDeliveryService(persistence, {} as never);
        await expect(service.applyReceipt('unknown', 'delivered')).resolves.toEqual({ known: false, changed: false });
        record = { id: 'delivery-1', status: SmsDeliveryStatus.ACCEPTED, acceptedAt: new Date() };
        await expect(service.applyReceipt('challenge-1', 'delivered')).resolves.toEqual({ known: true, changed: true });
        await expect(service.applyReceipt('challenge-1', 'delivered')).resolves.toEqual({
            known: true,
            changed: false,
        });
        await expect(service.applyReceipt('challenge-1', 'uncertain')).resolves.toEqual({
            known: true,
            changed: false,
        });
    });
});

function configure(overrides: Record<string, string>): void {
    const env = {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'receipt-test',
        OTP_HMAC_KEY: secret,
        CREDENTIAL_HMAC_KEY: secret,
        FINGERPRINT_HMAC_KEY: secret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: secret,
        JWT_ACCESS_SIGNING_KEY: secret,
        SMS_PROVIDER: 'fake',
        ORANGE_SMS_DR_CALLBACK_URL: 'https://callback.example.test/v1/integrations/orange/sms/delivery-receipts',
        ORANGE_SMS_DR_ALLOWED_IPS: '127.0.0.1',
        ...overrides,
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}
