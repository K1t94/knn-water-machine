import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDiscoveryScreen } from './MachineDiscoveryScreen';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDiscoveryContext,
    MachineId,
    MachineRevision,
    MachineSummary,
    MachineViewport,
} from '../machine-discovery.types';
import type { NativeCapabilityState } from '../native/LocationAdapter';
import type { MapRegion } from '../native/MapAdapter';
import type { MachineDiscoveryCommands } from '../services/machine-discovery-flow.service';
import type { MachineDiscoveryViewMode } from '../stores/machine-discovery.store';

vi.mock('../components/MachineMap', async () => {
    const { Pressable, Text, View } = await import('react-native');

    return {
        MachineMap: ({
            machines,
            unavailable,
            onMachinePress,
            onRegionChangeComplete,
        }: {
            machines: readonly MachineSummary[];
            unavailable: boolean;
            onMachinePress: (machineId: MachineId) => void;
            onRegionChangeComplete?: (region: MapRegion) => void;
        }) => (
            <View accessibilityLabel={unavailable ? 'Carte indisponible' : 'Résultats sur la carte'}>
                {machines.map((machine) => (
                    <Pressable
                        accessibilityLabel={`Ouvrir ${machine.displayName} depuis la carte`}
                        key={machine.machineId}
                        onPress={() => onMachinePress(machine.machineId)}
                    >
                        <Text>{machine.machineId}</Text>
                    </Pressable>
                ))}
                {onRegionChangeComplete === undefined ? null : (
                    <Pressable
                        accessibilityLabel="Déplacer la carte"
                        onPress={() =>
                            onRegionChangeComplete({
                                latitude: 10,
                                longitude: 20,
                                latitudeDelta: 2,
                                longitudeDelta: 4,
                            })
                        }
                    />
                )}
            </View>
        ),
    };
});

vi.mock('../components/MachineList', async () => {
    const { Pressable, Text, View } = await import('react-native');

    return {
        MachineList: ({
            machines,
            loading,
            error,
            onMachinePress,
            onLoadMore,
            onRetry,
        }: {
            machines: readonly MachineSummary[];
            loading: boolean;
            error: boolean;
            onMachinePress: (machineId: MachineId) => void;
            onLoadMore: () => void;
            onRetry?: () => void;
        }) => (
            <View accessibilityLabel="Résultats en liste">
                {loading && machines.length === 0 ? <Text>Chargement du catalogue</Text> : null}
                {error ? (
                    <View>
                        <Text>Catalogue indisponible</Text>
                        {onRetry === undefined ? null : (
                            <Pressable accessibilityLabel="Réessayer le catalogue" onPress={onRetry} />
                        )}
                    </View>
                ) : null}
                {!loading && !error && machines.length === 0 ? <Text>Catalogue vide</Text> : null}
                {machines.map((machine) => (
                    <Pressable
                        accessibilityLabel={`Ouvrir ${machine.displayName} depuis la liste`}
                        key={machine.machineId}
                        onPress={() => onMachinePress(machine.machineId)}
                    >
                        <Text>{machine.machineId}</Text>
                        <Text>{machine.status}</Text>
                    </Pressable>
                ))}
                <Pressable accessibilityLabel="Charger la suite" onPress={onLoadMore} />
            </View>
        ),
    };
});

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const INITIAL_CONTEXT: MachineDiscoveryContext = {
    mode: 'USER_LOCATION',
    position: { latitude: 14.716677, longitude: -17.467686 },
    viewport: { north: 14.8, east: -17.3, south: 14.6, west: -17.6 },
};

