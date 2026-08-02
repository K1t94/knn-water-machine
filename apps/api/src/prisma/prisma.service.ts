import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit(): Promise<void> {
        // Let the health probe own connection timing so API startup cannot hang.
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
