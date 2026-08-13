import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import type {
    LocatedMachineCatalogQuery,
    LocatedMachineCatalogRecord,
    MachineCatalogQueryPage,
} from '../../application/ports/machine.repository';
import type {
    MachineEvidenceState,
    MachineId,
    MachinePublicationState,
    MachineServiceMode,
} from '../../domain/machine.types';
import type { PrismaClient } from '@prisma/client';

const MAX_PAGE_LIMIT = 100;

interface LocatedMachineRow {
    readonly machineId: string;
    readonly displayName: string | null;
    readonly publicationState: MachinePublicationState;
    readonly serviceMode: MachineServiceMode;
    readonly selectionRevision: bigint;
    readonly deletedAt: Date | null;
    readonly address: string;
    readonly latitude: Prisma.Decimal;
    readonly longitude: Prisma.Decimal;
    readonly amountPerLiter: Prisma.Decimal | null;
    readonly currency: string | null;
    readonly evidenceState: MachineEvidenceState | null;
    readonly reachable: boolean | null;
    readonly readyToSell: boolean | null;
    readonly salesAllowed: boolean | null;
    readonly observedAt: Date | null;
    readonly distanceMeters: number;
}

@Injectable()
export class PostgresDistanceRepository {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

    async findLocated(
        query: LocatedMachineCatalogQuery,
    ): Promise<MachineCatalogQueryPage<LocatedMachineCatalogRecord>> {
        const limit = requirePageLimit(query.limit);
        const viewportFilter = query.viewport
            ? Prisma.sql`
                AND l."latitude" BETWEEN ${query.viewport.south} AND ${query.viewport.north}
                AND l."longitude" BETWEEN ${query.viewport.west} AND ${query.viewport.east}
            `
            : Prisma.empty;
        const keysetFilter = query.after
            ? Prisma.sql`
                WHERE (c."distanceMeters", c."machineId") >
                      (${query.after.distanceMeters}, ${query.after.machineId})
            `
            : Prisma.empty;

        const rows = await this.prisma.$queryRaw<LocatedMachineRow[]>(Prisma.sql`
            WITH request_position AS (
                SELECT ${query.position.latitude}::double precision AS latitude,
                       ${query.position.longitude}::double precision AS longitude
            ),
            candidates AS (
                SELECT m."machineId",
                       m."displayName",
                       m."publicationState",
                       m."serviceMode",
                       m."selectionRevision",
                       m."deletedAt",
                       l."address",
                       l."latitude",
                       l."longitude",
                       p."amountPerLiter",
                       p."currency",
                       e."state" AS "evidenceState",
                       e."reachable",
                       e."readyToSell",
                       e."salesAllowed",
                       e."observedAt",
                       6371000.0 * 2.0 * ASIN(
                           SQRT(
                               LEAST(
                                   1.0,
                                   POWER(SIN(RADIANS((l."latitude"::double precision - q.latitude) / 2.0)), 2)
                                   + COS(RADIANS(q.latitude))
                                   * COS(RADIANS(l."latitude"::double precision))
                                   * POWER(
                                       SIN(RADIANS((l."longitude"::double precision - q.longitude) / 2.0)),
                                       2
                                   )
                               )
                           )
                       ) AS "distanceMeters"
                FROM "Machine" m
                JOIN "MachineLocation" l ON l."machineInternalId" = m."id"
                CROSS JOIN request_position q
                LEFT JOIN "MachinePrice" p ON p."machineInternalId" = m."id"
                LEFT JOIN "MachineAvailabilityEvidence" e ON e."machineInternalId" = m."id"
                WHERE m."publicationState" = 'PUBLISHED'::"MachinePublicationState"
                  AND m."deletedAt" IS NULL
                  AND l."latitude" BETWEEN -90 AND 90
                  AND l."longitude" BETWEEN -180 AND 180
                  ${viewportFilter}
            )
            SELECT c.*
            FROM candidates c
            ${keysetFilter}
            ORDER BY c."distanceMeters" ASC, c."machineId" ASC
            LIMIT ${limit + 1}
        `);

        return {
            items: rows.slice(0, limit).map(toLocatedMachineCatalogRecord),
            hasMore: rows.length > limit,
        };
    }
}

function requirePageLimit(limit: number): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
        throw new RangeError(`Machine catalog limit must be between 1 and ${MAX_PAGE_LIMIT}.`);
    }
    return limit;
}

function toLocatedMachineCatalogRecord(row: LocatedMachineRow): LocatedMachineCatalogRecord {
    return {
        machineId: row.machineId as MachineId,
        displayName: row.displayName,
        publicationState: row.publicationState,
        serviceMode: row.serviceMode,
        selectionRevision: row.selectionRevision,
        deletedAt: row.deletedAt,
        address: row.address,
        coordinates: {
            latitude: row.latitude.toNumber(),
            longitude: row.longitude.toNumber(),
        },
        distanceMeters: row.distanceMeters,
        price:
            row.amountPerLiter === null || row.currency === null
                ? null
                : { amountPerLiter: row.amountPerLiter.toString(), currency: row.currency.trim() },
        evidence:
            row.evidenceState === null ||
            row.reachable === null ||
            row.readyToSell === null ||
            row.salesAllowed === null ||
            row.observedAt === null
                ? null
                : {
                      state: row.evidenceState,
                      reachable: row.reachable,
                      readyToSell: row.readyToSell,
                      salesAllowed: row.salesAllowed,
                      observedAt: row.observedAt,
                  },
    };
}
