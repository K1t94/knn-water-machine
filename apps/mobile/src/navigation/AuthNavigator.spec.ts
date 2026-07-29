import { describe, expect, it } from 'vitest';

import { parsePendingPromo } from './pending-promo-deep-link';

describe('parsePendingPromo', () => {
  it('accepts only the configured registration deep link', () => {
    expect(parsePendingPromo('kaynann://register?promo=HELLO-1'))
      .toBe('HELLO-1');
    expect(parsePendingPromo('https://example.com/register?promo=HELLO-1'))
      .toBeUndefined();
    expect(parsePendingPromo('kaynann://profile?promo=HELLO-1'))
      .toBeUndefined();
  });

  it('normalizes and bounds pending context without validating referral effects', () => {
    expect(parsePendingPromo('kaynann://register?promo=%20PROMO%20'))
      .toBe('PROMO');
    expect(parsePendingPromo(
      `kaynann://register?promo=${'A'.repeat(80)}`,
    )).toHaveLength(64);
  });
});
