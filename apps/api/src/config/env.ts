import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MQTT_URL: z.string().url(),
  MQTT_CLIENT_ID: z.string().trim().min(1).max(128),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  return result.data;
}

export function getRedactedEnvDiagnostics(env: AppEnv): Record<string, string | number> {
  return {
    nodeEnv: env.NODE_ENV,
    apiPort: env.API_PORT,
    database: 'configured',
    redis: 'configured',
    mqtt: 'configured',
  };
}
