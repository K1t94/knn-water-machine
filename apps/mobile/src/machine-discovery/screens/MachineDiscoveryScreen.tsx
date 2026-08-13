import { observer } from 'mobx-react-lite';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MachineDiscoveryState } from '../components/MachineDiscoveryState';
import { MachineList } from '../components/MachineList';
import { MachineMap } from '../components/MachineMap';

import type { MachineDiscoveryStateVariant } from '../components/MachineDiscoveryState';
import type { MachineId, MachineViewport } from '../machine-discovery.types';
import type { NativeCapabilityState } from '../native/LocationAdapter';
import type { MapRegion } from '../native/MapAdapter';
import type { MachineDiscoveryCommands } from '../services/machine-discovery-flow.service';
import type { MachineDiscoveryStore, MachineDiscoveryViewMode } from '../stores/machine-discovery.store';

interface MachineDiscoveryScreenProps {
    readonly accessToken: string;
    readonly commands: MachineDiscoveryCommands;
    readonly store: MachineDiscoveryStore;
    readonly onOpenMachine: (machineId: MachineId) => void;
    readonly onBack?: () => void;
    readonly onOpenManualEntry?: () => void;
}

export const MachineDiscoveryScreen = observer(
    ({
        accessToken,
        commands,
        store,
        onOpenMachine,
        onBack,
        onOpenManualEntry,
    }: MachineDiscoveryScreenProps): React.JSX.Element => {
        const { height, width } = useWindowDimensions();
        const compactLayout = width <= 360 || height <= 700;
        const context = store.discoveryContext;
        const mapUnavailable = isCapabilityUnavailable(store.mapCapability);
        const locationUnavailable = isCapabilityUnavailable(store.locationCapability);
        const showMap = store.viewMode === 'map';
        const selectedMachineId = store.currentCard?.machineId;
        const catalogState = getCatalogState(store.catalogLoading, store.catalog.length, store.error?.code);

        const openMachine = (machineId: MachineId): void => {
            commands.openMachine(accessToken, machineId);
            onOpenMachine(machineId);
        };

        const setViewMode = (mode: MachineDiscoveryViewMode): void => {
            commands.setViewMode(mode);
        };

        const retryCatalog = (): void => {
            if (store.catalogLoading) return;
            commands.refresh();
        };

        const list = (
            <MachineList
                error={false}
                hasMore
                loading={false}
                machines={store.catalog}
                onLoadMore={() => commands.loadNextPage()}
                onMachinePress={openMachine}
                {...(selectedMachineId === undefined ? {} : { selectedMachineId })}
                style={styles.list}
            />
        );

        const state =
            catalogState === undefined ? null : (
                <MachineDiscoveryState
                    compact={store.catalog.length > 0}
                    context="catalog"
                    {...(store.error?.retryable === true ? { onRetry: retryCatalog } : {})}
                    style={styles.catalogState}
                    variant={catalogState}
                />
            );

        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={[styles.page, compactLayout && styles.compactPage]} testID="machine-discovery-page">
                    <View style={styles.header}>
                        {onBack === undefined ? (
                            <View style={styles.headerSide} />
                        ) : (
                            <Pressable
                                accessibilityLabel="Retour"
                                accessibilityRole="button"
                                onPress={onBack}
                                style={styles.headerSide}
                            >
                                <Text style={styles.backText}>‹ Retour</Text>
                            </Pressable>
                        )}
                        <View style={styles.headerTitleBlock}>
                            <Text style={styles.eyebrow}>POINTS D’EAU</Text>
                            <Text style={styles.title}>Trouver un point</Text>
                        </View>
                        {onOpenManualEntry === undefined ? (
                            <View style={styles.headerSide} />
                        ) : (
                            <Pressable
                                accessibilityLabel="Saisir un code manuellement"
                                accessibilityRole="button"
                                onPress={onOpenManualEntry}
                                style={[styles.headerSide, styles.manualButton]}
                            >
                                <Text style={styles.manualButtonText}>Code</Text>
                            </Pressable>
                        )}
                    </View>

                    {locationUnavailable ? (
                        <View
                            accessibilityLabel="Localisation indisponible"
                            accessibilityLiveRegion="polite"
                            style={styles.locationNotice}
                        >
                            <Text style={styles.locationTitle}>Localisation indisponible</Text>
                            {context?.mode === 'SERVICE_AREA' ? (
                                <View style={styles.serviceAreaRow}>
                                    <Text style={styles.locationBody}>Zone de service :</Text>
                                    <Text style={styles.serviceAreaCode}>{context.serviceAreaCode}</Text>
                                </View>
                            ) : (
                                <Text style={styles.locationBody}>
                                    La carte et la liste restent disponibles sans calcul de distance.
                                </Text>
                            )}
                        </View>
                    ) : null}

                    <View accessibilityRole="tablist" style={styles.viewSwitch}>
                        <ViewModeButton
                            active={showMap}
                            label="Carte"
                            onPress={() => setViewMode('map')}
                            screenReaderLabel="Afficher la carte"
                        />
                        <ViewModeButton
                            active={!showMap}
                            label="Liste"
                            onPress={() => setViewMode('list')}
                            screenReaderLabel="Afficher la liste"
                        />
                    </View>

                    {showMap ? (
                        <View style={styles.mapResults}>
                            <MachineMap
                                loading={store.catalogLoading}
                                machines={mapUnavailable ? [] : store.catalog}
                                onMachinePress={openMachine}
                                onRegionChangeComplete={(region) => commands.updateViewport(toViewport(region))}
                                unavailable={mapUnavailable}
                                {...(context === undefined ? {} : { initialViewport: context.viewport })}
                                {...(context?.mode === 'USER_LOCATION' ? { userPosition: context.position } : {})}
                                {...(selectedMachineId === undefined ? {} : { selectedMachineId })}
                                style={[styles.map, compactLayout && styles.compactMap]}
                            />
                            {state}
                            {store.catalog.length > 0 ? (
                                <View
                                    style={[styles.mapList, compactLayout && styles.compactMapList]}
                                    testID="machine-discovery-map-list"
                                >
                                    {list}
                                </View>
                            ) : null}
                        </View>
                    ) : (
                        <View style={styles.listResults}>
                            {state}
                            {store.catalog.length > 0 ? list : null}
                        </View>
                    )}
                </View>
            </SafeAreaView>
        );
    },
);

