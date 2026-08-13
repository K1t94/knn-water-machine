import { StyleSheet, Text, View } from 'react-native';

import type { MachineMapProps } from './MachineMap.types';

export type { MachineMapProps } from './MachineMap.types';

export function MachineMap({ style }: MachineMapProps): React.JSX.Element {
    return (
        <View
            accessibilityLabel="Carte indisponible"
            accessibilityLiveRegion="polite"
            style={[styles.surface, style]}
            testID="machine-map-unavailable"
        >
            <Text style={styles.eyebrow}>CARTE</Text>
            <Text style={styles.title}>Carte indisponible sur le web</Text>
            <Text style={styles.body}>Utilisez la liste pour choisir un point d’eau.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    surface: {
        alignItems: 'center',
        aspectRatio: 1.55,
        backgroundColor: '#dce9e6',
        borderColor: '#c9dbd7',
        borderRadius: 24,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 240,
        overflow: 'hidden',
        paddingHorizontal: 32,
        width: '100%',
    },
    eyebrow: {
        color: '#087f73',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.4,
        marginBottom: 8,
    },
    title: {
        color: '#143c38',
        fontSize: 22,
        fontWeight: '700',
        textAlign: 'center',
    },
    body: {
        color: '#526864',
        fontSize: 16,
        lineHeight: 23,
        marginTop: 8,
        textAlign: 'center',
    },
});
