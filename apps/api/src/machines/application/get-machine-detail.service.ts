import { Inject, Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { MachineAvailabilityProjector } from '../domain/availability-projector';
import { parseMachineId } from '../domain/machine-validation';

import { MachineApplicationError } from './machine-application.error';
import { CLOCK_PORT } from './ports/clock.port';
import { MACHINE_GATEWAY } from './ports/machine-gateway.port';
import { MACHINE_REPOSITORY } from './ports/machine.repository';

import type { ClockPort } from './ports/clock.port';
import type { MachineGateway } from './ports/machine-gateway.port';
import type { MachineCatalogRecord, MachineRepository } from './ports/machine.repository';
import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachinePricePerLiter,
    MachineRevision,
} from '../domain/machine.types';

const EXACT_MONEY_PATTERN = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const GENERIC_MACHINE_DISPLAY_NAME = 'Water machine';

@Injectable()
export class GetMachineDetailService {
    constructor(
        @Inject(MACHINE_REPOSITORY) private readonly repository: MachineRepository,
        @Inject(MACHINE_GATEWAY) private readonly gateway: MachineGateway,
        private readonly projector: MachineAvailabilityProjector,
        @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    ) {}

    async execute(value: MachineId): Promise<MachineDetail> {
        let machineId: MachineId;
        try {
            machineId = parseMachineId(value);
        } catch (error: unknown) {
            throw new MachineApplicationError('VALIDATION_ERROR', { cause: error });
        }

        const record = await this.findPublicMachine(machineId);
        const evidence = await this.refreshAvailability(machineId);
        const availability = this.projector.project({ ...record, evidence });
        const coordinates = publicCoordinates(record.coordinates);
        const price = publicPrice(record.price);

        return {
            machineId: record.machineId,
            displayName: publicDisplayName(record.displayName),
            address: record.address,
            ...(coordinates === null ? {} : { coordinates }),
            ...(price === null ? {} : { price }),
            status: availability.status,
            machineRevision: publicMachineRevision(record.selectionRevision),
            selectable: availability.selectable,
            refreshedAt: this.clock.now().toISOString(),
        };
    }

    private async findPublicMachine(machineId: MachineId): Promise<MachineCatalogRecord> {
        let record: MachineCatalogRecord | null;
        try {
            record = await this.repository.findPublicByMachineId(machineId);
        } catch (error: unknown) {
            throw new MachineApplicationError('DISCOVERY_TEMPORARILY_UNAVAILABLE', { cause: error });
        }

        if (record === null || record.publicationState !== 'PUBLISHED' || record.deletedAt !== null) {
            throw new MachineApplicationError('MACHINE_NOT_FOUND');
        }
        return record;
    }

    private async refreshAvailability(machineId: MachineId): Promise<unknown> {
        try {
            return await firstValueFrom(this.gateway.refreshAvailability(machineId));
        } catch (error: unknown) {
            throw new MachineApplicationError('DISCOVERY_TEMPORARILY_UNAVAILABLE', { cause: error });
        }
    }
}

function publicDisplayName(value: string | null): string {
    const displayName = value?.trim();
    return displayName === undefined || displayName.length === 0 ? GENERIC_MACHINE_DISPLAY_NAME : displayName;
}

function publicMachineRevision(selectionRevision: bigint): MachineRevision {
    return selectionRevision.toString() as MachineRevision;
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
