import type { NativeCapabilityState } from './LocationAdapter';
import type { Observable } from 'rxjs';

export interface ScannerPreviewController {
    startPreview(): Observable<boolean>;
    stopPreview(): void;
    cancel(): void;
    setFocused(focused: boolean): void;
    handleBarcodeScanned(result: { readonly data: string; readonly type: string }): void;
}

export interface ScannerAdapter {
    readonly capabilityState$: Observable<NativeCapabilityState>;
    readonly scanResults$: Observable<string>;
    dispose(): void;
}

export type ScannerRuntimeAdapter = ScannerAdapter & ScannerPreviewController;
