import '../../mobx.config';

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LaunchArguments } from 'react-native-launch-arguments';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { asyncScheduler, of } from 'rxjs';

import { FetchAuthApi } from '../../api/auth-api';
import { FetchMachineDiscoveryApi } from '../../api/machine-discovery-api';
import { FetchReferralApi } from '../../api/referral-api';
import { FetchWalletApi } from '../../api/wallet-api';
import { AuthCompositionRoot } from '../../auth/auth-composition-root';
import { AuthRootProvider } from '../../auth/auth.context';
import { RootNavigator } from '../../navigation/RootNavigator';
import { ReferralCompositionRoot } from '../../referral/referral-composition-root';
import { WalletCompositionRoot } from '../../wallet/wallet-composition-root';
import { MachineDiscoveryCompositionRoot } from '../machine-discovery-composition-root';
import { ExpoLocationAdapter } from '../native/ExpoLocationAdapter';
import { ExpoScannerAdapter } from '../native/ExpoScannerAdapter';
import { ReactNativeMapAdapter } from '../native/ReactNativeMapAdapter';

import {
    FetchMachineDiscoveryE2EControlTransport,
    MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
    registerMachineDiscoveryE2EBootstrap,
    resolveMachineDiscoveryE2EScenario,
} from './machine-discovery-e2e-bootstrap';

import type { SessionCredentials } from '../../api/auth-api';
import type { StoredRegistrationAuthorization } from '../../auth/storage/registration-authorization.storage';
import type { StoredSessionCredential } from '../../auth/storage/session.storage';
import type { MachineDiscoveryNavigationScope } from '../../navigation/MainNavigator';
import type { Observable } from 'rxjs';

const FIXTURE_ACCOUNT_ID = '20000000-0000-4000-8000-000000000124';
const FIXTURE_CATALOG_ID = 'machine-discovery-v1';
const FIXTURE_INSTALLATION_ID = 'machine-discovery-e2e-installation';

interface MachineDiscoveryE2ERuntimeConfig {
    readonly environment: string;
    readonly variant: string;
    readonly productionDistributable: boolean;
    readonly origin: string;
    readonly allowedOrigins: readonly string[];
    readonly controlCredential: string;
    readonly serviceAreaCode: string;
}

interface E2EComposition {
    readonly api: FetchAuthApi;
    readonly machineDiscovery: MachineDiscoveryNavigationScope;
    readonly referral: ReferralCompositionRoot;
    readonly root: AuthCompositionRoot;
    readonly wallet: WalletCompositionRoot;
}

export function MachineDiscoveryE2EApp(): React.JSX.Element {
    const [composition, setComposition] = useState<E2EComposition>();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        let created: E2EComposition | undefined;

        initializeMachineDiscoveryE2EComposition()
            .then((value) => {
                created = value;
                if (active) setComposition(value);
                else disposeComposition(value);
            })
            .catch(() => {
                if (active) setFailed(true);
            });

        return () => {
            active = false;
            if (created !== undefined) disposeComposition(created);
        };
    }, []);

    if (failed) {
        return (
            <View style={styles.centered}>
                <Text>Machine discovery E2E bootstrap unavailable.</Text>
            </View>
        );
    }
    if (composition === undefined) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <SafeAreaProvider>
            <AuthRootProvider root={composition.root}>
                <E2EAppShell composition={composition} />
            </AuthRootProvider>
        </SafeAreaProvider>
    );
}

const E2EAppShell = observer(function E2EAppShell({
    composition,
}: {
    readonly composition: E2EComposition;
}): React.JSX.Element {
    return (
        <RootNavigator
            api={composition.api}
            initialMainRoute="MachineDiscovery"
            machineDiscovery={composition.machineDiscovery}
            referral={composition.referral}
            root={composition.root}
            wallet={composition.wallet}
        />
    );
});

