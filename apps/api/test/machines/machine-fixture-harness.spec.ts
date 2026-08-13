import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/testing/fixed-clock';
import { EmulatedMachineGateway } from '../../src/machines/infrastructure/emulated-machine-gateway';

import { MachineFixtureHarness } from './machine-fixture-harness';

import type { MachineId } from '../../src/machines/domain/machine.types';
import type { PrismaClient } from '@prisma/client';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv' as MachineId;

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];

        return [path];
    });
}

describe('MachineFixtureHarness', () => {
    const updateMachine = vi.fn();
    const prisma = {
        machine: { update: updateMachine },
    } as unknown as PrismaClient;

    let clock: FixedClock;
    let gateway: EmulatedMachineGateway;
    let harness: MachineFixtureHarness;

    beforeEach(() => {
        updateMachine.mockReset().mockResolvedValue(undefined);
        clock = new FixedClock(NOW);
        gateway = new EmulatedMachineGateway(clock);
        harness = new MachineFixtureHarness(prisma, gateway, clock);
    });

    it('changes an exact price without converting its decimal representation to a number', async () => {
        await harness.setExactPrice(MACHINE_ID, {
            amountPerLiter: '41.125000',
            currency: 'XOF',
        });

        expect(updateMachine).toHaveBeenCalledWith({
            where: { machineId: MACHINE_ID },
            data: {
                price: {
                    update: {
                        amountPerLiter: '41.125000',
                        currency: 'XOF',
                    },
                },
                selectionRevision: { increment: 1 },
            },
        });
    });

    it('changes publication and service mode while advancing the selection revision', async () => {
        await harness.setPublicationState(MACHINE_ID, 'HIDDEN');
        await harness.setServiceMode(MACHINE_ID, 'SERVICE');

        expect(updateMachine).toHaveBeenNthCalledWith(1, {
            where: { machineId: MACHINE_ID },
            data: {
                publicationState: 'HIDDEN',
                selectionRevision: { increment: 1 },
            },
        });
        expect(updateMachine).toHaveBeenNthCalledWith(2, {
            where: { machineId: MACHINE_ID },
            data: {
                serviceMode: 'SERVICE',
                selectionRevision: { increment: 1 },
            },
        });
    });

    it('controls evidence age using the same clock that stamps emulator receipts', async () => {
        harness.setAvailabilityEvidence(MACHINE_ID, {
            state: 'READY',
            reachable: true,
            readyToSell: true,
            salesAllowed: true,
            observedAt: clock.now(),
        });
        harness.advanceTime(60_001);

        await expect(firstValueFrom(gateway.refreshAvailability(MACHINE_ID))).resolves.toMatchObject({
            observedAt: NOW,
            receivedAt: new Date(NOW.getTime() + 60_001),
        });
    });

    it('stays test-only and is never imported by production source files', () => {
        const sourceRoot = resolve(__dirname, '../../src');
        const imports = productionTypeScriptFiles(sourceRoot).filter((path) =>
            readFileSync(path, 'utf8').includes('machine-fixture-harness'),
        );

        expect(imports).toEqual([]);
    });
});
