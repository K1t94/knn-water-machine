import { z } from 'zod';

import { MAX_REFERRAL_MILLILITRES } from '../referral/domain/referral-types';

const deploymentEnvironments = ['development', 'test', 'staging', 'production'] as const;
const restrictedEnvironments = new Set<string>(['staging', 'production']);
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const positiveDecimalPattern = /^[1-9]\d*$/;
const localMachineCursorHmacKey = Buffer.alloc(32).toString('base64url');
const referralBonusDefaults = {
    REFERRAL_INVITER_BONUS_ML: 5_000n,
} as const;

function decodedBase64UrlBytes(value: string): number {
    if (!base64UrlPattern.test(value)) {
        return -1;
    }

    try {
        return Buffer.from(value, 'base64url').byteLength;
    } catch {
        return -1;
    }
}

function base64UrlSecret(minimumBytes: number): z.ZodType<string> {
    return z
        .string()
        .trim()
        .refine(
            (value) => decodedBase64UrlBytes(value) >= minimumBytes,
            `must be base64url encoding of at least ${minimumBytes} bytes`,
        );
}

function exactBase64UrlSecret(bytes: number): z.ZodType<string> {
    return z
        .string()
        .trim()
        .refine(
            (value) => decodedBase64UrlBytes(value) === bytes,
            `must be base64url encoding of exactly ${bytes} bytes`,
        );
}

const booleanFromEnv = z.preprocess((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}, z.boolean());

const optionalTrimmedString = z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());

const optionalBase64UrlSecret = (minimumBytes: number) =>
    z.preprocess((value) => (value === '' ? undefined : value), base64UrlSecret(minimumBytes).optional());

