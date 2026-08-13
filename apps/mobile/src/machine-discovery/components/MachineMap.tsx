import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import type {
    MachineAvailability,
    MachineCoordinates,
    MachineViewport,
} from '../machine-discovery.types';
import type { MachineMapProps } from './MachineMap.types';
import type { MapRegion } from '../native/MapAdapter';
import type { ViewStyle } from 'react-native';

export type { MachineMapProps } from './MachineMap.types';

const markerLabels: Record<MachineAvailability, string> = {
    ONLINE: 'ON',
    SERVICE: 'SV',
    OFFLINE: 'OFF',
};

const statusLabels: Record<MachineAvailability, string> = {
    ONLINE: 'en ligne',
    SERVICE: 'en maintenance',
    OFFLINE: 'hors ligne',
};

export function MachineMap({
    machines,
    selectedMachineId,
    userPosition,
    initialViewport,
    loading,
    unavailable,
    style,
    onMachinePress,
    onMapReady,
    onRegionChangeComplete,
}: MachineMapProps): React.JSX.Element {
    const region = initialViewport === null ? undefined : toRegion(initialViewport);

    if (unavailable) {
        return (
            <View
                accessibilityLabel="Carte indisponible"
                accessibilityLiveRegion="polite"
                style={[styles.surface, styles.unavailableSurface, style]}
                testID="machine-map-unavailable"
            >
                <Text style={styles.stateEyebrow}>CARTE</Text>
                <Text style={styles.stateTitle}>Carte indisponible</Text>
                <Text style={styles.stateBody}>Utilisez la liste pour choisir un point d’eau.</Text>
            </View>
        );
    }

    return (
        <View style={[styles.surface, style]}>
            <MapView
                accessibilityLabel="Carte des points d’eau"
                rotateEnabled={false}
                style={StyleSheet.absoluteFill}
                testID="machine-map"
                toolbarEnabled={false}
                {...(region === undefined ? {} : { initialRegion: region })}
                {...(onMapReady === undefined ? {} : { onMapReady })}
                {...(onRegionChangeComplete === undefined ? {} : { onRegionChangeComplete })}
            >
                {isValidCoordinates(userPosition) ? (
                    <Marker
                        accessibilityLabel="Votre position"
                        coordinate={userPosition}
                        identifier="user-position"
                        tappable={false}
                        zIndex={4}
                    >
                        <View style={styles.userPositionHalo}>
                            <View style={styles.userPositionCore} />
                        </View>
                    </Marker>
                ) : null}

                {machines.map((machine) => {
                    if (!isValidCoordinates(machine.coordinates)) return null;

                    const selected = machine.machineId === selectedMachineId;
                    return (
                        <Marker
                            accessibilityHint="Ouvre la fiche de ce point d’eau"
                            accessibilityLabel={`${machine.displayName}, ${statusLabels[machine.status]}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            coordinate={machine.coordinates}
                            identifier={machine.machineId}
                            key={machine.machineId}
                            onPress={() => onMachinePress(machine.machineId)}
                            testID={`machine-marker-${machine.machineId}`}
                            zIndex={selected ? 3 : 2}
                        >
                            <View style={[styles.markerSelectionRing, selected && styles.markerSelectionRingActive]}>
                                <View style={[styles.marker, markerStatusStyles[machine.status]]}>
                                    <Text style={styles.markerLabel}>{markerLabels[machine.status]}</Text>
                                </View>
                            </View>
                        </Marker>
                    );
                })}
            </MapView>

            {loading ? (
                <View
                    accessibilityLabel="Chargement de la carte"
                    accessibilityLiveRegion="polite"
                    accessibilityRole="progressbar"
                    pointerEvents="none"
                    style={styles.loadingOverlay}
                    testID="machine-map-loading"
                >
                    <ActivityIndicator color="#075b53" size="large" />
                    <Text style={styles.loadingText}>Actualisation des points d’eau…</Text>
                </View>
            ) : null}
        </View>
    );
}

function isValidCoordinates(coordinates: MachineCoordinates | undefined): coordinates is MachineCoordinates {
    return (
        coordinates !== undefined &&
        Number.isFinite(coordinates.latitude) &&
        Number.isFinite(coordinates.longitude) &&
        coordinates.latitude >= -90 &&
        coordinates.latitude <= 90 &&
        coordinates.longitude >= -180 &&
        coordinates.longitude <= 180
    );
}

function toRegion(viewport: MachineViewport | undefined): MapRegion | undefined {
    if (
        viewport === undefined ||
        ![viewport.north, viewport.east, viewport.south, viewport.west].every(Number.isFinite) ||
        viewport.north <= viewport.south ||
        viewport.east <= viewport.west ||
        viewport.north > 90 ||
        viewport.south < -90 ||
        viewport.east > 180 ||
        viewport.west < -180
    ) {
        return undefined;
    }

    return {
        latitude: (viewport.north + viewport.south) / 2,
        longitude: (viewport.east + viewport.west) / 2,
        latitudeDelta: viewport.north - viewport.south,
        longitudeDelta: viewport.east - viewport.west,
    };
}

const markerStatusStyles: Record<MachineAvailability, ViewStyle> = {
    ONLINE: {
        backgroundColor: '#087f73',
        borderRadius: 20,
    },
    SERVICE: {
        backgroundColor: '#b66321',
        borderRadius: 10,
    },
    OFFLINE: {
        backgroundColor: '#596b69',
        borderRadius: 4,
    },
};

const styles = StyleSheet.create({
    surface: {
        aspectRatio: 1.55,
        backgroundColor: '#dce9e6',
        borderColor: '#c9dbd7',
        borderRadius: 24,
        borderWidth: 1,
        minHeight: 240,
        overflow: 'hidden',
        width: '100%',
    },
    unavailableSurface: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    stateEyebrow: {
        color: '#087f73',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.4,
        marginBottom: 8,
    },
    stateTitle: {
        color: '#143c38',
        fontSize: 22,
        fontWeight: '700',
        textAlign: 'center',
    },
    stateBody: {
        color: '#526864',
        fontSize: 16,
        lineHeight: 23,
        marginTop: 8,
        textAlign: 'center',
    },
    userPositionHalo: {
        alignItems: 'center',
        backgroundColor: 'rgba(8, 127, 115, 0.22)',
        borderRadius: 18,
        height: 36,
        justifyContent: 'center',
        width: 36,
    },
    userPositionCore: {
        backgroundColor: '#0b6fef',
        borderColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 3,
        height: 16,
        width: 16,
    },
    markerSelectionRing: {
        alignItems: 'center',
        borderColor: 'transparent',
        borderRadius: 28,
        borderWidth: 3,
        height: 50,
        justifyContent: 'center',
        width: 50,
    },
    markerSelectionRingActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.88)',
        borderColor: '#0b6fef',
    },
    marker: {
        alignItems: 'center',
        borderColor: '#ffffff',
        borderWidth: 2,
        height: 40,
        justifyContent: 'center',
        minWidth: 40,
        paddingHorizontal: 6,
    },
    markerLabel: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        backgroundColor: 'rgba(238, 246, 244, 0.88)',
        justifyContent: 'center',
    },
    loadingText: {
        color: '#294d48',
        fontSize: 15,
        fontWeight: '600',
        marginTop: 12,
    },
});
