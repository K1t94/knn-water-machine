import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MachineDiscoveryState } from '../components/MachineDiscoveryState';

import type { MachineDiscoveryStateVariant } from '../components/MachineDiscoveryState';
import type { MachineAvailability, MachineDetail, MachineSelectionHandoff } from '../machine-discovery.types';
import type { MachineDiscoveryCommands } from '../services/machine-discovery-flow.service';
import type { MachineDiscoveryStore } from '../stores/machine-discovery.store';

interface MachineDetailCommands extends MachineDiscoveryCommands {
    confirmSelection(accessToken: string): void;
}

interface MachineDetailScreenProps {
    readonly accessToken: string;
    readonly commands: MachineDetailCommands;
    readonly store: MachineDiscoveryStore;
    readonly onBack: () => void;
    readonly onSelectionHandoff?: (handoff: MachineSelectionHandoff) => void;
}

const statusLabels: Record<MachineAvailability, string> = {
    ONLINE: 'Disponible',
    SERVICE: 'En maintenance',
    OFFLINE: 'Hors ligne',
};

export const MachineDetailScreen = observer(
    ({ accessToken, commands, store, onBack, onSelectionHandoff }: MachineDetailScreenProps): React.JSX.Element => {
        const { height, width } = useWindowDimensions();
        const compactLayout = width <= 360 || height <= 700;
        const detail = store.currentDetail;
        const retryMachineId = detail?.machineId ?? store.currentCard?.machineId;
        const detailErrorState = getDetailErrorState(store.error?.code);
        const deliveredHandoff = useRef<MachineSelectionHandoff | undefined>(undefined);

        useEffect(() => {
            const handoff = store.selectionHandoff;
            if (handoff === undefined || onSelectionHandoff === undefined || handoff === deliveredHandoff.current) {
                return;
            }

            deliveredHandoff.current = handoff;
            onSelectionHandoff(handoff);
        }, [onSelectionHandoff, store.selectionHandoff]);

        const retry = (): void => {
            if (store.detailLoading) return;
            if (retryMachineId !== undefined) commands.openMachine(accessToken, retryMachineId);
        };

        const confirmSelection = (): void => {
            if (store.selectionLoading) return;
            commands.confirmSelection(accessToken);
        };

        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.page} testID="machine-detail-page">
                    <View style={[styles.header, compactLayout && styles.compactHeader]} testID="machine-detail-header">
                        <Pressable
                            accessibilityLabel="Retour aux points d’eau"
                            accessibilityRole="button"
                            onPress={onBack}
                            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                        >
                            <Text style={styles.backText}>‹ Retour</Text>
                        </Pressable>
                        <Text style={styles.headerTitle}>Détails</Text>
                        <View style={styles.headerSide} />
                    </View>

                    {detail === undefined ? (
                        <UnavailableDetail
                            canRetry={store.error?.retryable === true && retryMachineId !== undefined}
                            state={getDetailState(store.detailLoading, store.error?.code)}
                            onRetry={retry}
                        />
                    ) : (
                        <DetailContent
                            compactLayout={compactLayout}
                            detail={detail}
                            {...(detailErrorState === undefined ? {} : { errorState: detailErrorState })}
                            onConfirm={confirmSelection}
                            onRetry={retry}
                            refreshing={store.detailLoading}
                            selectionLoading={store.selectionLoading}
                        />
                    )}
                </View>
            </SafeAreaView>
        );
    },
);

interface UnavailableDetailProps {
    readonly canRetry: boolean;
    readonly state: MachineDiscoveryStateVariant;
    readonly onRetry: () => void;
}

function UnavailableDetail({ canRetry, state, onRetry }: UnavailableDetailProps): React.JSX.Element {
    return (
        <View style={styles.centered}>
            <MachineDiscoveryState context="detail" style={styles.fullState} variant={state} />
            {canRetry && state !== 'loading' ? <RetryButton onPress={onRetry} /> : null}
        </View>
    );
}

