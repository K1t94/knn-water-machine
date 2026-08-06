import './mobx.config';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FetchAuthApi } from './api/auth-api';
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
import { RootNavigator } from './navigation/RootNavigator';
import { ReferralCompositionRoot } from './referral/referral-composition-root';
import { WalletCompositionRoot } from './wallet/wallet-composition-root';

const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;

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
                createdRoot = new AuthCompositionRoot(api, createSessionStorage(), createRegistrationStorage());
                createdWallet = new WalletCompositionRoot(
                    new FetchWalletApi(apiUrl),
                    createdRoot.sessionStore,
                    createdRoot.sessionFlow,
                );
                createdReferral = new ReferralCompositionRoot(
                    new FetchReferralApi(apiUrl),
                    createdRoot.sessionStore,
                    createdRoot.sessionFlow,
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
                <RootNavigator
                    api={composition.api}
                    referral={composition.referral}
                    root={composition.root}
                    wallet={composition.wallet}
                />
            </AuthRootProvider>
        </SafeAreaProvider>
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
