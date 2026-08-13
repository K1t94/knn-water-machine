import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

// T069 provides the implementation exercised by this RED contract.
// eslint-disable-next-line import/no-unresolved
import { ExpoScannerAdapter as ExpoScannerAdapterImplementation } from './ExpoScannerAdapter';

import type { ScannerAdapter } from './ScannerAdapter';
import type { Observable } from 'rxjs';

type PermissionStatus = 'undetermined' | 'granted' | 'denied';

type CameraPermission = {
    status: PermissionStatus;
    granted: boolean;
    canAskAgain: boolean;
    expires: 'never';
};

type BarcodeScan = Readonly<{
    type: string;
    data: string;
}>;

type ExpoCameraClient = {
    getCameraPermissionsAsync(): Promise<CameraPermission>;
    requestCameraPermissionsAsync(): Promise<CameraPermission>;
};

interface ScannerPreviewAdapter extends ScannerAdapter {
    readonly previewActive$: Observable<boolean>;
    startPreview(): Observable<boolean>;
    stopPreview(): void;
    cancel(): void;
    setFocused(focused: boolean): void;
    setAppState(state: 'active' | 'inactive' | 'background'): void;
    handleBarcodeScanned(result: BarcodeScan): void;
}

type ExpoScannerAdapterConstructor = new (client: ExpoCameraClient) => ScannerPreviewAdapter;

const ExpoScannerAdapter = ExpoScannerAdapterImplementation as unknown as ExpoScannerAdapterConstructor;

function permission(status: PermissionStatus, canAskAgain = status === 'undetermined'): CameraPermission {
    return {
        status,
        granted: status === 'granted',
        canAskAgain,
        expires: 'never',
    };
}

function createClient(initialPermission: CameraPermission = permission('granted')): ExpoCameraClient {
    return {
        getCameraPermissionsAsync: vi.fn(async () => initialPermission),
        requestCameraPermissionsAsync: vi.fn(async () => initialPermission),
    };
}

function recordValues<T>(stream: Observable<T>): T[] {
    const values: T[] = [];
    stream.subscribe((value) => values.push(value));
    return values;
}

async function start(adapter: ScannerPreviewAdapter): Promise<boolean> {
    return firstValueFrom(adapter.startPreview());
}