async function initializeMachineDiscoveryE2EComposition(): Promise<E2EComposition> {
    const config = loadMachineDiscoveryE2ERuntimeConfig({
        allowedOrigins: process.env.EXPO_PUBLIC_MACHINE_E2E_ALLOWED_ORIGINS,
        controlCredential: process.env.EXPO_PUBLIC_MACHINE_E2E_CONTROL_CREDENTIAL,
        environment: process.env.EXPO_PUBLIC_APP_ENV,
        origin: process.env.EXPO_PUBLIC_MACHINE_E2E_ORIGIN,
        productionDistributable: process.env.EXPO_PUBLIC_PRODUCTION_DISTRIBUTABLE,
        serviceAreaCode: process.env.EXPO_PUBLIC_MACHINE_SERVICE_AREA_CODE,
        variant: process.env.EXPO_PUBLIC_BUILD_VARIANT,
    });
    const api = new FetchAuthApi(config.origin, FIXTURE_INSTALLATION_ID);
    const root = new AuthCompositionRoot(api, new E2ESessionStorage(), new E2ERegistrationStorage());
    const wallet = new WalletCompositionRoot(new FetchWalletApi(config.origin), root.sessionStore, root.sessionFlow);
    const referral = new ReferralCompositionRoot(
        new FetchReferralApi(config.origin),
        root.sessionStore,
        root.sessionFlow,
        root.featureAvailabilityStore,
    );
    let scope: MachineDiscoveryNavigationScope | undefined;

    try {
        const scenario = resolveMachineDiscoveryE2EScenario(LaunchArguments.value<Record<string, unknown>>());
        const bootstrap = registerMachineDiscoveryE2EBootstrap({
            acceptanceTime: MACHINE_DISCOVERY_E2E_ACCEPTANCE_TIME,
            allowedFixtureOrigins: config.allowedOrigins,
            build: {
                environment: config.environment,
                productionDistributable: config.productionDistributable,
                variant: config.variant,
            },
            control: new FetchMachineDiscoveryE2EControlTransport(config.origin),
            controlCredential: { provenance: 'fixture-e2e', value: config.controlCredential },
            controlEndpoint: { origin: config.origin, provenance: 'fixture' },
            createMachineDiscoveryRoot: ({ clock, machineApiOrigin }) =>
                new MachineDiscoveryCompositionRoot({
                    api: new FetchMachineDiscoveryApi(machineApiOrigin),
                    clock,
                    location: new ExpoLocationAdapter(),
                    map: new ReactNativeMapAdapter(),
                    scanner: new ExpoScannerAdapter(),
                    serviceAreaCode: config.serviceAreaCode,
                    timers: asyncScheduler,
                }),
            fixtureAccountId: FIXTURE_ACCOUNT_ID,
            fixtureCatalogId: FIXTURE_CATALOG_ID,
            injectMachineDiscoveryScope: (value) => {
                scope = value;
            },
            acceptSession: (credentials: SessionCredentials) => root.acceptSession(credentials),
            ...(scenario === undefined ? {} : { scenario }),
        });
        await bootstrap.start();
        if (scope === undefined || root.sessionStore.state !== 'authenticated') {
            throw new Error('Machine discovery E2E bootstrap did not authenticate the fixture composition.');
        }
        return { api, machineDiscovery: scope, referral, root, wallet };
    } catch (error: unknown) {
        scope?.root.dispose();
        referral.dispose();
        wallet.dispose();
        root.dispose();
        throw error;
    }
}

export function loadMachineDiscoveryE2ERuntimeConfig(input: {
    readonly allowedOrigins: unknown;
    readonly controlCredential: unknown;
    readonly environment: unknown;
    readonly origin: unknown;
    readonly productionDistributable: unknown;
    readonly serviceAreaCode: unknown;
    readonly variant: unknown;
}): MachineDiscoveryE2ERuntimeConfig {
    const environment = requireString(input.environment, 'environment');
    const variant = requireString(input.variant, 'build variant');
    const origin = requireString(input.origin, 'fixture origin');
    const controlCredential = requireString(input.controlCredential, 'fixture credential');
    const allowedOrigins = requireString(input.allowedOrigins, 'fixture allowlist')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    if (allowedOrigins.length === 0) throw new Error('Machine discovery E2E fixture allowlist is empty.');
    if (input.productionDistributable !== 'false') {
        throw new Error('Machine discovery E2E runtime requires a non-distributable build.');
    }

    return {
        allowedOrigins,
        controlCredential,
        environment,
        origin,
        productionDistributable: false,
        serviceAreaCode:
            typeof input.serviceAreaCode === 'string' && input.serviceAreaCode.trim() !== ''
                ? input.serviceAreaCode.trim()
                : 'dakar',
        variant,
    };
}

class E2ESessionStorage {
    private stored: StoredSessionCredential | undefined;

    load(): Observable<StoredSessionCredential | undefined> {
        return of(this.stored);
    }

    replace(value: StoredSessionCredential): Observable<void> {
        this.stored = value;
        return of(undefined);
    }

    clear(): Observable<void> {
        this.stored = undefined;
        return of(undefined);
    }
}

class E2ERegistrationStorage {
    load(): Observable<StoredRegistrationAuthorization | undefined> {
        return of(undefined);
    }

    save(_value: StoredRegistrationAuthorization): Observable<void> {
        return of(undefined);
    }

    clear(): Observable<void> {
        return of(undefined);
    }
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Machine discovery E2E runtime requires ${label}.`);
    }
    return value.trim();
}

function disposeComposition(composition: E2EComposition): void {
    composition.machineDiscovery.root.dispose();
    composition.referral.dispose();
    composition.wallet.dispose();
    composition.root.dispose();
}

const styles = StyleSheet.create({
    centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
