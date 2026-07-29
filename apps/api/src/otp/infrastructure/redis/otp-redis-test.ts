import { RedisScriptRunner } from '../../../infrastructure/redis/redis-script-runner';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export async function createOtpRedisTestContext(): Promise<{
  redis: RedisService;
  runner: RedisScriptRunner;
  close(): Promise<void>;
}> {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    MQTT_URL: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: process.env.MQTT_CLIENT_ID ?? 'otp-redis-test',
    OTP_HMAC_KEY: process.env.OTP_HMAC_KEY ?? secret,
    CREDENTIAL_HMAC_KEY: process.env.CREDENTIAL_HMAC_KEY ?? secret,
    FINGERPRINT_HMAC_KEY: process.env.FINGERPRINT_HMAC_KEY ?? secret,
    REGISTRATION_RESULT_ENCRYPTION_KEY:
      process.env.REGISTRATION_RESULT_ENCRYPTION_KEY ?? secret,
    JWT_ACCESS_SIGNING_KEY: process.env.JWT_ACCESS_SIGNING_KEY ?? secret,
  });
  const redis = new RedisService();
  await redis.onModuleInit();
  const keys = await redis.commandClient.keys('auth:otp:*');
  if (keys.length > 0) await redis.commandClient.del(keys);
  return {
    redis,
    runner: new RedisScriptRunner(redis),
    close: () => redis.onModuleDestroy(),
  };
}
