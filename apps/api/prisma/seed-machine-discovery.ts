import {
    MachineEvidenceState,
    MachineIdentifierKind,
    MachinePublicationState,
    MachineServiceMode,
    Prisma,
    PrismaClient,
} from '@prisma/client';

interface SeedEnvironment {
    readonly appEnv: string;
    readonly fixtureMode: boolean;
}

interface MachineDiscoveryFixture {
    readonly internalId: string;
    readonly machineId: string;
    readonly qrPayload: string;
    readonly displayName: string;
    readonly publicationState: MachinePublicationState;
    readonly serviceMode: MachineServiceMode;
    readonly location: {
        readonly id: string;
        readonly address: string;
        readonly serviceAreaCode: string;
        readonly latitude: string;
        readonly longitude: string;
    };
    readonly price: {
        readonly id: string;
        readonly amountPerLiter: string;
        readonly currency: string;
    };
    readonly identifiers: readonly {
        readonly id: string;
        readonly kind: MachineIdentifierKind;
        readonly normalizedValue: string;
        readonly enabled: boolean;
        readonly verifiedAt: Date | null;
    }[];
    readonly evidence: {
        readonly state: MachineEvidenceState;
        readonly reachable: boolean;
        readonly readyToSell: boolean;
        readonly salesAllowed: boolean;
        readonly observedAt: Date;
        readonly receivedAt: Date;
        readonly sourceRevision: string;
    };
}

const fixtureTimestamp = new Date('2026-08-13T12:00:00.000Z');

export const MACHINE_DISCOVERY_FIXTURES: readonly MachineDiscoveryFixture[] = [
    {
        internalId: '10000000-0000-4000-8000-000000000001',
        machineId: 'kdBu6l4X0dCVSatmsocVsQ',
        qrPayload: 'kaynann://machine/v1/kdBu6l4X0dCVSatmsocVsQ',
        displayName: 'Plateau Water 01',
        publicationState: MachinePublicationState.PUBLISHED,
        serviceMode: MachineServiceMode.NORMAL,
        location: {
            id: '11000000-0000-4000-8000-000000000001',
            address: 'Avenue Nelson Mandela, Dakar-Plateau',
            serviceAreaCode: 'DKR-CENTRE',
            latitude: '14.668420',
            longitude: '-17.437180',
        },
        price: {
            id: '12000000-0000-4000-8000-000000000001',
            amountPerLiter: '25.000000',
            currency: 'XOF',
        },
        identifiers: [
            {
                id: '13000000-0000-4000-8000-000000000001',
                kind: MachineIdentifierKind.CURRENT_MANUAL,
                normalizedValue: 'DKR-PLATEAU-01',
                enabled: true,
                verifiedAt: null,
            },
            {
                id: '13000000-0000-4000-8000-000000000002',
                kind: MachineIdentifierKind.LEGACY_MANUAL,
                normalizedValue: 'WM-0001',
                enabled: true,
                verifiedAt: fixtureTimestamp,
            },
            {
                id: '13000000-0000-4000-8000-000000000003',
                kind: MachineIdentifierKind.LEGACY_QR,
                normalizedValue: 'KNNLEGACY:0001',
                enabled: true,
                verifiedAt: fixtureTimestamp,
            },
        ],
        evidence: {
            state: MachineEvidenceState.READY,
            reachable: true,
            readyToSell: true,
            salesAllowed: true,
            observedAt: fixtureTimestamp,
            receivedAt: fixtureTimestamp,
            sourceRevision: 'fixture-ready-1',
        },
    },
    {
        internalId: '10000000-0000-4000-8000-000000000002',
        machineId: 'nHqwT5B_eojbUe1cWZHHvw',
        qrPayload: 'kaynann://machine/v1/nHqwT5B_eojbUe1cWZHHvw',
        displayName: 'Medina Water 02',
        publicationState: MachinePublicationState.PUBLISHED,
        serviceMode: MachineServiceMode.SERVICE,
        location: {
            id: '11000000-0000-4000-8000-000000000002',
            address: 'Avenue Blaise Diagne, Medina',
            serviceAreaCode: 'DKR-CENTRE',
            latitude: '14.685210',
            longitude: '-17.446620',
        },
        price: {
            id: '12000000-0000-4000-8000-000000000002',
            amountPerLiter: '30.500000',
            currency: 'XOF',
        },
        identifiers: [
            {
                id: '13000000-0000-4000-8000-000000000004',
                kind: MachineIdentifierKind.CURRENT_MANUAL,
                normalizedValue: 'DKR-MEDINA-02',
                enabled: true,
                verifiedAt: null,
            },
        ],
        evidence: {
            state: MachineEvidenceState.OFFLINE,
            reachable: false,
            readyToSell: false,
            salesAllowed: false,
            observedAt: fixtureTimestamp,
            receivedAt: fixtureTimestamp,
            sourceRevision: 'fixture-offline-1',
        },
    },
    {
        internalId: '10000000-0000-4000-8000-000000000003',
        machineId: 'y4_EoD0MblZ4i7CHp4NnXw',
        qrPayload: 'kaynann://machine/v1/y4_EoD0MblZ4i7CHp4NnXw',
        displayName: 'Yoff Water 03',
        publicationState: MachinePublicationState.HIDDEN,
        serviceMode: MachineServiceMode.NORMAL,
        location: {
            id: '11000000-0000-4000-8000-000000000003',
            address: 'Route de l Aeroport, Yoff',
            serviceAreaCode: 'DKR-NORD',
            latitude: '14.746150',
            longitude: '-17.490320',
        },
        price: {
            id: '12000000-0000-4000-8000-000000000003',
            amountPerLiter: '40.000000',
            currency: 'XOF',
        },
        identifiers: [
            {
                id: '13000000-0000-4000-8000-000000000005',
                kind: MachineIdentifierKind.CURRENT_MANUAL,
                normalizedValue: 'DKR-YOFF-03',
                enabled: false,
                verifiedAt: null,
            },
        ],
        evidence: {
            state: MachineEvidenceState.UNKNOWN,
            reachable: true,
            readyToSell: false,
            salesAllowed: false,
            observedAt: fixtureTimestamp,
            receivedAt: fixtureTimestamp,
            sourceRevision: 'fixture-unknown-1',
        },
    },
    {
        internalId: '10000000-0000-4000-8000-000000000004',
        machineId: 'XvQj8R0W3mlJwJtkYNFbqg',
        qrPayload: 'kaynann://machine/v1/XvQj8R0W3mlJwJtkYNFbqg',
        displayName: 'Ouakam Water 04',
        publicationState: MachinePublicationState.ARCHIVED,
        serviceMode: MachineServiceMode.NORMAL,
        location: {
            id: '11000000-0000-4000-8000-000000000004',
            address: 'Route de la Corniche Ouest, Ouakam',
            serviceAreaCode: 'DKR-OUEST',
            latitude: '14.723710',
            longitude: '-17.494670',
        },
        price: {
            id: '12000000-0000-4000-8000-000000000004',
            amountPerLiter: '35.250000',
            currency: 'XOF',
        },
        identifiers: [
            {
                id: '13000000-0000-4000-8000-000000000006',
                kind: MachineIdentifierKind.LEGACY_MANUAL,
                normalizedValue: 'WM-0004',
                enabled: true,
                verifiedAt: fixtureTimestamp,
            },
        ],
        evidence: {
            state: MachineEvidenceState.READY,
            reachable: true,
            readyToSell: true,
            salesAllowed: true,
            observedAt: fixtureTimestamp,
            receivedAt: fixtureTimestamp,
            sourceRevision: 'fixture-ready-2',
        },
    },
] as const;

