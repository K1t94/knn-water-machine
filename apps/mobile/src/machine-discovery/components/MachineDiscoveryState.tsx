import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { StyleProp, ViewStyle } from 'react-native';

export type MachineDiscoveryStateVariant = 'loading' | 'empty' | 'denied' | 'offline' | 'service' | 'stale' | 'error';

export type MachineDiscoveryStateContext = 'catalog' | 'detail' | 'scanner';

export interface MachineDiscoveryStateProps {
    readonly variant: MachineDiscoveryStateVariant;
    readonly context?: MachineDiscoveryStateContext;
    readonly compact?: boolean;
    readonly onRetry?: () => void;
    readonly style?: StyleProp<ViewStyle>;
    readonly testID?: string;
}

interface StateCopy {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
}

const loadingCopy: Readonly<Record<MachineDiscoveryStateContext, StateCopy>> = {
    catalog: {
        eyebrow: 'POINTS D’EAU',
        title: 'Actualisation des points d’eau…',
        body: 'Recherche des informations disponibles dans la zone actuelle.',
    },
    detail: {
        eyebrow: 'POINT D’EAU',
        title: 'Actualisation du point d’eau…',
        body: 'Vérification du statut et du prix actuels.',
    },
    scanner: {
        eyebrow: 'IDENTIFICATION',
        title: 'Vérification du code…',
        body: 'Validation sécurisée du point d’eau en cours.',
    },
};

const emptyCopy: Readonly<Record<MachineDiscoveryStateContext, StateCopy>> = {
    catalog: {
        eyebrow: 'POINTS D’EAU',
        title: 'Aucun point d’eau trouvé',
        body: 'Déplacez la carte ou consultez une autre zone.',
    },
    detail: {
        eyebrow: 'POINT D’EAU',
        title: 'Aucune fiche à afficher',
        body: 'Revenez à la liste et choisissez un point d’eau.',
    },
    scanner: {
        eyebrow: 'IDENTIFICATION',
        title: 'Aucun code détecté',
        body: 'Cadrez le QR ou saisissez le code public manuellement.',
    },
};

const deniedCopy: Readonly<Record<MachineDiscoveryStateContext, StateCopy>> = {
    catalog: {
        eyebrow: 'LOCALISATION',
        title: 'Localisation indisponible',
        body: 'La liste reste disponible dans la zone de service configurée.',
    },
    detail: {
        eyebrow: 'ACCÈS',
        title: 'Accès indisponible',
        body: 'Revenez aux points d’eau disponibles.',
    },
    scanner: {
        eyebrow: 'CAMÉRA',
        title: 'Accès à la caméra refusé',
        body: 'Utilisez le code public indiqué sur le point d’eau.',
    },
};

const errorCopy: Readonly<Record<MachineDiscoveryStateContext, StateCopy>> = {
    catalog: {
        eyebrow: 'POINTS D’EAU',
        title: 'Points d’eau indisponibles',
        body: 'Les résultats ne peuvent pas être chargés pour le moment.',
    },
    detail: {
        eyebrow: 'POINT D’EAU',
        title: 'Fiche indisponible',
        body: 'La fiche actuelle ne peut pas être chargée pour le moment.',
    },
    scanner: {
        eyebrow: 'IDENTIFICATION',
        title: 'Vérification impossible',
        body: 'Le code ne peut pas être vérifié pour le moment.',
    },
};

const sharedCopy: Readonly<
    Record<Exclude<MachineDiscoveryStateVariant, 'loading' | 'empty' | 'denied' | 'error'>, StateCopy>
> = {
    offline: {
        eyebrow: 'CONNEXION',
        title: 'Connexion indisponible',
        body: 'Vérifiez votre connexion, puis réessayez.',
    },
    service: {
        eyebrow: 'MAINTENANCE',
        title: 'Point d’eau en maintenance',
        body: 'Ce point reste visible, mais il ne peut pas être sélectionné actuellement.',
    },
    stale: {
        eyebrow: 'ACTUALISATION',
        title: 'Résultats à actualiser',
        body: 'Actualisez les informations avant de continuer.',
    },
};

export function MachineDiscoveryState({
    variant,
    context = 'catalog',
    compact = false,
    onRetry,
    style,
    testID,
}: MachineDiscoveryStateProps): React.JSX.Element {
    const copy = getStateCopy(variant, context);
    const loading = variant === 'loading';

    return (
        <View
            accessible={variant !== 'empty'}
            accessibilityLabel={loading ? copy.title.replace('…', '') : undefined}
            accessibilityLiveRegion="polite"
            accessibilityRole={loading ? 'progressbar' : variant === 'empty' ? undefined : 'alert'}
            style={[styles.container, compact && styles.compact, style]}
            testID={testID}
        >
            {loading ? <ActivityIndicator color="#087f73" size={compact ? 'small' : 'large'} /> : null}
            <View style={[styles.copy, compact && styles.compactCopy]}>
                <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
                <Text style={[styles.title, compact && styles.compactTitle]}>{copy.title}</Text>
                {compact ? null : <Text style={styles.body}>{copy.body}</Text>}
            </View>
            {onRetry === undefined || loading ? null : (
                <Pressable
                    accessibilityLabel="Réessayer"
                    accessibilityRole="button"
                    onPress={onRetry}
                    style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                >
                    <Text style={styles.retryButtonText}>Réessayer</Text>
                </Pressable>
            )}
        </View>
    );
}

function getStateCopy(variant: MachineDiscoveryStateVariant, context: MachineDiscoveryStateContext): StateCopy {
    if (variant === 'loading') return loadingCopy[context];
    if (variant === 'empty') return emptyCopy[context];
    if (variant === 'denied') return deniedCopy[context];
    if (variant === 'error') return errorCopy[context];
    return sharedCopy[variant];
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderColor: '#d5e5e1',
        borderRadius: 24,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 240,
        paddingHorizontal: 30,
        paddingVertical: 36,
    },
    compact: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        minHeight: 0,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    copy: { alignItems: 'center' },
    compactCopy: { alignItems: 'flex-start', flex: 1, marginLeft: 12 },
    eyebrow: { color: '#087f73', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
    title: { color: '#143c38', fontSize: 22, fontWeight: '900', lineHeight: 28, marginTop: 10, textAlign: 'center' },
    compactTitle: { fontSize: 16, lineHeight: 21, marginTop: 4, textAlign: 'left' },
    body: { color: '#61766f', fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 420, textAlign: 'center' },
    retryButton: {
        backgroundColor: '#087f73',
        borderRadius: 999,
        marginTop: 18,
        minHeight: 44,
        paddingHorizontal: 22,
        paddingVertical: 11,
    },
    retryButtonPressed: { backgroundColor: '#075b53' },
    retryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800', lineHeight: 22 },
});
