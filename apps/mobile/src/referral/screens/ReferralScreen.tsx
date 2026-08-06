import { observer } from 'mobx-react-lite';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firstValueFrom } from 'rxjs';

import type { ReferralInvitation } from '../../api/referral-api';
import type { ReferralNativeCommands } from '../native/referral-native-actions';
import type { ReferralCommands } from '../services/referral-flow.service';
import type { ReferralStore } from '../stores/referral.store';
import type { Observable } from 'rxjs';

interface ReferralScreenProps {
    store: ReferralStore;
    commands: ReferralCommands;
    nativeActions: ReferralNativeCommands;
    onApplyCode?(): void;
    onBack?(): void;
}

export const ReferralScreen = observer(
    ({ store, commands, nativeActions, onApplyCode, onBack }: ReferralScreenProps): React.JSX.Element => {
        if (store.viewState === 'initial' || store.viewState === 'loading') {
            return (
                <SafeAreaView style={styles.safeArea}>
                    <View
                        accessibilityLabel="Chargement du parrainage"
                        accessibilityRole="progressbar"
                        style={styles.centered}
                    >
                        <ActivityIndicator color="#087f73" size="large" />
                        <Text style={styles.loadingText}>Chargement de votre espace parrainage…</Text>
                    </View>
                </SafeAreaView>
            );
        }

        if (store.viewState === 'error') {
            return (
                <SafeAreaView style={styles.safeArea}>
                    <View style={styles.centered}>
                        <Text style={styles.eyebrow}>PARRAINAGE</Text>
                        <Text style={styles.errorTitle}>Vos informations ne sont pas disponibles.</Text>
                        <Text accessibilityRole="alert" style={styles.errorBody}>
                            Vérifiez votre connexion, puis réessayez.
                        </Text>
                        {store.error?.retryable ? (
                            <Pressable
                                accessibilityLabel="Réessayer de charger le parrainage"
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

        const referral = store.myReferral;
        if (!referral) return <SafeAreaView style={styles.safeArea} />;

        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.header}>
                    {onBack ? (
                        <Pressable
                            accessibilityLabel="Retour au portefeuille"
                            accessibilityRole="button"
                            onPress={onBack}
                        >
                            <Text style={styles.backText}>‹ Retour</Text>
                        </Pressable>
                    ) : (
                        <View />
                    )}
                    <Text style={styles.brand}>KAYNANN</Text>
                </View>
                <ScrollView
                    accessibilityLabel="Contenu du parrainage"
                    contentContainerStyle={styles.content}
                    refreshControl={
                        <RefreshControl
                            colors={['#087f73']}
                            onRefresh={() => commands.refresh()}
                            refreshing={store.refreshing}
                            tintColor="#087f73"
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={styles.eyebrow}>INVITEZ VOS PROCHES</Text>
                    <Text style={styles.title}>Partagez l’eau,{`\n`}simplement.</Text>
                    <Text style={styles.intro}>
                        Envoyez votre lien personnel. Les récompenses confirmées apparaissent dans votre portefeuille.
                    </Text>

                    <View style={styles.codeCard}>
                        <Text style={styles.codeLabel}>VOTRE CODE PROMO</Text>
                        <Text accessibilityLabel={`Code promo ${referral.promoCode}`} style={styles.codeValue}>
                            {referral.promoCode}
                        </Text>
                        <View style={styles.actions}>
                            <Pressable
                                accessibilityLabel="Copier le code promo"
                                accessibilityRole="button"
                                onPress={() => runNativeAction(nativeActions.copyPromoCode(referral.promoCode))}
                                style={styles.lightButton}
                            >
                                <Text style={styles.lightButtonText}>Copier</Text>
                            </Pressable>
                            <Pressable
                                accessibilityLabel="Partager le lien de parrainage"
                                accessibilityRole="button"
                                onPress={() => runNativeAction(nativeActions.shareReferralLink(referral.referralLink))}
                                style={styles.shareButton}
                            >
                                <Text style={styles.shareButtonText}>Partager</Text>
                            </Pressable>
                        </View>
                    </View>

                    <View style={styles.summaryRow}>
                        <View style={styles.summaryCard}>
                            <Text style={styles.summaryLabel}>CRÉDITÉ</Text>
                            <Text style={styles.summaryValue}>
                                {formatMillilitres(referral.creditedInviterBonusMl)} L
                            </Text>
                        </View>
                        <View style={styles.summaryCard}>
                            <Text style={styles.summaryLabel}>INVITATIONS</Text>
                            <Text style={styles.summaryValue}>{referral.creditedInvitationCount}</Text>
                        </View>
                    </View>

                    {referral.eligibility === 'OPEN' && onApplyCode ? (
                        <Pressable
                            accessibilityLabel="Appliquer un code promo"
                            accessibilityRole="button"
                            onPress={onApplyCode}
                            style={styles.applyButton}
                        >
                            <Text style={styles.applyButtonText}>J’ai reçu un code</Text>
                        </Pressable>
                    ) : null}

                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Invitations créditées</Text>
                        <Pressable
                            accessibilityLabel="Actualiser le parrainage"
                            accessibilityRole="button"
                            disabled={store.refreshing}
                            onPress={() => commands.refresh()}
                        >
                            <Text style={styles.refreshText}>{store.refreshing ? 'Actualisation…' : 'Actualiser'}</Text>
                        </Pressable>
                    </View>

                    {store.error && store.invitations.length > 0 ? (
                        <View style={styles.inlineError}>
                            <Text accessibilityRole="alert" style={styles.inlineErrorText}>
                                Les invitations suivantes n’ont pas pu être chargées.
                            </Text>
                            {store.error.retryable ? (
                                <Pressable
                                    accessibilityLabel="Réessayer de charger les invitations"
                                    accessibilityRole="button"
                                    onPress={() => commands.loadNextPage()}
                                >
                                    <Text style={styles.inlineRetry}>Réessayer</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : null}

                    {store.invitations.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyMark}>—</Text>
                            <Text style={styles.emptyTitle}>Aucune invitation créditée</Text>
                            <Text style={styles.emptyBody}>Partagez votre lien pour commencer.</Text>
                        </View>
                    ) : (
                        <View style={styles.invitationList}>
                            {store.invitations.map((invitation) => (
                                <InvitationRow invitation={invitation} key={invitation.id} />
                            ))}
                        </View>
                    )}

                    {store.hasMore ? (
                        <Pressable
                            accessibilityLabel={
                                store.loadingNextPage
                                    ? 'Chargement des invitations suivantes'
                                    : 'Charger plus d’invitations'
                            }
                            accessibilityRole="button"
                            disabled={store.loadingNextPage}
                            onPress={() => commands.loadNextPage()}
                            style={styles.moreButton}
                        >
                            {store.loadingNextPage ? (
                                <ActivityIndicator color="#087f73" />
                            ) : (
                                <Text style={styles.moreText}>Voir plus d’invitations</Text>
                            )}
                        </Pressable>
                    ) : store.invitations.length > 0 ? (
                        <Text style={styles.endText}>Toutes les invitations sont affichées</Text>
                    ) : null}
                </ScrollView>
            </SafeAreaView>
        );
    },
);

function InvitationRow({ invitation }: { invitation: ReferralInvitation }): React.JSX.Element {
    return (
        <View accessibilityLabel={`Invitation ${invitation.inviteeLabel}`} style={styles.invitationRow}>
            <View style={styles.avatar}>
                <Text style={styles.avatarText}>{invitation.inviteeLabel.slice(-2)}</Text>
            </View>
            <View style={styles.invitationDetails}>
                <Text style={styles.inviteeLabel}>{invitation.inviteeLabel}</Text>
                <Text style={styles.invitationDate}>{formatDate(invitation.appliedAt)}</Text>
            </View>
            <Text style={styles.invitationAmount}>+{formatMillilitres(invitation.creditedAmountMl)} L</Text>
        </View>
    );
}

function runNativeAction(action: Observable<void>): void {
    void firstValueFrom(action).catch(() => undefined);
}

function formatMillilitres(value: string): string {
    const padded = value.padStart(4, '0');
    return `${padded.slice(0, -3)}.${padded.slice(-3)}`;
}

function formatDate(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f3f8f2', flex: 1 },
    centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
    loadingText: { color: '#536b64', fontSize: 16, marginTop: 18 },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        minHeight: 48,
        paddingHorizontal: 22,
    },
    backText: { color: '#075b53', fontSize: 15, fontWeight: '800' },
    brand: { color: '#087f73', fontSize: 11, fontWeight: '900', letterSpacing: 2.4 },
    content: { padding: 22, paddingBottom: 48 },
    eyebrow: { color: '#d65d32', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
    title: { color: '#153a34', fontSize: 36, fontWeight: '900', letterSpacing: -1, lineHeight: 40, marginTop: 10 },
    intro: { color: '#61766f', fontSize: 16, lineHeight: 24, marginTop: 12, maxWidth: 430 },
    errorTitle: {
        color: '#153a34',
        fontSize: 28,
        fontWeight: '900',
        lineHeight: 34,
        marginTop: 14,
        textAlign: 'center',
    },
    errorBody: { color: '#687b75', fontSize: 16, lineHeight: 24, marginTop: 12, textAlign: 'center' },
    primaryButton: {
        backgroundColor: '#087f73',
        borderRadius: 16,
        marginTop: 26,
        paddingHorizontal: 30,
        paddingVertical: 15,
    },
    primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    codeCard: { backgroundColor: '#123e37', borderRadius: 28, marginTop: 26, padding: 24 },
    codeLabel: { color: '#9bd5c9', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
    codeValue: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: 2.2, marginTop: 10 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
    lightButton: { alignItems: 'center', backgroundColor: '#d8f3ed', borderRadius: 14, flex: 1, padding: 13 },
    lightButtonText: { color: '#075b53', fontSize: 14, fontWeight: '900' },
    shareButton: { alignItems: 'center', backgroundColor: '#f4a340', borderRadius: 14, flex: 1, padding: 13 },
    shareButtonText: { color: '#3d2a13', fontSize: 14, fontWeight: '900' },
    summaryRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
    summaryCard: { backgroundColor: '#fff', borderRadius: 20, flex: 1, padding: 18 },
    summaryLabel: { color: '#7b8c86', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
    summaryValue: { color: '#153a34', fontSize: 22, fontWeight: '900', marginTop: 7 },
    applyButton: {
        alignItems: 'center',
        borderColor: '#8bbdb3',
        borderRadius: 15,
        borderWidth: 1,
        marginTop: 14,
        padding: 14,
    },
    applyButtonText: { color: '#087f73', fontSize: 14, fontWeight: '900' },
    historyHeader: {
        alignItems: 'baseline',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 14,
        marginTop: 30,
    },
    historyTitle: { color: '#153a34', fontSize: 21, fontWeight: '900' },
    refreshText: { color: '#087f73', fontSize: 13, fontWeight: '800' },
    inlineError: { backgroundColor: '#fff0eb', borderRadius: 15, marginBottom: 12, padding: 14 },
    inlineErrorText: { color: '#8d3827', fontSize: 14, lineHeight: 20 },
    inlineRetry: { color: '#8d3827', fontSize: 14, fontWeight: '900', marginTop: 8 },
    emptyCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, padding: 28 },
    emptyMark: { color: '#9dc9c1', fontSize: 24, fontWeight: '900' },
    emptyTitle: { color: '#183d38', fontSize: 17, fontWeight: '800', marginTop: 8 },
    emptyBody: { color: '#748782', fontSize: 14, marginTop: 7 },
    invitationList: { backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden' },
    invitationRow: { alignItems: 'center', flexDirection: 'row', minHeight: 78, padding: 14 },
    avatar: {
        alignItems: 'center',
        backgroundColor: '#dcefea',
        borderRadius: 16,
        height: 46,
        justifyContent: 'center',
        width: 46,
    },
    avatarText: { color: '#087f73', fontSize: 14, fontWeight: '900' },
    invitationDetails: { flex: 1, marginHorizontal: 13 },
    inviteeLabel: { color: '#183d38', fontSize: 15, fontWeight: '900' },
    invitationDate: { color: '#7b8d89', fontSize: 12, marginTop: 5 },
    invitationAmount: { color: '#087f5b', fontSize: 14, fontWeight: '900' },
    moreButton: {
        alignItems: 'center',
        borderColor: '#a8cec7',
        borderRadius: 15,
        borderWidth: 1,
        justifyContent: 'center',
        marginTop: 16,
        minHeight: 50,
    },
    moreText: { color: '#087f73', fontSize: 14, fontWeight: '800' },
    endText: { color: '#7b8d89', fontSize: 13, marginTop: 18, textAlign: 'center' },
});