interface DetailContentProps {
    readonly compactLayout: boolean;
    readonly detail: MachineDetail;
    readonly errorState?: MachineDiscoveryStateVariant;
    readonly onConfirm: () => void;
    readonly onRetry: () => void;
    readonly refreshing: boolean;
    readonly selectionLoading: boolean;
}

function DetailContent({
    compactLayout,
    detail,
    errorState,
    onConfirm,
    onRetry,
    refreshing,
    selectionLoading,
}: DetailContentProps): React.JSX.Element {
    const canConfirm =
        detail.selectable &&
        detail.status === 'ONLINE' &&
        detail.price !== undefined &&
        errorState === undefined &&
        !refreshing &&
        !selectionLoading;

    return (
        <ScrollView
            contentContainerStyle={[styles.content, compactLayout && styles.compactContent]}
            showsVerticalScrollIndicator={false}
            testID="machine-detail-scroll"
        >
            {refreshing ? (
                <MachineDiscoveryState compact context="detail" style={styles.inlineState} variant="loading" />
            ) : null}

            <Text style={styles.stateEyebrow}>FICHE ACTUALISÉE</Text>
            <View style={styles.summaryCard}>
                <Text style={styles.machineName}>{detail.displayName}</Text>
                <Text style={styles.address}>{detail.address}</Text>
                <View style={styles.summaryHeader}>
                    <Text style={styles.summaryLabel}>STATUT ACTUEL</Text>
                    <View style={[styles.statusBadge, statusBadgeStyles[detail.status]]}>
                        <Text style={styles.statusCode}>{detail.status}</Text>
                    </View>
                </View>
                <Text style={styles.statusLabel}>{statusLabels[detail.status]}</Text>
                {detail.distanceMeters === undefined ? null : (
                    <Text style={styles.distance}>Distance : {formatDistance(detail.distanceMeters)}</Text>
                )}
            </View>

            {detail.price === undefined ? null : (
                <View style={styles.priceCard}>
                    <Text style={styles.summaryLabel}>PRIX PAR LITRE</Text>
                    <Text style={styles.price}>
                        {detail.price.amountPerLiter} {detail.price.currency} / L
                    </Text>
                </View>
            )}

            {detail.status === 'ONLINE' ? null : (
                <View style={styles.availabilityNotice}>
                    <Text style={styles.availabilityTitle}>Indisponible pour la suite</Text>
                    <Text style={styles.availabilityBody}>
                        Ce point reste visible, mais son état actuel ne permet pas de continuer.
                    </Text>
                </View>
            )}

            {errorState === undefined ? null : (
                <View>
                    <MachineDiscoveryState compact context="detail" style={styles.inlineState} variant={errorState} />
                    <RetryButton onPress={onRetry} />
                </View>
            )}

            <Pressable
                accessibilityLabel="Continuer avec ce point d’eau"
                accessibilityRole="button"
                accessibilityState={{ busy: selectionLoading, disabled: !canConfirm }}
                disabled={!canConfirm}
                onPress={onConfirm}
                style={({ pressed }) => [
                    styles.confirmButton,
                    !canConfirm && styles.confirmButtonDisabled,
                    pressed && canConfirm && styles.confirmButtonPressed,
                ]}
            >
                {selectionLoading ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <Text style={[styles.confirmText, !canConfirm && styles.confirmTextDisabled]}>
                    {selectionLoading ? 'Validation en cours…' : 'Continuer avec ce point d’eau'}
                </Text>
            </Pressable>
        </ScrollView>
    );
}

function getDetailState(loading: boolean, errorCode: string | undefined): MachineDiscoveryStateVariant {
    if (loading) return 'loading';
    return getDetailErrorState(errorCode) ?? 'empty';
}

function getDetailErrorState(errorCode: string | undefined): MachineDiscoveryStateVariant | undefined {
    if (errorCode === undefined) return undefined;
    if (errorCode.startsWith('OFFLINE')) return 'offline';
    if (errorCode.startsWith('STALE_') || errorCode === 'MACHINE_CONTEXT_CHANGED') return 'stale';
    return 'error';
}

function RetryButton({ onPress }: Readonly<{ onPress: () => void }>): React.JSX.Element {
    return (
        <Pressable
            accessibilityLabel="Réessayer la fiche du point d’eau"
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
            <Text style={styles.retryText}>Réessayer</Text>
        </Pressable>
    );
}

function formatDistance(distanceMeters: number): string {
    if (distanceMeters < 1_000) return `${Math.round(distanceMeters)} m`;
    return `${(distanceMeters / 1_000).toFixed(1)} km`;
}

const statusBadgeStyles: Record<MachineAvailability, { backgroundColor: string }> = {
    ONLINE: { backgroundColor: '#087f73' },
    SERVICE: { backgroundColor: '#b66321' },
    OFFLINE: { backgroundColor: '#596b69' },
};

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#edf8f5', flex: 1 },
    page: { alignSelf: 'center', flex: 1, maxWidth: 680, width: '100%' },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        minHeight: 72,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    compactHeader: { paddingHorizontal: 12 },
    backButton: { justifyContent: 'center', minHeight: 44, minWidth: 84 },
    backText: { color: '#075b53', fontSize: 14, fontWeight: '800' },
    headerTitle: {
        color: '#12332f',
        flex: 1,
        fontSize: 18,
        fontWeight: '900',
        paddingHorizontal: 8,
        textAlign: 'center',
    },
    headerSide: { minWidth: 84 },
    pressed: { opacity: 0.7 },
    centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
    fullState: { maxWidth: 480, width: '100%' },
    content: { paddingBottom: 44, paddingHorizontal: 22, paddingTop: 16 },
    compactContent: { paddingBottom: 28, paddingHorizontal: 16 },
    stateEyebrow: { color: '#087f73', fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
    inlineState: { marginTop: 16 },
    machineName: { color: '#12332f', fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
    address: { color: '#61766f', fontSize: 16, lineHeight: 24, marginTop: 10 },
    summaryCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d5e5e1',
        borderRadius: 26,
        borderWidth: 1,
        marginTop: 10,
        padding: 22,
    },
    summaryHeader: {
        alignItems: 'center',
        borderTopColor: '#e0ece9',
        borderTopWidth: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 22,
        paddingTop: 20,
    },
    summaryLabel: { color: '#718681', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
    statusBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    statusCode: { color: '#ffffff', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
    statusLabel: { color: '#173d38', fontSize: 22, fontWeight: '900', marginTop: 12 },
    priceCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d5e5e1',
        borderRadius: 26,
        borderWidth: 1,
        marginTop: 16,
        padding: 22,
    },
    price: { color: '#075b53', fontSize: 27, fontWeight: '900', marginTop: 8 },
    distance: { color: '#61766f', fontSize: 14, fontWeight: '700', marginTop: 18 },
    availabilityNotice: {
        backgroundColor: '#fff5e9',
        borderColor: '#ead1b3',
        borderRadius: 20,
        borderWidth: 1,
        marginTop: 16,
        padding: 18,
    },
    availabilityTitle: { color: '#7d431a', fontSize: 16, fontWeight: '900' },
    availabilityBody: { color: '#7c614d', fontSize: 14, lineHeight: 21, marginTop: 6 },
    confirmButton: {
        alignItems: 'center',
        backgroundColor: '#087f73',
        borderRadius: 20,
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
        minHeight: 58,
        paddingHorizontal: 24,
    },
    confirmButtonDisabled: { backgroundColor: '#cbdad6' },
    confirmButtonPressed: { opacity: 0.82 },
    confirmText: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginHorizontal: 8 },
    confirmTextDisabled: { color: '#647a75' },
    retryButton: {
        alignSelf: 'center',
        backgroundColor: '#087f73',
        borderRadius: 999,
        marginTop: 20,
        minHeight: 44,
        paddingHorizontal: 24,
        paddingVertical: 11,
    },
    retryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});
