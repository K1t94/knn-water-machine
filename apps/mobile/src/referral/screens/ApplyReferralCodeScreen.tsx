import { observer } from 'mobx-react-lite';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ReferralCommands } from '../services/referral-flow.service';
import type { ReferralStore } from '../stores/referral.store';

interface ApplyReferralCodeScreenProps {
    store: ReferralStore;
    commands: ReferralCommands;
    onBack?(): void;
}

export const ApplyReferralCodeScreen = observer(
    ({ store, commands, onBack }: ApplyReferralCodeScreenProps): React.JSX.Element => {
        const attached = store.myReferral?.eligibility === 'ATTACHED' || store.applyState === 'success';
        const closed = store.myReferral?.eligibility === 'CLOSED' || store.applyState === 'closed';
        const locked = attached || closed || store.applyState === 'applying';

        return (
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
                    {onBack ? (
                        <Pressable
                            accessibilityLabel="Retour au parrainage"
                            accessibilityRole="button"
                            onPress={onBack}
                        >
                            <Text style={styles.backText}>‹ Retour</Text>
                        </Pressable>
                    ) : null}
                    <View style={styles.hero}>
                        <Text style={styles.eyebrow}>CODE REÇU</Text>
                        <Text style={styles.title}>Rattacher mon invitation</Text>
                        <Text style={styles.body}>
                            Vérifiez le code, puis confirmez. Cette action ne peut pas être remplacée après validation.
                        </Text>
                    </View>

                    <View style={styles.formCard}>
                        <Text style={styles.label}>CODE PROMO</Text>
                        <TextInput
                            accessibilityLabel="Code promo"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            editable={!locked}
                            maxLength={64}
                            onChangeText={(value) => store.setApplyCode(value)}
                            placeholder="12 caractères"
                            placeholderTextColor="#90a19c"
                            style={[styles.input, locked ? styles.inputLocked : undefined]}
                            value={store.applyCode}
                        />

                        {attached ? (
                            <Text accessibilityRole="alert" style={styles.successText}>
                                Code rattaché avec succès
                            </Text>
                        ) : null}
                        {closed ? (
                            <Text accessibilityRole="alert" style={styles.errorText}>
                                Un code promo ne peut plus être appliqué à ce compte.
                            </Text>
                        ) : null}
                        {store.applyState === 'validation-error' ? (
                            <Text accessibilityRole="alert" style={styles.errorText}>
                                Ce code est invalide ou indisponible.
                            </Text>
                        ) : null}
                        {store.applyState === 'error' ? (
                            <View>
                                <Text accessibilityRole="alert" style={styles.errorText}>
                                    Le code n’a pas pu être appliqué. Réessayez.
                                </Text>
                                {store.applyError?.retryable ? (
                                    <Pressable
                                        accessibilityLabel="Réessayer d’appliquer le code promo"
                                        accessibilityRole="button"
                                        onPress={() => commands.applyPromoCode(store.applyCode)}
                                    >
                                        <Text style={styles.retryText}>Réessayer</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        ) : null}

                        {!attached && !closed ? (
                            <Pressable
                                accessibilityLabel="Confirmer le code promo"
                                accessibilityRole="button"
                                disabled={!store.applyCode || store.applyState === 'applying'}
                                onPress={() => commands.applyPromoCode(store.applyCode)}
                                style={[
                                    styles.submitButton,
                                    !store.applyCode || store.applyState === 'applying'
                                        ? styles.buttonDisabled
                                        : undefined,
                                ]}
                            >
                                <Text style={styles.submitText}>
                                    {store.applyState === 'applying' ? 'Validation…' : 'Confirmer le code'}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>
        );
    },
);

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f3f8f2', flex: 1 },
    container: { flex: 1, padding: 22 },
    backText: { color: '#075b53', fontSize: 15, fontWeight: '800' },
    hero: { marginTop: 34, maxWidth: 440 },
    eyebrow: { color: '#d65d32', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
    title: { color: '#153a34', fontSize: 34, fontWeight: '900', letterSpacing: -0.8, lineHeight: 40, marginTop: 10 },
    body: { color: '#61766f', fontSize: 16, lineHeight: 24, marginTop: 12 },
    formCard: { backgroundColor: '#fff', borderRadius: 26, marginTop: 30, padding: 22 },
    label: { color: '#657a73', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    input: {
        backgroundColor: '#edf6f2',
        borderColor: '#a9cec5',
        borderRadius: 15,
        borderWidth: 1,
        color: '#153a34',
        fontSize: 20,
        fontWeight: '900',
        letterSpacing: 1.6,
        marginTop: 10,
        minHeight: 56,
        paddingHorizontal: 16,
    },
    inputLocked: { backgroundColor: '#e5ece9', color: '#60716c' },
    successText: { color: '#087f5b', fontSize: 14, fontWeight: '800', marginTop: 14 },
    errorText: { color: '#a43d29', fontSize: 14, lineHeight: 20, marginTop: 14 },
    retryText: { color: '#a43d29', fontSize: 14, fontWeight: '900', marginTop: 9 },
    submitButton: { alignItems: 'center', backgroundColor: '#087f73', borderRadius: 15, marginTop: 22, padding: 16 },
    buttonDisabled: { opacity: 0.45 },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
