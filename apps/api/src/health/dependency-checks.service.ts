import { Inject, Injectable } from '@nestjs/common';
import mqtt from 'mqtt';

import { loadEnv } from '../config/env';
import { RedisService } from '../infrastructure/redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

export type DependencyName = 'postgres' | 'redis' | 'mqtt';

export interface DependencyStatus {
    status: 'up' | 'down';
    latencyMs?: number;
    errorCode?: string;
}

export type DependencyStatuses = Record<DependencyName, DependencyStatus>;

const PROBE_TIMEOUT_MS = 1500;

@Injectable()
export class DependencyChecksService {
    private readonly env = loadEnv();

    constructor(
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(RedisService) private readonly redis: RedisService,
    ) {}

    async checkAll(): Promise<DependencyStatuses> {
        const [postgres, redis, mqttStatus] = await Promise.all([
            this.check('postgres', () => this.checkPostgres()),
            this.check('redis', () => this.checkRedis()),
            this.check('mqtt', () => this.checkMqtt()),
        ]);

        return { postgres, redis, mqtt: mqttStatus };
    }

    private async check(name: DependencyName, operation: () => Promise<void>): Promise<DependencyStatus> {
        const startedAt = performance.now();

        try {
            await withTimeout(operation(), PROBE_TIMEOUT_MS);
            return {
                status: 'up',
                latencyMs: Math.round(performance.now() - startedAt),
            };
        } catch {
            return {
                status: 'down',
                errorCode: `${name.toUpperCase()}_UNAVAILABLE`,
            };
        }
    }

    private async checkPostgres(): Promise<void> {
        await this.prisma.$queryRawUnsafe('SELECT 1');
    }

    private async checkRedis(): Promise<void> {
        await this.redis.ping();
    }

    private async checkMqtt(): Promise<void> {
        const client = mqtt.connect(this.env.MQTT_URL, {
            clientId: this.env.MQTT_CLIENT_ID,
            connectTimeout: PROBE_TIMEOUT_MS,
            reconnectPeriod: 0,
        });

        try {
            await withTimeout(
                new Promise<void>((resolve, reject) => {
                    client.once('connect', () => resolve());
                    client.once('error', reject);
                }),
                PROBE_TIMEOUT_MS,
            );
        } finally {
            client.end(true);
        }
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('operation timed out')), timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
