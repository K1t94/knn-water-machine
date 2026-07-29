import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTH_ERROR_CODES } from '../src/auth/http/auth-error-code';

type OpenApiOperation = {
  parameters?: Array<{ name?: string; required?: boolean }>;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
  };
};

const contractsDirectory = resolve(
  __dirname,
  '../../../specs/002-phone-otp-auth/contracts',
);
const generated = JSON.parse(
  readFileSync(resolve(contractsDirectory, 'openapi.generated.json'), 'utf8'),
) as OpenApiDocument;
const sourceContract = readFileSync(
  resolve(contractsDirectory, 'openapi.yaml'),
  'utf8',
);

const publicPaths = [
  '/v1/auth/otp/requests',
  '/v1/auth/otp/requests/{challengeId}/resend',
  '/v1/auth/otp/verifications',
  '/v1/auth/registration/context',
  '/v1/legal/documents/current',
  '/v1/auth/registration/complete',
  '/v1/auth/legal/acceptances',
  '/v1/auth/sessions/refresh',
  '/v1/auth/sessions/current',
  '/v1/integrations/orange/sms/delivery-receipts',
] as const;

function operation(path: string, method: string): OpenApiOperation {
  const result = generated.paths[path]?.[method];
  expect(result, `${method.toUpperCase()} ${path}`).toBeDefined();
  return result as OpenApiOperation;
}

describe('generated Phone OTP OpenAPI contract', () => {
  it('covers every source-contract endpoint without exposing internal metrics', () => {
    for (const path of publicPaths) {
      expect(generated.paths).toHaveProperty(path);
      expect(sourceContract).toContain(`  ${path}:`);
    }

    expect(generated.paths).not.toHaveProperty('/internal/metrics');
  });

  it('keeps status codes, authorization, and idempotency explicit', () => {
    expect(Object.keys(operation('/v1/auth/otp/requests', 'post').responses ?? {})).toEqual([
      '202',
      '400',
      '429',
      '503',
    ]);
    expect(
      Object.keys(operation('/v1/auth/otp/verifications', 'post').responses ?? {}),
    ).toEqual(['200', '400', '409', '429', '503']);

    for (const path of [
      '/v1/auth/registration/context',
      '/v1/legal/documents/current',
      '/v1/auth/registration/complete',
      '/v1/auth/legal/acceptances',
    ]) {
      const method = path.endsWith('/context') ? 'patch' : path.endsWith('/current') ? 'get' : 'post';
      expect(operation(path, method).security).toContainEqual({ RegistrationAuth: [] });
    }

    expect(operation('/v1/auth/sessions/current', 'delete').security).toContainEqual({
      AccessBearer: [],
    });

    for (const path of [
      '/v1/auth/registration/complete',
      '/v1/auth/legal/acceptances',
    ]) {
      expect(operation(path, 'post').parameters).toContainEqual(
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      );
    }

    expect(
      Object.keys(
        operation('/v1/integrations/orange/sms/delivery-receipts', 'post').responses ?? {},
      ),
    ).toEqual(['200', '400', '403', '404']);
  });

  it('documents no-store token responses and correct read/write token direction', () => {
    for (const [path, method] of [
      ['/v1/auth/otp/verifications', 'post'],
      ['/v1/auth/registration/complete', 'post'],
      ['/v1/auth/legal/acceptances', 'post'],
      ['/v1/auth/sessions/refresh', 'post'],
    ] as const) {
      const success = operation(path, method).responses?.['200'] as {
        headers?: Record<string, unknown>;
      };
      expect(success.headers).toHaveProperty('Cache-Control');
    }

    const credentials = generated.components.schemas.SessionCredentialsDto as {
      properties: Record<string, { writeOnly?: boolean }>;
      required: string[];
    };
    expect(credentials.required).toEqual([
      'accessToken',
      'accessExpiresAt',
      'refreshToken',
      'refreshExpiresAt',
    ]);
    expect(credentials.properties.accessToken.writeOnly).not.toBe(true);
    expect(credentials.properties.refreshToken.writeOnly).not.toBe(true);

    const refreshRequest = generated.components.schemas.RefreshSessionDto as {
      properties: Record<string, { writeOnly?: boolean }>;
    };
    expect(refreshRequest.properties.refreshToken.writeOnly).toBe(true);
  });

  it('publishes stable product errors without OTP or provider response fields', () => {
    const errorBody = generated.components.schemas.AuthErrorBodyDto as {
      properties: { code: { enum: string[] } };
    };
    expect(errorBody.properties.code.enum).toEqual(AUTH_ERROR_CODES);

    for (const schemaName of ['OtpIssuedResponseDto', 'OtpVerifiedResponseDto']) {
      const schema = generated.components.schemas[schemaName] as {
        properties?: Record<string, unknown>;
      };
      const fields = Object.keys(schema.properties ?? {}).map((field) => field.toLowerCase());
      expect(fields).not.toContain('code');
      expect(fields).not.toContain('otp');
      expect(fields).not.toContain('providermessageid');
      expect(fields).not.toContain('providerpayload');
    }
  });
});
