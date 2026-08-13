import { MachineDiscoveryFlowService } from './services/machine-discovery-flow.service';
import { MachineDiscoveryStore } from './stores/machine-discovery.store';

import type { ScannerRuntimeAdapter } from './native/ScannerAdapter';
import type { MachineDiscoveryFlowDependencies } from './services/machine-discovery-flow.service';

export type MachineDiscoveryCompositionDependencies = Omit<MachineDiscoveryFlowDependencies, 'scanner' | 'store'> & {
    readonly scanner: ScannerRuntimeAdapter;
};

export class MachineDiscoveryCompositionRoot {
    readonly store = new MachineDiscoveryStore();
    readonly flow: MachineDiscoveryFlowService;
    readonly scanner: ScannerRuntimeAdapter;

    constructor(dependencies: MachineDiscoveryCompositionDependencies) {
        this.scanner = dependencies.scanner;
        this.flow = new MachineDiscoveryFlowService({ ...dependencies, store: this.store });
    }

    dispose(): void {
        this.flow.dispose();
    }
}
