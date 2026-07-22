import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'KAYNANN Water Vending',
  slug: 'kaynann-water-vending',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: 'kaynann',
  ios: {
    bundleIdentifier: 'com.kaynann.watervending',
  },
  android: {
    package: 'com.kaynann.watervending',
  },
  plugins: ['expo-dev-client'],
};

export default config;
