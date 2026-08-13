import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureAvailabilityStore } from '../features/stores/feature-availability.store';
import { MachineDiscoveryStore } from '../machine-discovery/stores/machine-discovery.store';
import { ReferralStore } from '../referral/stores/referral.store';
import { WalletStore } from '../wallet/stores/wallet.store';

import { MainNavigator, mainNavigationRef } from './MainNavigator';

import type { MachineSelectionHandoff, MachineSelectionHandoffHandler } from './machine-selection-handoff';
import type { MachineDiscoveryCompositionRoot } from '../machine-discovery/machine-discovery-composition-root';
import type {
    CurrencyCode,
    ExactMoneyString,
    MachineId,
    MachineRevision,
} from '../machine-discovery/machine-discovery.types';
import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';
import type React from 'react';

const MACHINE_ID = '7mQ3LJvR9Gf2xK8pNc4YAw' as MachineId;
const navigationHarness = vi.hoisted(() => ({
    activeRoute: 'Wallet',
    detailParams: { machineId: '7mQ3LJvR9Gf2xK8pNc4YAw' },
    focused: true,
    goBack: vi.fn(),
}));
const scannerHarness = vi.hoisted(
    (): { commands: unknown | undefined; scanner: unknown | undefined; store: unknown | undefined } => ({
        commands: undefined,
        scanner: undefined,
        store: undefined,
    }),
);

vi.mock('@react-navigation/native', async () => {
    const { createElement, Fragment } = await import('react');
    return {
        NavigationContainer: ({ children }: { children?: React.ReactNode }) => createElement(Fragment, null, children),
        createNavigationContainerRef: () => ({
            getCurrentRoute: vi.fn(),
            isReady: vi.fn(() => true),
            navigate: vi.fn(),
        }),
        useIsFocused: () => navigationHarness.focused,
    };
});

vi.mock('@react-navigation/native-stack', () => ({
    createNativeStackNavigator: () => ({
        Navigator: ({ children }: { children?: React.ReactNode }) => children,
        Screen: ({
            children,
            name,
        }: {
            children?: (props: {
                navigation: { goBack(): void };
                route: { key: string; name: string; params?: { machineId: string } };
            }) => React.ReactNode;
            name: string;
        }) => {
            if (name !== navigationHarness.activeRoute || children === undefined) return null;
            return children({
                navigation: { goBack: navigationHarness.goBack },
                route: {
                    key: name.toLowerCase(),
                    name,
                    ...(name === 'MachineDetail' ? { params: navigationHarness.detailParams } : {}),
                },
            });
        },
    }),
}));

vi.mock('../machine-discovery/screens/MachineDiscoveryScreen', async () => {
    const { Pressable, Text } = await import('react-native');
    return {
        MachineDiscoveryScreen: ({
            accessToken,
            onOpenMachine,
            onOpenManualEntry,
        }: {
            accessToken: string;
            onOpenMachine(machineId: MachineId): void;
            onOpenManualEntry?(): void;
        }) => (
            <>
                <Pressable accessibilityLabel={`Découverte ${accessToken}`} onPress={() => onOpenMachine(MACHINE_ID)}>
                    <Text>Ouvrir la fiche</Text>
                </Pressable>
                <Pressable accessibilityLabel="Ouvrir le scanner" onPress={onOpenManualEntry}>
                    <Text>Scanner</Text>
                </Pressable>
            </>
        ),
    };
});

vi.mock('../machine-discovery/screens/MachineDetailScreen', async () => {
    const { Pressable, Text } = await import('react-native');
    return {
        MachineDetailScreen: ({
            accessToken,
            onBack,
            onSelectionHandoff,
        }: {
            accessToken: string;
            onBack(): void;
            onSelectionHandoff?: MachineSelectionHandoffHandler;
        }) => (
            <>
                <Pressable accessibilityLabel={`Fiche ${accessToken}`} onPress={onBack}>
                    <Text>Retour</Text>
                </Pressable>
                <Pressable
                    accessibilityLabel="Transmettre la sélection"
                    onPress={() => onSelectionHandoff?.(selectionHandoff())}
                >
                    <Text>Continuer</Text>
                </Pressable>
            </>
        ),
    };
});

vi.mock('../machine-discovery/screens/MachineScannerScreen', async () => {
    const { Pressable, Text } = await import('react-native');
    return {
        MachineScannerScreen: ({
            accessToken,
            commands,
            focused,
            onCancel,
            onOpenMachine,
            scanner,
            store,
        }: {
            accessToken: string;
            commands: unknown;
            focused: boolean;
            onCancel(): void;
            onOpenMachine(machineId: MachineId): void;
            scanner: unknown;
            store: unknown;
        }) => {
            scannerHarness.commands = commands;
            scannerHarness.scanner = scanner;
            scannerHarness.store = store;
            return (
                <>
                    <Pressable accessibilityLabel={`Scanner ${accessToken} ${String(focused)}`} onPress={onCancel}>
                        <Text>Annuler</Text>
                    </Pressable>
                    <Pressable accessibilityLabel="Résoudre le QR" onPress={() => onOpenMachine(MACHINE_ID)}>
                        <Text>Résoudre</Text>
                    </Pressable>
                </>
            );
        },
    };
});