const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        APP_ENV: z.enum(deploymentEnvironments).default('development'),
        API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
        TRUSTED_PROXY_IPS: z.string().trim().default(''),
        DATABASE_URL: z.string().url(),
        REDIS_URL: z.string().url(),
        MQTT_URL: z.string().url(),
        MQTT_CLIENT_ID: z.string().trim().min(1).max(128),

        OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
        OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
        OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
        OTP_HMAC_KEY_VERSION: z.string().trim().min(1).default('v1'),
        OTP_HMAC_KEY: base64UrlSecret(32),
        CREDENTIAL_HMAC_KEY_VERSION: z.string().trim().min(1).default('v1'),
        CREDENTIAL_HMAC_KEY: base64UrlSecret(32),
        FINGERPRINT_HMAC_KEY_VERSION: z.string().trim().min(1).default('v1'),
        FINGERPRINT_HMAC_KEY: base64UrlSecret(32),
        REGISTRATION_RESULT_KEY_VERSION: z.string().trim().min(1).default('v1'),
        REGISTRATION_RESULT_ENCRYPTION_KEY: exactBase64UrlSecret(32),
        REGISTRATION_AUTH_TTL_SECONDS: z.coerce.number().int().positive().default(900),
        JWT_ACCESS_KEY_VERSION: z.string().trim().min(1).default('v1'),
        JWT_ACCESS_SIGNING_KEY: base64UrlSecret(32),
        ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(900),
        SESSION_TTL_DAYS: z.coerce.number().int().positive().default(60),

        REFERRAL_INVITER_BONUS_ML: optionalTrimmedString,
        REFERRAL_OPERATIONS_TOKEN: optionalBase64UrlSecret(32),

        MACHINE_CURSOR_HMAC_KEY: base64UrlSecret(32).default(localMachineCursorHmacKey),
        MACHINE_CURSOR_TTL_SECONDS: z.coerce.number().int().positive().default(300),
        MACHINE_AVAILABILITY_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(60),
        MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(5),
        MACHINE_SERVICE_AREA_NORTH: z.coerce.number().min(-90).max(90).default(56.1),
        MACHINE_SERVICE_AREA_EAST: z.coerce.number().min(-180).max(180).default(38.2),
        MACHINE_SERVICE_AREA_SOUTH: z.coerce.number().min(-90).max(90).default(55.4),
        MACHINE_SERVICE_AREA_WEST: z.coerce.number().min(-180).max(180).default(36.7),
        MACHINE_GATEWAY_MODE: z.enum(['disabled', 'emulator']).default('disabled'),
        MACHINE_FIXTURE_MODE: booleanFromEnv.default(false),
        MACHINE_LEGACY_QR_ENABLED: booleanFromEnv.default(false),

        OTP_SENDS_PER_PHONE_HOUR: z.coerce.number().int().positive().default(3),
        OTP_SENDS_PER_PHONE_DAY: z.coerce.number().int().positive().default(6),
        OTP_SENDS_PER_IP_HOUR: z.coerce.number().int().positive().default(20),
        OTP_SENDS_PER_INSTALLATION_HOUR: z.coerce.number().int().positive().default(10),
        OTP_SENDS_PER_INSTALLATION_DAY: z.coerce.number().int().positive().default(20),
        OTP_EXHAUSTED_CHALLENGES_PER_DAY: z.coerce.number().int().positive().default(3),
        OTP_PHONE_BLOCK_SECONDS: z.coerce.number().int().positive().default(1800),
        OTP_MAX_PARALLEL_SENDS_GLOBAL: z.coerce.number().int().positive().default(5),
        SMS_MAX_SENDS_PER_SECOND: z.coerce.number().int().positive().default(5),
        SMS_DAILY_COUNT_LIMIT: z.coerce.number().int().positive().default(500),
        SMS_ESTIMATED_UNIT_COST_XOF: z.coerce.number().int().positive().default(20),
        SMS_DAILY_XOF_LIMIT: z.coerce.number().int().positive().default(10_000),
        SMS_DAILY_COUNT_WARNING_PERCENT: z.coerce.number().int().default(80),
        SMS_DAILY_COUNT_CRITICAL_PERCENT: z.coerce.number().int().default(95),
        SMS_DAILY_XOF_WARNING_PERCENT: z.coerce.number().int().default(80),
        SMS_DAILY_XOF_CRITICAL_PERCENT: z.coerce.number().int().default(95),

        SMS_PROVIDER: z.enum(['fake', 'orange']).default('fake'),
        FAKE_SMS_EXPOSE_OTP: booleanFromEnv.default(false),
        FAKE_SMS_TEST_NUMBERS: z.string().trim().default(''),
        ORANGE_SMS_CLIENT_ID: optionalTrimmedString,
        ORANGE_SMS_CLIENT_SECRET: optionalTrimmedString,
        ORANGE_SMS_SENDER_ADDRESS: optionalTrimmedString,
        ORANGE_SMS_SENDER_NAME: optionalTrimmedString,
        ORANGE_SMS_API_URL: optionalUrl,
        ORANGE_SMS_OAUTH_URL: optionalUrl,
        ORANGE_SMS_DR_ENABLED: booleanFromEnv.default(false),
        ORANGE_SMS_DR_CALLBACK_URL: optionalUrl,
        ORANGE_SMS_DR_ALLOWED_IPS: z.string().trim().default(''),

        INTERNAL_METRICS_ENABLED: booleanFromEnv.default(false),
        INTERNAL_METRICS_TOKEN: optionalBase64UrlSecret(32),
    })
    .superRefine((env, context) => {
        for (const field of ['REFERRAL_INVITER_BONUS_ML'] as const) {
            const value = env[field];
            if (restrictedEnvironments.has(env.APP_ENV) && value === undefined) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: 'is required in staging and production',
                });
                continue;
            }

            if (
                value !== undefined &&
                (!positiveDecimalPattern.test(value) || BigInt(value) > MAX_REFERRAL_MILLILITRES)
            ) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: `must be a positive whole millilitre value not exceeding ${MAX_REFERRAL_MILLILITRES}`,
                });
            }
        }

        if (restrictedEnvironments.has(env.APP_ENV) && !env.REFERRAL_OPERATIONS_TOKEN) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['REFERRAL_OPERATIONS_TOKEN'],
                message: 'is required in staging and production',
            });
        }

        if (env.MACHINE_SERVICE_AREA_NORTH <= env.MACHINE_SERVICE_AREA_SOUTH) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['MACHINE_SERVICE_AREA_NORTH'],
                message: 'must be greater than MACHINE_SERVICE_AREA_SOUTH',
            });
        }

        if (env.MACHINE_SERVICE_AREA_EAST <= env.MACHINE_SERVICE_AREA_WEST) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['MACHINE_SERVICE_AREA_WEST'],
                message: 'must be less than MACHINE_SERVICE_AREA_EAST',
            });
        }

        const restrictedMachineModes = [
            ['MACHINE_GATEWAY_MODE', env.MACHINE_GATEWAY_MODE === 'emulator'],
            ['MACHINE_FIXTURE_MODE', env.MACHINE_FIXTURE_MODE],
            ['MACHINE_LEGACY_QR_ENABLED', env.MACHINE_LEGACY_QR_ENABLED],
        ] as const;

        if (restrictedEnvironments.has(env.APP_ENV)) {
            for (const [field, enabled] of restrictedMachineModes) {
                if (enabled) {
                    context.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [field],
                        message: 'is forbidden in staging and production',
                    });
                }
            }
        }

        if (restrictedEnvironments.has(env.APP_ENV) && env.SMS_PROVIDER === 'fake') {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['SMS_PROVIDER'],
                message: 'fake provider is forbidden in staging and production',
            });
        }

        if (env.FAKE_SMS_EXPOSE_OTP && !['development', 'test'].includes(env.APP_ENV)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['FAKE_SMS_EXPOSE_OTP'],
                message: 'OTP exposure is allowed only in development and test',
            });
        }

        if (env.SMS_PROVIDER === 'orange') {
            const requiredOrangeFields = [
                'ORANGE_SMS_CLIENT_ID',
                'ORANGE_SMS_CLIENT_SECRET',
                'ORANGE_SMS_SENDER_ADDRESS',
                'ORANGE_SMS_SENDER_NAME',
                'ORANGE_SMS_API_URL',
                'ORANGE_SMS_OAUTH_URL',
            ] as const;

            for (const field of requiredOrangeFields) {
                if (!env[field]) {
                    context.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [field],
                        message: 'is required when SMS_PROVIDER=orange',
                    });
                }
            }
        }

        if (env.ORANGE_SMS_DR_ENABLED) {
            for (const field of ['ORANGE_SMS_DR_CALLBACK_URL', 'ORANGE_SMS_DR_ALLOWED_IPS'] as const) {
                if (!env[field]) {
                    context.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [field],
                        message: 'is required when Delivery Receipt is enabled',
                    });
                }
            }
        }

        const percentagePairs = [
            ['SMS_DAILY_COUNT_WARNING_PERCENT', 'SMS_DAILY_COUNT_CRITICAL_PERCENT'],
            ['SMS_DAILY_XOF_WARNING_PERCENT', 'SMS_DAILY_XOF_CRITICAL_PERCENT'],
        ] as const;

        for (const [warningField, criticalField] of percentagePairs) {
            const warning = env[warningField];
            const critical = env[criticalField];
            if (warning <= 0 || critical >= 100 || warning >= critical) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [warningField],
                    message: 'must satisfy 0 < warning < critical < 100',
                });
            }
        }

        if (restrictedEnvironments.has(env.APP_ENV) && env.INTERNAL_METRICS_ENABLED && !env.INTERNAL_METRICS_TOKEN) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['INTERNAL_METRICS_TOKEN'],
                message: 'is required when metrics are enabled in staging or production',
            });
        }
    })
    .transform((env) => ({
        ...env,
        REFERRAL_INVITER_BONUS_ML:
            env.REFERRAL_INVITER_BONUS_ML === undefined
                ? referralBonusDefaults.REFERRAL_INVITER_BONUS_ML
                : BigInt(env.REFERRAL_INVITER_BONUS_ML),
    }));

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
    const result = envSchema.safeParse(source);

    if (!result.success) {
        const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
        throw new Error(`Invalid environment configuration: ${fields}`);
    }

    return result.data;
}

export function getRedactedEnvDiagnostics(env: AppEnv): Record<string, string | number> {
    return {
        nodeEnv: env.NODE_ENV,
        appEnv: env.APP_ENV,
        apiPort: env.API_PORT,
        database: 'configured',
        redis: 'configured',
        mqtt: 'configured',
        smsProvider: env.SMS_PROVIDER,
    };
}
