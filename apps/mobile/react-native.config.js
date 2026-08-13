const e2eNativeModulesEnabled =
    process.env.EAS_BUILD_PROFILE === 'machine-discovery-e2e' &&
    process.env.APP_ENV === 'e2e' &&
    process.env.EXPO_PUBLIC_BUILD_VARIANT === 'machine-discovery-e2e' &&
    process.env.EXPO_PUBLIC_PRODUCTION_DISTRIBUTABLE === 'false';

module.exports = {
    dependencies: {
        'react-native-launch-arguments': e2eNativeModulesEnabled
            ? {}
            : {
                  platforms: {
                      android: null,
                      ios: null,
                  },
              },
    },
};
