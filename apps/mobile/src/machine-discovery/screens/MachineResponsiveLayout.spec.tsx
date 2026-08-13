import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setWindowDimensionsForTests } from '../../testing/react-native';
import { MachineDiscoveryStore } from '../stores/machine-discovery.store';

import { MachineDetailScreen } from './MachineDetailScreen';
import { MachineDiscoveryScreen } from './MachineDiscoveryScreen';
import { MachineScannerScreen } from './MachineScannerScreen';

import type {
    CurrencyCode,
    ExactMoneyString,
    MachineDetail,
    MachineId,
    MachineRevision,
} from '../machine-discovery.types';
import type { ScannerPreviewController } from '../native/ScannerAdapter';
import type {
    MachineDiscoveryCommands,
    MachineDiscoveryFlowService,
} from '../services/machine-discovery-flow.service';
import type { ReactNode } from 'react';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

vi.mock('react-native-safe-area-context', async () => {
    const { View } = await import('react-native');

    return {
        SafeAreaView: ({
            children,
            edges = ['top', 'right', 'bottom', 'left'],
            ...props
        }: {
            readonly children?: ReactNode;
            readonly edges?: readonly string[];
            readonly style?: StyleProp<ViewStyle>;
        }) => {
            const viewProps = { ...props, edges, testID: 'responsive-safe-area' } as ViewProps;
            return <View {...viewProps}>{children}</View>;
        },
    };
});

vi.mock('../components/MachineMap', async () => {
    const { View } = await import('react-native');

    return {
        MachineMap: ({ style }: { readonly style?: StyleProp<ViewStyle> }) => (
            <View style={style} testID="responsive-machine-map" />
        ),
    };
});

vi.mock('../components/MachineList', async () => {
    const { View } = await import('react-native');

    return {
        MachineList: ({ style }: { readonly style?: StyleProp<ViewStyle> }) => (
            <View style={style} testID="responsive-machine-list" />
        ),
    };
});

vi.mock('expo-camera', async () => {
    const { View } = await import('react-native');

    return {
        CameraView: (props: { readonly active: boolean }) => (
            <View {...props} testID="responsive-camera-preview" />
        ),
    };
});

const ACCESS_TOKEN = 'access-token';
const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const SAFE_AREA_EDGES = ['top', 'right', 'bottom', 'left'];
const DEFAULT_VIEWPORT = { width: 390, height: 844 };
const VIEWPORTS = [
    { compact: true, height: 568, label: 'compact iOS', platform: 'ios', width: 320 },
    { compact: false, height: 932, label: 'large iOS', platform: 'ios', width: 430 },
    { compact: true, height: 640, label: 'compact Android', platform: 'android', width: 360 },
    { compact: false, height: 915, label: 'large Android', platform: 'android', width: 412 },
] as const;

afterEach(() => {
    setPlatform('ios');
    setWindowDimensionsForTests(DEFAULT_VIEWPORT);
});

