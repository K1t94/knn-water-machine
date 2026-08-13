import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/testing/fixed-clock';

import { EmulatedMachineGateway } from './emulated-machine-gateway';

import type { MachineGateway } from '../application/ports/machine-gateway.port';
import type { MachineId } from '../domain/machine.types';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv' as MachineId;

function readyEvidence(observedAt: Date = NOW): Readonly<Record<string, unknown>> {
    return {
        state: 'READY',
        reachable: true,
        readyToSell: true,
        salesAllowed: true,
        observedAt,
    };
}

afterEach(() => vi.useRealTimers());

describe('EmulatedMachineGateway', () => {
    it('implements the refresh-only gateway port and exposes mutable evidence between requests', async () => {
        const gateway = new EmulatedMachineGateway(new FixedClock(NOW));
        const port: MachineGateway = gateway;
        const initialEvidence = readyEvidence();
        const changedEvidence = { ...readyEvidence(), state: 'OFFLINE' };

        gateway.setEvidence(MACHINE_ID, initialEvidence);
        await expect(firstValueFrom(port.refreshAvailability(MACHINE_ID))).resolves.toMatchObject(initialEvidence);

        gateway.setEvidence(MACHINE_ID, changedEvidence);
        await expect(firstValueFrom(port.refreshAvailability(MACHINE_ID))).resolves.toMatchObject(changedEvidence);
    });

    it('delays a configured response without emitting early', async () => {
        vi.useFakeTimers();
        const gateway = new EmulatedMachineGateway(new FixedClock(NOW));
        const received: unknown[] = [];
        gateway.setEvidence(MACHINE_ID, readyEvidence());
        gateway.setResponseDelay(MACHINE_ID, 250);

        gateway.refreshAvailability(MACHINE_ID).subscribe((evidence) => received.push(evidence));

        await vi.advanceTimersByTimeAsync(249);
        expect(received).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(received).toHaveLength(1);
    });

    it('uses the injected clock for the receipt time of each refresh', async () => {
        const clock = new FixedClock(NOW);
        const gateway = new EmulatedMachineGateway(clock);
        gateway.setEvidence(MACHINE_ID, readyEvidence());

        await expect(firstValueFrom(gateway.refreshAvailability(MACHINE_ID))).resolves.toMatchObject({
            receivedAt: NOW,
        });

        clock.advance(5_000);
        await expect(firstValueFrom(gateway.refreshAvailability(MACHINE_ID))).resolves.toMatchObject({
            receivedAt: new Date(NOW.getTime() + 5_000),
        });
    });

    it.each([
        ['an unknown machine', null],
        ['unknown evidence with optimistic flags', { ...readyEvidence(), state: 'UNKNOWN' }],
        ['offline evidence with conflicting ready flags', { ...readyEvidence(), state: 'OFFLINE' }],
        ['a malformed state', { ...readyEvidence(), state: 'BROKEN' }],
        ['a malformed primitive payload', 'READY'],
    ])('passes through %s for fail-closed application projection', async (_case, evidence) => {
        const gateway = new EmulatedMachineGateway(new FixedClock(NOW));
        if (evidence !== null) gateway.setEvidence(MACHINE_ID, evidence);

        const result = await firstValueFrom(gateway.refreshAvailability(MACHINE_ID));

        if (evidence === null || typeof evidence !== 'object') {
            expect(result).toBe(evidence);
        } else {
            expect(result).toMatchObject(evidence);
        }
    });

    it('physically cancels delayed work when a refresh subscription is aborted by unsubscribe', async () => {
        vi.useFakeTimers();
        const gateway = new EmulatedMachineGateway(new FixedClock(NOW));
        const observer = {
            next: vi.fn(),
            complete: vi.fn(),
        };
        gateway.setEvidence(MACHINE_ID, readyEvidence());
        gateway.setResponseDelay(MACHINE_ID, 1_000);

        const subscription = gateway.refreshAvailability(MACHINE_ID).subscribe(observer);
        expect(vi.getTimerCount()).toBe(1);

        subscription.unsubscribe();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(observer.next).not.toHaveBeenCalled();
        expect(observer.complete).not.toHaveBeenCalled();
    });
});
