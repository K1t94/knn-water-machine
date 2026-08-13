import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExpoConfig } from 'expo/config';

const mapsKeyEnvironmentVariable = 'GOOGLE_MAPS_ANDROID_API_KEY';

async function loadConfig(mapsKey: string): Promise<ExpoConfig> {
    vi.stubEnv(mapsKeyEnvironmentVariable, mapsKey);
    vi.resetModules();

    const configModule = await import('./app.config');

    return configModule.default;
}

function getPluginOptions(config: ExpoConfig, pluginName: string): Record<string, unknown> {
    const plugins: readonly unknown[] = config.plugins ?? [];
    const plugin = plugins.find(
        (candidate): candidate is [string, Record<string, unknown>] =>
            Array.isArray(candidate) &&
            candidate[0] === pluginName &&
            typeof candidate[1] === 'object' &&
            candidate[1] !== null,
    );

    if (!plugin) {
        throw new Error(`Missing configured plugin: ${pluginName}`);
    }

    return plugin[1];
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('Expo native configuration', () => {
    it('configures localized foreground-only location access', async () => {
        const config = await loadConfig('');
        const options = getPluginOptions(config, 'expo-location');

        expect(options.locationWhenInUsePermission).toMatch(/геопозици/i);
        expect(options.locationAlwaysAndWhenInUsePermission).toBe(false);
        expect(options.locationAlwaysPermission).toBe(false);
        expect(options.isIosBackgroundLocationEnabled).toBe(false);
        expect(options.isAndroidBackgroundLocationEnabled).toBe(false);
        expect(options.isAndroidForegroundServiceEnabled).toBe(false);
    });

    it('configures localized camera access without audio permissions', async () => {
        const config = await loadConfig('');
        const options = getPluginOptions(config, 'expo-camera');

        expect(options.cameraPermission).toMatch(/камер/i);
        expect(options.microphonePermission).toBe(false);
        expect(options.recordAudioAndroid).toBe(false);
    });

    it('reads the Android Maps key only from deployment environment configuration', async () => {
        const configWithoutKey = await loadConfig('');

        expect(configWithoutKey.android?.config?.googleMaps?.apiKey).toBeUndefined();

        const configWithKey = await loadConfig('deployment-secret-value');

        expect(configWithKey.android?.config?.googleMaps?.apiKey).toBe('deployment-secret-value');
    });
});
