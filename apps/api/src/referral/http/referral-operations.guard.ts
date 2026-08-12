import { createHash, timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { loadEnv } from '../../config/env';

@Injectable()
export class ReferralOperationsGuard implements CanActivate {
    private readonly expectedToken = loadEnv().REFERRAL_OPERATIONS_TOKEN ?? '';

    canActivate(context: ExecutionContext): boolean {
        const authorization = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
        }>().headers.authorization;
        const value = Array.isArray(authorization) ? authorization[0] : authorization;
        const suppliedToken = value?.startsWith('Bearer ') ? value.slice(7) : '';

        if (!safeTokenEqual(suppliedToken, this.expectedToken)) throw new UnauthorizedException();
        return true;
    }
}

export function safeTokenEqual(left: string, right: string): boolean {
    const leftDigest = createHash('sha256').update(left).digest();
    const rightDigest = createHash('sha256').update(right).digest();
    return left.length > 0 && right.length > 0 && timingSafeEqual(leftDigest, rightDigest);
}
