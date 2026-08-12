import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';

import { ReferralScreen } from '../referral/screens/ReferralScreen';
import { WalletScreen } from '../wallet/screens/WalletScreen';

import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainStackParams = {
    Wallet: undefined;
    Referral: undefined;
};

interface MainNavigatorProps {
    wallet: WalletCompositionRoot;
    referral: ReferralCompositionRoot;
    onLogout(): void;
}

const Stack = createNativeStackNavigator<MainStackParams>();
export const mainNavigationRef = createNavigationContainerRef<MainStackParams>();

export const MainNavigator = observer(function MainNavigator({ wallet, referral, onLogout }: MainNavigatorProps): React.JSX.Element {
    const [navigationReady, setNavigationReady] = useState(false);
    const referralVisible = referral.availability.referralUiVisible;

    useEffect(() => {
        if (!navigationReady || referralVisible || !mainNavigationRef.isReady()) return;
        if (mainNavigationRef.getCurrentRoute()?.name === 'Referral') mainNavigationRef.navigate('Wallet');
    }, [navigationReady, referralVisible]);

    return (
        <NavigationContainer onReady={() => setNavigationReady(true)} ref={mainNavigationRef}>
            <Stack.Navigator initialRouteName="Wallet" screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Wallet">
                    {() => (
                        <WalletScreen
                            commands={wallet.flow}
                            onLogout={onLogout}
                            {...(referralVisible
                                ? { onOpenReferral: () => mainNavigationRef.navigate('Referral') }
                                : {})}
                            store={wallet.store}
                        />
                    )}
                </Stack.Screen>
                {referralVisible ? <Stack.Screen name="Referral">
                    {({ navigation }: NativeStackScreenProps<MainStackParams, 'Referral'>) => (
                        <ReferralScreen
                            available={referralVisible}
                            commands={referral.flow}
                            nativeActions={referral.nativeActions}
                            onBack={() => navigation.goBack()}
                            store={referral.store}
                        />
                    )}
                </Stack.Screen> : null}
            </Stack.Navigator>
        </NavigationContainer>
    );
});
