declare const machineIdBrand: unique symbol;
declare const machineRevisionBrand: unique symbol;
declare const catalogRevisionBrand: unique symbol;
declare const exactMoneyStringBrand: unique symbol;
declare const currencyCodeBrand: unique symbol;
declare const catalogCursorBrand: unique symbol;

export type MachineId = string & { readonly [machineIdBrand]: true };
export type MachineRevision = string & { readonly [machineRevisionBrand]: true };
export type CatalogRevision = string & { readonly [catalogRevisionBrand]: true };
export type ExactMoneyString = string & { readonly [exactMoneyStringBrand]: true };
export type CurrencyCode = string & { readonly [currencyCodeBrand]: true };
export type CatalogCursor = string & { readonly [catalogCursorBrand]: true };

export type MachinePublicationState = 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
export type MachineServiceMode = 'NORMAL' | 'SERVICE';
export type MachineEvidenceState = 'READY' | 'OFFLINE' | 'UNKNOWN';
export type MachineIdentifierKind = 'CURRENT_MANUAL' | 'LEGACY_MANUAL' | 'LEGACY_QR';
export type MachineAvailability = 'ONLINE' | 'SERVICE' | 'OFFLINE';

export interface MachineCoordinates {
    readonly latitude: number;
    readonly longitude: number;
}

export interface MachineViewport {
    readonly north: number;
    readonly east: number;
    readonly south: number;
    readonly west: number;
}

export type MachineDiscoveryContext =
    | Readonly<{
          mode: 'USER_LOCATION';
          position: MachineCoordinates;
          viewport: MachineViewport | null;
      }>
    | Readonly<{
          mode: 'SERVICE_AREA';
          serviceAreaCode: string;
          viewport: MachineViewport | null;
      }>;

export interface MachinePricePerLiter {
    readonly amountPerLiter: ExactMoneyString;
    readonly currency: CurrencyCode;
}

export interface MachineSummary {
    readonly machineId: MachineId;
    readonly displayName: string;
    readonly address: string;
    readonly coordinates?: MachineCoordinates;
    readonly distanceMeters?: number;
    readonly price?: MachinePricePerLiter;
    readonly status: MachineAvailability;
    readonly machineRevision: MachineRevision;
}

export interface MachineDetail extends MachineSummary {
    readonly selectable: boolean;
    readonly refreshedAt: string;
}

export interface MachineCatalogPage {
    readonly items: readonly MachineSummary[];
    readonly nextCursor?: CatalogCursor;
    readonly hasMore: boolean;
    readonly catalogRevision: CatalogRevision;
}

export type MachineIdentifierInput =
    Readonly<{ source: 'QR'; value: string }> | Readonly<{ source: 'MANUAL'; value: string }>;

export interface MachineSelectionHandoff {
    readonly machineId: MachineId;
    readonly machineRevision: MachineRevision;
    readonly price: MachinePricePerLiter;
    readonly availability: 'ONLINE';
    readonly validatedAt: string;
}
