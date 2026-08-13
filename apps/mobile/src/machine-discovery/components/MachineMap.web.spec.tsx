import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { MachineMap } from './MachineMap.web';

describe('MachineMap web fallback', () => {
    it('keeps machine discovery usable without importing the native map', async () => {
        const view = await render(
            <MachineMap
                loading={false}
                machines={[]}
                onMachinePress={vi.fn()}
                unavailable={false}
            />,
        );

        expect(view.getByTestId('machine-map-unavailable')).toBeTruthy();
        expect(view.getByText('Carte indisponible sur le web')).toBeTruthy();
        expect(view.getByText('Utilisez la liste pour choisir un point d’eau.')).toBeTruthy();
    });
});
