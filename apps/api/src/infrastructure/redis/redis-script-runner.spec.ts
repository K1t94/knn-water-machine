import { describe, expect, it, vi } from 'vitest';

import { RedisScriptRunner } from './redis-script-runner';

const script = {
    name: 'test-script',
    version: 1,
    source: 'return ARGV[1]',
    parse: (result: unknown) => String(result),
};

describe('RedisScriptRunner', () => {
    it('loads a versioned script once and reuses its SHA', async () => {
        const client = {
            scriptLoad: vi.fn().mockResolvedValue('sha-1'),
            evalSha: vi.fn().mockResolvedValue('ok'),
        };
        const runner = new RedisScriptRunner({
            commandClient: client,
        } as never);

        await expect(runner.invoke(script, { arguments: ['ok'] })).resolves.toBe('ok');
        await expect(runner.invoke(script)).resolves.toBe('ok');
        expect(client.scriptLoad).toHaveBeenCalledTimes(1);
    });

    it('reloads and retries exactly once after NOSCRIPT', async () => {
        const client = {
            scriptLoad: vi.fn().mockResolvedValueOnce('sha-1').mockResolvedValueOnce('sha-2'),
            evalSha: vi
                .fn()
                .mockRejectedValueOnce(new Error('NOSCRIPT missing script'))
                .mockResolvedValueOnce('recovered'),
        };
        const runner = new RedisScriptRunner({
            commandClient: client,
        } as never);

        await expect(runner.invoke(script)).resolves.toBe('recovered');
        expect(client.evalSha).toHaveBeenNthCalledWith(2, 'sha-2', {
            keys: [],
            arguments: [],
        });
    });
});
