import { Inject, Injectable } from '@nestjs/common';

import { MachineAvailabilityProjector } from '../domain/availability-projector';
import {
    MachineValidationError,
    parseCoordinates,
    parseServiceAreaCode,
    parseViewport,
} from '../domain/machine-validation';
import { CatalogOrderingRevisionMismatchError } from '../infrastructure/postgres/prisma-machine.repository';
import { SignedCatalogCursor, CatalogCursorError } from '../infrastructure/signed-catalog-cursor';

import { MachineApplicationError } from './machine-application.error';
import { MACHINE_REPOSITORY } from './ports/machine.repository';

import type {
    LocatedMachineCatalogRecord,
    LocatedMachineCatalogQuery,
    MachineCatalogQueryPage,
    MachineCatalogRecord,
    MachineRepository,
    ServiceAreaMachineCatalogQuery,
} from './ports/machine.repository';
import type {
    CatalogCursor,
    CatalogRevision,
    CurrencyCode,
    ExactMoneyString,
    MachineCatalogPage,
    MachineDiscoveryContext,
    MachinePricePerLiter,
    MachineRevision,
    MachineSummary,
} from '../domain/machine.types';
import type { CatalogCursorSortKey } from '../infrastructure/signed-catalog-cursor';

const MAX_PAGE_LIMIT = 100;
const EXACT_MONEY_PATTERN = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

type RevisionBound<T> = T & Readonly<{ catalogRevision: CatalogRevision }>;

export interface DiscoverMachinesInput {
    readonly context: MachineDiscoveryContext;
    readonly limit: number;
    readonly cursor: CatalogCursor | null;
}

@Injectable()
export class DiscoverMachinesService {
    constructor(
        @Inject(MACHINE_REPOSITORY) private readonly repository: MachineRepository,
        private readonly projector: MachineAvailabilityProjector,
        private readonly cursorCodec: SignedCatalogCursor,
    ) {}

    async execute(input: DiscoverMachinesInput): Promise<MachineCatalogPage> {
        let context: MachineDiscoveryContext;
        try {
            context = parseDiscoveryContext(input.context);
            requirePageLimit(input.limit);
        } catch (error: unknown) {
            throw toValidationError(error);
        }

        try {
            const catalogRevision = await this.repository.getCatalogRevision();
            const sortKey = this.decodeCursor(input.cursor, context, catalogRevision);
            const page = await this.queryPage(context, catalogRevision, input.limit, sortKey);

            return this.toCatalogPage(page, context, catalogRevision);
        } catch (error: unknown) {
            throw toDiscoveryError(error);
        }
    }

    private decodeCursor(
        cursor: CatalogCursor | null,
        context: MachineDiscoveryContext,
        catalogRevision: CatalogRevision,
    ): CatalogCursorSortKey | null {
        if (cursor === null) return null;

        try {
            return this.cursorCodec.decode(cursor, { context, catalogRevision });
        } catch (error: unknown) {
            throw toDiscoveryError(error);
        }
    }

    private queryPage(
        context: MachineDiscoveryContext,
        catalogRevision: CatalogRevision,
        limit: number,
        sortKey: CatalogCursorSortKey | null,
    ): Promise<MachineCatalogQueryPage<MachineCatalogRecord>> {
        if (context.mode === 'USER_LOCATION') {
            const query: RevisionBound<LocatedMachineCatalogQuery> = {
                position: context.position,
                viewport: context.viewport,
                after:
                    sortKey?.mode === 'DISTANCE'
                        ? { distanceMeters: sortKey.distanceMeters, machineId: sortKey.machineId }
                        : null,
                limit,
                catalogRevision,
            };
            return this.repository.findLocated(query);
        }

        const query: RevisionBound<ServiceAreaMachineCatalogQuery> = {
            serviceAreaCode: context.serviceAreaCode,
            viewport: context.viewport,
            afterMachineId: sortKey?.mode === 'MACHINE_ID' ? sortKey.machineId : null,
            limit,
            catalogRevision,
        };
        return this.repository.findByServiceArea(query);
    }

    private toCatalogPage(
        page: MachineCatalogQueryPage<MachineCatalogRecord>,
        context: MachineDiscoveryContext,
        catalogRevision: CatalogRevision,
    ): MachineCatalogPage {
        const items = page.items.flatMap((record) => {
            const summary = this.toSummary(record);
            return summary === null ? [] : [summary];
        });
        const lastRecord = page.items.at(-1);
        const nextCursor = page.hasMore && lastRecord ? this.encodeCursor(context, catalogRevision, lastRecord) : null;

        return {
            items,
            ...(nextCursor === null ? {} : { nextCursor }),
            hasMore: nextCursor !== null,
            catalogRevision,
        };
    }

