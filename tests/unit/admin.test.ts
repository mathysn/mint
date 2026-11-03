import { describe, expect, it } from 'vitest';
import { dropRates } from '../../server/admin/dropRates.js';
import { deviceLabel } from '../../server/auth/client.js';
import { signedCr } from '../../server/format.js';

describe('drop rates', () => {
  it('compares configured and actual rates, and flags a rarity beyond normal variance', () => {
    const normal = dropRates({ milspec: 7992, restricted: 1598, classified: 320, covert: 64, gold: 26 }, 10_000);
    expect(normal.normal).toBe(true);
    expect(normal.verdict).toBe('Every rarity is within normal variance for this sample size.');
    expect(normal.rows[0]).toMatchObject({ tier: 'milspec', setPct: 79.92, actualPct: 79.92 });
    expect(normal.rows[0]!.ratio).toBeCloseTo(1, 5);

    const off = dropRates({ milspec: 7900, restricted: 1598, classified: 320, covert: 64, gold: 118 }, 10_000);
    expect(off.normal).toBe(false);
    expect(off.verdict).toBe('★ Rare special is outside normal variance for this sample size.');
    expect(dropRates({}, 0).verdict).toBe('No openings yet.');
  });
});

describe('labels', () => {
  it('names the device from the user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome 130 · Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone');
    expect(deviceLabel(undefined)).toBeNull();
  });

  it('writes signed credits with a true minus sign', () => {
    expect(signedCr(-5000)).toBe('−5,000 CR');
    expect(signedCr(5000)).toBe('+5,000 CR');
  });
});
