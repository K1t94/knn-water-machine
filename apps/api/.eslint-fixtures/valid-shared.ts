import type { Stats } from 'node:fs';

export function sizeOf(stats: Stats, _source?: string): number {
    return stats.size;
}

export async function handledPromise(): Promise<boolean> {
    const result = await Promise.resolve(true);
    return result;
}
