import { AuthApi } from '../../mobile/src/api/auth-api';
import { missingSharedValue } from './missing-shared-module';
import { Stats } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

const unusedValue = dirname('/fixture/file.ts');

export const badly_named = missingSharedValue;
export type ForbiddenMobileImport = typeof AuthApi;
export type FixtureStats = Stats;

export function placeholderExample(unusedParameter: string, _allowedParameter: string): string {
    return _allowedParameter;
}

export function unsafeExample(value: any): string {
    const unsafeValue = value.payload;
    unsafeValue();
    placeholderExample(unsafeValue, 'allowed');
    return unsafeValue;
}

const alreadyTyped: string = 'already typed';
export const assertedValue = alreadyTyped as string;

export function unnecessaryGeneric<T>(value: T): string {
    return String(value);
}

async function loadFlag(): Promise<boolean> {
    return true;
}

loadFlag();

export async function redundantAwait(): Promise<boolean> {
    return await loadFlag();
}

export function promiseCondition(): string {
    if (loadFlag()) {
        return 'truthy';
    }

    return 'falsey';
}

export function unreachableFlow(): number {
    return 1;
    return 2;
}

export function duplicateFlow(value: 'first' | 'second'): number {
    if (value === 'first') {
        return 1;
    } else if (value === 'first') {
        return 2;
    }

    switch (value) {
        case 'second':
            return 3;
        case 'second':
            return 4;
    }
}

console.log(basename('/fixture/file.ts'));
