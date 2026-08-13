import { Inject, Injectable } from '@nestjs/common';

import {
    normalizeMachineIdentifier,
    type IdentifierNormalizationOptions,
    type NormalizedMachineIdentifier,
} from '../domain/identifier-normalizer';
import { MachineValidationError } from '../domain/machine-validation';

import { GetMachineDetailService } from './get-machine-detail.service';
import { MachineApplicationError } from './machine-application.error';
import { MACHINE_REPOSITORY } from './ports/machine.repository';

import type {
    MachineCatalogRecord,
    MachineIdentifierLookup,
    MachineRepository,
} from './ports/machine.repository';
import type { MachineDetail, MachineIdentifierInput } from '../domain/machine.types';

@Injectable()
export class ResolveMachineIdentifierService {
    constructor(
        @Inject(MACHINE_REPOSITORY) private readonly repository: MachineRepository,
        private readonly detailService: GetMachineDetailService,
        private readonly normalizationOptions: IdentifierNormalizationOptions,
    ) {}

    async execute(input: MachineIdentifierInput): Promise<MachineDetail> {
        const identifier = this.normalize(input);

        if (identifier.kind === 'CURRENT_QR') {
            return this.detailService.execute(identifier.normalizedValue);
        }

        const record = await this.findPublicMapping(identifier);
        return this.detailService.execute(record.machineId);
    }

    private normalize(input: MachineIdentifierInput): NormalizedMachineIdentifier {
        try {
            return normalizeMachineIdentifier(input, this.normalizationOptions);
        } catch (error: unknown) {
            if (!(error instanceof MachineValidationError)) {
                throw new MachineApplicationError('DISCOVERY_TEMPORARILY_UNAVAILABLE', { cause: error });
            }
            throw new MachineApplicationError('MACHINE_CODE_INVALID', { cause: error });
        }
    }

    private async findPublicMapping(identifier: MachineIdentifierLookup): Promise<MachineCatalogRecord> {
        let record: MachineCatalogRecord | null;
        try {
            record = await this.repository.findPublicByIdentifier(identifier);
        } catch (error: unknown) {
            throw new MachineApplicationError('DISCOVERY_TEMPORARILY_UNAVAILABLE', { cause: error });
        }

        if (record === null || record.publicationState !== 'PUBLISHED' || record.deletedAt !== null) {
            throw new MachineApplicationError('MACHINE_NOT_FOUND');
        }
        return record;
    }
}
