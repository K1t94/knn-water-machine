import type { ExpoConfig } from 'expo/config';

const developmentWebEnabled =
  process.env.APP_ENV === 'development' &&
  process.env.EXPO_DEV_WEB === 'true';

const config: ExpoConfig = {
  name: 'KAYNANN Water Vending',
  slug: 'kaynann-water-vending',
  version: '0.1.0',
  platforms: developmentWebEnabled
    ? ['ios', 'android', 'web']
    : ['ios', 'android'],
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: 'kaynann',
  ios: {
    bundleIdentifier: 'com.kaynann.watervending',
  },
  android: {
    package: 'com.kaynann.watervending',
  },
  plugins: ['expo-dev-client', 'expo-secure-store'],
};

export default config;
