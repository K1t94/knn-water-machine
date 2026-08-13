import { firstValueFrom, Observable } from 'rxjs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { FakeLocationAdapter, FakeMapAdapter, FakeScannerAdapter } from '../../testing/machine-discovery-native-fakes';

import type { LocationAdapter, NativeCapabilityState } from './LocationAdapter';
import type { MapAdapter } from './MapAdapter';
import type { ScannerAdapter } from './ScannerAdapter';

const CAPABILITY_STATES = [
    'undetermined',
    'granted',
    'denied',
    'restricted',
    'revoked',
    'unavailable',
] as const satisfies readonly NativeCapabilityState[];

const POSITION = { latitude: 14.716677, longitude: -17.467686 };
const VIEWPORT = { north: 14.8, east: -17.3, south: 14.6, west: -17.6 };

describe('native adapter contracts', () => {
    it.each(CAPABILITY_STATES)('normalizes the %s capability state', async (state) => {
        const adapter: LocationAdapter = new FakeLocationAdapter(state, POSITION);

        expectTypeOf(state).toMatchTypeOf<NativeCapabilityState>();
        await expect(firstValueFrom(adapter.capabilityState$)).resolves.toBe(state);
    });

    it('provides deterministic injectable location, scanner, and map seams', async () => {
        const locationFake = new FakeLocationAdapter('granted', POSITION);
        const scannerFake = new FakeScannerAdapter('granted');
        const mapFake = new FakeMapAdapter('granted');
        const location: LocationAdapter = locationFake;
        const scanner: ScannerAdapter = scannerFake;
        const map: MapAdapter = mapFake;

        expect(location.capabilityState$).toBeInstanceOf(Observable);
        expect(scanner.capabilityState$).toBeInstanceOf(Observable);
        expect(map.capabilityState$).toBeInstanceOf(Observable);
        await expect(firstValueFrom(location.getCurrentPosition())).resolves.toEqual(POSITION);

        const nextScan = firstValueFrom(scanner.scanResults$);
        scannerFake.emitScan('kaynann://machine/7mQ3LJvR9Gf2xK8pNc4YAw');
        await expect(nextScan).resolves.toBe('kaynann://machine/7mQ3LJvR9Gf2xK8pNc4YAw');

        const nextViewport = firstValueFrom(map.viewportChanges$);
        mapFake.emitViewport(VIEWPORT);
        await expect(nextViewport).resolves.toEqual(VIEWPORT);
    });

    it('disposes every injected seam idempotently and completes its streams', () => {
        const adapters = [
            new FakeLocationAdapter('granted', POSITION),
            new FakeScannerAdapter('granted'),
            new FakeMapAdapter('granted'),
        ];

        for (const adapter of adapters) {
            const complete = vi.fn();
            adapter.capabilityState$.subscribe({ complete });

            expect(() => {
                adapter.dispose();
                adapter.dispose();
            }).not.toThrow();
            expect(complete).toHaveBeenCalledOnce();
        }
    });
});
