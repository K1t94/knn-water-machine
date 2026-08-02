import { createHash } from 'node:crypto';

import type { RandomSource } from '../../auth/application/ports';

export class DeterministicCryptoFixture implements RandomSource {
    private counter = 0;

    constructor(private readonly seed = 'kaynann-test-seed') {}

    bytes(size: number): Uint8Array {
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new RangeError('size must be a non-negative integer');
        }
        const chunks: Buffer[] = [];
        let remaining = size;
        while (remaining > 0) {
            const digest = createHash('sha256').update(this.seed).update(':').update(String(this.counter++)).digest();
            const bytesToUse = Math.min(remaining, digest.byteLength);
            chunks.push(digest.subarray(0, bytesToUse));
            remaining -= bytesToUse;
        }
        return Buffer.concat(chunks, size);
    }

    integer(minimumInclusive: number, maximumExclusive: number): number {
        const range = maximumExclusive - minimumInclusive;
        if (!Number.isSafeInteger(range) || range <= 0) {
            throw new RangeError('integer range must be non-empty');
        }
        const value = Buffer.from(this.bytes(6)).readUIntBE(0, 6);
        return minimumInclusive + (value % range);
    }

    uuid(): string {
        const bytes = Buffer.from(this.bytes(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = bytes.toString('hex');
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }
}
