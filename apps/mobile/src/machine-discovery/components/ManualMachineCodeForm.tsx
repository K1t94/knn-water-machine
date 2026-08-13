import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import type { StyleProp, ViewStyle } from 'react-native';

export interface ManualMachineCodeFormProps {
    readonly value: string;
    readonly loading: boolean;
    readonly onChangeText: (value: string) => void;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
    readonly validationMessage?: string;
    readonly errorMessage?: string;
    readonly autoFocus?: boolean;
    readonly style?: StyleProp<ViewStyle>;
}

export function ManualMachineCodeForm({
    value,
    loading,
    onChangeText,
    onSubmit,
    onCancel,
    validationMessage,
    errorMessage,
    autoFocus = true,
    style,
}: ManualMachineCodeFormProps): React.JSX.Element {
    const hasValidationError = validationMessage !== undefined;
    const canSubmit = value.trim().length > 0 && !hasValidationError && !loading;

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.keyboardArea, style]}
            testID="manual-machine-code-form"
        >
            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.heading}>
                    <Text style={styles.eyebrow}>IDENTIFICATION</Text>
                    <Text style={styles.title}>Saisir le code du point</Text>
                    <Text style={styles.instructions}>
                        Entrez le code indiqué sur le point d’eau. Les espaces au début et à la fin seront ignorés.
                    </Text>
                </View>

                <View style={styles.fieldGroup}>
                    <Text nativeID="manual-machine-code-label" style={styles.label}>
                        Code du point d’eau
                    </Text>
                    <TextInput
                        accessibilityLabel="Code du point d’eau"
                        accessibilityState={{ disabled: loading }}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoFocus={autoFocus}
                        editable={!loading}
                        maxLength={256}
                        onChangeText={onChangeText}
                        onSubmitEditing={() => {
                            if (canSubmit) onSubmit();
                        }}
                        placeholder="Saisissez le code"
                        placeholderTextColor="#81938f"
                        returnKeyType="done"
                        style={[
                            styles.input,
                            hasValidationError && styles.inputInvalid,
                            loading && styles.inputDisabled,
                        ]}
                        testID="manual-machine-code-input"
                        value={value}
                    />
                    {validationMessage === undefined ? null : (
                        <Text
                            accessibilityLiveRegion="polite"
                            accessibilityRole="alert"
                            style={styles.validationMessage}
                        >
                            {validationMessage}
                        </Text>
                    )}
                </View>

                {errorMessage === undefined ? null : (
                    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorNotice}>
                        <Text style={styles.errorTitle}>Impossible de vérifier le code</Text>
                        <Text style={styles.errorMessage}>{errorMessage}</Text>
                    </View>
                )}

                <View style={styles.actions}>
                    <Pressable
                        accessibilityLabel={loading ? 'Vérification du code en cours' : 'Vérifier le code'}
                        accessibilityRole="button"
                        accessibilityState={{ busy: loading, disabled: !canSubmit }}
                        disabled={!canSubmit}
                        onPress={onSubmit}
                        style={({ pressed }) => [
                            styles.submitButton,
                            (!canSubmit || pressed) && styles.submitButtonMuted,
                        ]}
                        testID="manual-machine-code-submit"
                    >
                        {loading ? (
                            <ActivityIndicator color="#ffffff" />
                        ) : (
                            <Text style={styles.submitButtonText}>Vérifier le code</Text>
                        )}
                    </Pressable>

                    <Pressable
                        accessibilityLabel="Annuler la saisie du code"
                        accessibilityRole="button"
                        onPress={onCancel}
                        style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
                        testID="manual-machine-code-cancel"
                    >
                        <Text style={styles.cancelButtonText}>Annuler</Text>
                    </Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    keyboardArea: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingVertical: 28,
    },
    heading: {
        marginBottom: 28,
    },
    eyebrow: {
        color: '#087f73',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1.8,
        textAlign: 'center',
    },
    title: {
        color: '#12332f',
        fontSize: 28,
        fontWeight: '900',
        lineHeight: 34,
        marginTop: 6,
        textAlign: 'center',
    },
    instructions: {
        color: '#526b67',
        fontSize: 15,
        lineHeight: 22,
        marginTop: 12,
        textAlign: 'center',
    },
    fieldGroup: {
        gap: 8,
    },
    label: {
        color: '#284b46',
        fontSize: 14,
        fontWeight: '800',
    },
    input: {
        backgroundColor: '#ffffff',
        borderColor: '#bdd4cf',
        borderRadius: 18,
        borderWidth: 1.5,
        color: '#12332f',
        fontSize: 18,
        fontWeight: '700',
        minHeight: 60,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    inputInvalid: {
        borderColor: '#b83b3b',
    },
    inputDisabled: {
        backgroundColor: '#edf3f1',
        color: '#60736f',
    },
    validationMessage: {
        color: '#a52e2e',
        fontSize: 13,
        lineHeight: 19,
    },
    errorNotice: {
        backgroundColor: '#fff0ed',
        borderColor: '#efc0b7',
        borderRadius: 16,
        borderWidth: 1,
        marginTop: 18,
        padding: 14,
    },
    errorTitle: {
        color: '#8d2b22',
        fontSize: 14,
        fontWeight: '800',
    },
    errorMessage: {
        color: '#94463f',
        fontSize: 13,
        lineHeight: 19,
        marginTop: 4,
    },
    actions: {
        gap: 12,
        marginTop: 28,
    },
    submitButton: {
        alignItems: 'center',
        backgroundColor: '#087f73',
        borderRadius: 18,
        justifyContent: 'center',
        minHeight: 58,
        paddingHorizontal: 20,
    },
    submitButtonMuted: {
        opacity: 0.55,
    },
    submitButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '900',
    },
    cancelButton: {
        alignItems: 'center',
        borderRadius: 16,
        justifyContent: 'center',
        minHeight: 48,
        paddingHorizontal: 20,
    },
    cancelButtonPressed: {
        backgroundColor: '#dcefea',
    },
    cancelButtonText: {
        color: '#075b53',
        fontSize: 15,
        fontWeight: '800',
    },
});
