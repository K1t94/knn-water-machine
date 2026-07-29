import { NavigationContainer } from '@react-navigation/native';
import { observer } from 'mobx-react-lite';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AuthApi, OtpVerified } from '../api/auth-api';
import type { AuthCompositionRoot } from '../auth/auth-composition-root';
import { AuthFlowProvider } from '../auth/auth-flow.context';
import {
  RegistrationFlowProvider,
  useRegistrationFlow,
} from '../auth/registration-flow.context';
import { AuthNavigator, authNavigationRef } from './AuthNavigator';

export const RootNavigator = observer(({
  api,
  root,
}: {
  api: AuthApi;
  root: AuthCompositionRoot;
}): React.JSX.Element => {
  const route = root.sessionStore.rootRoute;
  if (route === 'loading') {
    return <Centered><ActivityIndicator /></Centered>;
  }
  if (route === 'offline') {
    return (
      <Centered>
        <Text style={styles.title}>Connection unavailable</Text>
        <Text style={styles.body}>Reconnect to restore your session.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => root.sessionFlow.retryRestore()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </Centered>
    );
  }
  if (route === 'main') {
    return (
      <Centered>
        <Text style={styles.brand}>KAYNANN</Text>
        <Text style={styles.title}>Session restored</Text>
        <Text style={styles.body}>
          The main application is available without another OTP.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => root.sessionFlow.logout()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Log out</Text>
        </Pressable>
      </Centered>
    );
  }
  return (
    <NavigationContainer ref={authNavigationRef}>
      <RegistrationFlowProvider api={api} root={root}>
        <AuthScope api={api} root={root} />
      </RegistrationFlowProvider>
    </NavigationContainer>
  );
});

function AuthScope({
  api,
  root,
}: {
  api: AuthApi;
  root: AuthCompositionRoot;
}): React.JSX.Element {
  const registration = useRegistrationFlow();
  const onVerified = (result: OtpVerified): void => {
    registration.commands.begin(result);
  };
  return (
    <AuthFlowProvider
      api={api}
      root={root}
      getPendingPromoCode={() => registration.store.pendingPromoCode}
      onVerified={onVerified}
    >
      <AuthNavigator />
    </AuthFlowProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  body: {
    color: '#526071',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    maxWidth: 320,
    textAlign: 'center',
  },
  brand: {
    color: '#0068d9',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#0068d9',
    borderRadius: 16,
    marginTop: 28,
    paddingHorizontal: 32,
    paddingVertical: 15,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  centered: {
    alignItems: 'center',
    backgroundColor: '#f7fbff',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#102a56', fontSize: 26, fontWeight: '700' },
});