interface ViewModeButtonProps {
    readonly active: boolean;
    readonly label: string;
    readonly onPress: () => void;
    readonly screenReaderLabel: string;
}

function ViewModeButton({ active, label, onPress, screenReaderLabel }: ViewModeButtonProps): React.JSX.Element {
    return (
        <Pressable
            accessibilityLabel={screenReaderLabel}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={({ pressed }) => [styles.viewButton, active && styles.viewButtonActive, pressed && styles.pressed]}
        >
            <Text style={[styles.viewButtonText, active && styles.viewButtonTextActive]}>{label}</Text>
        </Pressable>
    );
}

function isCapabilityUnavailable(capability: NativeCapabilityState): boolean {
    return capability !== 'granted' && capability !== 'undetermined';
}

function getCatalogState(
    loading: boolean,
    catalogSize: number,
    errorCode: string | undefined,
): MachineDiscoveryStateVariant | undefined {
    if (loading) return 'loading';
    if (errorCode === 'DISCOVERY_CONTEXT_STALE') return 'stale';
    if (errorCode?.startsWith('OFFLINE') === true) return 'offline';
    if (errorCode !== undefined) return 'error';
    if (catalogSize === 0) return 'empty';
    return undefined;
}

function toViewport(region: MapRegion): MachineViewport {
    const latitudeRadius = region.latitudeDelta / 2;
    const longitudeRadius = region.longitudeDelta / 2;
    return {
        north: region.latitude + latitudeRadius,
        east: region.longitude + longitudeRadius,
        south: region.latitude - latitudeRadius,
        west: region.longitude - longitudeRadius,
    };
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#edf8f5', flex: 1 },
    page: { alignSelf: 'center', flex: 1, maxWidth: 720, paddingHorizontal: 20, width: '100%' },
    compactPage: { paddingHorizontal: 12 },
    header: { alignItems: 'center', flexDirection: 'row', minHeight: 76, paddingVertical: 10 },
    headerSide: { justifyContent: 'center', minHeight: 44, minWidth: 72 },
    headerTitleBlock: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
    eyebrow: { color: '#087f73', fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
    title: { color: '#12332f', fontSize: 24, fontWeight: '900', marginTop: 3, textAlign: 'center' },
    backText: { color: '#075b53', fontSize: 14, fontWeight: '800' },
    manualButton: { alignItems: 'flex-end' },
    manualButtonText: { color: '#075b53', fontSize: 14, fontWeight: '800' },
    locationNotice: {
        backgroundColor: '#fff7df',
        borderColor: '#e8d49a',
        borderRadius: 18,
        borderWidth: 1,
        marginBottom: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    locationTitle: { color: '#725617', fontSize: 14, fontWeight: '800' },
    locationBody: { color: '#75663f', fontSize: 13, lineHeight: 19, marginTop: 4 },
    serviceAreaRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
    serviceAreaCode: { color: '#725617', fontSize: 13, fontWeight: '800', marginTop: 4 },
    viewSwitch: {
        alignSelf: 'center',
        backgroundColor: '#dcefea',
        borderRadius: 999,
        flexDirection: 'row',
        marginBottom: 14,
        padding: 4,
    },
    viewButton: { borderRadius: 999, minWidth: 104, paddingHorizontal: 22, paddingVertical: 10 },
    viewButtonActive: { backgroundColor: '#087f73' },
    viewButtonText: { color: '#526b67', fontSize: 14, fontWeight: '800', textAlign: 'center' },
    viewButtonTextActive: { color: '#ffffff' },
    pressed: { opacity: 0.72 },
    mapResults: { flex: 1, gap: 16 },
    map: { flexShrink: 0 },
    compactMap: { maxHeight: 220, minHeight: 180 },
    mapList: { flex: 1, minHeight: 180 },
    compactMapList: { minHeight: 140 },
    listResults: { flex: 1 },
    catalogState: { marginBottom: 14 },
    list: { flex: 1 },
});
