import { observer } from 'mobx-react-lite';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { WalletOperation } from '../../api/wallet-api';
import type { WalletCommands } from '../services/wallet-flow.service';
import type { WalletStore } from '../stores/wallet.store';

interface WalletScreenProps {
    store: WalletStore;
    commands: WalletCommands;
    onLogout(): void;
    onOpenMachineDiscovery?(): void;
    onOpenReferral?(): void;
}

export const WalletScreen = observer(
    ({ store, commands, onLogout, onOpenMachineDiscovery, onOpenReferral }: WalletScreenProps): React.JSX.Element => {
        const { height, width } = useWindowDimensions();
        const compactLayout = width <= 360 || height <= 700;

        if (store.viewState === 'initial' || store.viewState === 'loading') {
            return (
                <SafeAreaView style={styles.safeArea}>
                    <View accessibilityLabel="Chargement du portefeuille" style={styles.centered}>
                        <ActivityIndicator color="#087f73" size="large" />
                        <Text style={styles.loadingText}>Chargement de votre eau…</Text>
                    </View>
                </SafeAreaView>
            );
        }

        if (store.viewState === 'error') {
            return (
                <SafeAreaView style={styles.safeArea}>
                    <View style={styles.centered}>
                        <Text style={styles.errorEyebrow}>CONNEXION INTERROMPUE</Text>
                        <Text style={styles.errorTitle}>Votre portefeuille n’a pas pu être chargé.</Text>
                        <Text accessibilityRole="alert" style={styles.errorBody}>
                            Vérifiez votre connexion, puis réessayez.
                        </Text>
                        {store.error?.retryable ? (
                            <Pressable
                                accessibilityLabel="Réessayer de charger le portefeuille"
                                accessibilityRole="button"
                                onPress={() => commands.retry()}
                                style={styles.primaryButton}
                            >
                                <Text style={styles.primaryButtonText}>Réessayer</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </SafeAreaView>
            );
        }

        const balance = store.balance;
        if (!balance) return <SafeAreaView style={styles.safeArea} />;

        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={[styles.header, compactLayout && styles.compactHeader]}>
                    <View>
                        <Text style={styles.brand}>KAYNANN</Text>
                        <Text style={styles.heading}>Mon eau</Text>
                    </View>
                    <Pressable
                        accessibilityLabel="Se déconnecter"
                        accessibilityRole="button"
                        onPress={onLogout}
                        style={styles.logoutButton}
                    >
                        <Text style={styles.logoutText}>Sortir</Text>
                    </Pressable>
                </View>

                <ScrollView
                    accessibilityLabel="Contenu du portefeuille"
                    contentContainerStyle={[styles.content, compactLayout && styles.compactContent]}
                    refreshControl={
                        <RefreshControl
                            colors={['#087f73']}
                            onRefresh={() => commands.refresh()}
                            refreshing={store.refreshing}
                            tintColor="#087f73"
                        />
                    }
                    showsVerticalScrollIndicator={false}
                    style={styles.scroll}
                >
                    <View style={styles.balanceCard}>
                        <Text style={styles.balanceLabel}>SOLDE DISPONIBLE</Text>
                        <Text accessibilityLabel="Solde disponible" style={styles.balanceValue}>
                            {balance.balanceLiters} <Text style={styles.balanceUnit}>litres</Text>
                        </Text>
                        <Text style={styles.balanceCaption}>Disponible pour vos prochaines utilisations</Text>
                        <Pressable
                            accessibilityLabel="Actualiser le portefeuille"
                            accessibilityRole="button"
                            disabled={store.refreshing}
                            onPress={() => commands.refresh()}
                            style={styles.refreshButton}
                        >
                            {store.refreshing ? (
                                <ActivityIndicator color="#075b53" />
                            ) : (
                                <Text style={styles.refreshText}>Actualiser</Text>
                            )}
                        </Pressable>
                    </View>

                    {onOpenMachineDiscovery ? (
                        <Pressable
                            accessible
                            accessibilityLabel="Choisir un automate"
                            accessibilityRole="button"
                            onPress={onOpenMachineDiscovery}
                            style={styles.machineCard}
                        >
                            <View style={styles.machineMark}>
                                <Text style={styles.machineMarkText}>MAP</Text>
                            </View>
                            <View style={styles.machineCopy}>
                                <Text style={styles.machineEyebrow}>AUTOMATES</Text>
                                <Text style={styles.machineTitle}>Trouver un point d’eau</Text>
                            </View>
                            <Text style={styles.machineArrow}>›</Text>
                        </Pressable>
                    ) : null}

                    {onOpenReferral ? (
                        <Pressable
                            accessibilityLabel="Ouvrir le parrainage"
                            accessibilityRole="button"
                            onPress={onOpenReferral}
                            style={styles.referralCard}
                        >
                            <View>
                                <Text style={styles.referralEyebrow}>PARRAINAGE</Text>
                                <Text style={styles.referralTitle}>Inviter et partager</Text>
                            </View>
                            <Text style={styles.referralArrow}>›</Text>
                        </Pressable>
                    ) : null}

                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Historique</Text>
                        <Text style={styles.historyCount}>{store.operations.length} opérations</Text>
                    </View>

                    {store.error ? (
                        <View style={styles.inlineError}>
                            <Text accessibilityRole="alert" style={styles.inlineErrorText}>
                                Actualisation impossible. Vos dernières données restent affichées.
                            </Text>
                            {store.error.retryable ? (
                                <Pressable
                                    accessibilityLabel="Réessayer d’actualiser le portefeuille"
                                    accessibilityRole="button"
                                    onPress={() => commands.retry()}
                                >
                                    <Text style={styles.inlineRetry}>Réessayer</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : null}

                    {store.operations.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyMark}>0.000</Text>
                            <Text style={styles.emptyTitle}>Aucune opération pour le moment</Text>
                            <Text style={styles.emptyBody}>Vos futurs mouvements d’eau apparaîtront ici.</Text>
                        </View>
                    ) : (
                        <View style={styles.operationList}>
                            {store.operations.map((operation) => (
                                <OperationRow key={operation.id} operation={operation} />
                            ))}
                        </View>
                    )}

                    {store.hasMore ? (
                        <Pressable
                            accessibilityLabel="Charger plus d’opérations"
                            accessibilityRole="button"
                            disabled={store.loadingNextPage}
                            onPress={() => commands.loadNextPage()}
                            style={styles.moreButton}
                        >
                            {store.loadingNextPage ? (
                                <ActivityIndicator color="#087f73" />
                            ) : (
                                <Text style={styles.moreText}>Voir les opérations précédentes</Text>
                            )}
                        </Pressable>
                    ) : null}
                </ScrollView>
            </SafeAreaView>
        );
    },
);

function OperationRow({ operation }: { operation: WalletOperation }): React.JSX.Element {
    const credit = operation.direction === 'CREDIT';
    return (
        <View accessibilityLabel={`Opération ${operation.id}`} style={styles.operationRow}>
            <View style={[styles.directionMark, credit ? styles.creditMark : styles.debitMark]}>
                <Text style={[styles.directionSymbol, credit ? styles.creditText : styles.debitText]}>
                    {credit ? '+' : '−'}
                </Text>
            </View>
            <View style={styles.operationDetails}>
                <Text style={styles.operationKind}>{humanizeCategory(operation.operationKind)}</Text>
                <Text style={styles.operationMeta}>
                    {humanizeCategory(operation.source)} · {formatDate(operation.occurredAt)}
                </Text>
            </View>
            <Text style={[styles.operationAmount, credit ? styles.creditText : styles.debitText]}>
                {credit ? '+' : '-'}
                {formatMillilitres(operation.amountMl)} L
            </Text>
        </View>
    );
}

function formatMillilitres(amountMl: string): string {
    const padded = amountMl.padStart(4, '0');
    return `${padded.slice(0, -3)}.${padded.slice(-3)}`;
}

function humanizeCategory(value: string): string {
    return value.replaceAll('_', ' ');
}

function formatDate(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#edf8f5', flex: 1 },
    centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
    loadingText: { color: '#526b67', fontSize: 16, marginTop: 18 },
    errorEyebrow: { color: '#b9472f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
    errorTitle: {
        color: '#12332f',
        fontSize: 28,
        fontWeight: '800',
        lineHeight: 34,
        marginTop: 14,
        maxWidth: 340,
        textAlign: 'center',
    },
    errorBody: { color: '#667b77', fontSize: 16, lineHeight: 24, marginTop: 12, textAlign: 'center' },
    primaryButton: {
        backgroundColor: '#087f73',
        borderRadius: 16,
        marginTop: 26,
        paddingHorizontal: 30,
        paddingVertical: 15,
    },
    primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    header: {
        alignSelf: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        maxWidth: 680,
        paddingHorizontal: 22,
        paddingTop: 12,
        width: '100%',
    },
    compactHeader: { paddingHorizontal: 16, paddingTop: 8 },
    brand: { color: '#087f73', fontSize: 11, fontWeight: '900', letterSpacing: 2.4 },
    heading: { color: '#12332f', fontSize: 30, fontWeight: '900', marginTop: 2 },
    logoutButton: { backgroundColor: '#dcefea', borderRadius: 14, paddingHorizontal: 17, paddingVertical: 11 },
    logoutText: { color: '#075b53', fontSize: 14, fontWeight: '800' },
    scroll: { alignSelf: 'center', flex: 1, maxWidth: 680, width: '100%' },
    content: { padding: 22, paddingBottom: 44 },
    compactContent: { padding: 16, paddingBottom: 32 },
    balanceCard: {
        backgroundColor: '#0d6f66',
        borderRadius: 28,
        overflow: 'hidden',
        padding: 26,
    },
    balanceLabel: { color: '#bce8df', fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
    balanceValue: { color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: -1, marginTop: 10 },
    balanceUnit: { color: '#bce8df', fontSize: 19, fontWeight: '700', letterSpacing: 0 },
    balanceCaption: { color: '#d5f1eb', fontSize: 14, lineHeight: 20, marginTop: 8 },
    refreshButton: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#d8f3ed',
        borderRadius: 13,
        justifyContent: 'center',
        marginTop: 22,
        minHeight: 42,
        minWidth: 106,
        paddingHorizontal: 16,
    },
    refreshText: { color: '#075b53', fontSize: 14, fontWeight: '900' },
    machineCard: {
        alignItems: 'center',
        backgroundColor: '#dcefeb',
        borderRadius: 20,
        flexDirection: 'row',
        marginTop: 14,
        padding: 16,
    },
    machineMark: {
        alignItems: 'center',
        backgroundColor: '#087f73',
        borderRadius: 16,
        height: 52,
        justifyContent: 'center',
        width: 52,
    },
    machineMarkText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
    machineCopy: { flex: 1, marginHorizontal: 14 },
    machineEyebrow: { color: '#087f73', fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
    machineTitle: { color: '#12332f', fontSize: 17, fontWeight: '900', marginTop: 5 },
    machineArrow: { color: '#087f73', fontSize: 32, fontWeight: '500' },
    referralCard: {
        alignItems: 'center',
        backgroundColor: '#fff4df',
        borderRadius: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 14,
        padding: 19,
    },
    referralEyebrow: { color: '#b75b23', fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
    referralTitle: { color: '#53331c', fontSize: 17, fontWeight: '900', marginTop: 5 },
    referralArrow: { color: '#b75b23', fontSize: 32, fontWeight: '500' },
    historyHeader: {
        alignItems: 'baseline',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 14,
        marginTop: 30,
    },
    historyTitle: { color: '#12332f', fontSize: 23, fontWeight: '900' },
    historyCount: { color: '#718681', fontSize: 13, fontWeight: '600' },
    inlineError: { backgroundColor: '#fff0eb', borderRadius: 15, marginBottom: 12, padding: 14 },
    inlineErrorText: { color: '#8d3827', fontSize: 14, lineHeight: 20 },
    inlineRetry: { color: '#8d3827', fontSize: 14, fontWeight: '900', marginTop: 8 },
    emptyCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, padding: 28 },
    emptyMark: { color: '#9dc9c1', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
    emptyTitle: { color: '#183d38', fontSize: 17, fontWeight: '800', marginTop: 12, textAlign: 'center' },
    emptyBody: { color: '#748782', fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
    operationList: { backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden' },
    operationRow: {
        alignItems: 'center',
        flexDirection: 'row',
        minHeight: 82,
        paddingHorizontal: 16,
        paddingVertical: 13,
    },
    directionMark: { alignItems: 'center', borderRadius: 16, height: 46, justifyContent: 'center', width: 46 },
    creditMark: { backgroundColor: '#e0f5eb' },
    debitMark: { backgroundColor: '#fff0eb' },
    directionSymbol: { fontSize: 24, fontWeight: '700' },
    creditText: { color: '#087f5b' },
    debitText: { color: '#b9472f' },
    operationDetails: { flex: 1, marginHorizontal: 13 },
    operationKind: { color: '#183d38', fontSize: 14, fontWeight: '800' },
    operationMeta: { color: '#7b8d89', fontSize: 12, marginTop: 5 },
    operationAmount: { fontSize: 15, fontWeight: '900' },
    moreButton: {
        alignItems: 'center',
        borderColor: '#a8cec7',
        borderRadius: 15,
        borderWidth: 1,
        justifyContent: 'center',
        marginTop: 16,
        minHeight: 50,
        paddingHorizontal: 18,
    },
    moreText: { color: '#087f73', fontSize: 14, fontWeight: '800' },
});