describe('MachineDiscoveryScreen', () => {
    it.each<NativeCapabilityState>(['denied', 'revoked', 'unavailable'])(
        'keeps service-area list discovery available when location is %s',
        async (capability) => {
            const store = storeWithCatalog([summary(MACHINE_ID, 'ONLINE')]);
            const context: MachineDiscoveryContext = {
                mode: 'SERVICE_AREA',
                serviceAreaCode: 'DKR-CENTRE',
                viewport: null,
            };
            store.setCapability('location', capability);
            store.setDiscoveryContext(context);
            const commands = createCommands(store);
            const view = await render(
                <MachineDiscoveryScreen
                    accessToken={ACCESS_TOKEN}
                    commands={commands}
                    onOpenMachine={vi.fn()}
                    store={store}
                />,
            );

            expect(view.getByLabelText('Localisation indisponible')).toBeTruthy();
            expect(view.getByText('DKR-CENTRE')).toBeTruthy();
            await fireEvent.press(view.getByLabelText('Afficher la liste'));
            expect(view.getByLabelText('Résultats en liste')).toBeTruthy();
            expect(store.discoveryContext).toEqual(context);

            await view.unmount();
        },
    );

    it('renders offline machines and distinct loading, empty, and retryable catalog states', async () => {
        const store = storeWithCatalog([summary(MACHINE_ID, 'OFFLINE')]);
        store.setViewMode('list');
        const commands = createCommands(store);
        const view = await render(
            <MachineDiscoveryScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                onOpenMachine={vi.fn()}
                store={store}
            />,
        );

        expect(view.getByText('OFFLINE')).toBeTruthy();

        await act(() => {
            store.replaceCatalog([]);
            store.setLoading('catalog', true);
        });
        expect(view.getByText('Actualisation des points d’eau…')).toBeTruthy();

        await act(() => store.setLoading('catalog', false));
        expect(view.getByText('Aucun point d’eau trouvé')).toBeTruthy();

        await act(() => store.setError({ code: 'OFFLINE', retryable: true }));
        expect(view.getByText('Connexion indisponible')).toBeTruthy();
        await fireEvent.press(view.getByLabelText('Réessayer'));
        expect(commands.refresh).toHaveBeenCalledOnce();
    });

    it('falls back to the list when the map is unavailable', async () => {
        const store = storeWithCatalog([summary(MACHINE_ID, 'ONLINE')]);
        store.setCapability('map', 'unavailable');
        const view = await render(
            <MachineDiscoveryScreen
                accessToken={ACCESS_TOKEN}
                commands={createCommands(store)}
                onOpenMachine={vi.fn()}
                store={store}
            />,
        );

        expect(view.getByLabelText('Carte indisponible')).toBeTruthy();
        expect(view.getByLabelText('Résultats en liste')).toBeTruthy();
        expect(view.getByText(MACHINE_ID)).toBeTruthy();
    });

    it('preserves context and viewport while switching between map and list', async () => {
        const store = storeWithCatalog([summary(MACHINE_ID, 'ONLINE')]);
        store.setDiscoveryContext(INITIAL_CONTEXT);
        store.setCapability('location', 'granted');
        store.setCapability('map', 'granted');
        const commands = createCommands(store);
        const view = await render(
            <MachineDiscoveryScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                onOpenMachine={vi.fn()}
                store={store}
            />,
        );

        await fireEvent.press(view.getByLabelText('Déplacer la carte'));
        const expectedViewport = { north: 11, east: 22, south: 9, west: 18 };
        expect(commands.updateViewport).toHaveBeenCalledWith(expectedViewport);

        await fireEvent.press(view.getByLabelText('Afficher la liste'));
        expect(commands.setViewMode).toHaveBeenCalledWith('list');
        expect(view.getByLabelText('Résultats en liste')).toBeTruthy();

        await fireEvent.press(view.getByLabelText('Afficher la carte'));
        expect(commands.setViewMode).toHaveBeenCalledWith('map');
        expect(store.discoveryContext).toEqual({ ...INITIAL_CONTEXT, viewport: expectedViewport });
        expect(view.getByLabelText('Résultats sur la carte')).toBeTruthy();
    });

    it('renders a deduplicated catalog and delegates incremental loading once per list event', async () => {
        const store = storeWithCatalog([summary(MACHINE_ID, 'ONLINE')]);
        store.appendCatalog([summary(MACHINE_ID, 'SERVICE'), summary('Q8pLm2Vx7Nw4Rk9Yc3TgZA' as MachineId, 'ONLINE')]);
        store.setViewMode('list');
        const commands = createCommands(store);
        const view = await render(
            <MachineDiscoveryScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                onOpenMachine={vi.fn()}
                store={store}
            />,
        );

        expect(view.getAllByText(MACHINE_ID)).toHaveLength(1);
        expect(store.catalog).toHaveLength(2);
        await fireEvent.press(view.getByLabelText('Charger la suite'));
        expect(commands.loadNextPage).toHaveBeenCalledOnce();
    });

    it.each(['map', 'list'] as const)('opens the corresponding refreshed card from the %s', async (mode) => {
        const store = storeWithCatalog([summary(MACHINE_ID, 'ONLINE')]);
        store.setCapability('map', 'granted');
        store.setViewMode(mode);
        const commands = createCommands(store);
        const onOpenMachine = vi.fn();
        const view = await render(
            <MachineDiscoveryScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                onOpenMachine={onOpenMachine}
                store={store}
            />,
        );

        await fireEvent.press(
            view.getByLabelText(`Ouvrir Point d’eau Liberté depuis la ${mode === 'map' ? 'carte' : 'liste'}`),
        );
        expect(commands.openMachine).toHaveBeenCalledWith(ACCESS_TOKEN, MACHINE_ID);
        expect(onOpenMachine).toHaveBeenCalledWith(MACHINE_ID);
    });
});

function createCommands(store: MachineDiscoveryStore) {
    const updateViewport = vi.fn((viewport: MachineViewport | null) => {
        const context = store.discoveryContext;
        if (context !== undefined) store.setDiscoveryContext({ ...context, viewport });
    });
    const setViewMode = vi.fn((mode: MachineDiscoveryViewMode) => store.setViewMode(mode));

    return {
        discover: vi.fn(),
        updateViewport,
        refresh: vi.fn(),
        loadNextPage: vi.fn(),
        setViewMode,
        openMachine: vi.fn(),
    } satisfies MachineDiscoveryCommands;
}

function storeWithCatalog(machines: readonly MachineSummary[]): MachineDiscoveryStore {
    const store = new MachineDiscoveryStore();
    store.replaceCatalog(machines);
    return store;
}

function summary(machineId: MachineId, status: MachineSummary['status']): MachineSummary {
    return {
        machineId,
        displayName: 'Point d’eau Liberté',
        address: 'Avenue de la Liberté, Dakar',
        coordinates: { latitude: 14.716677, longitude: -17.467686 },
        distanceMeters: 120,
        price: {
            amountPerLiter: '25.00' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        status,
        machineRevision: '7' as MachineRevision,
    };
}
