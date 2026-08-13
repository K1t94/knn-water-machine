import './mobx.config';

import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { asyncScheduler } from 'rxjs';

import { FetchAppConfigApi } from './api/app-config-api';
import { FetchAuthApi } from './api/auth-api';
import { FetchMachineDiscoveryApi } from './api/machine-discovery-api';
import { FetchReferralApi } from './api/referral-api';
import { FetchWalletApi } from './api/wallet-api';
import { AuthCompositionRoot } from './auth/auth-composition-root';
import { AuthRootProvider } from './auth/auth.context';
import {
    DevelopmentWebRegistrationAuthorizationStorage,
    SecureRegistrationAuthorizationStorage,
} from './auth/storage/registration-authorization.storage';
import { DevelopmentWebSessionStorage, SecureSessionStorage } from './auth/storage/session.storage';
import { getOrCreateInstallationId } from './device/installation-id';
import { MachineDiscoveryCompositionRoot } from './machine-discovery/machine-discovery-composition-root';
import { ExpoLocationAdapter } from './machine-discovery/native/ExpoLocationAdapter';
import { ExpoScannerAdapter } from './machine-discovery/native/ExpoScannerAdapter';
import { ReactNativeMapAdapter } from './machine-discovery/native/ReactNativeMapAdapter';
import { RootNavigator } from './navigation/RootNavigator';
import { ReferralCompositionRoot } from './referral/referral-composition-root';
import { WalletCompositionRoot } from './wallet/wallet-composition-root';

import type { MachineDiscoveryNavigationScope } from './navigation/MainNavigator';

const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;
const machineServiceAreaCode = (process.env.EXPO_PUBLIC_MACHINE_SERVICE_AREA_CODE ?? 'dakar') as string;

export default function App(): React.JSX.Element {
    const [composition, setComposition] = useState<{
        api: FetchAuthApi;
        referral: ReferralCompositionRoot;
        root: AuthCompositionRoot;
        wallet: WalletCompositionRoot;
    }>();
    const [initializationFailed, setInitializationFailed] = useState(false);

    useEffect(() => {
        let createdRoot: AuthCompositionRoot | undefined;
        let createdReferral: ReferralCompositionRoot | undefined;
        let createdWallet: WalletCompositionRoot | undefined;
        const subscription = getOrCreateInstallationId().subscribe({
            next: (id) => {
                const api = new FetchAuthApi(apiUrl, id);
                createdRoot = new AuthCompositionRoot(
                    api,
                    createSessionStorage(),
                    createRegistrationStorage(),
                    new FetchAppConfigApi(apiUrl),
                );
                createdWallet = new WalletCompositionRoot(
                    new FetchWalletApi(apiUrl),
                    createdRoot.sessionStore,
                    createdRoot.sessionFlow,
                );
                createdReferral = new ReferralCompositionRoot(
                    new FetchReferralApi(apiUrl),
                    createdRoot.sessionStore,
                    createdRoot.sessionFlow,
                    createdRoot.featureAvailabilityStore,
                );
                setComposition({ api, referral: createdReferral, root: createdRoot, wallet: createdWallet });
                createdRoot.sessionFlow.restore();
            },
            error: () => setInitializationFailed(true),
        });
        return () => {
            subscription.unsubscribe();
            createdReferral?.dispose();
            createdWallet?.dispose();
            createdRoot?.dispose();
        };
    }, []);

    if (initializationFailed) {
        return (
            <View style={styles.loading}>
                <Text>Secure storage is unavailable.</Text>
            </View>
        );
    }

    if (!composition) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <SafeAreaProvider>
            <AuthRootProvider root={composition.root}>
                <AppShell composition={composition} />
            </AuthRootProvider>
        </SafeAreaProvider>
    );
}

interface AppComposition {
    readonly api: FetchAuthApi;
    readonly referral: ReferralCompositionRoot;
    readonly root: AuthCompositionRoot;
    readonly wallet: WalletCompositionRoot;
}

const AppShell = observer(function AppShell({ composition }: { composition: AppComposition }): React.JSX.Element {
    const { accessToken, state } = composition.root.sessionStore;

    if (state === 'authenticated' && accessToken !== undefined) {
        return <AuthenticatedAppShell accessToken={accessToken} composition={composition} key={accessToken} />;
    }

    return (
        <RootNavigator
            api={composition.api}
            referral={composition.referral}
            root={composition.root}
            wallet={composition.wallet}
        />
    );
});

function AuthenticatedAppShell({
    accessToken,
    composition,
}: {
    readonly accessToken: string;
    readonly composition: AppComposition;
}): React.JSX.Element {
    const [machineDiscovery, setMachineDiscovery] = useState<MachineDiscoveryNavigationScope>();

    useLayoutEffect(() => {
        const scope: MachineDiscoveryNavigationScope = {
            accessToken,
            root: new MachineDiscoveryCompositionRoot({
                api: new FetchMachineDiscoveryApi(apiUrl),
                clock: asyncScheduler,
                location: new ExpoLocationAdapter(),
                map: new ReactNativeMapAdapter(),
                scanner: new ExpoScannerAdapter(),
                serviceAreaCode: machineServiceAreaCode,
                timers: asyncScheduler,
            }),
        };
        setMachineDiscovery(scope);

        return () => scope.root.dispose();
    }, [accessToken]);

    const currentMachineDiscovery = machineDiscovery?.accessToken === accessToken ? machineDiscovery : undefined;

    return (
        <RootNavigator
            api={composition.api}
            {...(currentMachineDiscovery === undefined ? {} : { machineDiscovery: currentMachineDiscovery })}
            referral={composition.referral}
            root={composition.root}
            wallet={composition.wallet}
        />
    );
}

function createSessionStorage() {
    if (Platform.OS !== 'web') return new SecureSessionStorage();
    if (!__DEV__) throw new Error('Web session storage is development-only');
    return new DevelopmentWebSessionStorage();
}

function createRegistrationStorage() {
    if (Platform.OS !== 'web') {
        return new SecureRegistrationAuthorizationStorage();
    }
    if (!__DEV__) {
        throw new Error('Web registration storage is development-only');
    }
    return new DevelopmentWebRegistrationAuthorizationStorage();
}

const styles = StyleSheet.create({
    loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
