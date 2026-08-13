import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { of } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachineRevision,
} from '../machine-discovery.types';
import type { MachineDiscoveryFlowService } from '../services/machine-discovery-flow.service';
import type { ReactElement } from 'react';
import type { Observable } from 'rxjs';

vi.mock('expo-camera', async () => {
    const { Pressable } = await import('react-native');

    return {
        CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (result: { data: string; type: string }) => void }) => (
            <Pressable
                accessibilityLabel="Simuler la détection du QR"
                onPress={() => onBarcodeScanned({ data: QR_VALUE, type: 'qr' })}
            />
        ),
    };
});

type ScannerCommands = Pick<MachineDiscoveryFlowService, 'cancelResolution' | 'resolveManualCode' | 'startScanner'>;

interface ScannerScreenController {
    startPreview(): Observable<boolean>;
    stopPreview(): void;
    cancel(): void;
    setFocused(focused: boolean): void;
    handleBarcodeScanned(result: { data: string; type: string }): void;
}

interface MachineScannerScreenProps {
    readonly accessToken: string;
    readonly commands: ScannerCommands;
    readonly focused: boolean;
    readonly onCancel: () => void;
    readonly onOpenMachine: (machineId: MachineId) => void;
    readonly scanner: ScannerScreenController;
    readonly store: MachineDiscoveryStore;
}

interface MachineScannerScreenModule {
    readonly MachineScannerScreen: (props: MachineScannerScreenProps) => ReactElement;
}

let MachineScannerScreen: (props: MachineScannerScreenProps) => ReactElement;

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const QR_VALUE = `kaynann://machine/v1/${MACHINE_ID}`;
const MANUAL_VALUE = 'DKR-LIBERTE-01';

beforeAll(async () => {
    const module = await vi.importActual<MachineScannerScreenModule>('./MachineScannerScreen');
    MachineScannerScreen = module.MachineScannerScreen;
});

describe('MachineScannerScreen', () => {
    it.each([
        ['denied', 'Accès à la caméra refusé'],
        ['restricted', 'Accès à la caméra limité'],
        ['revoked', 'Accès à la caméra révoqué'],
        ['unavailable', 'Caméra indisponible'],
    ] as const)('keeps manual identification available when camera access is %s', async (capability, message) => {
        const store = new MachineDiscoveryStore();
        store.setCapability('scanner', capability);
        const view = await renderScreen({ focused: false, store });

        expect(view.getByText(message)).toBeTruthy();
        expect(view.getByLabelText('Saisir le code manuellement')).toBeTruthy();
        expect(view.queryByLabelText('Simuler la détection du QR')).toBeNull();
    });

    it('starts the preview only while focused and stops it on focus loss', async () => {
        const scanner = createScanner();
        const harness = await renderScreen({ scanner });

        await waitFor(() => expect(scanner.startPreview).toHaveBeenCalledOnce());
        expect(scanner.setFocused).toHaveBeenLastCalledWith(true);

        await harness.rerender(
            <MachineScannerScreen
                accessToken={ACCESS_TOKEN}
                commands={harness.commands}
                focused={false}
                onCancel={harness.onCancel}
                onOpenMachine={harness.onOpenMachine}
                scanner={scanner}
                store={harness.store}
            />,
        );

        expect(scanner.setFocused).toHaveBeenLastCalledWith(false);
        expect(scanner.stopPreview).toHaveBeenCalledOnce();
    });

    it('explicitly cancels scanning, stops the preview, and selects no machine', async () => {
        const scanner = createScanner();
        const harness = await renderScreen({ scanner });

        await fireEvent.press(harness.getByLabelText('Annuler le scan'));

        expect(scanner.cancel).toHaveBeenCalledOnce();
        expect(harness.commands.cancelResolution).toHaveBeenCalledOnce();
        expect(harness.store.currentDetail).toBeUndefined();
        expect(harness.onOpenMachine).not.toHaveBeenCalled();
        expect(harness.onCancel).toHaveBeenCalledOnce();
    });

    it('offers a controlled keyboard-safe manual fallback with local empty-input validation', async () => {
        const harness = await renderScreen();

        await fireEvent.press(harness.getByLabelText('Saisir le code manuellement'));
        const form = harness.getByTestId('manual-machine-code-form');
        expect(form.type).toBe('KeyboardAvoidingView');

        await fireEvent.press(harness.getByTestId('manual-machine-code-submit'));
        expect(harness.getByText('Saisissez un code de machine')).toBeTruthy();
        expect(harness.commands.resolveManualCode).not.toHaveBeenCalled();

        await fireEvent.changeText(
            harness.getByTestId('manual-machine-code-input'),
            `  ${MANUAL_VALUE.toLowerCase()}  `,
        );
        await fireEvent.press(harness.getByTestId('manual-machine-code-submit'));

        expect(harness.commands.resolveManualCode).toHaveBeenCalledWith(
            ACCESS_TOKEN,
            `  ${MANUAL_VALUE.toLowerCase()}  `,
        );
    });

    it.each([
        ['MACHINE_CODE_INVALID', 'Code de machine invalide'],
        ['MACHINE_NOT_FOUND', 'Machine introuvable'],
    ] as const)('shows the safe non-retryable QR result for %s', async (code, message) => {
        const store = new MachineDiscoveryStore();
        store.setError({ code, retryable: false });
        const view = await renderScreen({ store });

        expect(view.getByText(message)).toBeTruthy();
        expect(view.queryByText(MACHINE_ID)).toBeNull();
        expect(view.queryByLabelText('Réessayer')).toBeNull();
    });

    it('retries a QR connectivity failure without turning it into a not-found result', async () => {
        const store = new MachineDiscoveryStore();
        store.setError({ code: 'OFFLINE', retryable: true });
        const harness = await renderScreen({ store });

        expect(harness.getByText('Connexion indisponible')).toBeTruthy();
        expect(harness.queryByText('Machine introuvable')).toBeNull();
        await fireEvent.press(harness.getByLabelText('Réessayer'));

        expect(harness.commands.startScanner).toHaveBeenCalledTimes(2);
        expect(harness.commands.startScanner).toHaveBeenLastCalledWith(ACCESS_TOKEN);
    });

    it('retries manual connectivity failure with the same controlled input', async () => {
        const store = new MachineDiscoveryStore();
        const harness = await renderScreen({ store });

        await fireEvent.press(harness.getByLabelText('Saisir le code manuellement'));
        await fireEvent.changeText(harness.getByTestId('manual-machine-code-input'), MANUAL_VALUE);
        await fireEvent.press(harness.getByTestId('manual-machine-code-submit'));
        await act(() => store.setError({ code: 'OFFLINE', retryable: true }));

        expect(harness.getByText('Connexion indisponible')).toBeTruthy();
        await fireEvent.press(harness.getByLabelText('Réessayer'));

        expect(harness.commands.resolveManualCode).toHaveBeenCalledTimes(2);
        expect(harness.commands.resolveManualCode).toHaveBeenLastCalledWith(ACCESS_TOKEN, MANUAL_VALUE);
    });

    it('forwards repeated detections to the scanner seam but opens the resolved card exactly once', async () => {
        const scanner = createScanner();
        const harness = await renderScreen({ scanner });

        await fireEvent.press(harness.getByLabelText('Simuler la détection du QR'));
        await fireEvent.press(harness.getByLabelText('Simuler la détection du QR'));
        expect(scanner.handleBarcodeScanned).toHaveBeenCalledTimes(2);

        await act(() => harness.store.setCurrentDetail(detail()));
        await waitFor(() => expect(harness.onOpenMachine).toHaveBeenCalledOnce());
        expect(harness.onOpenMachine).toHaveBeenCalledWith(MACHINE_ID);

        await act(() => harness.store.setCurrentDetail({ ...detail() }));
        expect(harness.onOpenMachine).toHaveBeenCalledOnce();
    });
});

