import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const apiRequire = createRequire(resolve(process.cwd(), 'apps/api/package.json'));
apiRequire('reflect-metadata');
const dotenv = apiRequire('dotenv');

dotenv.config({ path: resolve(process.cwd(), 'apps/api/.env') });

const OTP_IDENTITIES = 200;
const OTP_CONCURRENCY = 10;
const REFRESH_SESSIONS = 500;
const REFRESH_CONCURRENCY = 20;
const AUTH_P95_LIMIT_MS = 500;
const REFRESH_P95_LIMIT_MS = 300;
const runId = `${Date.now()}-${process.pid}`;
const otpPhones = Array.from(
  { length: OTP_IDENTITIES },
  (_, index) => `+22178${String(1_000_000 + index)}`,
);
const refreshPhones = Array.from(
  { length: REFRESH_SESSIONS },
  (_, index) => `+22179${String(2_000_000 + index)}`,
);

configureEnvironment();

const { ValidationPipe } = apiRequire('@nestjs/common');
const { NestFactory } = apiRequire('@nestjs/core');
const { AppModule } = apiRequire('./dist/app.module.js');
const { authRequestContext } = apiRequire(
  './dist/auth/http/auth-request-context.middleware.js',
);
const { RedactedExceptionFilter } = apiRequire(
  './dist/common/redacted-exception.filter.js',
);
const { loadEnv } = apiRequire('./dist/config/env.js');
const { PrismaService } = apiRequire('./dist/prisma/prisma.service.js');
const { SessionsService } = apiRequire(
  './dist/sessions/application/sessions.service.js',
);
const { FakeSmsOutbox } = apiRequire(
  './dist/sms/infrastructure/fake/fake-sms.outbox.js',
);

let app;
let prisma;
const challengeIds = [];

try {
  const env = loadEnv();
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(authRequestContext(env));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new RedactedExceptionFilter());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine the local performance server port.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);
  const sessions = app.get(SessionsService);
  const outbox = app.get(FakeSmsOutbox);

  await cleanupDatabase(prisma);

  const otpRequest = createMeasurement('otp_request');
  const otpVerification = createMeasurement('otp_verification');
  await mapConcurrent(otpPhones, OTP_CONCURRENCY, async (phone, index) => {
    const installationId = `phase8-perf-otp-${runId}-${index}`;
    const issued = await measureHttp(otpRequest, () =>
      postJson(baseUrl, '/v1/auth/otp/requests', { phone, installationId }),
    );
    challengeIds.push(issued.challengeId);
    const code = outbox.latestFor(phone)?.otp;
    if (!code) {
      throw new Error(`Fake SMS inspection is unavailable for identity ${index}.`);
    }
    const verified = await measureHttp(otpVerification, () =>
      postJson(baseUrl, '/v1/auth/otp/verifications', {
        challengeId: issued.challengeId,
        phone,
        code,
        installationId,
      }),
    );
    if (verified.nextStep !== 'completeRegistration') {
      throw new Error(`Unexpected OTP next step: ${String(verified.nextStep)}`);
    }
  });

  await prisma.user.createMany({
    data: refreshPhones.map((phoneE164) => ({
      phoneE164,
      phoneConfirmedAt: new Date(),
    })),
    skipDuplicates: true,
  });
  const users = await prisma.user.findMany({
    where: { phoneE164: { in: refreshPhones } },
    select: { id: true, phoneE164: true },
  });
  const userByPhone = new Map(users.map((user) => [user.phoneE164, user.id]));
  const refreshTokens = await mapConcurrent(
    refreshPhones,
    REFRESH_CONCURRENCY,
    async (phone, index) => {
      const userId = userByPhone.get(phone);
      if (!userId) throw new Error(`Missing refresh test user ${index}.`);
      const credentials = await sessions.issueForUser({
        userId,
        installationId: `phase8-perf-refresh-${runId}-${index}`,
        creationContext: `phase8-performance:${runId}:${index}`,
      });
      return credentials.refreshToken;
    },
  );

  const sessionRefresh = createMeasurement('session_refresh');
  await mapConcurrent(refreshTokens, REFRESH_CONCURRENCY, async (refreshToken) => {
    await measureHttp(sessionRefresh, () =>
      postJson(baseUrl, '/v1/auth/sessions/refresh', { refreshToken }),
    );
  });

  const results = [otpRequest, otpVerification, sessionRefresh].map(summarize);
  console.table(results);

  const failures = results.filter((result) =>
    result.errorRate > 0 ||
    result.p95Ms > (result.operation === 'session_refresh'
      ? REFRESH_P95_LIMIT_MS
      : AUTH_P95_LIMIT_MS),
  );
  if (failures.length > 0) {
    throw new Error(
      `Performance thresholds failed: ${failures.map((item) => item.operation).join(', ')}`,
    );
  }
} finally {
  if (prisma) await cleanupDatabase(prisma).catch(() => undefined);
  if (app) await app.close();
}

