import { createHash, timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { loadEnv } from '../config/env';

@Injectable()
export class InternalMetricsGuard implements CanActivate {
    private readonly env = loadEnv();

    canActivate(context: ExecutionContext): boolean {
        if (!this.env.INTERNAL_METRICS_ENABLED) throw new NotFoundException();
        const authorization = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
        }>().headers.authorization;
        const value = Array.isArray(authorization) ? authorization[0] : authorization;
        const supplied = value?.startsWith('Bearer ') ? value.slice(7) : '';
        const expected = this.env.INTERNAL_METRICS_TOKEN ?? '';
        if (!safeEqual(supplied, expected)) throw new UnauthorizedException();
        return true;
    }
}

function safeEqual(left: string, right: string): boolean {
    const leftDigest = createHash('sha256').update(left).digest();
    const rightDigest = createHash('sha256').update(right).digest();
    return left.length > 0 && right.length > 0 && timingSafeEqual(leftDigest, rightDigest);
}
