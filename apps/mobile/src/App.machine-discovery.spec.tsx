import { render, waitFor } from '@testing-library/react-native';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { MachineDiscoveryCompositionRoot } from './machine-discovery/machine-discovery-composition-root';

import type { PropsWithChildren } from 'react';

type SessionState = 'anonymous' | 'authenticated' | 'offline' | 'staleLegal';

interface AppHarness {
    accessToken: string | undefined;
    rootNavigatorProps:
        | {
              machineDiscovery?: { accessToken: string; root: unknown };
          }
        | undefined;
    sessionState: SessionState;
}

const appHarness = vi.hoisted<AppHarness>(() => ({
    accessToken: 'current-access-token',
    rootNavigatorProps: undefined,
    sessionState: 'authenticated',
}));

vi.mock('./device/installation-id', () => ({
    getOrCreateInstallationId: () => of('installation-machine-discovery'),
}));

vi.mock('./api/app-config-api', () => ({ FetchAppConfigApi: class {} }));
vi.mock('./api/auth-api', () => ({ FetchAuthApi: class {} }));
vi.mock('./api/referral-api', () => ({ FetchReferralApi: class {} }));
vi.mock('./api/wallet-api', () => ({ FetchWalletApi: class {} }));
vi.mock('./api/machine-discovery-api', () => ({ FetchMachineDiscoveryApi: class {} }));

vi.mock('./auth/auth.context', () => ({
    AuthRootProvider: ({ children }: PropsWithChildren) => children,
}));

vi.mock('./auth/auth-composition-root', () => ({
    AuthCompositionRoot: class {
        readonly featureAvailabilityStore = {};
        readonly sessionFlow = { restore: vi.fn() };
        readonly sessionStore = {
            get accessToken() {
                return appHarness.accessToken;
            },
            get rootRoute() {
                if (appHarness.sessionState === 'authenticated') return 'main';
                if (appHarness.sessionState === 'offline') return 'offline';
                if (appHarness.sessionState === 'staleLegal') return 'legal';
                return 'auth';
            },
            get state() {
                return appHarness.sessionState;
            },
        };

        dispose = vi.fn();
    },
}));

vi.mock('./referral/referral-composition-root', () => ({
    ReferralCompositionRoot: class {
        dispose = vi.fn();
    },
}));

vi.mock('./wallet/wallet-composition-root', () => ({
    WalletCompositionRoot: class {
        dispose = vi.fn();
    },
}));

vi.mock('./machine-discovery/machine-discovery-composition-root', () => ({
    MachineDiscoveryCompositionRoot: class {
        readonly dispose = vi.fn();
        readonly flow = {};
        readonly scanner = {};
        readonly store = {};
    },
}));

vi.mock('./machine-discovery/native/ExpoLocationAdapter', () => ({ ExpoLocationAdapter: class {} }));
vi.mock('./machine-discovery/native/ExpoScannerAdapter', () => ({ ExpoScannerAdapter: class {} }));
vi.mock('./machine-discovery/native/ReactNativeMapAdapter', () => ({ ReactNativeMapAdapter: class {} }));

vi.mock('./navigation/RootNavigator', () => ({
    RootNavigator: (props: AppHarness['rootNavigatorProps']) => {
        appHarness.rootNavigatorProps = props;
        return null;
    },
}));

describe('App machine-discovery composition', () => {
    beforeEach(() => {
        appHarness.accessToken = 'current-access-token';
        appHarness.rootNavigatorProps = undefined;
        appHarness.sessionState = 'authenticated';
    });

    it('passes the current authenticated machine-discovery scope through RootNavigator', async () => {
        const view = await render(<App />);

        await waitFor(() => expect(appHarness.rootNavigatorProps).toBeDefined());
        expect(appHarness.rootNavigatorProps?.machineDiscovery?.accessToken).toBe('current-access-token');
        expect(appHarness.rootNavigatorProps?.machineDiscovery?.root).toBeInstanceOf(MachineDiscoveryCompositionRoot);

        await view.unmount();
    });

    it.each<SessionState>(['anonymous', 'offline', 'staleLegal'])(
        'does not create a machine-discovery scope for a %s session',
        async (sessionState) => {
            appHarness.accessToken = undefined;
            appHarness.sessionState = sessionState;
            const view = await render(<App />);

            await waitFor(() => expect(appHarness.rootNavigatorProps).toBeDefined());
            expect(appHarness.rootNavigatorProps?.machineDiscovery).toBeUndefined();

            await view.unmount();
        },
    );
});
