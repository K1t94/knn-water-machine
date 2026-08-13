import { Inject, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

import { CLOCK_PORT, type ClockPort } from '../application/ports/clock.port';

import type { MachineGateway } from '../application/ports/machine-gateway.port';
import type { MachineId } from '../domain/machine.types';

@Injectable()
export class EmulatedMachineGateway implements MachineGateway {
    private readonly evidenceByMachine = new Map<MachineId, unknown>();
    private readonly responseDelayByMachine = new Map<MachineId, number>();

    constructor(@Inject(CLOCK_PORT) private readonly clock: ClockPort) {}

    setEvidence(machineId: MachineId, evidence: unknown): void {
        this.evidenceByMachine.set(machineId, evidence);
    }

    setResponseDelay(machineId: MachineId, milliseconds: number): void {
        this.responseDelayByMachine.set(machineId, milliseconds);
    }

    refreshAvailability(machineId: MachineId): Observable<unknown> {
        return new Observable((subscriber) => {
            const evidence = this.evidenceByMachine.has(machineId) ? this.evidenceByMachine.get(machineId) : null;
            const delay = this.responseDelayByMachine.get(machineId) ?? 0;
            let timeout: ReturnType<typeof setTimeout> | undefined;

            const emit = (): void => {
                subscriber.next(this.withReceiptTime(evidence));
                subscriber.complete();
            };

            if (delay > 0) timeout = setTimeout(emit, delay);
            else emit();

            return () => {
                if (timeout !== undefined) clearTimeout(timeout);
            };
        });
    }

    private withReceiptTime(evidence: unknown): unknown {
        if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;

        return {
            ...evidence,
            receivedAt: this.clock.now(),
        };
    }
}
