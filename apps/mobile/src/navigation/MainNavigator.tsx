import { NavigationContainer, createNavigationContainerRef, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { observer } from 'mobx-react-lite';
import { Suspense, lazy, useEffect, useState } from 'react';

import { ReferralScreen } from '../referral/screens/ReferralScreen';
import { WalletScreen } from '../wallet/screens/WalletScreen';

import type { MachineSelectionHandoffHandler } from './machine-selection-handoff';
import type { MachineDiscoveryCompositionRoot } from '../machine-discovery/machine-discovery-composition-root';
import type { MachineId } from '../machine-discovery/machine-discovery.types';
import type { ReferralCompositionRoot } from '../referral/referral-composition-root';
import type { WalletCompositionRoot } from '../wallet/wallet-composition-root';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainStackParams = {
    Wallet: undefined;
    Referral: undefined;
    MachineDiscovery: undefined;
    MachineScanner: undefined;
    MachineDetail: { machineId: MachineId };
};

interface MainNavigatorProps {
    wallet: WalletCompositionRoot;
    referral: ReferralCompositionRoot;
    initialRouteName?: keyof MainStackParams;
    machineDiscovery?: MachineDiscoveryNavigationScope;
    onMachineSelectionHandoff?: MachineSelectionHandoffHandler;
    onLogout(): void;
}

export interface MachineDiscoveryNavigationScope {
    readonly accessToken: string;
    readonly root: MachineDiscoveryCompositionRoot;
}

const Stack = createNativeStackNavigator<MainStackParams>();
export const mainNavigationRef = createNavigationContainerRef<MainStackParams>();
const MachineDiscoveryScreen = lazy(async () => {
    const module = await import('../machine-discovery/screens/MachineDiscoveryScreen');
    return { default: module.MachineDiscoveryScreen };
});
const MachineDetailScreen = lazy(async () => {
    const module = await import('../machine-discovery/screens/MachineDetailScreen');
    return { default: module.MachineDetailScreen };
});
const MachineScannerScreen = lazy(async () => {
    const module = await import('../machine-discovery/screens/MachineScannerScreen');
    return { default: module.MachineScannerScreen };
});

export const MainNavigator = observer(function MainNavigator({
    wallet,
    referral,
    initialRouteName = 'Wallet',
    machineDiscovery,
    onMachineSelectionHandoff,
    onLogout,
}: MainNavigatorProps): React.JSX.Element {
    const [navigationReady, setNavigationReady] = useState(false);
    const referralVisible = referral.availability.referralUiVisible;

    useEffect(() => {
        if (!navigationReady || referralVisible || !mainNavigationRef.isReady()) return;
        if (mainNavigationRef.getCurrentRoute()?.name === 'Referral') mainNavigationRef.navigate('Wallet');
    }, [navigationReady, referralVisible]);

    return (
        <NavigationContainer onReady={() => setNavigationReady(true)} ref={mainNavigationRef}>
            <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Wallet">
                    {() => (
                        <WalletScreen
                            commands={wallet.flow}
                            onLogout={onLogout}
                            {...(machineDiscovery
                                ? { onOpenMachineDiscovery: () => mainNavigationRef.navigate('MachineDiscovery') }
                                : {})}
                            {...(referralVisible
                                ? { onOpenReferral: () => mainNavigationRef.navigate('Referral') }
                                : {})}
                            store={wallet.store}
                        />
                    )}
                </Stack.Screen>
                {referralVisible ? (
                    <Stack.Screen name="Referral">
                        {({ navigation }: NativeStackScreenProps<MainStackParams, 'Referral'>) => (
                            <ReferralScreen
                                available={referralVisible}
                                commands={referral.flow}
                                nativeActions={referral.nativeActions}
                                onBack={() => navigation.goBack()}
                                store={referral.store}
                            />
                        )}
                    </Stack.Screen>
                ) : null}
                {machineDiscovery ? (
                    <>
                        <Stack.Screen name="MachineDiscovery">
                            {({ navigation }: NativeStackScreenProps<MainStackParams, 'MachineDiscovery'>) => (
                                <MachineDiscoveryRoute navigation={navigation} scope={machineDiscovery} />
                            )}
                        </Stack.Screen>
                        <Stack.Screen name="MachineScanner">
                            {({ navigation }: NativeStackScreenProps<MainStackParams, 'MachineScanner'>) => (
                                <MachineScannerRoute navigation={navigation} scope={machineDiscovery} />
                            )}
                        </Stack.Screen>
                        <Stack.Screen name="MachineDetail">
                            {({ navigation }: NativeStackScreenProps<MainStackParams, 'MachineDetail'>) => (
                                <Suspense fallback={null}>
                                    <MachineDetailScreen
                                        accessToken={machineDiscovery.accessToken}
                                        commands={machineDiscovery.root.flow}
                                        onBack={() => navigation.goBack()}
                                        {...(onMachineSelectionHandoff === undefined
                                            ? {}
                                            : { onSelectionHandoff: onMachineSelectionHandoff })}
                                        store={machineDiscovery.root.store}
                                    />
                                </Suspense>
                            )}
                        </Stack.Screen>
                    </>
                ) : null}
            </Stack.Navigator>
        </NavigationContainer>
    );
});

function MachineDiscoveryRoute({
    navigation,
    scope,
}: {
    readonly navigation: NativeStackScreenProps<MainStackParams, 'MachineDiscovery'>['navigation'];
    readonly scope: MachineDiscoveryNavigationScope;
}): React.JSX.Element {
    const focused = useIsFocused();

    useEffect(() => {
        if (!focused) return;

        scope.root.flow.startDiscovery(scope.accessToken);
        return () => scope.root.flow.stopDiscovery();
    }, [focused, scope.accessToken, scope.root.flow]);

    return (
        <Suspense fallback={null}>
            <MachineDiscoveryScreen
                accessToken={scope.accessToken}
                commands={scope.root.flow}
                onBack={() => navigation.goBack()}
                onOpenMachine={(machineId) => mainNavigationRef.navigate('MachineDetail', { machineId })}
                onOpenManualEntry={() => mainNavigationRef.navigate('MachineScanner')}
                store={scope.root.store}
            />
        </Suspense>
    );
}

function MachineScannerRoute({
    navigation,
    scope,
}: {
    readonly navigation: NativeStackScreenProps<MainStackParams, 'MachineScanner'>['navigation'];
    readonly scope: MachineDiscoveryNavigationScope;
}): React.JSX.Element {
    const focused = useIsFocused();

    return (
        <Suspense fallback={null}>
            <MachineScannerScreen
                accessToken={scope.accessToken}
                commands={scope.root.flow}
                focused={focused}
                onCancel={() => navigation.goBack()}
                onOpenMachine={(machineId) => mainNavigationRef.navigate('MachineDetail', { machineId })}
                scanner={scope.root.scanner}
                store={scope.root.store}
            />
        </Suspense>
    );
}
