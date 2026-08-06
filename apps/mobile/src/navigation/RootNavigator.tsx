import { NavigationContainer } from '@react-navigation/native';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthFlowProvider } from '../auth/auth-flow.context';
import { RegistrationFlowProvider, useRegistrationFlow } from '../auth/registration-flow.context';
import { WalletScreen } from '../wallet/screens/WalletScreen';

import { AuthNavigator, authNavigationRef } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';

import type { AuthApi, OtpVerified } from '../api/auth-api';
import type { AuthCompositionRoot } from '../auth/auth-composition-root';
import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';

export const RootNavigator = observer(
    ({
        api,
        referral,
        root,
        wallet,
    }: {
        api: AuthApi;
        referral?: ReferralCompositionRoot;
        root: AuthCompositionRoot;
        wallet: WalletCompositionRoot;
    }): React.JSX.Element => {
        const route = root.sessionStore.rootRoute;
        if (route === 'loading') {
            return (
                <Centered>
                    <ActivityIndicator />
                </Centered>
            );
        }
        if (route === 'offline') {
            return (
                <Centered>
                    <Text style={styles.title}>Connection unavailable</Text>
                    <Text style={styles.body}>Reconnect to restore your session.</Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => root.sessionFlow.retryRestore()}
                        style={styles.button}
                    >
                        <Text style={styles.buttonText}>Try again</Text>
                    </Pressable>
                </Centered>
            );
        }
        if (route === 'main') {
            if (referral) {
                return <MainNavigator onLogout={() => root.sessionFlow.logout()} referral={referral} wallet={wallet} />;
            }
            return <FallbackWallet wallet={wallet} onLogout={() => root.sessionFlow.logout()} />;
        }
        return (
            <NavigationContainer ref={authNavigationRef}>
                <RegistrationFlowProvider api={api} root={root}>
                    <AuthScope api={api} referral={referral} root={root} />
                </RegistrationFlowProvider>
            </NavigationContainer>
        );
    },
);

function FallbackWallet({ wallet, onLogout }: { wallet: WalletCompositionRoot; onLogout(): void }): React.JSX.Element {
    return <WalletScreen commands={wallet.flow} onLogout={onLogout} store={wallet.store} />;
}

function AuthScope({
    api,
    referral,
    root,
}: {
    api: AuthApi;
    referral: ReferralCompositionRoot | undefined;
    root: AuthCompositionRoot;
}): React.JSX.Element {
    const registration = useRegistrationFlow();
    useEffect(() => {
        if (!referral) return undefined;
        return referral.linkCoordinator.bindRegistration(registration.commands);
    }, [referral, registration.commands]);
    const onVerified = (result: OtpVerified): void => {
        registration.commands.begin(result);
    };
    return (
        <AuthFlowProvider
            api={api}
            root={root}
            getPendingPromoCode={() => registration.store.pendingPromoCode}
            onVerified={onVerified}
        >
            <AuthNavigator />
        </AuthFlowProvider>
    );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
    body: {
        color: '#526071',
        fontSize: 16,
        lineHeight: 24,
        marginTop: 8,
        maxWidth: 320,
        textAlign: 'center',
    },
    button: {
        backgroundColor: '#0068d9',
        borderRadius: 16,
        marginTop: 28,
        paddingHorizontal: 32,
        paddingVertical: 15,
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    centered: {
        alignItems: 'center',
        backgroundColor: '#f7fbff',
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    title: { color: '#102a56', fontSize: 26, fontWeight: '700' },
});
