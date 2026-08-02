import { observable } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import './mobx.config';

describe('MobX configuration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports observable mutations made outside an action', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const state = observable({ value: 'initial' });

        state.value = 'mutated';

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('changing (observed) observable values without using an action'),
        );
    });
});
