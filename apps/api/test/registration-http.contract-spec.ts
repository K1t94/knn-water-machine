import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationService } from '../src/auth/application/registration.service';
import {
  RegistrationController,
} from '../src/auth/http/auth.controller';
import {
  RegistrationAuthorizationError,
  RegistrationAuthorizationStore,
} from '../src/auth/infrastructure/redis/registration-authorization.store';
import {
  LegalService,
  LegalVersionStaleError,
} from '../src/legal/application/legal.service';
import { LegalController } from '../src/legal/http/legal.controller';

const authorization = 'registration-authorization-token-with-enough-entropy';
const idempotencyKey = 'registration-attempt-0001';
const documentId = '00000000-0000-4000-8000-000000000001';
const credentials = {
  accessToken: 'access-token',
  accessExpiresAt: '2030-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshExpiresAt: '2030-03-01T00:00:00.000Z',
};

describe('registration HTTP contract', () => {
  let app: INestApplication;
  const registration = {
    updatePendingPromo: vi.fn(),
    complete: vi.fn(),
  };
  const registrations = { requireActive: vi.fn() };
  const legal = { currentMandatory: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    registration.updatePendingPromo.mockResolvedValue(undefined);
    registration.complete.mockResolvedValue(credentials);
    registrations.requireActive.mockResolvedValue({});
    legal.currentMandatory.mockResolvedValue({
      setVersion: 'set-v1',
      documents: [{
        id: documentId,
        kind: 'TERMS_OF_SERVICE',
        version: '1',
        locale: 'fr-SN',
        title: 'Conditions',
        content: 'Current terms',
        contentSha256: 'a'.repeat(64),
        mandatory: true,
      }],
    });
    const module = await Test.createTestingModule({
      controllers: [RegistrationController, LegalController],
      providers: [
        { provide: RegistrationService, useValue: registration },
        { provide: RegistrationAuthorizationStore, useValue: registrations },
        { provide: LegalService, useValue: legal },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }));
    await app.init();
  });

  afterEach(() => app.close());

  it('updates only pending promo context under registration authorization', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .patch('/v1/auth/registration/context')
      .set('x-registration-authorization', authorization)
      .send({ pendingPromoCode: 'PROMO-1' });

    expect(response.status).toBe(204);
    expect(registration.updatePendingPromo)
      .toHaveBeenCalledWith(authorization, 'PROMO-1');
    expect(response.text).toBe('');
  });

  it('returns the exact current legal set without internal storage fields', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .get('/v1/legal/documents/current')
      .set('x-registration-authorization', authorization);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      setVersion: 'set-v1',
      documents: [{
        id: documentId,
        kind: 'TERMS_OF_SERVICE',
        version: '1',
        title: 'Conditions',
        content: 'Current terms',
        contentSha256: 'a'.repeat(64),
        mandatory: true,
      }],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /phone|promo|token|installation|ipFingerprint/i,
    );
  });

  it('rejects legal retrieval without registration authorization before storage access', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .get('/v1/legal/documents/current');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('REGISTRATION_AUTH_INVALID');
    expect(registrations.requireActive).not.toHaveBeenCalled();
  });

  it('returns byte-equivalent credentials for a repeated idempotency key', async () => {
    const send = () => request(app.getHttpAdapter().getInstance())
      .post('/v1/auth/registration/complete')
      .set('x-registration-authorization', authorization)
      .set('idempotency-key', idempotencyKey)
      .send({
        setVersion: 'set-v1',
        acceptedDocumentIds: [documentId],
        installationId: 'installation-0001',
      });

    const [first, second] = await Promise.all([send(), send()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.text).toBe(second.text);
    expect(first.body).toEqual(credentials);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(registration.complete).toHaveBeenCalledTimes(2);
    expect(registration.complete).toHaveBeenCalledWith(expect.objectContaining({
      registrationAuthorization: authorization,
      idempotencyKey,
    }));
  });

  it('rejects missing authorization and malformed idempotency before work', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .post('/v1/auth/registration/complete')
      .set('idempotency-key', 'short')
      .send({
        setVersion: 'set-v1',
        acceptedDocumentIds: [documentId],
        installationId: 'installation-0001',
      });

    expect(response.status).toBe(401);
    expect(registration.complete).not.toHaveBeenCalled();
  });

  it('normalizes stale legal and conflicting completion errors', async () => {
    registration.complete
      .mockRejectedValueOnce(new LegalVersionStaleError())
      .mockRejectedValueOnce(
        new RegistrationAuthorizationError(
          'REGISTRATION_ALREADY_COMPLETING',
        ),
      );
    const send = (key: string) => request(app.getHttpAdapter().getInstance())
      .post('/v1/auth/registration/complete')
      .set('x-registration-authorization', authorization)
      .set('idempotency-key', key)
      .set('x-request-id', 'safe-request-id')
      .send({
        setVersion: 'set-v1',
        acceptedDocumentIds: [documentId],
        installationId: 'installation-0001',
      });

    const stale = await send('registration-attempt-stale');
    const conflict = await send('registration-attempt-conflict');

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('LEGAL_VERSION_STALE');
    expect(conflict.status).toBe(503);
    expect(conflict.body.error).toEqual(expect.objectContaining({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
      requestId: 'safe-request-id',
    }));
  });

  it('redacts unexpected dependency failures', async () => {
    registration.complete.mockRejectedValue(
      new Error('postgres password=do-not-expose'),
    );
    const response = await request(app.getHttpAdapter().getInstance())
      .post('/v1/auth/registration/complete')
      .set('x-registration-authorization', authorization)
      .set('idempotency-key', idempotencyKey)
      .send({
        setVersion: 'set-v1',
        acceptedDocumentIds: [documentId],
        installationId: 'installation-0001',
      });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('do-not-expose');
  });
});
