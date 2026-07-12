import { describe, expect, it } from 'vitest';
import { HYSTERESIS, NEAR_RADIUS } from '../config.js';
import { activeIndexFor, directionOf, preloadLevelFor, scrollTopFor } from './feedMath.js';

describe('activeIndexFor', () => {
  const H = 100; // slideHeight: 100 px keeps the fractions readable

  it('fires k→k+1 only strictly past k+0.5+HYSTERESIS', () => {
    // Switch-away boundary from prev 3 is frac 3.6; 3.59 is inside the band…
    expect(activeIndexFor(359, H, 3, HYSTERESIS)).toBe(3);
    // …and 3.61 is past it (distance 0.61 > 0.6) → switch to 4.
    expect(activeIndexFor(361, H, 3, HYSTERESIS)).toBe(4);
  });

  it('returns k+1→k only strictly below k+0.5−HYSTERESIS', () => {
    // Coming back toward 3 with prev 4: the return boundary is frac 3.4.
    expect(activeIndexFor(341, H, 4, HYSTERESIS)).toBe(4); // 0.59 from 4 → hold
    expect(activeIndexFor(339, H, 4, HYSTERESIS)).toBe(3); // 0.61 from 4 → return
  });

  it('holds prevIndex everywhere inside the dead band (kills midpoint flapping)', () => {
    // scrollTop 350 = the exact 3/4 midpoint: BOTH previous indices hold —
    // this asymmetry-by-history is the whole point of hysteresis.
    expect(activeIndexFor(350, H, 3, HYSTERESIS)).toBe(3);
    expect(activeIndexFor(350, H, 4, HYSTERESIS)).toBe(4);
  });

  it('holds at the EXACT boundary (strict >, probed with a binary-exact hysteresis)', () => {
    // 0.1 has no exact binary representation, so the 0.6 boundary cannot be
    // probed exactly with HYSTERESIS. 0.125 can: 0.5 + 0.125 === 0.625 exactly,
    // and 3.625 is float-exact → distance === 0.625, which is NOT > 0.625.
    expect(activeIndexFor(3625, 1000, 3, 0.125)).toBe(3); // exactly at boundary → hold
    expect(activeIndexFor(3626, 1000, 3, 0.125)).toBe(4); // one step past → fire
  });

  it('rounds half up on far jumps (exact-boundary rounding)', () => {
    // frac 2.5 is far outside prev 0's band → clamp(round(2.5)) — JS rounds .5 up.
    expect(activeIndexFor(250, H, 0, HYSTERESIS)).toBe(3);
    expect(activeIndexFor(249, H, 0, HYSTERESIS)).toBe(2);
    // Same rounding arriving from above.
    expect(activeIndexFor(250, H, 6, HYSTERESIS)).toBe(3);
  });

  it('clamps at 0 during rubber-band overscroll', () => {
    expect(activeIndexFor(-70, H, 0, HYSTERESIS)).toBe(0); // round(-0.7) = -1 → clamp
    expect(activeIndexFor(-200, H, 1, HYSTERESIS)).toBe(0);
  });
});

describe('scrollTopFor', () => {
  it('is index * slideHeight', () => {
    expect(scrollTopFor(0, 640)).toBe(0);
    expect(scrollTopFor(7, 100)).toBe(700);
  });
});

describe('directionOf', () => {
  it('signs the scroll delta', () => {
    expect(directionOf(0, 100)).toBe(1);
    expect(directionOf(100, 0)).toBe(-1);
    expect(directionOf(100, 100)).toBe(0);
  });
});

describe('preloadLevelFor', () => {
  it('maps distance 0 → active, ≤ nearRadius → near, else far', () => {
    expect(preloadLevelFor(5, 5, NEAR_RADIUS)).toBe('active');
    expect(preloadLevelFor(4, 5, NEAR_RADIUS)).toBe('near');
    expect(preloadLevelFor(6, 5, NEAR_RADIUS)).toBe('near');
    expect(preloadLevelFor(3, 5, NEAR_RADIUS)).toBe('far');
    expect(preloadLevelFor(7, 5, NEAR_RADIUS)).toBe('far');
  });

  it('respects a custom radius', () => {
    expect(preloadLevelFor(3, 5, 2)).toBe('near');
    expect(preloadLevelFor(2, 5, 2)).toBe('far');
  });
});
