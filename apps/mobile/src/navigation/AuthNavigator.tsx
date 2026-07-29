import { createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { Observable, defer, from, merge } from 'rxjs';

import { LegalAcceptanceScreen } from '../auth/screens/LegalAcceptanceScreen';
import { OtpVerificationScreen } from '../auth/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '../auth/screens/PhoneEntryScreen';
import { useRegistrationFlow } from '../auth/registration-flow.context';
import { parsePendingPromo } from './pending-promo-deep-link';

export type AuthStackParams = {
  Phone: undefined;
  Otp: undefined;
  Legal: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParams>();
export const authNavigationRef =
  createNavigationContainerRef<AuthStackParams>();

export const AuthNavigator = observer((): React.JSX.Element => {
  const { commands, store } = useRegistrationFlow();
  useEffect(() => {
    const openedUrls = new Observable<string>((subscriber) => {
      const subscription = Linking.addEventListener('url', ({ url }) => {
        subscriber.next(url);
      });
      return () => subscription.remove();
    });
    const subscription = merge(
      defer(() => from(Linking.getInitialURL())),
      openedUrls,
    ).subscribe(
      (url) => {
        const promo = parsePendingPromo(url);
        if (promo) commands.setPendingPromoCode(promo);
      },
    );
    return () => subscription.unsubscribe();
  }, [commands]);

  useEffect(() => {
    const syncRegistrationRoute = (): void => {
      const requiresRegistration =
        store.state !== 'idle' && store.state !== 'success';
      if (
        requiresRegistration &&
        authNavigationRef.isReady() &&
        authNavigationRef.getCurrentRoute()?.name !== 'Legal'
      ) {
        authNavigationRef.navigate('Legal');
      }
    };

    syncRegistrationRoute();
    const unsubscribe = authNavigationRef.addListener(
      'state',
      syncRegistrationRoute,
    );

    return unsubscribe;
  }, [store.state]);

  return (
    <Stack.Navigator
      initialRouteName="Phone"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Phone" component={PhoneEntryScreen} />
      <Stack.Screen name="Otp" component={OtpVerificationScreen} />
      <Stack.Screen name="Legal" component={LegalAcceptanceScreen} />
    </Stack.Navigator>
  );
});
