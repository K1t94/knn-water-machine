import type { FixedClock } from '../../src/common/testing/fixed-clock';
import type { MachineId, MachinePublicationState, MachineServiceMode } from '../../src/machines/domain/machine.types';
import type { EmulatedMachineGateway } from '../../src/machines/infrastructure/emulated-machine-gateway';
import type { PrismaClient } from '@prisma/client';

interface ExactFixturePrice {
    readonly amountPerLiter: string;
    readonly currency: string;
}

export class MachineFixtureHarness {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly gateway: EmulatedMachineGateway,
        private readonly clock: FixedClock,
    ) {}

    async setExactPrice(machineId: MachineId, price: ExactFixturePrice): Promise<void> {
        await this.prisma.machine.update({
            where: { machineId },
            data: {
                price: {
                    update: {
                        amountPerLiter: price.amountPerLiter,
                        currency: price.currency,
                    },
                },
                selectionRevision: { increment: 1 },
            },
        });
    }

    async setPublicationState(machineId: MachineId, publicationState: MachinePublicationState): Promise<void> {
        await this.prisma.machine.update({
            where: { machineId },
            data: {
                publicationState,
                selectionRevision: { increment: 1 },
            },
        });
    }

    async setServiceMode(machineId: MachineId, serviceMode: MachineServiceMode): Promise<void> {
        await this.prisma.machine.update({
            where: { machineId },
            data: {
                serviceMode,
                selectionRevision: { increment: 1 },
            },
        });
    }

    setAvailabilityEvidence(machineId: MachineId, evidence: unknown): void {
        this.gateway.setEvidence(machineId, evidence);
    }

    advanceTime(milliseconds: number): void {
        this.clock.advance(milliseconds);
    }
}