function assertSeedEnvironment(environment: SeedEnvironment): void {
    if (!['development', 'test'].includes(environment.appEnv)) {
        throw new Error('Machine discovery fixtures are allowed in development and test only.');
    }
    if (!environment.fixtureMode) {
        throw new Error('Machine discovery fixtures require MACHINE_FIXTURE_MODE=true.');
    }
}

export async function seedMachineDiscovery(
    prisma: PrismaClient,
    environment: SeedEnvironment,
): Promise<{ readonly machines: number }> {
    assertSeedEnvironment(environment);
    const fixtureMachineIds = MACHINE_DISCOVERY_FIXTURES.map((fixture) => fixture.internalId);

    await prisma.$transaction(async (transaction) => {
        const ownedRows = { machineInternalId: { in: fixtureMachineIds } };
        await transaction.machineAvailabilityEvidence.deleteMany({ where: ownedRows });
        await transaction.machineIdentifierMapping.deleteMany({ where: ownedRows });
        await transaction.machinePrice.deleteMany({ where: ownedRows });
        await transaction.machineLocation.deleteMany({ where: ownedRows });
        await transaction.machine.deleteMany({ where: { id: { in: fixtureMachineIds } } });

        for (const fixture of MACHINE_DISCOVERY_FIXTURES) {
            await transaction.machine.create({
                data: {
                    id: fixture.internalId,
                    machineId: fixture.machineId,
                    displayName: fixture.displayName,
                    publicationState: fixture.publicationState,
                    serviceMode: fixture.serviceMode,
                    selectionRevision: 1n,
                    location: {
                        create: {
                            id: fixture.location.id,
                            address: fixture.location.address,
                            serviceAreaCode: fixture.location.serviceAreaCode,
                            latitude: new Prisma.Decimal(fixture.location.latitude),
                            longitude: new Prisma.Decimal(fixture.location.longitude),
                        },
                    },
                    price: {
                        create: {
                            id: fixture.price.id,
                            amountPerLiter: new Prisma.Decimal(fixture.price.amountPerLiter),
                            currency: fixture.price.currency,
                        },
                    },
                    identifierMappings: {
                        create: fixture.identifiers.map((identifier) => ({ ...identifier })),
                    },
                    availabilityEvidence: {
                        create: { ...fixture.evidence },
                    },
                },
            });
        }
    });

    return { machines: MACHINE_DISCOVERY_FIXTURES.length };
}

async function main(): Promise<void> {
    const environment = {
        appEnv: process.env.APP_ENV ?? 'development',
        fixtureMode: process.env.MACHINE_FIXTURE_MODE === 'true',
    };
    assertSeedEnvironment(environment);

    const prisma = new PrismaClient();
    try {
        await prisma.$connect();
        const result = await seedMachineDiscovery(prisma, environment);
        process.stdout.write(`${JSON.stringify({ event: 'machine_discovery_seed_completed', ...result })}\n`);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown machine discovery seed failure';
        process.stderr.write(`${JSON.stringify({ event: 'machine_discovery_seed_failed', message })}\n`);
        process.exitCode = 1;
    });
}
