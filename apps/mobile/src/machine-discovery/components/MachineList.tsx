import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MachineCard } from './MachineCard';

import type { MachineId, MachineSummary } from '../machine-discovery.types';
import type { StyleProp, ViewStyle } from 'react-native';

export interface MachineListProps {
    readonly machines: readonly MachineSummary[];
    readonly selectedMachineId?: MachineId;
    readonly loading: boolean;
    readonly error: boolean;
    readonly hasMore: boolean;
    readonly style?: StyleProp<ViewStyle>;
    readonly contentContainerStyle?: StyleProp<ViewStyle>;
    readonly onMachinePress: (machineId: MachineId) => void;
    readonly onLoadMore: () => void;
    readonly onRetry?: () => void;
}

export function MachineList({
    machines,
    selectedMachineId,
    loading,
    error,
    hasMore,
    style,
    contentContainerStyle,
    onMachinePress,
    onLoadMore,
    onRetry,
}: MachineListProps): React.JSX.Element {
    const hasMachines = machines.length > 0;

    return (
        <FlatList
            contentContainerStyle={[styles.content, !hasMachines && styles.emptyContent, contentContainerStyle]}
            data={machines}
            extraData={selectedMachineId}
            keyExtractor={(machine) => machine.machineId}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
                <EmptyState error={error} loading={loading} {...(onRetry === undefined ? {} : { onRetry })} />
            }
            ListFooterComponent={
                hasMachines ? (
                    <ListFooter error={error} loading={loading} {...(onRetry === undefined ? {} : { onRetry })} />
                ) : null
            }
            ItemSeparatorComponent={ListSeparator}
            onEndReachedThreshold={0.35}
            renderItem={({ item }) => (
                <MachineCard machine={item} onPress={onMachinePress} selected={item.machineId === selectedMachineId} />
            )}
            showsVerticalScrollIndicator={false}
            style={style}
            testID="machine-list"
            {...(hasMore && !loading && !error ? { onEndReached: onLoadMore } : {})}
        />
    );
}

interface StateProps {
    readonly error: boolean;
    readonly loading: boolean;
    readonly onRetry?: () => void;
}

function EmptyState({ error, loading, onRetry }: StateProps): React.JSX.Element {
    if (loading) {
        return (
            <View
                accessibilityLabel="Chargement des points d’eau"
                accessibilityLiveRegion="polite"
                accessibilityRole="progressbar"
                style={styles.state}
                testID="machine-list-loading"
            >
                <ActivityIndicator color="#087f73" size="large" />
                <Text style={styles.stateTitle}>Chargement des points d’eau…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View accessibilityLiveRegion="polite" style={styles.state} testID="machine-list-error">
                <Text style={styles.stateEyebrow}>INDISPONIBLE</Text>
                <Text style={styles.stateTitle}>Liste indisponible</Text>
                <Text style={styles.stateBody}>Vérifiez votre connexion, puis réessayez.</Text>
                {onRetry === undefined ? null : <RetryButton onPress={onRetry} />}
            </View>
        );
    }

    return (
        <View accessibilityLiveRegion="polite" style={styles.state} testID="machine-list-empty">
            <Text style={styles.stateEyebrow}>POINTS D’EAU</Text>
            <Text style={styles.stateTitle}>Aucun point d’eau trouvé</Text>
            <Text style={styles.stateBody}>Déplacez la carte ou consultez une autre zone.</Text>
        </View>
    );
}

function ListFooter({ error, loading, onRetry }: StateProps): React.JSX.Element | null {
    if (loading) {
        return (
            <View
                accessibilityLabel="Chargement de points d’eau supplémentaires"
                accessibilityLiveRegion="polite"
                accessibilityRole="progressbar"
                style={styles.footer}
                testID="machine-list-loading-more"
            >
                <ActivityIndicator color="#087f73" />
                <Text style={styles.footerText}>Chargement des points suivants…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View accessibilityLiveRegion="polite" style={styles.footer} testID="machine-list-error-more">
                <Text style={styles.footerText}>Les points suivants n’ont pas pu être chargés.</Text>
                {onRetry === undefined ? null : <RetryButton onPress={onRetry} />}
            </View>
        );
    }

    return null;
}

function RetryButton({ onPress }: Readonly<{ onPress: () => void }>): React.JSX.Element {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
        >
            <Text style={styles.retryButtonText}>Réessayer</Text>
        </Pressable>
    );
}

function ListSeparator(): React.JSX.Element {
    return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
    content: {
        paddingBottom: 24,
    },
    emptyContent: {
        flexGrow: 1,
    },
    separator: {
        height: 14,
    },
    state: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        minHeight: 240,
        paddingHorizontal: 32,
        paddingVertical: 40,
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
        fontSize: 20,
        fontWeight: '700',
        lineHeight: 26,
        marginTop: 12,
        textAlign: 'center',
    },
    stateBody: {
        color: '#526864',
        fontSize: 15,
        lineHeight: 22,
        marginTop: 8,
        textAlign: 'center',
    },
    footer: {
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 24,
        paddingTop: 20,
    },
    footerText: {
        color: '#526864',
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    retryButton: {
        backgroundColor: '#087f73',
        borderRadius: 999,
        marginTop: 16,
        minHeight: 44,
        paddingHorizontal: 20,
        paddingVertical: 11,
    },
    retryButtonPressed: {
        backgroundColor: '#075b53',
    },
    retryButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '700',
        lineHeight: 22,
    },
});
