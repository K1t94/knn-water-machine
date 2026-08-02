import type { RedisScript } from '../../../infrastructure/redis/redis-script-runner';

export const consumeOtpScript: RedisScript<'used' | 'stale' | 'missing'> = {
    name: 'otp-consume',
    version: 1,
    source: `
    if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'stale' end
    if redis.call('HGET', KEYS[1], 'state') ~= 'ACTIVE' then return 'missing' end
    redis.call('DEL', KEYS[1], KEYS[2])
    redis.call('SET', KEYS[3], 'USED', 'PX', ARGV[2])
    return 'used'
  `,
    parse: (result) => {
        if (result === 'used') return 'used';
        return result === 'stale' ? 'stale' : 'missing';
    },
};

export const rejectOtpAttemptScript: RedisScript<'invalid' | 'exhausted' | 'stale'> = {
    name: 'otp-reject-attempt',
    version: 1,
    source: `
    if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'stale' end
    local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
    if attempts <= 1 then
      redis.call('DEL', KEYS[1], KEYS[2])
      redis.call('SET', KEYS[3], 'EXHAUSTED', 'PX', ARGV[2])
      return 'exhausted'
    end
    redis.call('HINCRBY', KEYS[1], 'attempts', -1)
    return 'invalid'
  `,
    parse: (result) => (result === 'exhausted' ? 'exhausted' : result === 'invalid' ? 'invalid' : 'stale'),
};