describe('MainNavigator', () => {
    beforeEach(() => {
        navigationHarness.activeRoute = 'Wallet';
        navigationHarness.focused = true;
        navigationHarness.goBack.mockClear();
        scannerHarness.commands = undefined;
        scannerHarness.scanner = undefined;
        scannerHarness.store = undefined;
    });

    it('shows the referral entry only while availability is enabled', async () => {
        const referral = referralRoot(true);
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const view = await render(<MainNavigator onLogout={vi.fn()} referral={referral} wallet={walletRoot()} />);
        await fireEvent.press(view.getByLabelText('Ouvrir le parrainage'));
        expect(navigate).toHaveBeenCalledWith('Referral');
        await act(async () => referral.availability.disableFromReferralResponse());
        await waitFor(() => expect(view.queryByLabelText('Ouvrir le parrainage')).toBeNull());
        navigate.mockRestore();
    });

    it.each([false, undefined])('does not declare referral UI when enabled is %s', async (enabled) => {
        const referral = referralRoot(enabled === true);
        if (enabled === undefined) referral.availability.resetForSessionReplacement();
        const view = await render(<MainNavigator onLogout={vi.fn()} referral={referral} wallet={walletRoot()} />);
        expect(view.queryByLabelText('Ouvrir le parrainage')).toBeNull();
    });

    it('opens machine discovery from the visible Wallet action when a scope exists', async () => {
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscoveryRoot() }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await fireEvent.press(await view.findByRole('button', { name: /automate/i }));
        expect(navigate).toHaveBeenCalledWith('MachineDiscovery');
        navigate.mockRestore();
    });

    it('owns the discovery lifecycle across route focus, blur, refocus, and unmount', async () => {
        navigationHarness.activeRoute = 'MachineDiscovery';
        const machineDiscovery = machineDiscoveryRoot();
        const flow = lifecycleFlow(machineDiscovery);
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await waitFor(() => {
            expect(flow.startDiscovery).toHaveBeenCalledTimes(1);
            expect(flow.startDiscovery).toHaveBeenCalledWith('access-token');
        });

        await view.rerender(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );
        expect(flow.startDiscovery).toHaveBeenCalledTimes(1);

        navigationHarness.focused = false;
        await view.rerender(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );
        await waitFor(() => expect(flow.stopDiscovery).toHaveBeenCalledTimes(1));

        navigationHarness.focused = true;
        await view.rerender(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );
        await waitFor(() => expect(flow.startDiscovery).toHaveBeenCalledTimes(2));

        await view.unmount();
        expect(flow.stopDiscovery).toHaveBeenCalledTimes(2);
    });

    it('transfers the active discovery lifecycle when the authenticated scope is replaced', async () => {
        navigationHarness.activeRoute = 'MachineDiscovery';
        const firstRoot = machineDiscoveryRoot();
        const firstFlow = lifecycleFlow(firstRoot);
        const secondRoot = machineDiscoveryRoot();
        const secondFlow = lifecycleFlow(secondRoot);
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'first-access-token', root: firstRoot }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await waitFor(() => expect(firstFlow.startDiscovery).toHaveBeenCalledTimes(1));

        await view.rerender(
            <MainNavigator
                machineDiscovery={{ accessToken: 'replacement-access-token', root: secondRoot }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await waitFor(() => {
            expect(firstFlow.stopDiscovery).toHaveBeenCalledTimes(1);
            expect(secondFlow.startDiscovery).toHaveBeenCalledWith('replacement-access-token');
        });

        await view.unmount();
        expect(secondFlow.stopDiscovery).toHaveBeenCalledTimes(1);
    });

    it('does not expose the Wallet machine action without a machine-discovery scope', async () => {
        const view = await render(<MainNavigator onLogout={vi.fn()} referral={referralRoot(true)} wallet={walletRoot()} />);

        expect(view.queryByRole('button', { name: /automate/i })).toBeNull();
    });

    it('opens the typed machine-detail route from discovery without copying feature state', async () => {
        navigationHarness.activeRoute = 'MachineDiscovery';
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const machineDiscovery = machineDiscoveryRoot();
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        const discovery = await view.findByLabelText('Découverte access-token');
        await fireEvent.press(discovery);
        expect(navigate).toHaveBeenCalledWith('MachineDetail', { machineId: MACHINE_ID });
        expect(machineDiscovery.store.currentCard).toBeUndefined();
        navigate.mockRestore();
    });

    it('renders machine detail from the same injected scope and delegates back navigation', async () => {
        navigationHarness.activeRoute = 'MachineDetail';
        const machineDiscovery = machineDiscoveryRoot();
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await fireEvent.press(await view.findByLabelText('Fiche access-token'));
        expect(navigationHarness.goBack).toHaveBeenCalledOnce();
        expect(machineDiscovery.store.currentCard).toBeUndefined();
    });

    it('forwards the exact typed selection handoff without copying it into navigation state', async () => {
        navigationHarness.activeRoute = 'MachineDetail';
        const machineDiscovery = machineDiscoveryRoot();
        const onMachineSelectionHandoff = vi.fn<MachineSelectionHandoffHandler>();
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                onMachineSelectionHandoff={onMachineSelectionHandoff}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await fireEvent.press(await view.findByLabelText('Transmettre la sélection'));

        expect(onMachineSelectionHandoff).toHaveBeenCalledOnce();
        expect(onMachineSelectionHandoff).toHaveBeenCalledWith(selectionHandoff());
        expect(machineDiscovery.store.selectionHandoff).toBeUndefined();
    });

    it('opens the typed scanner route from discovery', async () => {
        navigationHarness.activeRoute = 'MachineDiscovery';
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscoveryRoot() }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        await fireEvent.press(await view.findByLabelText('Ouvrir le scanner'));
        expect(navigate).toHaveBeenCalledWith('MachineScanner');
        navigate.mockRestore();
    });

    it('renders the focused scanner from the same scope and delegates its navigation', async () => {
        navigationHarness.activeRoute = 'MachineScanner';
        navigationHarness.focused = false;
        const navigate = vi.spyOn(mainNavigationRef, 'navigate').mockImplementation(() => undefined);
        const machineDiscovery = machineDiscoveryRoot();
        const view = await render(
            <MainNavigator
                machineDiscovery={{ accessToken: 'access-token', root: machineDiscovery }}
                onLogout={vi.fn()}
                referral={referralRoot(true)}
                wallet={walletRoot()}
            />,
        );

        expect(await view.findByLabelText('Scanner access-token false')).toBeTruthy();
        expect(scannerHarness.commands).toBe(machineDiscovery.flow);
        expect(scannerHarness.scanner).toBe(machineDiscovery.scanner);
        expect(scannerHarness.store).toBe(machineDiscovery.store);

        await fireEvent.press(view.getByLabelText('Résoudre le QR'));
        expect(navigate).toHaveBeenCalledWith('MachineDetail', { machineId: MACHINE_ID });
        await fireEvent.press(view.getByLabelText('Scanner access-token false'));
        expect(navigationHarness.goBack).toHaveBeenCalledOnce();
        navigate.mockRestore();
    });

    it('does not contain the retired post-registration apply screen or route', () => {
        const mobileSourceRoot = join(__dirname, '..');
        const productionFiles = productionTypeScriptFiles(mobileSourceRoot);

        expect(productionFiles.some((path) => /ApplyReferralCodeScreen/.test(path))).toBe(false);
        expect(
            productionFiles.filter((path) =>
                /ApplyReferralCodeScreen|ApplyReferralCode|ReferralApplication/.test(readFileSync(path, 'utf8')),
            ),
        ).toEqual([]);
    });
});

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