describe('ExpoScannerAdapter', () => {
    it('requests only camera permission from an undetermined state before starting the preview', async () => {
        const client = createClient(permission('undetermined'));
        vi.mocked(client.requestCameraPermissionsAsync).mockResolvedValue(permission('granted'));
        const adapter = new ExpoScannerAdapter(client);
        const capabilityStates = recordValues(adapter.capabilityState$);
        const previewStates = recordValues(adapter.previewActive$);

        const pendingStart = adapter.startPreview();

        expect(client.getCameraPermissionsAsync).not.toHaveBeenCalled();
        await expect(firstValueFrom(pendingStart)).resolves.toBe(true);
        expect(client.requestCameraPermissionsAsync).toHaveBeenCalledOnce();
        expect(client).not.toHaveProperty('requestMicrophonePermissionsAsync');
        expect(capabilityStates).toEqual(['undetermined', 'granted']);
        expect(previewStates).toEqual([false, true]);
    });

    it('uses an existing camera grant without showing another permission prompt', async () => {
        const client = createClient();
        const adapter = new ExpoScannerAdapter(client);

        await expect(start(adapter)).resolves.toBe(true);

        expect(client.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    });

    it.each([
        ['denied', permission('denied', true)],
        ['restricted', permission('denied', false)],
    ] as const)('normalizes a blocked camera as %s and keeps the preview stopped', async (expected, response) => {
        const adapter = new ExpoScannerAdapter(createClient(response));
        const capabilityStates = recordValues(adapter.capabilityState$);
        const previewStates = recordValues(adapter.previewActive$);

        await expect(start(adapter)).resolves.toBe(false);

        expect(capabilityStates).toEqual(['undetermined', expected]);
        expect(previewStates).toEqual([false]);
    });

    it('normalizes a withdrawn previous camera grant as revoked', async () => {
        const client = createClient();
        vi.mocked(client.getCameraPermissionsAsync)
            .mockResolvedValueOnce(permission('granted'))
            .mockResolvedValueOnce(permission('denied', false));
        const adapter = new ExpoScannerAdapter(client);
        const capabilityStates = recordValues(adapter.capabilityState$);
        const previewStates = recordValues(adapter.previewActive$);

        await expect(start(adapter)).resolves.toBe(true);
        adapter.stopPreview();
        await expect(start(adapter)).resolves.toBe(false);

        expect(capabilityStates).toEqual(['undetermined', 'granted', 'revoked']);
        expect(previewStates).toEqual([false, true, false]);
    });

    it('normalizes a native camera failure as unavailable without leaking the error', async () => {
        const client = createClient();
        vi.mocked(client.getCameraPermissionsAsync).mockRejectedValue(new Error('native camera details'));
        const adapter = new ExpoScannerAdapter(client);
        const capabilityStates = recordValues(adapter.capabilityState$);

        await expect(start(adapter)).resolves.toBe(false);

        expect(capabilityStates).toEqual(['undetermined', 'unavailable']);
    });

    it('emits only QR payloads received while the preview is active', async () => {
        const adapter = new ExpoScannerAdapter(createClient());
        const results = recordValues(adapter.scanResults$);

        adapter.handleBarcodeScanned({ type: 'qr', data: 'ignored-before-start' });
        await start(adapter);
        adapter.handleBarcodeScanned({ type: 'ean13', data: '5901234123457' });
        adapter.handleBarcodeScanned({ type: 'qr', data: 'kaynann://machine/v1/test-machine-id' });
        adapter.stopPreview();
        adapter.handleBarcodeScanned({ type: 'qr', data: 'ignored-after-stop' });

        expect(results).toEqual(['kaynann://machine/v1/test-machine-id']);
    });

    it('stops the preview on explicit cancel and ignores subsequent detections', async () => {
        const adapter = new ExpoScannerAdapter(createClient());
        const previewStates = recordValues(adapter.previewActive$);
        const results = recordValues(adapter.scanResults$);
        await start(adapter);

        adapter.cancel();
        adapter.handleBarcodeScanned({ type: 'qr', data: 'ignored-after-cancel' });

        expect(previewStates).toEqual([false, true, false]);
        expect(results).toEqual([]);
    });

    it.each([
        ['focus loss', (adapter: ScannerPreviewAdapter) => adapter.setFocused(false)],
        ['app backgrounding', (adapter: ScannerPreviewAdapter) => adapter.setAppState('background')],
        ['app inactivity', (adapter: ScannerPreviewAdapter) => adapter.setAppState('inactive')],
    ] as const)('stops the preview on %s', async (_name, deactivate) => {
        const adapter = new ExpoScannerAdapter(createClient());
        const previewStates = recordValues(adapter.previewActive$);
        const results = recordValues(adapter.scanResults$);
        await start(adapter);

        deactivate(adapter);
        adapter.handleBarcodeScanned({ type: 'qr', data: 'ignored-while-inactive' });

        expect(previewStates).toEqual([false, true, false]);
        expect(results).toEqual([]);
    });

    it('disposes idempotently, stops the preview, and completes every stream', async () => {
        const adapter = new ExpoScannerAdapter(createClient());
        const previewStates = recordValues(adapter.previewActive$);
        const capabilityComplete = vi.fn();
        const previewComplete = vi.fn();
        const resultsComplete = vi.fn();
        adapter.capabilityState$.subscribe({ complete: capabilityComplete });
        adapter.previewActive$.subscribe({ complete: previewComplete });
        adapter.scanResults$.subscribe({ complete: resultsComplete });
        await start(adapter);

        adapter.dispose();
        adapter.dispose();

        expect(previewStates).toEqual([false, true, false]);
        expect(capabilityComplete).toHaveBeenCalledOnce();
        expect(previewComplete).toHaveBeenCalledOnce();
        expect(resultsComplete).toHaveBeenCalledOnce();
    });
});
