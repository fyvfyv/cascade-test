import { describe, expect, it } from 'vitest';
import { RECENTER_THRESHOLD, WINDOW_SIZE } from '../config.js';
import { VirtualWindow } from './VirtualWindow.js';

/** Tiny-number window for example-based tests. */
const makeWindow = () => new VirtualWindow({ size: 5, cycleLength: 3, recenterThreshold: 10, runwayChunk: 4 });

describe('VirtualWindow.update', () => {
  it('first update enters the full window around the active index', () => {
    const vw = makeWindow();
    expect(vw.update(10)).toEqual({
      enter: [8, 9, 10, 11, 12],
      exit: [],
      indices: [8, 9, 10, 11, 12],
    });
  });

  it('clamps the window at 0', () => {
    const vw = makeWindow();
    expect(vw.update(0).indices).toEqual([0, 1, 2]);
    expect(vw.update(1).indices).toEqual([0, 1, 2, 3]);
    expect(vw.update(2).indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('diffs one-in / one-out for ±1 steps', () => {
    const vw = makeWindow();
    vw.update(10);
    expect(vw.update(11)).toEqual({
      enter: [13],
      exit: [8],
      indices: [9, 10, 11, 12, 13],
    });
    expect(vw.update(10)).toEqual({
      enter: [8],
      exit: [13],
      indices: [8, 9, 10, 11, 12],
    });
  });

  it('rebinds everything on a far jump', () => {
    const vw = makeWindow();
    vw.update(10);
    expect(vw.update(20)).toEqual({
      enter: [18, 19, 20, 21, 22],
      exit: [8, 9, 10, 11, 12],
      indices: [18, 19, 20, 21, 22],
    });
  });
});

describe('VirtualWindow.slotFor', () => {
  it('is index % size — the entering index reuses the vacated slot', () => {
    const vw = makeWindow();
    expect(vw.slotFor(8)).toBe(3);
    expect(vw.slotFor(13)).toBe(3); // 13 enters exactly the slot 8 vacated
    for (let i = 0; i < 20; i++) expect(vw.slotFor(i)).toBe(i % 5);
  });
});

describe('VirtualWindow.runwaySlides', () => {
  it('is monotonic, chunked, and keeps ≥ runwayChunk slides of headroom', () => {
    const vw = makeWindow(); // runwayChunk 4
    expect(vw.runwaySlides(0)).toBe(4);
    expect(vw.runwaySlides(1)).toBe(8); // needs 5 → next multiple of 4
    expect(vw.runwaySlides(0)).toBe(8); // never shrinks mid-session
    expect(vw.runwaySlides(9)).toBe(16); // needs 13 → 16

    const vw2 = makeWindow();
    let prev = 0;
    for (let a = 0; a <= 30; a++) {
      const r = vw2.runwaySlides(a);
      expect(r % 4).toBe(0); // chunked
      expect(r).toBeGreaterThanOrEqual(a + 4); // headroom ≥ activeIndex + runwayChunk
      expect(r).toBeGreaterThanOrEqual(prev); // monotonic
      prev = r;
    }
  });
});

describe('VirtualWindow.recenterDelta', () => {
  it('is 0 at or below the threshold', () => {
    const vw = makeWindow(); // threshold 10
    expect(vw.recenterDelta(0)).toBe(0);
    expect(vw.recenterDelta(10)).toBe(0);
  });

  it('is 0 when a full rebase unit cannot be subtracted yet', () => {
    const vw = makeWindow(); // rebase unit lcm(3, 5) = 15; 14 > threshold but < 2 units
    expect(vw.recenterDelta(14)).toBe(0);
  });

  it('is a positive multiple of cycleLength AND size, preserving index % cycleLength', () => {
    const vw = makeWindow();
    const delta = vw.recenterDelta(37);
    expect(delta).toBe(15); // lcm(3, 5)
    expect(delta % 3).toBe(0); // content identity
    expect(delta % 5).toBe(0); // slot identity
    expect((37 - delta) % 3).toBe(37 % 3);
  });

  it('production-shaped: cycle 11, window 5, threshold RECENTER_THRESHOLD', () => {
    const vw = new VirtualWindow({ size: WINDOW_SIZE, cycleLength: 11 });
    expect(vw.recenterDelta(RECENTER_THRESHOLD)).toBe(0); // rebases only BEYOND it
    const a = RECENTER_THRESHOLD + 5; // 20005
    const delta = vw.recenterDelta(a);
    expect(delta).toBe(19910); // (floor(20005/55) − 1) * 55
    expect(delta % 11).toBe(0);
    expect(delta % WINDOW_SIZE).toBe(0);
    expect((a - delta) % 11).toBe(a % 11); // same video before and after
    expect(a - delta).toBeLessThan(RECENTER_THRESHOLD);
  });
});

describe('VirtualWindow.rebase', () => {
  it('shifts indices and the runway watermark; the post-rebase update is a no-op diff', () => {
    const vw = makeWindow();
    vw.update(37); // indices [35..39]
    expect(vw.runwaySlides(37)).toBe(44); // 37+4 = 41 → next multiple of 4
    const delta = vw.recenterDelta(37); // 15
    vw.rebase(delta);
    // Content-identical world: same window, zero enter/exit churn.
    expect(vw.update(37 - delta)).toEqual({
      enter: [],
      exit: [],
      indices: [20, 21, 22, 23, 24],
    });
    // Watermark shifted by −delta (44 − 15 = 29), re-chunked upward on next call:
    // max(29, 22+4) = 29 → next multiple of 4 = 32 — shrunk vs 44, still ≥ headroom.
    expect(vw.runwaySlides(22)).toBe(32);
    // Slot identity across the rebase: delta is a multiple of size.
    expect(vw.slotFor(35 - delta)).toBe(vw.slotFor(35));
  });
});

describe('VirtualWindow property: seeded random walk', () => {
  it('indices always equal active±2 (clamped at 0); enters land in vacated slots; slots rotate with period WINDOW_SIZE', () => {
    const vw = new VirtualWindow({ size: WINDOW_SIZE, cycleLength: 11 });
    // Deterministic LCG (Numerical Recipes constants) — NOT Math.random:
    // a failing walk must reproduce identically on every run.
    let seed = 42;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    /** Physical occupancy model: slot → feed index. @type {Map<number, number>} */
    const slots = new Map();
    let active = 50;
    for (const i of vw.update(active).enter) slots.set(vw.slotFor(i), i);

    for (let step = 0; step < 300; step++) {
      const r = rand();
      if (r < 0.45) active += 1;
      else if (r < 0.9) active = Math.max(0, active - 1);
      else active += 7; // occasional chained-flick jump
      const { enter, exit, indices } = vw.update(active);

      // 1. Window is exactly active ± 2, clamped at 0.
      /** @type {number[]} */
      const expected = [];
      for (let i = Math.max(0, active - 2); i <= active + 2; i++) expected.push(i);
      expect(indices).toEqual(expected);

      // 2. Every exit frees exactly the slot it occupied…
      for (const e of exit) {
        expect(slots.get(vw.slotFor(e))).toBe(e);
        slots.delete(vw.slotFor(e));
      }
      // …and every enter lands in a now-free slot (the vacated one, by modulo) —
      // if this ever fails, two live slides would fight over one DOM element.
      for (const e of enter) {
        expect(slots.has(vw.slotFor(e))).toBe(false);
        slots.set(vw.slotFor(e), e);
      }

      // 3. Slot assignment rotates back after WINDOW_SIZE steps.
      expect(vw.slotFor(active + WINDOW_SIZE)).toBe(vw.slotFor(active));
    }
  });
});
