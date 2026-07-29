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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuthFlow } from '../auth-flow.context';
import { useRegistrationFlow } from '../registration-flow.context';
import type { AuthStackParams } from '../../navigation/AuthNavigator';

type Props = NativeStackScreenProps<AuthStackParams, 'Phone'>;

export const PhoneEntryScreen = observer(({ navigation }: Props) => {
  const { store, commands } = useAuthFlow();
  const registration = useRegistrationFlow();

  useEffect(() => {
    if (store.phoneState === 'sent') navigation.navigate('Otp');
  }, [navigation, store.phoneState]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <View style={styles.brand}>
          <View style={styles.brandMark}><View style={styles.brandDrop} /></View>
          <Text style={styles.brandName}>KAYNANN</Text>
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>Votre numéro de téléphone</Text>
          <Text style={styles.subtitle}>
            Nous vous enverrons un code à 6 chiffres pour confirmer votre numéro.
          </Text>

          <View style={[
            styles.phoneField,
            store.phoneState === 'invalid' && styles.phoneFieldError,
          ]}>
            <View style={styles.country}>
              <Text style={styles.flag}>SN</Text>
              <Text style={styles.countryCode}>+221</Text>
            </View>
            <View style={styles.separator} />
            <TextInput
              accessibilityLabel="Numéro de téléphone"
              autoComplete="tel"
              keyboardType="phone-pad"
              onChangeText={store.setPhone.bind(store)}
              placeholder="77 123 45 67"
              placeholderTextColor="#9aa6b2"
              style={styles.input}
              value={store.phoneInput}
            />
          </View>

          <View style={styles.promoField}>
            <TextInput
              accessibilityLabel="Code promo facultatif"
              autoCapitalize="characters"
              maxLength={64}
              onChangeText={registration.commands.setPendingPromoCode}
              placeholder="Code promo (facultatif)"
              placeholderTextColor="#9aa6b2"
              style={styles.promoInput}
              value={registration.store.pendingPromoCode ?? ''}
            />
            {registration.store.pendingPromoCode ? (
              <Pressable
                accessibilityLabel="Supprimer le code promo"
                onPress={registration.commands.removePendingPromoCode}
              >
                <Text style={styles.removePromo}>Supprimer</Text>
              </Pressable>
            ) : null}
          </View>

          {store.errorMessage ? (
            <Text accessibilityRole="alert" style={styles.error}>{store.errorMessage}</Text>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={!store.canSubmitPhone}
            onPress={() => commands.requestOtp()}
            style={({ pressed }) => [
              styles.button,
              (!store.canSubmitPhone || pressed) && styles.buttonMuted,
            ]}
          >
            {store.phoneState === 'sending'
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Continuer</Text>}
          </Pressable>
          <Text style={styles.legalHint}>
            En continuant, vous pourrez consulter et accepter les documents légaux applicables.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#f7fbff', flex: 1 },
  screen: { flex: 1, paddingHorizontal: 24 },
  brand: { alignItems: 'center', marginTop: 38 },
  brandMark: {
    alignItems: 'center', backgroundColor: '#dff3ff', borderRadius: 30,
    height: 58, justifyContent: 'center', width: 58,
  },
  brandDrop: {
    backgroundColor: '#1688d4', borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18, borderTopLeftRadius: 18, height: 30,
    transform: [{ rotate: '45deg' }], width: 30,
  },
  brandName: { color: '#117bc0', fontSize: 18, fontWeight: '800', letterSpacing: 2, marginTop: 10 },
  content: { flex: 1, justifyContent: 'center' },
  title: { color: '#12263a', fontSize: 32, fontWeight: '800', lineHeight: 38, textAlign: 'center' },
  subtitle: { color: '#6f7f8f', fontSize: 16, lineHeight: 24, marginTop: 14, textAlign: 'center' },
  phoneField: {
    alignItems: 'center', backgroundColor: '#fff', borderColor: '#c9d8e5',
    borderRadius: 18, borderWidth: 1.5, flexDirection: 'row', height: 68,
    marginTop: 36, paddingHorizontal: 16,
  },
  phoneFieldError: { borderColor: '#c74545' },
  country: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  flag: { color: '#1688d4', fontSize: 12, fontWeight: '800' },
  countryCode: { color: '#12263a', fontSize: 18, fontWeight: '700' },
  separator: { backgroundColor: '#dce6ee', height: 30, marginHorizontal: 14, width: 1 },
  input: { color: '#12263a', flex: 1, fontSize: 19, letterSpacing: 1 },
  promoField: {
    alignItems: 'center', backgroundColor: '#fff', borderColor: '#d8e3ec',
    borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 14,
    minHeight: 52, paddingHorizontal: 14,
  },
  promoInput: { color: '#12263a', flex: 1, fontSize: 15 },
  removePromo: { color: '#1688d4', fontSize: 13, fontWeight: '700' },
  error: { color: '#b83232', fontSize: 14, marginTop: 10 },
  footer: { paddingBottom: 20 },
  button: {
    alignItems: 'center', backgroundColor: '#1688d4', borderRadius: 18,
    height: 60, justifyContent: 'center',
  },
  buttonMuted: { opacity: 0.55 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  legalHint: { color: '#7b8997', fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: 'center' },
});
