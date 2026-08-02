import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import type { Response } from 'supertest';

type SupertestApp = Parameters<typeof request>[0];

export function httpServer(app: INestApplication): SupertestApp {
    return app.getHttpAdapter().getInstance() as SupertestApp;
}

export function responseBody(response: Response): unknown {
    return response.body as unknown;
}

export function responseRecord(response: Response): Record<string, unknown> {
    return asRecord(responseBody(response), 'response body');
}

export function asRecord(value: unknown, label = 'value'): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Expected ${label} to be an object`);
    }
    return value as Record<string, unknown>;
}

export function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = Reflect.get(record, key);
    if (typeof value !== 'string') throw new TypeError(`Expected response field ${key} to be a string`);
    return value;
}

export function requiredRecord(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
    const value: unknown = Reflect.get(record, key);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Expected response field ${key} to be an object`);
    }
    return value as Record<string, unknown>;
}

export function requiredArray(record: Readonly<Record<string, unknown>>, key: string): unknown[] {
    const value: unknown = Reflect.get(record, key);
    if (!Array.isArray(value)) throw new TypeError(`Expected response field ${key} to be an array`);
    return value;
}

export function configureTrustProxy(app: INestApplication, value: unknown): void {
    const instance: unknown = app.getHttpAdapter().getInstance();
    if (!instance || (typeof instance !== 'object' && typeof instance !== 'function')) {
        throw new TypeError('Expected an HTTP adapter instance');
    }
    const set: unknown = Reflect.get(instance, 'set');
    if (typeof set !== 'function') throw new TypeError('HTTP adapter does not support settings');
    Reflect.apply(set, instance, ['trust proxy', value]);
}
