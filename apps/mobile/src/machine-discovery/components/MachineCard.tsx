import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MachineAvailability, MachineId, MachineSummary } from '../machine-discovery.types';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

export interface MachineCardProps {
    readonly machine: MachineSummary;
    readonly selected?: boolean;
    readonly style?: StyleProp<ViewStyle>;
    readonly onPress: (machineId: MachineId) => void;
}

const statusLabels: Record<MachineAvailability, string> = {
    ONLINE: 'En ligne',
    SERVICE: 'Maintenance',
    OFFLINE: 'Hors ligne',
};

export function MachineCard({ machine, selected = false, style, onPress }: MachineCardProps): React.JSX.Element {
    const statusLabel = statusLabels[machine.status];
    const distanceLabel = machine.distanceMeters === undefined ? undefined : `${machine.distanceMeters} m`;
    const priceLabel =
        machine.price === undefined ? undefined : `${machine.price.amountPerLiter} ${machine.price.currency} / L`;
    const accessibilityLabel = [machine.displayName, statusLabel, machine.address, distanceLabel, priceLabel]
        .filter((value): value is string => value !== undefined)
        .join(', ');

    return (
        <Pressable
            accessibilityHint="Ouvre la fiche de ce point d’eau"
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onPress(machine.machineId)}
            style={({ pressed }) => [
                styles.card,
                selected && styles.cardSelected,
                pressed && styles.cardPressed,
                style,
            ]}
            testID={`machine-card-${machine.machineId}`}
        >
            <View style={styles.headingRow}>
                <Text numberOfLines={2} style={styles.title}>
                    {machine.displayName}
                </Text>
                <View style={[styles.statusBadge, statusBadgeStyles[machine.status]]}>
                    <Text style={[styles.statusText, statusTextStyles[machine.status]]}>{statusLabel}</Text>
                </View>
            </View>

            <View style={styles.detailRow}>
                <Text numberOfLines={3} style={styles.address}>
                    {machine.address}
                </Text>
                {distanceLabel === undefined ? null : <Text style={styles.distance}>{distanceLabel}</Text>}
            </View>

            {priceLabel === undefined ? null : <Text style={styles.price}>{priceLabel}</Text>}
        </Pressable>
    );
}

const statusBadgeStyles: Record<MachineAvailability, ViewStyle> = {
    ONLINE: { backgroundColor: '#e0f3ef' },
    SERVICE: { backgroundColor: '#fff0df' },
    OFFLINE: { backgroundColor: '#e8edec' },
};

const statusTextStyles: Record<MachineAvailability, TextStyle> = {
    ONLINE: { color: '#087f73' },
    SERVICE: { color: '#9a4e14' },
    OFFLINE: { color: '#465956' },
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        borderColor: '#d8e5e2',
        borderRadius: 22,
        borderWidth: 1,
        padding: 18,
        shadowColor: '#143c38',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.08,
        shadowRadius: 14,
        elevation: 2,
    },
    cardSelected: {
        borderColor: '#0b6fef',
        borderWidth: 2,
        padding: 17,
    },
    cardPressed: {
        backgroundColor: '#f2f8f6',
        transform: [{ scale: 0.99 }],
    },
    headingRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    title: {
        color: '#143c38',
        flex: 1,
        fontSize: 20,
        fontWeight: '700',
        lineHeight: 26,
    },
    statusBadge: {
        borderRadius: 999,
        flexShrink: 0,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 16,
    },
    detailRow: {
        alignItems: 'flex-end',
        flexDirection: 'row',
        gap: 16,
        justifyContent: 'space-between',
        marginTop: 12,
    },
    address: {
        color: '#526864',
        flex: 1,
        fontSize: 15,
        lineHeight: 21,
    },
    distance: {
        color: '#526864',
        flexShrink: 0,
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 20,
    },
    price: {
        color: '#143c38',
        fontSize: 17,
        fontWeight: '700',
        lineHeight: 23,
        marginTop: 16,
    },
});
