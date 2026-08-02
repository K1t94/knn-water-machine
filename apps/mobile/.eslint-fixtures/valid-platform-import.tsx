import { Platform, Pressable, Text, View } from 'react-native';

import { platformValue } from './platform-target';

type ValidPlatformImportProps = {
    active: boolean;
    onPress: () => void;
};

export function ValidPlatformImport({ active, onPress }: ValidPlatformImportProps): React.JSX.Element {
    const selectedValue: unknown = Platform.select({
        android: platformValue,
        default: platformValue,
        ios: platformValue,
    });

    return (
        <View style={{ opacity: active ? 1 : 0.5 }}>
            <Pressable accessibilityLabel="Select platform" accessibilityRole="button" onPress={onPress}>
                <Text>{typeof selectedValue === 'string' ? selectedValue : ''}</Text>
            </Pressable>
        </View>
    );
}
