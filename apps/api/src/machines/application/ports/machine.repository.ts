import type {
    CatalogRevision,
    MachineCoordinates,
    MachineId,
    MachineIdentifierKind,
    MachinePublicationState,
    MachineServiceMode,
    MachineViewport,
} from '../../domain/machine.types';

export const MACHINE_REPOSITORY = Symbol('MACHINE_REPOSITORY');

export interface MachineCatalogRecord {
    readonly machineId: MachineId;
    readonly displayName: string | null;
    readonly publicationState: MachinePublicationState;
    readonly serviceMode: MachineServiceMode;
    readonly selectionRevision: bigint;
    readonly deletedAt: Date | null;
    readonly address: string;
    readonly coordinates: MachineCoordinates | null;
    readonly price: unknown;
    readonly evidence: unknown;
}

export interface LocatedMachineCatalogRecord extends MachineCatalogRecord {
    readonly coordinates: MachineCoordinates;
    readonly distanceMeters: number;
}

export interface MachineCatalogQueryPage<T extends MachineCatalogRecord> {
    readonly items: readonly T[];
    readonly hasMore: boolean;
}

export interface LocatedMachineCatalogQuery {
    readonly position: MachineCoordinates;
    readonly viewport: MachineViewport | null;
    readonly after: Readonly<{ distanceMeters: number; machineId: MachineId }> | null;
    readonly limit: number;
}

export interface ServiceAreaMachineCatalogQuery {
    readonly serviceAreaCode: string;
    readonly viewport: MachineViewport | null;
    readonly afterMachineId: MachineId | null;
    readonly limit: number;
}

export interface MachineIdentifierLookup {
    readonly kind: MachineIdentifierKind;
    readonly normalizedValue: string;
}

export interface MachineRepository {
    getCatalogRevision(): Promise<CatalogRevision>;
    findLocated(query: LocatedMachineCatalogQuery): Promise<MachineCatalogQueryPage<LocatedMachineCatalogRecord>>;
    findByServiceArea(query: ServiceAreaMachineCatalogQuery): Promise<MachineCatalogQueryPage<MachineCatalogRecord>>;
    findPublicByMachineId(machineId: MachineId): Promise<MachineCatalogRecord | null>;
    findPublicByIdentifier(identifier: MachineIdentifierLookup): Promise<MachineCatalogRecord | null>;
}