async function renderScreen({
    focused = true,
    scanner = createScanner(),
    store = new MachineDiscoveryStore(),
}: {
    focused?: boolean;
    scanner?: ReturnType<typeof createScanner>;
    store?: MachineDiscoveryStore;
} = {}) {
    const commands = createCommands(store);
    const onCancel = vi.fn();
    const onOpenMachine = vi.fn();
    const view = await render(
        <MachineScannerScreen
            accessToken={ACCESS_TOKEN}
            commands={commands}
            focused={focused}
            onCancel={onCancel}
            onOpenMachine={onOpenMachine}
            scanner={scanner}
            store={store}
        />,
    );

    return { ...view, commands, onCancel, onOpenMachine, scanner, store };
}

function createCommands(store: MachineDiscoveryStore) {
    return {
        startScanner: vi.fn(() => store.setScannerState('scanning')),
        resolveManualCode: vi.fn(() => store.setScannerState('resolving')),
        cancelResolution: vi.fn(() => {
            store.setCurrentDetail(undefined);
            store.setScannerState('idle');
            store.setLoading('resolution', false);
        }),
    } satisfies ScannerCommands;
}

function createScanner(): ScannerScreenController & {
    readonly startPreview: ReturnType<typeof vi.fn<() => Observable<boolean>>>;
    readonly stopPreview: ReturnType<typeof vi.fn<() => void>>;
    readonly cancel: ReturnType<typeof vi.fn<() => void>>;
    readonly setFocused: ReturnType<typeof vi.fn<(focused: boolean) => void>>;
    readonly handleBarcodeScanned: ReturnType<typeof vi.fn<(result: { data: string; type: string }) => void>>;
} {
    return {
        startPreview: vi.fn<() => Observable<boolean>>(() => of(true)),
        stopPreview: vi.fn<() => void>(),
        cancel: vi.fn<() => void>(),
        setFocused: vi.fn<(focused: boolean) => void>(),
        handleBarcodeScanned: vi.fn<(result: { data: string; type: string }) => void>(),
    };
}

function detail(): MachineDetail {
    return {
        machineId: MACHINE_ID,
        displayName: 'Point d’eau Liberté',
        address: 'Avenue de la Liberté, Dakar',
        status: 'ONLINE',
        machineRevision: '7' as MachineRevision,
        price: {
            amountPerLiter: '25.00' as ExactMoneyString,
            currency: 'XOF' as CurrencyCode,
        },
        selectable: true,
        refreshedAt: '2026-08-18T10:00:00.000Z',
    };
}
