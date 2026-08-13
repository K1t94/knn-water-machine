import { render, waitFor } from '@testing-library/react-native';
import { createElement } from 'react';
import { EMPTY, Observable, Subject, asyncScheduler } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

import type * as CompositionRootModule from './machine-discovery-composition-root';
import type { MachineCoordinates, MachineViewport } from './machine-discovery.types';
import type { LocationAdapter, NativeCapabilityState } from './native/LocationAdapter';
import type { MapAdapter } from './native/MapAdapter';
import type { ScannerRuntimeAdapter } from './native/ScannerAdapter';
import type { MachineDiscoveryApi } from './services/machine-discovery-flow.service';
import type * as MachineApiModule from '../api/machine-discovery-api';
import type { PropsWithChildren } from 'react';

type SessionState = 'anonymous' | 'authenticated' | 'offline' | 'staleLegal';

interface AppHarness {
    accessToken: string | undefined;
    accountKey: string | undefined;
    events: string[];
    rootNavigatorProps: { machineDiscovery?: { accessToken: string; root: TestCompositionRoot } } | undefined;
    roots: TestCompositionRoot[];
    sessionState: SessionState;
}

const appHarness = vi.hoisted<AppHarness>(() => ({
    accessToken: 'access-token-a',
    accountKey: 'account-a',
    events: [],
    rootNavigatorProps: undefined,
    roots: [],
    sessionState: 'authenticated',
}));

interface TestCompositionRoot {
    readonly dispose: ReturnType<typeof vi.fn>;
}

vi.mock('../device/installation-id', async () => {
    const { of } = await import('rxjs');
    return { getOrCreateInstallationId: () => of('installation-machine-discovery') };
});

vi.mock('mobx-react-lite', () => ({ observer: (component: unknown) => component }));

vi.mock('../api/app-config-api', () => ({ FetchAppConfigApi: class {} }));
vi.mock('../api/auth-api', () => ({ FetchAuthApi: class {} }));
vi.mock('../api/referral-api', () => ({ FetchReferralApi: class {} }));
vi.mock('../api/wallet-api', () => ({ FetchWalletApi: class {} }));
vi.mock('../api/machine-discovery-api', async (importOriginal) => ({
    ...(await importOriginal<typeof MachineApiModule>()),
    FetchMachineDiscoveryApi: class {},
}));

vi.mock('../auth/auth.context', () => ({
    AuthRootProvider: ({ children }: PropsWithChildren) => children,
}));

vi.mock('../auth/auth-composition-root', () => ({
    AuthCompositionRoot: class {
        readonly featureAvailabilityStore = {};
        readonly sessionFlow = { restore: vi.fn() };
        readonly sessionStore = {
            get accessToken() {
                return appHarness.accessToken;
            },
            get accountKey() {
                return appHarness.accountKey;
            },
            get state() {
                return appHarness.sessionState;
            },
        };

        dispose = vi.fn();
    },
}));

vi.mock('../referral/referral-composition-root', () => ({
    ReferralCompositionRoot: class {
        dispose = vi.fn();
    },
}));

vi.mock('../wallet/wallet-composition-root', () => ({
    WalletCompositionRoot: class {
        dispose = vi.fn();
    },
}));

vi.mock('./machine-discovery-composition-root', () => ({
    MachineDiscoveryCompositionRoot: class {
        readonly dispose: ReturnType<typeof vi.fn>;

        constructor() {
            const accountKey = appHarness.accountKey;
            this.dispose = vi.fn(() => appHarness.events.push(`dispose:${accountKey}`));
            appHarness.events.push(`create:${accountKey}`);
            appHarness.roots.push(this);
        }
    },
}));

vi.mock('./native/ExpoLocationAdapter', () => ({ ExpoLocationAdapter: class {} }));
vi.mock('./native/ExpoScannerAdapter', () => ({ ExpoScannerAdapter: class {} }));
vi.mock('./native/ReactNativeMapAdapter', () => ({ ReactNativeMapAdapter: class {} }));

vi.mock('../navigation/RootNavigator', () => ({
    RootNavigator: (props: AppHarness['rootNavigatorProps']) => {
        appHarness.rootNavigatorProps = props;
        return null;
    },
}));

