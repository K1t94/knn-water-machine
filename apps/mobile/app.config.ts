import type { ExpoConfig } from 'expo/config';

const developmentWebEnabled = process.env.APP_ENV === 'development' && process.env.EXPO_DEV_WEB === 'true';
const googleMapsAndroidApiKeyValue: unknown = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
const googleMapsAndroidApiKey =
    typeof googleMapsAndroidApiKeyValue === 'string' && googleMapsAndroidApiKeyValue.length > 0
        ? googleMapsAndroidApiKeyValue
        : undefined;

const config: ExpoConfig = {
    name: 'KAYNANN Water Vending',
    slug: 'kaynann-water-vending',
    version: '0.1.0',
    platforms: developmentWebEnabled ? ['ios', 'android', 'web'] : ['ios', 'android'],
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'kaynann',
    ios: {
        bundleIdentifier: 'com.kaynann.watervending',
    },
    android: {
        package: 'com.kaynann.watervending',
        ...(googleMapsAndroidApiKey
            ? {
                  config: {
                      googleMaps: {
                          apiKey: googleMapsAndroidApiKey,
                      },
                  },
              }
            : {}),
    },
    plugins: [
        'expo-dev-client',
        'expo-secure-store',
        [
            'expo-location',
            {
                locationWhenInUsePermission:
                    'Разрешите KAYNANN Water Vending использовать геопозицию для поиска ближайших автоматов.',
                locationAlwaysAndWhenInUsePermission: false,
                locationAlwaysPermission: false,
                isIosBackgroundLocationEnabled: false,
                isAndroidBackgroundLocationEnabled: false,
                isAndroidForegroundServiceEnabled: false,
            },
        ],
        [
            'expo-camera',
            {
                cameraPermission:
                    'Разрешите KAYNANN Water Vending использовать камеру для сканирования QR-кода автомата.',
                microphonePermission: false,
                recordAudioAndroid: false,
            },
        ],
    ],
};

export default config;
