export const CLOCK = Symbol('CLOCK');
export const RANDOM_SOURCE = Symbol('RANDOM_SOURCE');

export interface Clock {
    now(): Date;
}

export interface RandomSource {
    bytes(size: number): Uint8Array;
    integer(minimumInclusive: number, maximumExclusive: number): number;
    uuid(): string;
}
