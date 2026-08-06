import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';

import { ApplyReferralCodeScreen } from '../referral/screens/ApplyReferralCodeScreen';
import { ReferralScreen } from '../referral/screens/ReferralScreen';
import { WalletScreen } from '../wallet/screens/WalletScreen';

import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainStackParams = {
    Wallet: undefined;
    Referral: undefined;
    ApplyReferralCode: undefined;
};

interface MainNavigatorProps {
    wallet: WalletCompositionRoot;
    referral: ReferralCompositionRoot;
    onLogout(): void;
}

const Stack = createNativeStackNavigator<MainStackParams>();
export const mainNavigationRef = createNavigationContainerRef<MainStackParams>();

export function MainNavigator({ wallet, referral, onLogout }: MainNavigatorProps): React.JSX.Element {
    const [navigationReady, setNavigationReady] = useState(false);

    useEffect(
        () =>
            referral.linkCoordinator.bindSignedInNavigation(() => {
                if (!mainNavigationRef.isReady()) return false;
                mainNavigationRef.navigate('ApplyReferralCode');
                return true;
            }),
        [navigationReady, referral.linkCoordinator],
    );

    return (
        <NavigationContainer onReady={() => setNavigationReady(true)} ref={mainNavigationRef}>
            <Stack.Navigator initialRouteName="Wallet" screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Wallet">
                    {() => (
                        <WalletScreen
                            commands={wallet.flow}
                            onLogout={onLogout}
                            onOpenReferral={() => mainNavigationRef.navigate('Referral')}
                            store={wallet.store}
                        />
                    )}
                </Stack.Screen>
                <Stack.Screen name="Referral">
                    {({ navigation }: NativeStackScreenProps<MainStackParams, 'Referral'>) => (
                        <ReferralScreen
                            commands={referral.flow}
                            nativeActions={referral.nativeActions}
                            onApplyCode={() => navigation.navigate('ApplyReferralCode')}
                            onBack={() => navigation.goBack()}
                            store={referral.store}
                        />
                    )}
                </Stack.Screen>
                <Stack.Screen name="ApplyReferralCode">
                    {({ navigation }: NativeStackScreenProps<MainStackParams, 'ApplyReferralCode'>) => (
                        <ApplyReferralCodeScreen
                            commands={referral.flow}
                            onBack={() => navigation.goBack()}
                            store={referral.store}
                        />
                    )}
                </Stack.Screen>
            </Stack.Navigator>
        </NavigationContainer>
    );
}
