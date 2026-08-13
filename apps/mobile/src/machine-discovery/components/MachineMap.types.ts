import type {
    MachineCoordinates,
    MachineId,
    MachineSummary,
    MachineViewport,
} from '../machine-discovery.types';
import type { MapRegion } from '../native/MapAdapter';
import type { StyleProp, ViewStyle } from 'react-native';

export interface MachineMapProps {
    readonly machines: readonly MachineSummary[];
    readonly selectedMachineId?: MachineId;
    readonly userPosition?: MachineCoordinates;
    readonly initialViewport?: MachineViewport | null;
    readonly loading: boolean;
    readonly unavailable: boolean;
    readonly style?: StyleProp<ViewStyle>;
    readonly onMachinePress: (machineId: MachineId) => void;
    readonly onMapReady?: () => void;
    readonly onRegionChangeComplete?: (region: MapRegion) => void;
}
