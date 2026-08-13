import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDetailScreen } from './MachineDetailScreen';

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
import type { ComponentType, ReactNode } from 'react';

vi.mock('react-native-safe-area-context', async () => {
    const { View } = await import('react-native');

    return {
        SafeAreaView: ({ children }: { readonly children?: ReactNode }) => (
            <View testID="machine-detail-safe-area">{children}</View>
        ),
    };
});

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const CONFIRM_LABEL = 'Continuer avec ce point d’eau';

interface SelectionReadyCommands extends MachineDiscoveryCommands {
    confirmSelection(accessToken: string): void;
}

interface SelectionReadyScreenProps {
    readonly accessToken: string;
    readonly commands: SelectionReadyCommands;
    readonly onBack: () => void;
    readonly onSelectionHandoff: (handoff: MachineSelectionHandoff) => void;
    readonly store: MachineDiscoveryStore;
}

const SelectionReadyMachineDetailScreen = MachineDetailScreen as unknown as ComponentType<SelectionReadyScreenProps>;

describe('MachineDetailScreen selection', () => {
    it('uses the Safe Area and replaces the summary price and status with refreshed detail data', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('20.00', 'SERVICE'));
        store.setLoading('detail', true);
        const view = await renderScreen(store);

        expect(view.getByTestId('machine-detail-safe-area')).toBeTruthy();
        expect(view.getByLabelText('Actualisation du point d’eau')).toBeTruthy();
        expect(view.queryByText('20.00 XOF / L')).toBeNull();

        await act(() => {
            store.setCurrentDetail(detail('25.00', 'ONLINE', true));
            store.setLoading('detail', false);
        });

        expect(view.getByText('Point d’eau Liberté')).toBeTruthy();
        expect(view.getByText('Avenue de la Liberté, Dakar')).toBeTruthy();
        expect(view.getByText('25.00 XOF / L')).toBeTruthy();
        expect(view.getByText('ONLINE')).toBeTruthy();
        expect(view.queryByText('20.00 XOF / L')).toBeNull();
    });

    it.each<MachineDetail['status']>(['SERVICE', 'OFFLINE'])(
        'shows %s as unavailable and disables confirmation',
        async (status) => {
            const store = new MachineDiscoveryStore();
            store.setCurrentCard(summary('25.00', status));
            store.setCurrentDetail(detail('25.00', status, false));
            const view = await renderScreen(store);

            expect(view.getByText(status)).toBeTruthy();
            expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: true });

            await view.unmount();
        },
    );

    it('keeps a stale detail visible but disables confirmation and exposes no technical error', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('25.00', 'ONLINE'));
        store.setCurrentDetail(detail('25.00', 'OFFLINE', false));
        store.setError({ code: 'STALE_MACHINE_CONTEXT database_password=secret', retryable: false });
        const view = await renderScreen(store);

        expect(view.getByText('OFFLINE')).toBeTruthy();
        expect(view.getByRole('alert')).toBeTruthy();
        expect(view.queryByText(/STALE_MACHINE_CONTEXT|database_password|secret/)).toBeNull();
        expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('shows a safe retry for detail errors and delegates back navigation', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('25.00', 'ONLINE'));
        store.setError({ code: 'UPSTREAM_DATABASE_PASSWORD=secret', retryable: true });
        const commands = createCommands();
        const onBack = vi.fn();
        const view = await renderScreen(store, { commands, onBack });

        expect(view.getByRole('alert')).toBeTruthy();
        expect(view.queryByText(/UPSTREAM|DATABASE|secret/)).toBeNull();
        await fireEvent.press(view.getByLabelText('Réessayer la fiche du point d’eau'));
        expect(commands.openMachine).toHaveBeenCalledWith(ACCESS_TOKEN, MACHINE_ID);

        await fireEvent.press(view.getByLabelText('Retour aux points d’eau'));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('replaces stale context with the refreshed card and disables confirmation when it is no longer selectable', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('25.00', 'ONLINE', '7'));
        store.setCurrentDetail(detail('25.00', 'ONLINE', true, '7'));
        const view = await renderScreen(store);

        expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: false });

        await act(() => {
            store.setCurrentCard(summary('30.00', 'SERVICE', '8'));
            store.setCurrentDetail(detail('30.00', 'SERVICE', false, '8'));
            store.setError({ code: 'MACHINE_CONTEXT_CHANGED', retryable: false });
        });

        expect(view.getByText('30.00 XOF / L')).toBeTruthy();
        expect(view.getByText('SERVICE')).toBeTruthy();
        expect(view.queryByText('25.00 XOF / L')).toBeNull();
        expect(view.getByLabelText(CONFIRM_LABEL).props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('disables confirmation while selection is pending and ignores repeated taps', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('25.00', 'ONLINE'));
        store.setCurrentDetail(detail('25.00', 'ONLINE', true));
        const commands = createCommands();
        commands.confirmSelection.mockImplementation(() => store.setLoading('selection', true));
        const view = await renderScreen(store, { commands });
        const confirmation = view.getByLabelText(CONFIRM_LABEL);

        await act(() => fireEvent.press(confirmation));
        await act(() => fireEvent.press(confirmation));
        await act(() => fireEvent.press(confirmation));

        expect(commands.confirmSelection).toHaveBeenCalledOnce();
        expect(commands.confirmSelection).toHaveBeenCalledWith(ACCESS_TOKEN);
        expect(confirmation.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    });

    it('forwards the typed selection handoff once so navigation can continue', async () => {
        const store = new MachineDiscoveryStore();
        store.setCurrentCard(summary('25.00', 'ONLINE'));
        store.setCurrentDetail(detail('25.00', 'ONLINE', true));
        const onSelectionHandoff = vi.fn();
        await renderScreen(store, { onSelectionHandoff });
        const handoff = selectionHandoff();

        await act(() => store.setSelectionHandoff(handoff));

        expect(onSelectionHandoff).toHaveBeenCalledOnce();
        expect(onSelectionHandoff).toHaveBeenCalledWith(handoff);
    });
});