    private encodeCursor(
        context: MachineDiscoveryContext,
        catalogRevision: CatalogRevision,
        record: MachineCatalogRecord,
    ): CatalogCursor {
        const sortKey: CatalogCursorSortKey =
            context.mode === 'USER_LOCATION'
                ? {
                      mode: 'DISTANCE',
                      distanceMeters: (record as LocatedMachineCatalogRecord).distanceMeters,
                      machineId: record.machineId,
                  }
                : { mode: 'MACHINE_ID', machineId: record.machineId };

        return this.cursorCodec.encode({ context, catalogRevision }, sortKey);
    }

    private toSummary(record: MachineCatalogRecord): MachineSummary | null {
        const availability = this.projector.project(record);
        if (!availability.publiclyVisible) return null;

        const coordinates = publicCoordinates(record.coordinates);
        const price = publicPrice(record.price);
        const distanceMeters = publicDistance(record);

        return {
            machineId: record.machineId,
            displayName: record.displayName?.trim() ?? '',
            address: record.address,
            ...(coordinates === null ? {} : { coordinates }),
            ...(distanceMeters === null ? {} : { distanceMeters }),
            ...(price === null ? {} : { price }),
            status: availability.status,
            machineRevision: record.selectionRevision.toString() as MachineRevision,
        };
    }
}

function parseDiscoveryContext(value: unknown): MachineDiscoveryContext {
    if (!isRecord(value)) throw new MachineValidationError('INVALID_COORDINATES');

    if (value.mode === 'USER_LOCATION') {
        const position = parseCoordinates(value.position);
        if (position === null) throw new MachineValidationError('INVALID_COORDINATES');
        return {
            mode: 'USER_LOCATION',
            position,
            viewport: value.viewport === null ? null : parseViewport(value.viewport),
        };
    }
    if (value.mode === 'SERVICE_AREA') {
        return {
            mode: 'SERVICE_AREA',
            serviceAreaCode: parseServiceAreaCode(value.serviceAreaCode),
            viewport: value.viewport === null ? null : parseViewport(value.viewport),
        };
    }
    throw new MachineValidationError('INVALID_SERVICE_AREA');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function requirePageLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
        throw new MachineValidationError('INVALID_VIEWPORT');
    }
}

function toValidationError(error: unknown): MachineApplicationError {
    if (error instanceof MachineApplicationError) return error;
    return new MachineApplicationError('VALIDATION_ERROR', { cause: error });
}

function toDiscoveryError(error: unknown): MachineApplicationError {
    if (error instanceof MachineApplicationError) return error;
    if (
        error instanceof CatalogOrderingRevisionMismatchError ||
        (error instanceof CatalogCursorError && error.reason === 'ORDERING_REVISION_MISMATCH')
    ) {
        return new MachineApplicationError('DISCOVERY_CONTEXT_STALE', { cause: error });
    }
    if (error instanceof CatalogCursorError) {
        return new MachineApplicationError('VALIDATION_ERROR', { cause: error });
    }
    return new MachineApplicationError('DISCOVERY_TEMPORARILY_UNAVAILABLE', { cause: error });
}

function publicCoordinates(coordinates: MachineCatalogRecord['coordinates']) {
    if (
        coordinates === null ||
        !Number.isFinite(coordinates.latitude) ||
        !Number.isFinite(coordinates.longitude) ||
        coordinates.latitude < -90 ||
        coordinates.latitude > 90 ||
        coordinates.longitude < -180 ||
        coordinates.longitude > 180
    ) {
        return null;
    }
    return coordinates;
}

function publicDistance(record: MachineCatalogRecord): number | null {
    if (!('distanceMeters' in record)) return null;
    const distanceMeters = record.distanceMeters;
    return typeof distanceMeters === 'number' && Number.isFinite(distanceMeters) && distanceMeters >= 0
        ? Math.round(distanceMeters)
        : null;
}

function publicPrice(value: unknown): MachinePricePerLiter | null {
    if (typeof value !== 'object' || value === null) return null;
    const price = value as Readonly<Record<string, unknown>>;
    if (
        typeof price.amountPerLiter !== 'string' ||
        !EXACT_MONEY_PATTERN.test(price.amountPerLiter) ||
        /^0(?:\.0+)?$/.test(price.amountPerLiter) ||
        typeof price.currency !== 'string' ||
        !CURRENCY_PATTERN.test(price.currency)
    ) {
        return null;
    }
    return {
        amountPerLiter: price.amountPerLiter as ExactMoneyString,
        currency: price.currency as CurrencyCode,
    };
}
