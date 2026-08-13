import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDetailScreen } from './MachineDetailScreen';
import { MachineDiscoveryScreen } from './MachineDiscoveryScreen';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachineRevision,
    MachineSelectionHandoff,
    MachineSummary,
} from '../machine-discovery.types';
import type { MachineDiscoveryCommands } from '../services/machine-discovery-flow.service';
import type { ComponentType } from 'react';

vi.mock('../components/MachineMap', () => ({ MachineMap: () => null }));

vi.mock('../components/MachineList', async () => {
    const { Pressable, Text, View } = await import('react-native');

    return {
        MachineList: ({
            error,
            loading,
            machines,
            onRetry,
        }: {
            readonly error: boolean;
            readonly loading: boolean;
            readonly machines: readonly MachineSummary[];
            readonly onRetry?: () => void;
        }) => (
            <View accessibilityLabel="Résultats en liste">
                {machines.map((machine) => (
                    <View key={machine.machineId}>
                        <Text>{machine.displayName}</Text>
                        <Text>{machine.status}</Text>
                    </View>
                ))}
                {loading ? <Text>Chargement du catalogue</Text> : null}
                {error && onRetry !== undefined ? (
                    <Pressable accessibilityLabel="Réessayer" onPress={onRetry}>
                        <Text>Réessayer</Text>
                    </Pressable>
                ) : null}
            </View>
        ),
    };
});

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const CONFIRM_LABEL = 'Continuer avec ce point d’eau';

interface SafetyDetailCommands extends MachineDiscoveryCommands {
    confirmSelection(accessToken: string): void;
}

interface SafetyDetailScreenProps {
    readonly accessToken: string;
    readonly commands: SafetyDetailCommands;
    readonly onBack: () => void;
    readonly onSelectionHandoff?: (handoff: MachineSelectionHandoff) => void;
    readonly store: MachineDiscoveryStore;
}

const SafetyDetailScreen = MachineDetailScreen as unknown as ComponentType<SafetyDetailScreenProps>;

describe('machine discovery safe-current screen states', () => {
    it('keeps the current catalog visible while a stale catalog context requires refresh', async () => {
        const store = catalogStore();
        store.setError({ code: 'DISCOVERY_CONTEXT_STALE', retryable: true });
        const commands = createCommands();
        const view = await renderDiscovery(store, commands);

        expect(view.getByText('Point d’eau Liberté')).toBeTruthy();
        expect(view.getByText('Résultats à actualiser')).toBeTruthy();
        expect(view.queryByText('DISCOVERY_CONTEXT_STALE')).toBeNull();

        await fireEvent.press(view.getByLabelText('Réessayer'));
        expect(commands.refresh).toHaveBeenCalledOnce();
    });

    it('presents a consumer-safe offline recovery without exposing the transport error', async () => {
        const store = new MachineDiscoveryStore();
        store.setViewMode('list');
        store.setError({ code: 'OFFLINE socket ECONNREFUSED api.internal', retryable: true });
        const view = await renderDiscovery(store, createCommands());

        expect(view.getByText('Connexion indisponible')).toBeTruthy();
        expect(view.getByRole('alert')).toBeTruthy();
        expect(view.getByLabelText('Réessayer')).toBeTruthy();
        expect(view.queryByText(/ECONNREFUSED|api\.internal|socket/)).toBeNull();
    });

    it('shows stale availability evidence as unavailable and never selectable', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('ONLINE', '7'));
        store.setCurrentDetail(detail('OFFLINE', false, '8'));
        const view = await renderDetail(store, createDetailCommands());

        expect(view.getByText('OFFLINE')).toBeTruthy();
        expect(view.getByText('Indisponible pour la suite')).toBeTruthy();
        expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('allows only one active retry to supersede the failed catalog request', async () => {
        const store = new MachineDiscoveryStore();
        store.setViewMode('list');
        store.setError({ code: 'OFFLINE', retryable: true });
        const commands = createCommands();
        commands.refresh.mockImplementation(() => {
            store.setError(undefined);
            store.setLoading('catalog', true);
        });
        const view = await renderDiscovery(store, commands);
        const retry = view.getByLabelText('Réessayer');

        await act(async () => {
            await fireEvent.press(retry);
            await fireEvent.press(retry);
        });

        expect(commands.refresh).toHaveBeenCalledOnce();
        expect(view.getByText('Actualisation des points d’eau…')).toBeTruthy();
    });

    it('preserves safe current catalog data while a refresh is pending', async () => {
        const store = catalogStore();
        store.setLoading('catalog', true);
        const view = await renderDiscovery(store, createCommands());

        expect(view.getByText('Point d’eau Liberté')).toBeTruthy();
        expect(view.getByText('Actualisation des points d’eau…')).toBeTruthy();
    });

    it('preserves safe current detail while refreshing and blocks confirmation', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('ONLINE', '7'));
        store.setCurrentDetail(detail('ONLINE', true, '7'));
        store.setLoading('detail', true);
        const view = await renderDetail(store, createDetailCommands());

        expect(view.getByText('Point d’eau Liberté')).toBeTruthy();
        expect(view.getByText('25.00 XOF / L')).toBeTruthy();
        expect(view.getByLabelText('Actualisation du point d’eau')).toBeTruthy();
        expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: true });
    });
});

function renderDiscovery(store: MachineDiscoveryStore, commands: ReturnType<typeof createCommands>) {
    return render(
        <MachineDiscoveryScreen accessToken={ACCESS_TOKEN} commands={commands} onOpenMachine={vi.fn()} store={store} />,
    );
}

function renderDetail(store: MachineDiscoveryStore, commands: SafetyDetailCommands) {
    return render(<SafetyDetailScreen accessToken={ACCESS_TOKEN} commands={commands} onBack={vi.fn()} store={store} />);
}

function createCommands() {
    return {
        discover: vi.fn(),
        updateViewport: vi.fn(),
        refresh: vi.fn(),
        loadNextPage: vi.fn(),
        setViewMode: vi.fn(),
        openMachine: vi.fn(),
    } satisfies MachineDiscoveryCommands;
}

function createDetailCommands(): SafetyDetailCommands {
    return { ...createCommands(), confirmSelection: vi.fn() };
}

function catalogStore(): MachineDiscoveryStore {
    const store = new MachineDiscoveryStore();
    store.setViewMode('list');
    store.replaceCatalog([summary('ONLINE', '7')]);
    return store;
}

function summary(status: MachineSummary['status'], machineRevision: string): MachineSummary {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point d’eau Liberté',
        address: 'Avenue de la Liberté, Dakar',
        coordinates: { latitude: 14.716677, longitude: -17.467686 },
        distanceMeters: 120,
        price: {
            amountPerLiter: '25.00' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        status,
        machineRevision: machineRevision as MachineRevision,
    };
}

function detail(status: MachineDetail['status'], selectable: boolean, machineRevision: string): MachineDetail {
    return {
        ...summary(status, machineRevision),
        selectable,
        refreshedAt: '2026-08-18T10:00:00.000Z',
    };
}