function createCommands() {
    return {
        discover: vi.fn(),
        updateViewport: vi.fn(),
        refresh: vi.fn(),
        loadNextPage: vi.fn(),
        setViewMode: vi.fn(),
        openMachine: vi.fn(),
        confirmSelection: vi.fn(),
    } satisfies SelectionReadyCommands;
}

function renderScreen(store: MachineDiscoveryStore, overrides: Partial<SelectionReadyScreenProps> = {}) {
    return render(
        <SelectionReadyMachineDetailScreen
            accessToken={ACCESS_TOKEN}
            commands={createCommands()}
            onBack={vi.fn()}
            onSelectionHandoff={vi.fn()}
            store={store}
            {...overrides}
        />,
    );
}

function summary(amountPerLiter: string, status: MachineSummary['status'], machineRevision = '7'): MachineSummary {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point d’eau Liberté',
        address: 'Avenue de la Liberté, Dakar',
        coordinates: { latitude: 14.716677, longitude: -17.467686 },
        distanceMeters: 120,
        price: {
            amountPerLiter: amountPerLiter as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        status,
        machineRevision: machineRevision as MachineRevision,
    };
}

function detail(
    amountPerLiter: string,
    status: MachineDetail['status'],
    selectable: boolean,
    machineRevision = '7',
): MachineDetail {
    return {
        ...summary(amountPerLiter, status, machineRevision),
        selectable,
        refreshedAt: '2026-08-17T10:00:00.000Z',
    };
}

function selectionHandoff(): MachineSelectionHandoff {
    return {
        machineId: MACHINE_ID,
        machineRevision: '7' as MachineRevision,
        price: {
            amountPerLiter: '25.00' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        availability: 'ONLINE',
        validatedAt: '2026-08-17T10:00:01.000Z',
    };
}
