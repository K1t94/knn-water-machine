import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { of } from 'rxjs';

import type { AppModule } from '../../api/src/app.module';

type InvalidMobileProps = {
    enabled: boolean;
    label: string;
};

type ForbiddenApiType = AppModule;

const ignoredAsyncWork = async (): Promise<void> => undefined;

export function InvalidMobile({ enabled, label }: InvalidMobileProps): React.JSX.Element {
    if (enabled) {
        useState(false);
    }

    useEffect(() => {
        if (label.length > 0) {
            ignoredAsyncWork().catch(() => undefined);
        }
    }, []);

    ignoredAsyncWork();
    of(label);

    const observableReturningCallback: () => void = () => of(label);
    observableReturningCallback();
    of(label).subscribe(async () => Promise.resolve());

    const items = [label];
    return (
        <View style={styles.container}>
            Raw native text
            {items.map((item) => (
                <Text>{item}</Text>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    unused: {
        opacity: 0.5,
    },
});

export type { ForbiddenApiType };