function configureEnvironment() {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'development',
    SMS_PROVIDER: 'fake',
    FAKE_SMS_EXPOSE_OTP: 'true',
    FAKE_SMS_TEST_NUMBERS: otpPhones.join(','),
    OTP_HMAC_KEY: process.env.OTP_HMAC_KEY ?? secret,
    CREDENTIAL_HMAC_KEY: process.env.CREDENTIAL_HMAC_KEY ?? secret,
    FINGERPRINT_HMAC_KEY: process.env.FINGERPRINT_HMAC_KEY ?? secret,
    REGISTRATION_RESULT_ENCRYPTION_KEY:
      process.env.REGISTRATION_RESULT_ENCRYPTION_KEY ?? secret,
    JWT_ACCESS_SIGNING_KEY: process.env.JWT_ACCESS_SIGNING_KEY ?? secret,
    OTP_RESEND_COOLDOWN_SECONDS: '1',
    OTP_SENDS_PER_PHONE_HOUR: '10',
    OTP_SENDS_PER_PHONE_DAY: '10',
    OTP_SENDS_PER_IP_HOUR: '10000',
    OTP_SENDS_PER_INSTALLATION_HOUR: '10',
    OTP_SENDS_PER_INSTALLATION_DAY: '10',
    OTP_MAX_PARALLEL_SENDS_GLOBAL: '100',
    SMS_MAX_SENDS_PER_SECOND: '10000',
    SMS_DAILY_COUNT_LIMIT: '1000000',
    SMS_DAILY_XOF_LIMIT: '1000000000',
  });
}

function createMeasurement(operation) {
  return { operation, durations: [], errors: 0, total: 0 };
}

async function measureHttp(measurement, operation) {
  measurement.total += 1;
  const startedAt = performance.now();
  try {
    return await operation();
  } catch (error) {
    measurement.errors += 1;
    throw error;
  } finally {
    measurement.durations.push(performance.now() - startedAt);
  }
}

function summarize(measurement) {
  const values = [...measurement.durations].sort((left, right) => left - right);
  return {
    operation: measurement.operation,
    samples: measurement.total,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    errorRate: Number((measurement.errors / measurement.total).toFixed(4)),
  };
}

function percentile(values, quantile) {
  const index = Math.max(0, Math.ceil(values.length * quantile) - 1);
  return Number(values[index].toFixed(2));
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(items[index], index);
      }
    }),
  );
  return results;
}

async function cleanupDatabase(client) {
  const users = await client.user.findMany({
    where: { phoneE164: { in: refreshPhones } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    const sessions = await client.userSession.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    await client.sessionRefreshToken.deleteMany({
      where: { sessionId: { in: sessions.map((session) => session.id) } },
    });
    await client.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (challengeIds.length > 0) {
    await client.smsDelivery.deleteMany({
      where: { challengeId: { in: challengeIds } },
    });
  }
}
