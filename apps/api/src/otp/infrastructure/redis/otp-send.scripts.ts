import type { RedisScript } from '../../../infrastructure/redis/redis-script-runner';

export const prepareOtpScript: RedisScript<'prepared'> = {
  name: 'otp-prepare',
  version: 2,
  source: `
    redis.call('HSET', KEYS[1],
      'state', 'PREPARED', 'challengeId', ARGV[1], 'phone', ARGV[2],
      'digest', ARGV[3], 'keyVersion', ARGV[4], 'attempts', ARGV[5],
      'createdAt', ARGV[6], 'expiresAt', ARGV[7], 'installation', ARGV[8],
      'promoState', ARGV[9], 'promo', ARGV[10])
    redis.call('PEXPIREAT', KEYS[1], ARGV[7])
    return 'prepared'
  `,
  parse: () => 'prepared',
};

export const activateOtpScript: RedisScript<'active' | 'expired' | 'missing'> = {
  name: 'otp-activate',
  version: 1,
  source: `
    if redis.call('EXISTS', KEYS[1]) == 0 then return 'missing' end
    local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt'))
    if expiresAt <= tonumber(ARGV[1]) then redis.call('DEL', KEYS[1]); return 'expired' end
    local old = redis.call('GET', KEYS[2])
    if old and old ~= ARGV[2] then redis.call('DEL', ARGV[5] .. old) end
    redis.call('HSET', KEYS[1], 'state', 'ACTIVE', 'delivery', ARGV[3])
    redis.call('SET', KEYS[2], ARGV[2], 'PXAT', expiresAt)
    redis.call('SET', KEYS[3], '1', 'PX', ARGV[4])
    return 'active'
  `,
  parse: (result) => {
    if (result === 'expired') return 'expired';
    return result === 'active' ? 'active' : 'missing';
  },
};

export const failPreparedOtpScript: RedisScript<boolean> = {
  name: 'otp-fail-prepared',
  version: 1,
  source: `
    if redis.call('HGET', KEYS[1], 'state') ~= 'PREPARED' then return 0 end
    redis.call('DEL', KEYS[1])
    return 1
  `,
  parse: (result) => Number(result) === 1,
};

export const updateOtpPromoScript: RedisScript<'updated' | 'missing'> = {
  name: 'otp-update-promo',
  version: 1,
  source: `
    if redis.call('EXISTS', KEYS[1]) == 0 then return 'missing' end
    redis.call('HSET', KEYS[1], 'promoState', ARGV[1], 'promo', ARGV[2])
    return 'updated'
  `,
  parse: (result) => result === 'updated' ? 'updated' : 'missing',
};

export const releaseOwnedLockScript: RedisScript<boolean> = {
  name: 'otp-release-owned-lock',
  version: 1,
  source: `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    redis.call('DEL', KEYS[1])
    return 1
  `,
  parse: (result) => Number(result) === 1,
};

export type AbuseReservationResult =
  | 'ok' | 'blocked' | 'phone_hour' | 'phone_day' | 'ip_hour'
  | 'installation_hour' | 'installation_day' | 'throughput'
  | 'count_budget' | 'cost_budget' | 'busy';

export const reserveOtpSendScript: RedisScript<AbuseReservationResult> = {
  name: 'otp-abuse-reserve',
  version: 2,
  source: `
    local function value(key) return tonumber(redis.call('GET', key) or '0') end
    local function incrementFixed(key, ttl)
      local count = redis.call('INCR', key)
      if count == 1 then redis.call('PEXPIRE', key, ttl) end
    end
    if redis.call('EXISTS', KEYS[1]) == 1 then return 'blocked' end
    local labels = {'phone_hour','phone_day','ip_hour','installation_hour','installation_day'}
    for i=2,6 do
      if value(KEYS[i]) >= tonumber(ARGV[i-1]) then return labels[i-1] end
    end
    if value(KEYS[7]) >= tonumber(ARGV[6]) then return 'throughput' end
    if value(KEYS[8]) >= tonumber(ARGV[7]) then return 'count_budget' end
    if value(KEYS[9]) + tonumber(ARGV[8]) > tonumber(ARGV[9]) then return 'cost_budget' end
    if value(KEYS[10]) >= tonumber(ARGV[10]) then return 'busy' end

    incrementFixed(KEYS[2], ARGV[11]); incrementFixed(KEYS[3], ARGV[12])
    incrementFixed(KEYS[4], ARGV[11]); incrementFixed(KEYS[5], ARGV[11])
    incrementFixed(KEYS[6], ARGV[12]); incrementFixed(KEYS[7], 2000)
    incrementFixed(KEYS[8], 172800000)
    local cost = redis.call('INCRBY', KEYS[9], ARGV[8])
    if cost == tonumber(ARGV[8]) then redis.call('PEXPIRE', KEYS[9], 172800000) end
    incrementFixed(KEYS[10], 30000)
    return 'ok'
  `,
  parse: (value) => {
    const result = String(value) as AbuseReservationResult;
    return allowedReservationResults.has(result) ? result : 'busy';
  },
};

export const releaseOtpSemaphoreScript: RedisScript<void> = {
  name: 'otp-abuse-release',
  version: 2,
  source: `
    local value = tonumber(redis.call('GET', KEYS[1]) or '0')
    if value <= 1 then redis.call('DEL', KEYS[1]) else redis.call('DECR', KEYS[1]) end
    return 1
  `,
  parse: () => undefined,
};

export const refundOtpBudgetScript: RedisScript<void> = {
  name: 'otp-budget-refund',
  version: 2,
  source: `
    local count = tonumber(redis.call('GET', KEYS[1]) or '0')
    if count > 0 then redis.call('DECR', KEYS[1]) end
    local cost = tonumber(redis.call('GET', KEYS[2]) or '0')
    if cost > 0 then redis.call('SET', KEYS[2], math.max(0, cost-tonumber(ARGV[1])), 'KEEPTTL') end
    return 1
  `,
  parse: () => undefined,
};

export const recordOtpExhaustionScript: RedisScript<boolean> = {
  name: 'otp-exhaustion-block',
  version: 2,
  source: `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then redis.call('PEXPIRE', KEYS[1], 172800000) end
    if count >= tonumber(ARGV[1]) then
      redis.call('SET', KEYS[2], '1', 'PX', ARGV[2]); return 1
    end
    return 0
  `,
  parse: (value) => Number(value) === 1,
};

const allowedReservationResults = new Set<AbuseReservationResult>([
  'ok', 'blocked', 'phone_hour', 'phone_day', 'ip_hour',
  'installation_hour', 'installation_day', 'throughput',
  'count_budget', 'cost_budget', 'busy',
]);