describe('MachineDiscoveryCompositionRoot', () => {
    it('disposes active subscriptions and every native adapter exactly once', async () => {
        const { MachineDiscoveryCompositionRoot } =
            await vi.importActual<typeof CompositionRootModule>('./machine-discovery-composition-root');
        const api = new PendingApi();
        const location = new TestLocationAdapter();
        const scanner = new TestScannerAdapter();
        const map = new TestMapAdapter();
        const root = new MachineDiscoveryCompositionRoot({
            api,
            clock: asyncScheduler,
            location,
            map,
            scanner,
            serviceAreaCode: 'dakar',
            timers: asyncScheduler,
        });

        root.flow.discover('access-token', {
            mode: 'SERVICE_AREA',
            serviceAreaCode: 'dakar',
            viewport: null,
        });
        expect(api.activeSubscriptions).toBe(1);

        root.dispose();
        root.dispose();

        expect(api.activeSubscriptions).toBe(0);
        expect(location.dispose).toHaveBeenCalledTimes(1);
        expect(scanner.dispose).toHaveBeenCalledTimes(1);
        expect(map.dispose).toHaveBeenCalledTimes(1);
        expect(scanner.capabilityState.observed).toBe(false);
        expect(scanner.scanResults.observed).toBe(false);
    });

    it('exposes commands and MobX state without exposing long-lived public subjects', async () => {
        const { MachineDiscoveryCompositionRoot } =
            await vi.importActual<typeof CompositionRootModule>('./machine-discovery-composition-root');
        const root = new MachineDiscoveryCompositionRoot({
            api: new PendingApi(),
            clock: asyncScheduler,
            location: new TestLocationAdapter(),
            map: new TestMapAdapter(),
            scanner: new TestScannerAdapter(),
            serviceAreaCode: 'dakar',
            timers: asyncScheduler,
        });

        try {
            expect(Object.keys(root).sort()).toEqual(['flow', 'scanner', 'store']);
            expect(Object.values(root)).not.toContainEqual(expect.any(Subject));
        } finally {
            root.dispose();
        }
    });
});

describe('App account-bound machine-discovery lifetime', () => {
    beforeEach(() => {
        appHarness.accessToken = 'access-token-a';
        appHarness.accountKey = 'account-a';
        appHarness.events = [];
        appHarness.rootNavigatorProps = undefined;
        appHarness.roots = [];
        appHarness.sessionState = 'authenticated';
    });

    it.each(['anonymous', 'offline', 'staleLegal'] as const)(
        'tears down the authenticated scope after the session enters %s',
        async (sessionState) => {
            const view = await render(createElement(App));
            await waitFor(() => expect(appHarness.roots).toHaveLength(1));
            const authenticatedRoot = appHarness.roots[0];

            appHarness.accessToken = undefined;
            appHarness.accountKey = undefined;
            appHarness.sessionState = sessionState;
            await view.rerender(createElement(App));

            await waitFor(() => expect(authenticatedRoot.dispose).toHaveBeenCalledTimes(1));
            expect(appHarness.rootNavigatorProps?.machineDiscovery).toBeUndefined();

            await view.unmount();
        },
    );

    it('disposes the prior account scope before constructing its replacement', async () => {
        const view = await render(createElement(App));
        await waitFor(() => expect(appHarness.roots).toHaveLength(1));

        appHarness.accessToken = 'access-token-b';
        appHarness.accountKey = 'account-b';
        await view.rerender(createElement(App));

        await waitFor(() => expect(appHarness.roots).toHaveLength(2));
        expect(appHarness.events).toEqual(['create:account-a', 'dispose:account-a', 'create:account-b']);
        expect(appHarness.rootNavigatorProps?.machineDiscovery).toEqual({
            accessToken: 'access-token-b',
            root: appHarness.roots[1],
        });

        await view.unmount();
    });
});

class PendingApi implements MachineDiscoveryApi {
    activeSubscriptions = 0;

    request<T>(_accessToken: string, _request: MachineApiModule.MachineDiscoveryRequest<T>): Observable<T> {
        return new Observable<T>(() => {
            this.activeSubscriptions += 1;
            return () => {
                this.activeSubscriptions -= 1;
            };
        });
    }
}

class TestLocationAdapter implements LocationAdapter {
    readonly capabilityState$ = EMPTY;
    readonly dispose = vi.fn();

    getCurrentPosition(): Observable<MachineCoordinates> {
        return EMPTY;
    }
}

class TestScannerAdapter implements ScannerRuntimeAdapter {
    readonly capabilityState = new Subject<NativeCapabilityState>();
    readonly capabilityState$ = this.capabilityState.asObservable();
    readonly dispose = vi.fn();
    readonly scanResults = new Subject<string>();
    readonly scanResults$ = this.scanResults.asObservable();

    cancel(): void {}
    handleBarcodeScanned(_result: { readonly data: string; readonly type: string }): void {}
    setFocused(_focused: boolean): void {}
    startPreview(): Observable<boolean> {
        return EMPTY;
    }
    stopPreview(): void {}
}

class TestMapAdapter implements MapAdapter {
    readonly capabilityState$ = EMPTY;
    readonly dispose = vi.fn();
    readonly viewportChanges$ = EMPTY as Observable<MachineViewport>;
}
