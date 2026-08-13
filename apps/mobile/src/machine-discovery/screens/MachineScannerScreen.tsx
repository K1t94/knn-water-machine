import { CameraView } from 'expo-camera';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firstValueFrom } from 'rxjs';

import { MachineDiscoveryState } from '../components/MachineDiscoveryState';
import { ManualMachineCodeForm } from '../components/ManualMachineCodeForm';

import type { MachineDiscoveryStateVariant } from '../components/MachineDiscoveryState';
import type { MachineId } from '../machine-discovery.types';
import type { ScannerPreviewController } from '../native/ScannerAdapter';
import type { MachineDiscoveryFlowService } from '../services/machine-discovery-flow.service';
import type { MachineDiscoveryStore } from '../stores/machine-discovery.store';

type ScannerCommands = Pick<MachineDiscoveryFlowService, 'cancelResolution' | 'resolveManualCode' | 'startScanner'>;

export interface MachineScannerScreenProps {
    readonly accessToken: string;
    readonly commands: ScannerCommands;
    readonly focused: boolean;
    readonly onCancel: () => void;
    readonly onOpenMachine: (machineId: MachineId) => void;
    readonly scanner: ScannerPreviewController;
    readonly store: MachineDiscoveryStore;
}

const cameraCapabilityMessages = {
    denied: 'Accès à la caméra refusé',
    restricted: 'Accès à la caméra limité',
    revoked: 'Accès à la caméra révoqué',
    unavailable: 'Caméra indisponible',
} as const;

const resolutionErrorMessages: Readonly<Record<string, string>> = {
    MACHINE_CODE_INVALID: 'Code de machine invalide',
    MACHINE_NOT_FOUND: 'Machine introuvable',
    OFFLINE: 'Connexion indisponible',
};

