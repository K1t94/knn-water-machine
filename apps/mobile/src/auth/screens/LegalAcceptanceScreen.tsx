import { observer } from 'mobx-react-lite';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRegistrationFlow } from '../registration-flow.context';

import type { AuthStackParams } from '../../navigation/AuthNavigator';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<AuthStackParams, 'Legal'>;

export const LegalAcceptanceScreen = observer(({ navigation }: Props) => {
    const { store, commands } = useRegistrationFlow();
    const busy = store.state === 'loading' || store.state === 'submitting';

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.screen}>
                <Pressable
                    accessibilityLabel="Retour"
                    disabled={busy}
                    onPress={() => {
                        commands.cancel();
                        navigation.popToTop();
                    }}
                    style={styles.back}
                >
                    <Text style={styles.backText}>‹</Text>
                </Pressable>

                <Text style={styles.title}>Conditions et confidentialité</Text>
                <Text style={styles.subtitle}>
                    Lisez et acceptez les documents obligatoires pour terminer votre inscription.
                </Text>

                {store.state === 'loading' ? (
                    <View style={styles.center}>
                        <ActivityIndicator color="#1688d4" />
                        <Text style={styles.status}>Chargement des documents…</Text>
                    </View>
                ) : store.state === 'success' ? (
                    <View style={styles.center}>
                        <View style={styles.successMark}>
                            <Text style={styles.successText}>✓</Text>
                        </View>
                        <Text style={styles.successTitle}>Inscription terminée</Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.documents} showsVerticalScrollIndicator={false}>
                        {store.legalSet?.documents.map((document) => {
                            const accepted = store.acceptedDocumentIds.has(document.id);
                            return (
                                <View key={document.id} style={styles.document}>
                                    <Text style={styles.documentTitle}>{document.title}</Text>
                                    <Text style={styles.version}>Version {document.version}</Text>
                                    <Text style={styles.content}>{document.content}</Text>
                                    <Pressable
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: accepted }}
                                        onPress={() => commands.toggleAcceptance(document.id)}
                                        style={styles.acceptance}
                                    >
                                        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                                            <Text style={styles.check}>{accepted ? '✓' : ''}</Text>
                                        </View>
                                        <Text style={styles.acceptanceText}>J’accepte {document.title}</Text>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </ScrollView>
                )}

                {store.errorMessage ? (
                    <View style={styles.errorBox}>
                        <Text accessibilityRole="alert" style={styles.error}>
                            {store.errorMessage}
                        </Text>
                        {['offline', 'error', 'stale'].includes(store.state) ? (
                            <Pressable onPress={commands.retryDocuments}>
                                <Text style={styles.retry}>Réessayer</Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}

                {store.state !== 'success' ? (
                    <Pressable
                        accessibilityRole="button"
                        disabled={busy || !store.canComplete}
                        onPress={commands.complete}
                        style={({ pressed }) => [
                            styles.button,
                            (busy || !store.canComplete || pressed) && styles.buttonMuted,
                        ]}
                    >
                        {store.state === 'submitting' ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Accepter et continuer</Text>
                        )}
                    </Pressable>
                ) : null}
            </View>
        </SafeAreaView>
    );
});

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7fbff', flex: 1 },
    screen: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
    back: {
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 22,
        height: 44,
        justifyContent: 'center',
        width: 44,
    },
    backText: { color: '#17324a', fontSize: 34, lineHeight: 36, marginTop: -4 },
    title: {
        color: '#12263a',
        fontSize: 30,
        fontWeight: '800',
        lineHeight: 36,
        marginTop: 26,
    },
    subtitle: { color: '#6f7f8f', fontSize: 15, lineHeight: 22, marginTop: 10 },
    documents: { gap: 16, paddingBottom: 16, paddingTop: 22 },
    document: {
        backgroundColor: '#fff',
        borderColor: '#deebf3',
        borderRadius: 18,
        borderWidth: 1,
        padding: 18,
    },
    documentTitle: { color: '#15324a', fontSize: 18, fontWeight: '800' },
    version: { color: '#82909d', fontSize: 12, marginTop: 4 },
    content: { color: '#536879', fontSize: 14, lineHeight: 21, marginTop: 14 },
    acceptance: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        marginTop: 18,
    },
    checkbox: {
        alignItems: 'center',
        borderColor: '#9db4c5',
        borderRadius: 6,
        borderWidth: 1.5,
        height: 24,
        justifyContent: 'center',
        width: 24,
    },
    checkboxChecked: { backgroundColor: '#1688d4', borderColor: '#1688d4' },
    check: { color: '#fff', fontSize: 16, fontWeight: '800' },
    acceptanceText: {
        color: '#17324a',
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
    },
    center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
    status: { color: '#6f7f8f', marginTop: 12 },
    successMark: {
        alignItems: 'center',
        backgroundColor: '#dff4ea',
        borderRadius: 36,
        height: 72,
        justifyContent: 'center',
        width: 72,
    },
    successText: { color: '#168b5b', fontSize: 38, fontWeight: '800' },
    successTitle: {
        color: '#12263a',
        fontSize: 24,
        fontWeight: '800',
        marginTop: 18,
    },
    errorBox: { alignItems: 'center', marginBottom: 10 },
    error: { color: '#b83232', fontSize: 13, textAlign: 'center' },
    retry: { color: '#1688d4', fontSize: 14, fontWeight: '800', marginTop: 6 },
    button: {
        alignItems: 'center',
        backgroundColor: '#1688d4',
        borderRadius: 18,
        height: 60,
        justifyContent: 'center',
        marginBottom: 18,
    },
    buttonMuted: { opacity: 0.5 },
    buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
