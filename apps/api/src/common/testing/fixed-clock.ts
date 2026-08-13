import type { ClockPort } from '../../machines/application/ports/clock.port';

export class FixedClock implements ClockPort {
    private current: Date;

    constructor(value: Date) {
        this.current = new Date(value);
    }

    now(): Date {
        return new Date(this.current);
    }

    set(value: Date): void {
        this.current = new Date(value);
    }

    advance(milliseconds: number): void {
        this.current = new Date(this.current.getTime() + milliseconds);
    }
}
