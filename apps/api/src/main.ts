import 'reflect-metadata';
import { resolve } from 'node:path';

import * as dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { authRequestContext } from './auth/http/auth-request-context.middleware';
import { RedactedExceptionFilter } from './common/redacted-exception.filter';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  const trustedProxies = env.TRUSTED_PROXY_IPS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies);
  app.use(authRequestContext(env));

  app.useGlobalPipes(new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }));
  app.useGlobalFilters(new RedactedExceptionFilter());
  if (env.APP_ENV === 'development') {
    app.enableCors({
      origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    });
  }
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
