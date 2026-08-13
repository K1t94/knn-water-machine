import type { MachineSelectionHandoff as DomainMachineSelectionHandoff } from '../machine-discovery/machine-discovery.types';

export type MachineSelectionHandoff = DomainMachineSelectionHandoff;
export type MachineSelectionHandoffHandler = (handoff: MachineSelectionHandoff) => void;
