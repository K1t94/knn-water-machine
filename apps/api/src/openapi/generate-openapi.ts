import 'reflect-metadata';

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { RedisService } from '../infrastructure/redis/redis.service';

const SNAPSHOT_PATH = resolve(process.cwd(), '../../specs/005-referral-program/contracts/openapi.generated.json');
const toolingSecret = Buffer.alloc(32, 1).toString('base64url');

function configureToolingEnvironment(): void {
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
        REDIS_URL: 'redis://localhost:6379',
        MQTT_URL: 'mqtt://localhost:1883',
        MQTT_CLIENT_ID: 'openapi-generator',
        SMS_PROVIDER: 'fake',
        OTP_HMAC_KEY: toolingSecret,
        CREDENTIAL_HMAC_KEY: toolingSecret,
        FINGERPRINT_HMAC_KEY: toolingSecret,
        REGISTRATION_RESULT_ENCRYPTION_KEY: toolingSecret,
        JWT_ACCESS_SIGNING_KEY: toolingSecret,
    });
}

function stableJson(value: unknown): string {
    return `${JSON.stringify(sortForStableJson(value, new WeakSet<object>()), null, 2)}\n`;
}

function sortForStableJson(value: unknown, ancestors: WeakSet<object>): unknown {
    if (!value || typeof value !== 'object') return value;
    if (ancestors.has(value)) throw new Error('OpenAPI document contains a circular reference');

    ancestors.add(value);
    const sorted = Array.isArray(value)
        ? value.map((item) => sortForStableJson(item, ancestors))
        : Object.fromEntries(
              Object.entries(value)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([key, item]) => [key, sortForStableJson(item, ancestors)]),
          );
    ancestors.delete(value);
    return sorted;
}

async function generateDocument(): Promise<string> {
    configureToolingEnvironment();
    const { AppModule } = await import('../app.module');
    const testingModule = await Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(RedisService)
        .useValue({ ping: async () => undefined })
        .compile();
    const app = testingModule.createNestApplication({ logger: false });

    try {
        const config = new DocumentBuilder()
            .setTitle('KAYNANN API')
            .setDescription('Generated aggregate NestJS contract snapshot for drift detection.')
            .setVersion('0.1.0')
            .addServer('/api')
            .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'AccessBearer')
            .addApiKey(
                {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-Registration-Authorization',
                    description: 'Short-lived authorization that never grants application access.',
                },
                'RegistrationAuth',
            )
            .build();
        const document = SwaggerModule.createDocument(app, config, {
            operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
        });

        return stableJson(document);
    } finally {
        await app.close();
    }
}

async function main(): Promise<void> {
    const command = process.argv[2];
    if (command !== '--write' && command !== '--check') {
        throw new Error('Expected --write or --check');
    }

    const generated = await generateDocument();
    if (command === '--write') {
        await writeFile(SNAPSHOT_PATH, generated, 'utf8');
        return;
    }

    const snapshot = await readFile(SNAPSHOT_PATH, 'utf8').catch(() => '');
    if (snapshot !== generated) {
        throw new Error('Generated OpenAPI drift detected. Run pnpm openapi:generate.');
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'OpenAPI generation failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