export const MachineScannerScreen = observer(function MachineScannerScreen({
    accessToken,
    commands,
    focused,
    onCancel,
    onOpenMachine,
    scanner,
    store,
}: MachineScannerScreenProps): React.JSX.Element {
    const { height, width } = useWindowDimensions();
    const compactLayout = width <= 360 || height <= 700;
    const ui = useLocalObservable(() => ({
        manualMode: false,
        manualValue: '',
        validationMessage: undefined as string | undefined,
        openManualMode() {
            this.manualMode = true;
            this.validationMessage = undefined;
        },
        closeManualMode() {
            this.manualMode = false;
            this.validationMessage = undefined;
        },
        changeManualValue(value: string) {
            this.manualValue = value;
            this.validationMessage = undefined;
        },
        requireManualValue(): boolean {
            if (this.manualValue.trim().length > 0) return true;
            this.validationMessage = 'Saisissez un code de machine';
            return false;
        },
    }));
    const openedMachineId = useRef<MachineId | undefined>(undefined);
    const currentDetail = store.currentDetail;
    const error = store.error;
    const safeErrorCode = error?.code.startsWith('OFFLINE') === true ? 'OFFLINE' : error?.code;
    const errorMessage =
        safeErrorCode === undefined ? undefined : (resolutionErrorMessages[safeErrorCode] ?? 'Vérification impossible');
    const scannerErrorState = getScannerErrorState(safeErrorCode);

    useEffect(() => {
        scanner.setFocused(focused);
        if (!focused) {
            scanner.stopPreview();
            return;
        }

        commands.startScanner(accessToken);
        void firstValueFrom(scanner.startPreview()).catch(() => undefined);
    }, [accessToken, commands, focused, scanner]);

    useEffect(
        () => () => {
            scanner.stopPreview();
        },
        [scanner],
    );

    useEffect(() => {
        if (currentDetail === undefined || openedMachineId.current === currentDetail.machineId) return;
        openedMachineId.current = currentDetail.machineId;
        scanner.stopPreview();
        onOpenMachine(currentDetail.machineId);
    }, [currentDetail, onOpenMachine, scanner]);

    const submitManualCode = () => {
        if (!ui.requireManualValue()) return;
        commands.resolveManualCode(accessToken, ui.manualValue);
    };

    const retryResolution = () => {
        if (store.resolutionLoading) return;
        if (ui.manualMode) {
            commands.resolveManualCode(accessToken, ui.manualValue);
            return;
        }
        commands.startScanner(accessToken);
    };

    const openManualMode = () => {
        scanner.stopPreview();
        commands.cancelResolution();
        ui.openManualMode();
    };

    const closeManualMode = () => {
        commands.cancelResolution();
        ui.closeManualMode();
        if (focused) {
            commands.startScanner(accessToken);
            void firstValueFrom(scanner.startPreview()).catch(() => undefined);
        }
    };

    const cancelScanning = () => {
        scanner.cancel();
        commands.cancelResolution();
        onCancel();
    };

    return (
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
            <View style={styles.page} testID="machine-scanner-page">
                <View
                    style={[styles.header, compactLayout && styles.compactHeader]}
                    testID="machine-scanner-header"
                >
                    <Pressable
                        accessibilityLabel="Annuler le scan"
                        accessibilityRole="button"
                        onPress={cancelScanning}
                        style={({ pressed }) => [
                            styles.backButton,
                            compactLayout && styles.compactHeaderSide,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={styles.backText}>Annuler</Text>
                    </Pressable>
                    <Text style={styles.headerTitle}>Scanner un QR</Text>
                    <View style={[styles.headerSide, compactLayout && styles.compactHeaderSide]} />
                </View>

                {ui.manualMode ? (
                    <ManualMachineCodeForm
                        {...(errorMessage === undefined ? {} : { errorMessage })}
                        loading={store.resolutionLoading}
                        onCancel={closeManualMode}
                        onChangeText={ui.changeManualValue}
                        onSubmit={submitManualCode}
                        style={styles.manualForm}
                        {...(ui.validationMessage === undefined ? {} : { validationMessage: ui.validationMessage })}
                        value={ui.manualValue}
                    />
                ) : (
                    <ScannerContent
                        capability={store.scannerCapability}
                        compactLayout={compactLayout}
                        {...(errorMessage === undefined ? {} : { errorMessage })}
                        {...(scannerErrorState === undefined ? {} : { errorState: scannerErrorState })}
                        loading={store.resolutionLoading}
                        focused={focused}
                        onBarcodeScanned={scanner.handleBarcodeScanned}
                        onOpenManual={openManualMode}
                        onRetry={retryResolution}
                    />
                )}

                {ui.manualMode && error?.retryable === true ? (
                    <Pressable
                        accessibilityLabel="Réessayer"
                        accessibilityRole="button"
                        onPress={retryResolution}
                        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                    >
                        <Text style={styles.retryText}>Réessayer</Text>
                    </Pressable>
                ) : null}
            </View>
        </SafeAreaView>
    );
});

interface ScannerContentProps {
    readonly capability: MachineDiscoveryStore['scannerCapability'];
    readonly compactLayout: boolean;
    readonly errorMessage?: string;
    readonly errorState?: MachineDiscoveryStateVariant;
    readonly loading: boolean;
    readonly focused: boolean;
    readonly onBarcodeScanned: (result: { data: string; type: string }) => void;
    readonly onOpenManual: () => void;
    readonly onRetry: () => void;
}

function ScannerContent({
    capability,
    compactLayout,
    errorMessage,
    errorState,
    loading,
    focused,
    onBarcodeScanned,
    onOpenManual,
    onRetry,
}: ScannerContentProps): React.JSX.Element {
    const capabilityMessage =
        capability in cameraCapabilityMessages
            ? cameraCapabilityMessages[capability as keyof typeof cameraCapabilityMessages]
            : undefined;

    return (
        <View
            style={[styles.scannerSurface, compactLayout && styles.compactScannerSurface]}
            testID="machine-scanner-surface"
        >
            {capabilityMessage === undefined ? (
                focused ? (
                    <CameraView
                        active={!loading}
                        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                        onBarcodeScanned={onBarcodeScanned}
                        style={styles.camera}
                    />
                ) : (
                    <View style={styles.inactivePreview} />
                )
            ) : capability === 'denied' ? (
                <View style={styles.capabilityState}>
                    <MachineDiscoveryState context="scanner" style={styles.capabilityCard} variant="denied" />
                </View>
            ) : (
                <View style={styles.capabilityState}>
                    <Text accessibilityRole="alert" style={styles.capabilityTitle}>
                        {capabilityMessage}
                    </Text>
                    <Text style={styles.capabilityBody}>Utilisez le code public indiqué sur le point d’eau.</Text>
                </View>
            )}

            <View
                pointerEvents="box-none"
                style={[styles.overlay, compactLayout && styles.compactOverlay]}
            >
                <Text style={styles.instructions}>Cadrez le QR du point d’eau</Text>
                <View
                    style={[styles.target, compactLayout && styles.compactTarget]}
                    testID="machine-scanner-target"
                >
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                </View>
                {loading ? (
                    <MachineDiscoveryState compact context="scanner" style={styles.scannerState} variant="loading" />
                ) : errorState === undefined ? (
                    errorMessage === undefined ? null : (
                        <Text accessibilityRole="alert" style={styles.errorPill}>
                            {errorMessage}
                        </Text>
                    )
                ) : (
                    <MachineDiscoveryState
                        compact
                        context="scanner"
                        onRetry={onRetry}
                        style={styles.scannerState}
                        variant={errorState}
                    />
                )}
            </View>

            <Pressable
                accessibilityLabel="Saisir le code manuellement"
                accessibilityRole="button"
                onPress={onOpenManual}
                style={({ pressed }) => [
                    styles.manualButton,
                    compactLayout && styles.compactManualButton,
                    pressed && styles.pressed,
                ]}
            >
                <Text style={styles.manualIcon}>⌨</Text>
                <Text style={styles.manualButtonText}>Saisir le code manuellement</Text>
            </Pressable>
        </View>
    );
}

function getScannerErrorState(errorCode: string | undefined): MachineDiscoveryStateVariant | undefined {
    if (errorCode === 'OFFLINE') return 'offline';
    if (errorCode !== undefined && !(errorCode in resolutionErrorMessages)) return 'error';
    return undefined;
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#edf8f5', flex: 1 },
    page: { alignSelf: 'center', flex: 1, maxWidth: 680, width: '100%' },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        minHeight: 72,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    compactHeader: { minHeight: 64, paddingHorizontal: 12 },
    backButton: { justifyContent: 'center', minHeight: 44, minWidth: 84 },
    backText: { color: '#075b53', fontSize: 14, fontWeight: '800' },
    headerTitle: { color: '#12332f', flex: 1, fontSize: 20, fontWeight: '900', textAlign: 'center' },
    headerSide: { minWidth: 84 },
    compactHeaderSide: { minWidth: 64 },
    pressed: { opacity: 0.7 },
    scannerSurface: {
        backgroundColor: '#071412',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        flex: 1,
        marginHorizontal: 12,
        overflow: 'hidden',
    },
    compactScannerSurface: { borderTopLeftRadius: 24, borderTopRightRadius: 24, marginHorizontal: 8 },
    camera: { ...StyleSheet.absoluteFillObject },
    inactivePreview: { backgroundColor: '#102a26', flex: 1 },
    capabilityState: {
        alignItems: 'center',
        backgroundColor: '#102a26',
        flex: 1,
        justifyContent: 'center',
        padding: 28,
    },
    capabilityTitle: { color: '#ffffff', fontSize: 23, fontWeight: '900', textAlign: 'center' },
    capabilityBody: { color: '#b8cbc7', fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
    capabilityCard: { maxWidth: 420, width: '100%' },
    overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 },
    compactOverlay: { paddingHorizontal: 16, paddingTop: 20 },
    instructions: {
        backgroundColor: 'rgba(5, 18, 16, 0.78)',
        borderRadius: 999,
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
        overflow: 'hidden',
        paddingHorizontal: 18,
        paddingVertical: 11,
        textAlign: 'center',
    },
    target: { flex: 1, marginBottom: 126, marginTop: 42, maxHeight: 320, maxWidth: 320, width: '82%' },
    compactTarget: { marginBottom: 104, marginTop: 20, maxHeight: 220, maxWidth: 220 },
    corner: { borderColor: '#42d7bf', height: 48, position: 'absolute', width: 48 },
    topLeft: { borderLeftWidth: 5, borderTopLeftRadius: 12, borderTopWidth: 5, left: 0, top: 0 },
    topRight: { borderRightWidth: 5, borderTopRightRadius: 12, borderTopWidth: 5, right: 0, top: 0 },
    bottomLeft: { borderBottomLeftRadius: 12, borderBottomWidth: 5, borderLeftWidth: 5, bottom: 0, left: 0 },
    bottomRight: { borderBottomRightRadius: 12, borderBottomWidth: 5, borderRightWidth: 5, bottom: 0, right: 0 },
    scannerState: { maxWidth: 420, position: 'absolute', top: 104, width: '100%' },
    errorPill: {
        backgroundColor: '#fff0ed',
        borderRadius: 999,
        color: '#8d2b22',
        fontSize: 14,
        fontWeight: '800',
        overflow: 'hidden',
        paddingHorizontal: 17,
        paddingVertical: 10,
        position: 'absolute',
        textAlign: 'center',
        top: 104,
    },
    manualButton: {
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: 'rgba(5, 18, 16, 0.9)',
        borderColor: 'rgba(255, 255, 255, 0.24)',
        borderRadius: 22,
        borderWidth: 1,
        bottom: 22,
        minHeight: 92,
        paddingHorizontal: 24,
        paddingVertical: 12,
        position: 'absolute',
    },
    compactManualButton: { bottom: 12, minHeight: 76, paddingVertical: 10 },
    manualIcon: { color: '#42d7bf', fontSize: 24, lineHeight: 30 },
    manualButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 3 },
    retryButton: {
        alignSelf: 'center',
        backgroundColor: '#087f73',
        borderRadius: 999,
        bottom: 132,
        minHeight: 44,
        paddingHorizontal: 24,
        paddingVertical: 11,
        position: 'absolute',
    },
    retryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
    manualForm: { backgroundColor: '#edf8f5' },
});
