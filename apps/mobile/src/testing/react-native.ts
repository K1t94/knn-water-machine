export const Pressable = 'Pressable';
export const ActivityIndicator = 'ActivityIndicator';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const View = 'View';
export const ScrollView = 'ScrollView';
export const RefreshControl = 'RefreshControl';
export const Platform = { OS: 'ios' };

interface TestWindowDimensions {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly fontScale: number;
}

let windowDimensions: TestWindowDimensions = {
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
};

export const useWindowDimensions = (): TestWindowDimensions => windowDimensions;

export function setWindowDimensionsForTests(dimensions: Pick<TestWindowDimensions, 'width' | 'height'>): void {
    windowDimensions = { ...windowDimensions, ...dimensions };
}

export const Linking = {
    getInitialURL: async (): Promise<string | null> => null,
    addEventListener: (_event: 'url', _listener: (event: { url: string }) => void) => ({
        remove: (): void => undefined,
    }),
};
export const Share = {
    share: async (): Promise<{ action: string }> => ({ action: 'sharedAction' }),
};

export const StyleSheet = {
    create: <T>(styles: T): T => styles,
    flatten: (style: unknown): unknown => style,
};
