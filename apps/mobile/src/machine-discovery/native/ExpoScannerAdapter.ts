import { BehaviorSubject, defer, of, Subject } from 'rxjs';

import type { NativeCapabilityState } from './LocationAdapter';
import type { ScannerAdapter } from './ScannerAdapter';
import type * as ExpoCamera from 'expo-camera';
import type { Observable } from 'rxjs';

type ExpoCameraClient = Pick<typeof ExpoCamera.Camera, 'getCameraPermissionsAsync' | 'requestCameraPermissionsAsync'>;

type BarcodeScan = Pick<ExpoCamera.BarcodeScanningResult, 'data' | 'type'>;
type ScannerAppState = 'active' | 'inactive' | 'background';

export class ExpoScannerAdapter implements ScannerAdapter {
    private readonly capabilityStateSubject = new BehaviorSubject<NativeCapabilityState>('undetermined');
    private readonly previewActiveSubject = new BehaviorSubject(false);
    private readonly scanResultsSubject = new Subject<string>();
    private activationGeneration = 0;
    private focused = true;
    private appState: ScannerAppState = 'active';
    private disposed = false;

    readonly capabilityState$ = this.capabilityStateSubject.asObservable();
    readonly previewActive$ = this.previewActiveSubject.asObservable();
    readonly scanResults$ = this.scanResultsSubject.asObservable();

    constructor(private readonly client?: ExpoCameraClient) {}

    startPreview(): Observable<boolean> {
        return defer(() => {
            if (this.disposed) {
                return of(false);
            }

            const generation = ++this.activationGeneration;
            return this.activatePreview(generation);
        });
    }

    stopPreview(): void {
        this.activationGeneration += 1;
        this.setPreviewActive(false);
    }

    cancel(): void {
        this.stopPreview();
    }

    setFocused(focused: boolean): void {
        this.focused = focused;
        if (!focused) {
            this.stopPreview();
        }
    }

    setAppState(state: ScannerAppState): void {
        this.appState = state;
        if (state !== 'active') {
            this.stopPreview();
        }
    }

    handleBarcodeScanned(result: BarcodeScan): void {
        if (!this.disposed && this.previewActiveSubject.value && result.type === 'qr') {
            this.scanResultsSubject.next(result.data);
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.stopPreview();
        this.disposed = true;
        this.capabilityStateSubject.complete();
        this.previewActiveSubject.complete();
        this.scanResultsSubject.complete();
    }

    private async activatePreview(generation: number): Promise<boolean> {
        try {
            const client = this.client ?? (await import('expo-camera')).Camera;
            let permission = await client.getCameraPermissionsAsync();
            if (permission.status === 'undetermined') {
                permission = await client.requestCameraPermissionsAsync();
            }

            if (!permission.granted) {
                const state =
                    this.capabilityStateSubject.value === 'granted'
                        ? 'revoked'
                        : permission.canAskAgain
                          ? 'denied'
                          : 'restricted';
                this.setCapabilityState(state);
                return false;
            }

            this.setCapabilityState('granted');
            if (
                this.disposed ||
                generation !== this.activationGeneration ||
                !this.focused ||
                this.appState !== 'active'
            ) {
                return false;
            }

            this.setPreviewActive(true);
            return true;
        } catch {
            this.setCapabilityState('unavailable');
            return false;
        }
    }

    private setCapabilityState(state: NativeCapabilityState): void {
        if (!this.disposed && this.capabilityStateSubject.value !== state) {
            this.capabilityStateSubject.next(state);
        }
    }

    private setPreviewActive(active: boolean): void {
        if (!this.disposed && this.previewActiveSubject.value !== active) {
            this.previewActiveSubject.next(active);
        }
    }
}