function walletRoot(): WalletCompositionRoot {
    const store = new WalletStore();
    const token = store.beginInitialLoad();
    store.finishInitialLoad(
        token,
        { balanceMl: '0', balanceLiters: '0.000', observedAt: '2026-08-10T10:00:00.000Z' },
        { items: [], nextCursor: null, hasMore: false },
    );
    return {
        store,
        flow: { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn() },
    } as unknown as WalletCompositionRoot;
}
function referralRoot(enabled: boolean): ReferralCompositionRoot {
    const availability = new FeatureAvailabilityStore();
    availability.finishRefresh(availability.beginRefresh(), enabled);
    return {
        availability,
        store: new ReferralStore(),
        flow: { retry: vi.fn(), refresh: vi.fn(), loadNextPage: vi.fn() },
        nativeActions: { copyPromoCode: vi.fn(), shareReferralLink: vi.fn() },
        linkCoordinator: {},
    } as unknown as ReferralCompositionRoot;
}

function machineDiscoveryRoot(): MachineDiscoveryCompositionRoot {
    const scanner = {
        cancel: vi.fn(),
        capabilityState$: of('granted' as const),
        dispose: vi.fn(),
        handleBarcodeScanned: vi.fn(),
        scanResults$: of(),
        setFocused: vi.fn(),
        startPreview: vi.fn(() => of(true)),
        stopPreview: vi.fn(),
    };
    return {
        store: new MachineDiscoveryStore(),
        flow: {
            startDiscovery: vi.fn(),
            stopDiscovery: vi.fn(),
            discover: vi.fn(),
            updateViewport: vi.fn(),
            refresh: vi.fn(),
            loadNextPage: vi.fn(),
            setViewMode: vi.fn(),
            openMachine: vi.fn(),
        },
        scanner,
        dispose: vi.fn(),
    } as unknown as MachineDiscoveryCompositionRoot;
}

function lifecycleFlow(root: MachineDiscoveryCompositionRoot): {
    startDiscovery: ReturnType<typeof vi.fn>;
    stopDiscovery: ReturnType<typeof vi.fn>;
} {
    return root.flow as unknown as {
        startDiscovery: ReturnType<typeof vi.fn>;
        stopDiscovery: ReturnType<typeof vi.fn>;
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
