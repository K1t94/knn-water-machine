import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthFlow } from '../auth-flow.context';
import { useRegistrationFlow } from '../registration-flow.context';

import type { AuthStackParams } from '../../navigation/AuthNavigator';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<AuthStackParams, 'Otp'>;

export const OtpVerificationScreen = observer(({ navigation }: Props) => {
    const { store, commands } = useAuthFlow();
    const registration = useRegistrationFlow();
    const cells = Array.from({ length: 6 }, (_, index) => store.code[index] ?? '');

    useEffect(() => {
        if (registration.store.state !== 'idle') {
            navigation.replace('Legal');
        }
    }, [navigation, registration.store.state]);

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
                <Pressable accessibilityLabel="Retour" onPress={() => navigation.goBack()} style={styles.back}>
                    <Text style={styles.backText}>‹</Text>
                </Pressable>

                <View style={styles.content}>
                    <Text style={styles.title}>Entrez le code reçu</Text>
                    <Text style={styles.subtitle}>Code envoyé au +221 •• ••• {store.phoneInput.slice(-4)}</Text>

                    <View style={styles.codeWrap}>
                        <TextInput
                            accessibilityLabel="Code de vérification"
                            autoComplete="sms-otp"
                            autoFocus
                            caretHidden
                            keyboardType="number-pad"
                            maxLength={6}
                            onChangeText={store.setCode.bind(store)}
                            style={styles.hiddenInput}
                            textContentType="oneTimeCode"
                            value={store.code}
                        />
                        {cells.map((digit, index) => (
                            <View
                                key={index}
                                style={[
                                    styles.cell,
                                    index === store.code.length && styles.cellActive,
                                    ['invalid', 'expired', 'exhausted'].includes(store.verificationState) &&
                                        styles.cellError,
                                ]}
                            >
                                <Text style={styles.cellText}>{digit}</Text>
                            </View>
                        ))}
                    </View>

                    {store.errorMessage ? (
                        <Text accessibilityRole="alert" style={styles.error}>
                            {store.errorMessage}
                        </Text>
                    ) : null}

                    <View style={styles.resendRow}>
                        {store.canResend ? (
                            <Pressable disabled={store.phoneState === 'sending'} onPress={() => commands.resendOtp()}>
                                <Text style={styles.resendLink}>Renvoyer le code</Text>
                            </Pressable>
                        ) : (
                            <Text style={styles.resendText}>Renvoyer dans {formatCountdown(store.resendSeconds)}</Text>
                        )}
                    </View>
                </View>

                <Pressable
                    accessibilityRole="button"
                    disabled={!store.canSubmitCode}
                    onPress={() => commands.verifyOtp()}
                    style={({ pressed }) => [styles.button, (!store.canSubmitCode || pressed) && styles.buttonMuted]}
                >
                    {store.verificationState === 'checking' ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>Vérifier</Text>
                    )}
                </Pressable>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
});

function formatCountdown(seconds: number): string {
    return `0:${Math.max(0, seconds).toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7fbff', flex: 1 },
    screen: { flex: 1, padding: 24 },
    back: {
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 22,
        height: 44,
        justifyContent: 'center',
        width: 44,
    },
    backText: { color: '#17324a', fontSize: 34, lineHeight: 36, marginTop: -4 },
    content: { flex: 1, justifyContent: 'center' },
    title: { color: '#12263a', fontSize: 32, fontWeight: '800', lineHeight: 38, textAlign: 'center' },
    subtitle: { color: '#6f7f8f', fontSize: 16, marginTop: 14, textAlign: 'center' },
    codeWrap: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 42 },
    hiddenInput: { height: 64, opacity: 0.01, position: 'absolute', width: '100%', zIndex: 2 },
    cell: {
        alignItems: 'center',
        backgroundColor: '#fff',
        borderColor: '#c9d8e5',
        borderRadius: 14,
        borderWidth: 1.5,
        height: 62,
        justifyContent: 'center',
        width: 45,
    },
    cellActive: { borderColor: '#1688d4', borderWidth: 2 },
    cellError: { borderColor: '#c74545' },
    cellText: { color: '#12263a', fontSize: 25, fontWeight: '800' },
    error: { color: '#b83232', fontSize: 14, marginTop: 14, textAlign: 'center' },
    resendRow: { alignItems: 'center', height: 44, justifyContent: 'center', marginTop: 22 },
    resendText: { color: '#778795', fontSize: 15 },
    resendLink: { color: '#1688d4', fontSize: 15, fontWeight: '800' },
    button: {
        alignItems: 'center',
        backgroundColor: '#1688d4',
        borderRadius: 18,
        height: 60,
        justifyContent: 'center',
    },
    buttonMuted: { opacity: 0.55 },
    buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
