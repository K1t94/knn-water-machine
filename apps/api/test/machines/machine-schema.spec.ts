import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');

function blockLines(kind: 'enum' | 'model', name: string): string[] {
    const match = schema.match(new RegExp(`${kind}\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`));

    expect(match, `${kind} ${name} must exist`).not.toBeNull();

    return match![1]
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

describe('machine catalog Prisma schema', () => {
    it.each([
        ['MachinePublicationState', ['PUBLISHED', 'HIDDEN', 'ARCHIVED']],
        ['MachineServiceMode', ['NORMAL', 'SERVICE']],
        ['MachineEvidenceState', ['READY', 'OFFLINE', 'UNKNOWN']],
        ['MachineIdentifierKind', ['CURRENT_MANUAL', 'LEGACY_MANUAL', 'LEGACY_QR']],
    ] as const)('defines the %s enum', (name, values) => {
        expect(blockLines('enum', name)).toEqual(values);
    });

    it('defines the machine aggregate and its discovery index', () => {
        expect(blockLines('model', 'Machine')).toEqual([
            'id String @id @default(uuid()) @db.Uuid',
            'machineId String @unique @db.VarChar(22)',
            'displayName String? @db.VarChar(120)',
            'publicationState MachinePublicationState @default(HIDDEN)',
            'serviceMode MachineServiceMode @default(SERVICE)',
            'selectionRevision BigInt @default(1)',
            'deletedAt DateTime? @db.Timestamptz(3)',
            'createdAt DateTime @default(now()) @db.Timestamptz(3)',
            'updatedAt DateTime @updatedAt @db.Timestamptz(3)',
            'location MachineLocation?',
            'price MachinePrice?',
            'identifierMappings MachineIdentifierMapping[]',
            'availabilityEvidence MachineAvailabilityEvidence?',
            '@@index([publicationState, deletedAt, machineId])',
        ]);
    });

    it('defines exact coordinate types and location lookup indexes', () => {
        expect(blockLines('model', 'MachineLocation')).toEqual([
            'id String @id @default(uuid()) @db.Uuid',
            'machineInternalId String @unique @db.Uuid',
            'address String @db.VarChar(300)',
            'serviceAreaCode String @db.VarChar(64)',
            'latitude Decimal? @db.Decimal(9, 6)',
            'longitude Decimal? @db.Decimal(9, 6)',
            'updatedAt DateTime @updatedAt @db.Timestamptz(3)',
            'machine Machine @relation(fields: [machineInternalId], references: [id], onDelete: Restrict)',
            '@@index([serviceAreaCode])',
            '@@index([latitude, longitude])',
        ]);
    });

    it('defines exact money types for an optional machine price', () => {
        expect(blockLines('model', 'MachinePrice')).toEqual([
            'id String @id @default(uuid()) @db.Uuid',
            'machineInternalId String @unique @db.Uuid',
            'amountPerLiter Decimal @db.Decimal(20, 6)',
            'currency String @db.Char(3)',
            'updatedAt DateTime @updatedAt @db.Timestamptz(3)',
            'machine Machine @relation(fields: [machineInternalId], references: [id], onDelete: Restrict)',
        ]);
    });

    it('defines unique, indexed identifier mappings', () => {
        expect(blockLines('model', 'MachineIdentifierMapping')).toEqual([
            'id String @id @default(uuid()) @db.Uuid',
            'machineInternalId String @db.Uuid',
            'kind MachineIdentifierKind',
            'normalizedValue String @db.VarChar(256)',
            'enabled Boolean @default(true)',
            'verifiedAt DateTime? @db.Timestamptz(3)',
            'createdAt DateTime @default(now()) @db.Timestamptz(3)',
            'machine Machine @relation(fields: [machineInternalId], references: [id], onDelete: Restrict)',
            '@@unique([kind, normalizedValue])',
            '@@index([kind, normalizedValue, enabled])',
        ]);
    });

    it('defines one availability evidence row per machine', () => {
        expect(blockLines('model', 'MachineAvailabilityEvidence')).toEqual([
            'machineInternalId String @id @db.Uuid',
            'state MachineEvidenceState',
            'reachable Boolean',
            'readyToSell Boolean',
            'salesAllowed Boolean',
            'observedAt DateTime @db.Timestamptz(3)',
            'receivedAt DateTime @db.Timestamptz(3)',
            'sourceRevision String? @db.VarChar(100)',
            'updatedAt DateTime @updatedAt @db.Timestamptz(3)',
            'machine Machine @relation(fields: [machineInternalId], references: [id], onDelete: Restrict)',
            '@@index([observedAt])',
        ]);
    });

    it('defines the catalog ordering singleton', () => {
        expect(blockLines('model', 'MachineCatalogState')).toEqual([
            'singletonKey Int @id @default(1) @db.SmallInt',
            'orderingRevision BigInt @default(1)',
            'updatedAt DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
        ]);
    });
});
