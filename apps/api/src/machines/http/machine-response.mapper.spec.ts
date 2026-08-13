import { describe, expect, it } from 'vitest';

import {
    toMachineCatalogPageResponse,
    toMachineContextChangedResponse,
    toMachineDetailResponse,
    type MachineResponseProjection,
} from './machine-response.mapper';

const PUBLIC_MACHINE_ID = 'AbCdEfGhIjKlMnOpQrStUv';

const internalMachine = {
    id: '00000000-0000-4000-8000-000000000025',
    machineId: PUBLIC_MACHINE_ID,
    displayName: null,
    address: '12 Rue de Dakar',
    coordinates: { latitude: 14.7167, longitude: -17.4677 },
    distanceMeters: 1250,
    price: { amountPerLiter: '125.0700', currency: 'XOF' },
    status: 'ONLINE',
    machineRevision: '17',
    selectable: true,
    refreshedAt: '2026-08-14T10:00:00.000Z',
    privateAliases: ['KNNLEGACY:4821'],
    evidence: { state: 'READY', observedAt: '2026-08-14T09:59:59.000Z' },
    telemetry: { modemImei: '353490000000001', rawState: 17 },
    topic: 'machines/private/serial-42/state',
    credential: 'mqtt-password=super-secret',
    selectionRevision: 17n,
    rawCatalogRevision: 41n,
} as const satisfies MachineResponseProjection & Record<string, unknown>;

const internalCatalogPage = {
    items: [internalMachine],
    nextCursor: 'opaque-signed-cursor',
    hasMore: true,
    catalogRevision: '41',
    queryEvidence: { latitude: 14.7, longitude: -17.4 },
} as const satisfies Parameters<typeof toMachineCatalogPageResponse>[0] & Record<string, unknown>;

describe('machine response mapper', () => {
    it('allowlists catalog fields, localizes a generic name, and preserves exact money strings', () => {
        const response = toMachineCatalogPageResponse(internalCatalogPage, 'fr-SN');

        expect(response).toEqual({
            items: [
                {
                    machineId: PUBLIC_MACHINE_ID,
                    displayName: "Distributeur d'eau",
                    address: '12 Rue de Dakar',
                    coordinates: { latitude: 14.7167, longitude: -17.4677 },
                    distanceMeters: 1250,
                    price: { amountPerLiter: '125.0700', currency: 'XOF' },
                    status: 'ONLINE',
                    machineRevision: '17',
                },
            ],
            nextCursor: 'opaque-signed-cursor',
            hasMore: true,
            catalogRevision: '41',
        });
        expectSensitiveFieldsToBeAbsent(response);
    });

    it('allowlists detail fields and omits absent optional values', () => {
        const response = toMachineDetailResponse({
            ...internalMachine,
            displayName: '  Fontaine Plateau  ',
            coordinates: undefined,
            distanceMeters: undefined,
            price: undefined,
        });

        expect(response).toEqual({
            machineId: PUBLIC_MACHINE_ID,
            displayName: 'Fontaine Plateau',
            address: '12 Rue de Dakar',
            status: 'ONLINE',
            machineRevision: '17',
            selectable: true,
            refreshedAt: '2026-08-14T10:00:00.000Z',
        });
        expectSensitiveFieldsToBeAbsent(response);
    });

    it('embeds only an allowlisted current detail in a context-changed problem', () => {
        const response = toMachineContextChangedResponse(internalMachine, '12345678-1234-4234-9234-123456789abc');

        expect(response).toEqual({
            code: 'MACHINE_CONTEXT_CHANGED',
            message: 'Machine information changed. Review it before continuing.',
            retryable: false,
            correlationId: '12345678-1234-4234-9234-123456789abc',
            currentMachine: {
                machineId: PUBLIC_MACHINE_ID,
                displayName: "Distributeur d'eau",
                address: '12 Rue de Dakar',
                coordinates: { latitude: 14.7167, longitude: -17.4677 },
                distanceMeters: 1250,
                price: { amountPerLiter: '125.0700', currency: 'XOF' },
                status: 'ONLINE',
                machineRevision: '17',
                selectable: true,
                refreshedAt: '2026-08-14T10:00:00.000Z',
            },
        });
        expectSensitiveFieldsToBeAbsent(response);
    });
});

function expectSensitiveFieldsToBeAbsent(response: unknown): void {
    const serialized = JSON.stringify(response);

    expect(serialized).not.toMatch(
        /00000000-0000-4000-8000-000000000025|KNNLEGACY|evidence|telemetry|modemImei|topic|credential|password|selectionRevision|rawCatalogRevision/i,
    );
}
