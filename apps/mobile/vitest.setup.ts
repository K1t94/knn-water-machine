import Module from 'node:module';

import { vi } from 'vitest';

import * as reactNativeMock from './src/testing/react-native';

import type React from 'react';

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

const nodeModule = Module as unknown as { _load: ModuleLoader };
const originalLoad = nodeModule._load;

// RNTL is CommonJS, so Vite aliases do not intercept its direct require.
nodeModule._load = (request, parent, isMain) =>
    request === 'react-native' ? reactNativeMock : originalLoad(request, parent, isMain);

const passthrough = ({ children }: { children?: React.ReactNode }): React.ReactNode => children;
const createNavigationRef = () => ({
    goBack: vi.fn(),
    isReady: vi.fn(() => true),
    navigate: vi.fn(),
    reset: vi.fn(),
});

vi.mock('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    deleteItemAsync: vi.fn().mockResolvedValue(undefined),
    getItemAsync: vi.fn().mockResolvedValue(null),
    isAvailableAsync: vi.fn().mockResolvedValue(true),
    setItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: passthrough,
    SafeAreaView: passthrough,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

vi.mock('@react-navigation/native', () => ({
    NavigationContainer: passthrough,
    createNavigationContainerRef: createNavigationRef,
    useNavigation: () => ({
        goBack: vi.fn(),
        navigate: vi.fn(),
        reset: vi.fn(),
    }),
}));

vi.mock('@react-navigation/native-stack', () => ({
    createNativeStackNavigator: () => ({
        Navigator: passthrough,
        Screen: ({ children, name }: { children?: unknown; name: string }) =>
            name === 'Wallet' && typeof children === 'function'
                ? children({ navigation: createNavigationRef(), route: { key: 'wallet', name } })
                : null,
    }),
}));

vi.mock('react-native-screens', () => ({
    enableScreens: vi.fn(),
}));
