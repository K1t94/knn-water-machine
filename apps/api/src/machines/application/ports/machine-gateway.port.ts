import type { MachineId } from '../../domain/machine.types';
import type { Observable } from 'rxjs';

export const MACHINE_GATEWAY = Symbol('MACHINE_GATEWAY');

export interface MachineGateway {
    refreshAvailability(machineId: MachineId): Observable<unknown>;
}
