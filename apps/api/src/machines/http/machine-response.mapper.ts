import type { MachineAvailability } from '../domain/machine.types';

export type MachineResponseLocale = 'fr-SN';

export interface MachineSummaryProjection {
    readonly machineId: string;
    readonly displayName: string | null;
    readonly address: string;
    readonly coordinates?: Readonly<{
        latitude: number;
        longitude: number;
    }>;
    readonly distanceMeters?: number;
    readonly price?: Readonly<{
        amountPerLiter: string;
        currency: string;
    }>;
    readonly status: MachineAvailability;
    readonly machineRevision: string;
}

export interface MachineResponseProjection extends MachineSummaryProjection {
    readonly selectable: boolean;
    readonly refreshedAt: string;
}

export interface MachineCatalogPageProjection {
    readonly items: readonly MachineSummaryProjection[];
    readonly nextCursor?: string;
    readonly hasMore: boolean;
    readonly catalogRevision: string;
}

export type MachineSummaryResponse = Omit<MachineResponseProjection, 'displayName' | 'selectable' | 'refreshedAt'> & {
    readonly displayName: string;
};

export type MachineDetailResponse = MachineSummaryResponse &
    Readonly<{
        selectable: boolean;
        refreshedAt: string;
    }>;

export interface MachineCatalogPageResponse {
    readonly items: readonly MachineSummaryResponse[];
    readonly nextCursor?: string;
    readonly hasMore: boolean;
    readonly catalogRevision: string;
}

export interface MachineContextChangedResponse {
    readonly code: 'MACHINE_CONTEXT_CHANGED';
    readonly message: string;
    readonly retryable: false;
    readonly correlationId: string;
    readonly currentMachine: MachineDetailResponse;
}

const GENERIC_DISPLAY_NAMES: Record<MachineResponseLocale, string> = {
    'fr-SN': "Distributeur d'eau",
};

export function toMachineCatalogPageResponse(
    page: MachineCatalogPageProjection,
    locale: MachineResponseLocale = 'fr-SN',
): MachineCatalogPageResponse {
    return {
        items: page.items.map((machine) => toMachineSummaryResponse(machine, locale)),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        hasMore: page.hasMore,
        catalogRevision: page.catalogRevision,
    };
}

export function toMachineDetailResponse(
    machine: MachineResponseProjection,
    locale: MachineResponseLocale = 'fr-SN',
): MachineDetailResponse {
    return {
        ...toMachineSummaryResponse(machine, locale),
        selectable: machine.selectable,
        refreshedAt: machine.refreshedAt,
    };
}

export function toMachineContextChangedResponse(
    machine: MachineResponseProjection,
    correlationId: string,
    locale: MachineResponseLocale = 'fr-SN',
): MachineContextChangedResponse {
    return {
        code: 'MACHINE_CONTEXT_CHANGED',
        message: 'Machine information changed. Review it before continuing.',
        retryable: false,
        correlationId,
        currentMachine: toMachineDetailResponse(machine, locale),
    };
}

function toMachineSummaryResponse(
    machine: MachineSummaryProjection,
    locale: MachineResponseLocale,
): MachineSummaryResponse {
    return {
        machineId: machine.machineId,
        displayName: publicDisplayName(machine.displayName, locale),
        address: machine.address,
        ...(machine.coordinates === undefined
            ? {}
            : {
                  coordinates: {
                      latitude: machine.coordinates.latitude,
                      longitude: machine.coordinates.longitude,
                  },
              }),
        ...(machine.distanceMeters === undefined ? {} : { distanceMeters: machine.distanceMeters }),
        ...(machine.price === undefined
            ? {}
            : {
                  price: {
                      amountPerLiter: machine.price.amountPerLiter,
                      currency: machine.price.currency,
                  },
              }),
        status: machine.status,
        machineRevision: machine.machineRevision,
    };
}

function publicDisplayName(displayName: string | null, locale: MachineResponseLocale): string {
    const normalized = displayName?.trim();
    return normalized ? normalized : GENERIC_DISPLAY_NAMES[locale];
}
