import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

import { loadEnv } from '../../config/env';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly client: RedisClientType;

    constructor() {
        const env = loadEnv();
        this.client = createClient({
            url: env.REDIS_URL,
            socket: { connectTimeout: 1_500 },
        });
        this.client.on('error', () => undefined);
    }

    async onModuleInit(): Promise<void> {
        try {
            await this.client.connect();
            await this.client.ping();
        } catch {
            await this.disconnect();
            throw new ServiceUnavailableException('Required transient store is unavailable');
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.disconnect();
    }

    async ping(): Promise<void> {
        await this.client.ping();
    }

    get commandClient(): RedisClientType {
        if (!this.client.isReady) {
            throw new ServiceUnavailableException('Required transient store is unavailable');
        }
        return this.client;
    }

    private async disconnect(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.quit().catch(() => this.client.destroy());
        }
    }
}