describe('machine screen responsive layout', () => {
    it.each(VIEWPORTS)(
        'keeps discovery usable on a $label viewport',
        async ({ compact, height, platform, width }) => {
            setPlatform(platform);
            setWindowDimensionsForTests({ width, height });
            const store = storeWithDetail();
            store.replaceCatalog([detail()]);
            const view = await render(
                <MachineDiscoveryScreen
                    accessToken={ACCESS_TOKEN}
                    commands={createDiscoveryCommands()}
                    onOpenMachine={vi.fn()}
                    store={store}
                />,
            );

            expect(view.getByTestId('responsive-safe-area').props.edges).toEqual(SAFE_AREA_EDGES);
            expect(flattenStyle(view.getByTestId('machine-discovery-page').props.style)).toMatchObject({
                maxWidth: 720,
                paddingHorizontal: compact ? 12 : 20,
            });
            expect(flattenStyle(view.getByTestId('responsive-machine-map').props.style)).toMatchObject(
                compact ? { maxHeight: 220, minHeight: 180 } : { flexShrink: 0 },
            );
            expect(flattenStyle(view.getByTestId('machine-discovery-map-list').props.style)).toMatchObject({
                minHeight: compact ? 140 : 180,
            });
            expect(view.getByTestId('responsive-machine-list')).toBeTruthy();
        },
    );

    it.each(VIEWPORTS)(
        'keeps detail content scrollable on a $label viewport',
        async ({ compact, height, platform, width }) => {
            setPlatform(platform);
            setWindowDimensionsForTests({ width, height });
            const view = await render(
                <MachineDetailScreen
                    accessToken={ACCESS_TOKEN}
                    commands={createDetailCommands()}
                    onBack={vi.fn()}
                    store={storeWithDetail()}
                />,
            );

            expect(view.getByTestId('responsive-safe-area').props.edges).toEqual(SAFE_AREA_EDGES);
            expect(flattenStyle(view.getByTestId('machine-detail-page').props.style)).toMatchObject({ maxWidth: 680 });
            expect(flattenStyle(view.getByTestId('machine-detail-header').props.style)).toMatchObject({
                paddingHorizontal: compact ? 12 : 20,
            });
            expect(flattenStyle(view.getByTestId('machine-detail-scroll').props.contentContainerStyle)).toMatchObject({
                paddingBottom: compact ? 28 : 44,
                paddingHorizontal: compact ? 16 : 22,
            });
            expect(view.getByTestId('machine-detail-scroll').type).toBe('ScrollView');
        },
    );

    it.each(VIEWPORTS)(
        'keeps scanner controls visible on a $label viewport',
        async ({ compact, height, platform, width }) => {
            setPlatform(platform);
            setWindowDimensionsForTests({ width, height });
            const view = await renderScanner();

            expect(view.getByTestId('responsive-safe-area').props.edges).toEqual(SAFE_AREA_EDGES);
            expect(flattenStyle(view.getByTestId('machine-scanner-header').props.style)).toMatchObject({
                paddingHorizontal: compact ? 12 : 20,
            });
            expect(flattenStyle(view.getByTestId('machine-scanner-surface').props.style)).toMatchObject({
                marginHorizontal: compact ? 8 : 12,
            });
            expect(flattenStyle(view.getByTestId('machine-scanner-target').props.style)).toMatchObject(
                compact
                    ? { marginBottom: 104, marginTop: 20, maxHeight: 220, maxWidth: 220 }
                    : { marginBottom: 126, marginTop: 42, maxHeight: 320, maxWidth: 320 },
            );
        },
    );

    it.each(['ios', 'android'] as const)('keeps manual entry keyboard-safe and scrollable on %s', async (platform) => {
        setPlatform(platform);
        setWindowDimensionsForTests({ width: 320, height: 568 });
        const view = await renderScanner();

        await fireEvent.press(view.getByLabelText('Saisir le code manuellement'));

        expect(view.getByTestId('manual-machine-code-form').props.behavior).toBe(
            platform === 'ios' ? 'padding' : undefined,
        );
        const [scrollView] = view.container.queryAll((instance) => instance.type === 'ScrollView');
        expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    });

    it('unmounts the native camera as soon as the scanner route loses focus', async () => {
        const scanner = createScanner();
        const commands = createScannerCommands();
        const store = new MachineDiscoveryStore();
        const view = await render(
            <MachineScannerScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                focused
                onCancel={vi.fn()}
                onOpenMachine={vi.fn()}
                scanner={scanner}
                store={store}
            />,
        );

        await waitFor(() => expect(scanner.startPreview).toHaveBeenCalledOnce());
        expect(view.getByTestId('responsive-camera-preview')).toBeTruthy();

        await view.rerender(
            <MachineScannerScreen
                accessToken={ACCESS_TOKEN}
                commands={commands}
                focused={false}
                onCancel={vi.fn()}
                onOpenMachine={vi.fn()}
                scanner={scanner}
                store={store}
            />,
        );

        expect(view.queryByTestId('responsive-camera-preview')).toBeNull();
        expect(scanner.setFocused).toHaveBeenLastCalledWith(false);
        expect(scanner.stopPreview).toHaveBeenCalledOnce();
    });
});

function setPlatform(platform: 'ios' | 'android'): void {
    (Platform as { OS: string }).OS = platform;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.filter(Boolean).map(flattenStyle)) as Record<string, unknown>;
    }
    return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
}

function createDiscoveryCommands(): MachineDiscoveryCommands {
    return {
        discover: vi.fn(),
        updateViewport: vi.fn(),
        refresh: vi.fn(),
        loadNextPage: vi.fn(),
        setViewMode: vi.fn(),
        openMachine: vi.fn(),
    };
}

function createDetailCommands(): MachineDiscoveryCommands & { confirmSelection(accessToken: string): void } {
    return { ...createDiscoveryCommands(), confirmSelection: vi.fn() };
}

type ScannerCommands = Pick<MachineDiscoveryFlowService, 'cancelResolution' | 'resolveManualCode' | 'startScanner'>;

function createScannerCommands(): ScannerCommands {
    return {
        cancelResolution: vi.fn(),
        resolveManualCode: vi.fn(),
        startScanner: vi.fn(),
    };
}

function createScanner(): ScannerPreviewController & {
    readonly startPreview: ReturnType<typeof vi.fn<ScannerPreviewController['startPreview']>>;
    readonly stopPreview: ReturnType<typeof vi.fn<ScannerPreviewController['stopPreview']>>;
    readonly setFocused: ReturnType<typeof vi.fn<ScannerPreviewController['setFocused']>>;
} {
    return {
        startPreview: vi.fn<ScannerPreviewController['startPreview']>(() => of(true)),
        stopPreview: vi.fn<ScannerPreviewController['stopPreview']>(),
        cancel: vi.fn<ScannerPreviewController['cancel']>(),
        setFocused: vi.fn<ScannerPreviewController['setFocused']>(),
        handleBarcodeScanned: vi.fn<ScannerPreviewController['handleBarcodeScanned']>(),
    };
}

async function renderScanner() {
    return render(
        <MachineScannerScreen
            accessToken={ACCESS_TOKEN}
            commands={createScannerCommands()}
            focused
            onCancel={vi.fn()}
            onOpenMachine={vi.fn()}
            scanner={createScanner()}
            store={new MachineDiscoveryStore()}
        />,
    );
}

function storeWithDetail(): MachineDiscoveryStore {
    const store = new MachineDiscoveryStore();
    store.setCurrentDetail(detail());
    return store;
}

function detail(): MachineDetail {
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
        status: 'ONLINE',
        machineRevision: '7' as MachineRevision,
        selectable: true,
        refreshedAt: '2026-08-17T10:00:00.000Z',
    };
}
