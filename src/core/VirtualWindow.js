import { RECENTER_THRESHOLD, RUNWAY_CHUNK, WINDOW_SIZE } from '../config.js';

/**
 * Greatest common divisor, used for the rebase unit.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gcd(a, b) {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Pure, DOM-free windowing math: DOM membership, slot assignment, runway
 * sizing, recenter rebasing. FeedView executes the results.
 */
export class VirtualWindow {
  /** @type {number} */ #size;
  /** @type {number} */ #cycleLength;
  /** @type {number} */ #recenterThreshold;
  /** @type {number} */ #runwayChunk;
  /**
   * Rebase unit = lcm(cycleLength, size): recenterDelta is a multiple of both,
   * so content identity (index % cycleLength) and slot identity
   * (slotFor(i − delta) === slotFor(i)) both survive a rebase.
   * @type {number}
   */
  #rebaseUnit;
  /** Previous window, ascending. @type {number[]} */
  #indices = [];
  /** Runway watermark, in slides. @type {number} */
  #runway = 0;

  /** @param {{ size?: number, cycleLength: number, recenterThreshold?: number,
   *             runwayChunk?: number }} opts */
  constructor(opts) {
    this.#size = opts.size ?? WINDOW_SIZE;
    this.#cycleLength = opts.cycleLength;
    this.#recenterThreshold = opts.recenterThreshold ?? RECENTER_THRESHOLD;
    this.#runwayChunk = opts.runwayChunk ?? RUNWAY_CHUNK;
    this.#rebaseUnit = (this.#size * this.#cycleLength) / gcd(this.#size, this.#cycleLength);
  }

  /**
   * Diff against the previous window. Window = activeIndex ± floor(size/2),
   * clamped at 0.
   * @param {number} activeIndex
   * @returns {{ enter: number[], exit: number[], indices: number[] }}
   */
  update(activeIndex) {
    const half = Math.floor(this.#size / 2);
    /** @type {number[]} */
    const next = [];
    for (let i = Math.max(0, activeIndex - half); i <= activeIndex + half; i++) {
      next.push(i);
    }
    const prev = this.#indices;
    const enter = next.filter((i) => !prev.includes(i));
    const exit = prev.filter((i) => !next.includes(i));
    this.#indices = next;
    return { enter, exit, indices: [...next] };
  }

  /**
   * slotFor(i) === i % size. Sliding the window by 1 lands the entering index
   * in the slot the exiting index just vacated — no free-list bookkeeping.
   * @param {number} index
   * @returns {number}
   */
  slotFor(index) {
    return index % this.#size;
  }

  /**
   * Monotonic, chunked runway size in slides: smallest multiple of runwayChunk
   * ≥ max(previous, activeIndex + runwayChunk). Only shrinks inside rebase().
   * @param {number} activeIndex
   * @returns {number}
   */
  runwaySlides(activeIndex) {
    const target = Math.max(this.#runway, activeIndex + this.#runwayChunk);
    this.#runway = Math.ceil(target / this.#runwayChunk) * this.#runwayChunk;
    return this.#runway;
  }

  /**
   * 0 if no rebase is needed, else a positive multiple of the rebase unit to
   * subtract from every index. Rebases only beyond recenterThreshold, keeping
   * one full rebase unit of headroom so the rebased window never goes negative.
   * @param {number} activeIndex
   * @returns {number}
   */
  recenterDelta(activeIndex) {
    if (activeIndex <= this.#recenterThreshold) return 0;
    const delta = (Math.floor(activeIndex / this.#rebaseUnit) - 1) * this.#rebaseUnit;
    return Math.max(0, delta);
  }

  /**
   * Shift all internal indices and the runway watermark by -delta.
   * @param {number} delta
   */
  rebase(delta) {
    this.#indices = this.#indices.map((i) => i - delta);
    this.#runway = Math.max(0, this.#runway - delta);
  }
}
