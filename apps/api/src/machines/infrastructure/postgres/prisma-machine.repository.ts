import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { PostgresDistanceRepository } from './postgres-distance.repository';

import type {
    MachineCatalogQueryPage,
    MachineCatalogRecord,
    MachineIdentifierLookup,
    MachineRepository,
    LocatedMachineCatalogQuery,
    LocatedMachineCatalogRecord,
    ServiceAreaMachineCatalogQuery,
} from '../../application/ports/machine.repository';
import type { CatalogRevision, MachineCoordinates, MachineId } from '../../domain/machine.types';
import type { PrismaClient } from '@prisma/client';

const MAX_PAGE_LIMIT = 100;
const machineCatalogSelect = Prisma.validator<Prisma.MachineSelect>()({
    machineId: true,
    displayName: true,
    publicationState: true,
    serviceMode: true,
    selectionRevision: true,
    deletedAt: true,
    location: {
        select: {
            address: true,
            latitude: true,
            longitude: true,
        },
    },
    price: {
        select: {
            amountPerLiter: true,
            currency: true,
        },
    },
    availabilityEvidence: {
        select: {
            state: true,
            reachable: true,
            readyToSell: true,
            salesAllowed: true,
            observedAt: true,
        },
    },
});

const machineSelectionSnapshotSelect = Prisma.validator<Prisma.MachineSelect>()({
    machineId: true,
    displayName: true,
    publicationState: true,
    serviceMode: true,
    selectionRevision: true,
    deletedAt: true,
    location: {
        select: {
            address: true,
            latitude: true,
            longitude: true,
        },
    },
    price: {
        select: {
            amountPerLiter: true,
            currency: true,
        },
    },
});

type MachineCatalogProjection = Prisma.MachineGetPayload<{ select: typeof machineCatalogSelect }>;
type MachineSelectionSnapshotProjection = Prisma.MachineGetPayload<{
    select: typeof machineSelectionSnapshotSelect;
}>;
type CatalogPageQuery = LocatedMachineCatalogQuery | ServiceAreaMachineCatalogQuery;

interface RevisionBoundCatalogPageQuery {
    readonly catalogRevision?: CatalogRevision;
}

type RevisionAwareCatalogPageQuery<T extends CatalogPageQuery> = T & RevisionBoundCatalogPageQuery;

interface CatalogRevisionRow {
    readonly orderingRevision: bigint;
}

export class CatalogOrderingRevisionMismatchError extends Error {
    readonly name = 'CatalogOrderingRevisionMismatchError';

    constructor() {
        super('Machine catalog ordering revision is stale.');
    }
}

@Injectable()
export class PrismaMachineRepository implements MachineRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

    async getCatalogRevision(): Promise<CatalogRevision> {
        const state = await this.prisma.machineCatalogState.findUniqueOrThrow({
            where: { singletonKey: 1 },
            select: { orderingRevision: true },
        });
        return state.orderingRevision.toString() as CatalogRevision;
    }

    async findLocated(
        query: RevisionAwareCatalogPageQuery<LocatedMachineCatalogQuery>,
    ): Promise<MachineCatalogQueryPage<LocatedMachineCatalogRecord>> {
        return this.readAtCatalogRevision(query, (transaction) =>
            new PostgresDistanceRepository(transaction as unknown as PrismaClient).findLocated(query),
        );
    }

    async findByServiceArea(
        query: RevisionAwareCatalogPageQuery<ServiceAreaMachineCatalogQuery>,
    ): Promise<MachineCatalogQueryPage<MachineCatalogRecord>> {
        const limit = requirePageLimit(query.limit);
        const locationFilter: Prisma.MachineLocationWhereInput = {
            serviceAreaCode: query.serviceAreaCode,
            latitude: {
                not: null,
                gte: query.viewport?.south ?? -90,
                lte: query.viewport?.north ?? 90,
            },
            longitude: {
                not: null,
                gte: query.viewport?.west ?? -180,
                lte: query.viewport?.east ?? 180,
            },
        };
        const records = await this.readAtCatalogRevision(query, (transaction) =>
            transaction.machine.findMany({
                where: {
                    publicationState: 'PUBLISHED',
                    deletedAt: null,
                    machineId: query.afterMachineId === null ? undefined : { gt: query.afterMachineId },
                    location: { is: locationFilter },
                },
                select: machineCatalogSelect,
                orderBy: { machineId: 'asc' },
                take: limit + 1,
            }),
        );

        return {
            items: records.slice(0, limit).map(toMachineCatalogRecord),
            hasMore: records.length > limit,
        };
    }

    async findPublicByMachineId(machineId: MachineId): Promise<MachineCatalogRecord | null> {
        const record = await this.prisma.machine.findFirst({
            where: {
                machineId,
                publicationState: 'PUBLISHED',
                deletedAt: null,
            },
            select: machineSelectionSnapshotSelect,
        });
        return record === null ? null : toMachineSelectionSnapshotRecord(record);
    }

    async findPublicByIdentifier(identifier: MachineIdentifierLookup): Promise<MachineCatalogRecord | null> {
        const mappings = await this.prisma.machineIdentifierMapping.findMany({
            where: {
                kind: identifier.kind,
                normalizedValue: identifier.normalizedValue,
                enabled: true,
                machine: {
                    is: {
                        publicationState: 'PUBLISHED',
                        deletedAt: null,
                    },
                },
            },
            select: { machine: { select: machineCatalogSelect } },
            take: 2,
        });
        return mappings.length === 1 ? toMachineCatalogRecord(mappings[0].machine) : null;
    }

    private async readAtCatalogRevision<T>(
        query: RevisionAwareCatalogPageQuery<CatalogPageQuery>,
        read: (transaction: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
        const catalogRevision = query.catalogRevision;
        if (catalogRevision === undefined) return read(this.prisma);

        return this.prisma.$transaction(async (transaction) => {
            const [state] = await transaction.$queryRaw<CatalogRevisionRow[]>`
                SELECT "orderingRevision"
                FROM "MachineCatalogState"
                WHERE "singletonKey" = 1
                FOR SHARE
            `;
            const currentRevision = state.orderingRevision.toString();
            if (currentRevision !== catalogRevision) {
                throw new CatalogOrderingRevisionMismatchError();
            }

            return read(transaction);
        });
    }
}

function requirePageLimit(limit: number): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
        throw new RangeError(`Machine catalog limit must be between 1 and ${MAX_PAGE_LIMIT}.`);
    }
    return limit;
}

function toMachineCatalogRecord(record: MachineCatalogProjection): MachineCatalogRecord {
    return {
        machineId: record.machineId as MachineId,
        displayName: record.displayName,
        publicationState: record.publicationState,
        serviceMode: record.serviceMode,
        selectionRevision: record.selectionRevision,
        deletedAt: record.deletedAt,
        address: record.location?.address ?? '',
        coordinates: toCoordinates(record),
        price:
            record.price === null
                ? null
                : {
                      amountPerLiter: record.price.amountPerLiter.toString(),
                      currency: record.price.currency.trim(),
                  },
        evidence:
            record.availabilityEvidence === null
                ? null
                : {
                      state: record.availabilityEvidence.state,
                      reachable: record.availabilityEvidence.reachable,
                      readyToSell: record.availabilityEvidence.readyToSell,
                      salesAllowed: record.availabilityEvidence.salesAllowed,
                      observedAt: record.availabilityEvidence.observedAt,
                  },
    };
}

function toMachineSelectionSnapshotRecord(record: MachineSelectionSnapshotProjection): MachineCatalogRecord {
    return {
        machineId: record.machineId as MachineId,
        displayName: record.displayName,
        publicationState: record.publicationState,
        serviceMode: record.serviceMode,
        selectionRevision: record.selectionRevision,
        deletedAt: record.deletedAt,
        address: record.location?.address ?? '',
        coordinates: toCoordinates(record),
        price:
            record.price === null
                ? null
                : {
                      amountPerLiter: record.price.amountPerLiter.toString(),
                      currency: record.price.currency.trim(),
                  },
        evidence: null,
    };
}

function toCoordinates(
    record: MachineCatalogProjection | MachineSelectionSnapshotProjection,
): MachineCoordinates | null {
    const latitude = record.location?.latitude?.toNumber();
    const longitude = record.location?.longitude?.toNumber();
    if (
        latitude === undefined ||
        longitude === undefined ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        return null;
    }
    return { latitude, longitude };
}
