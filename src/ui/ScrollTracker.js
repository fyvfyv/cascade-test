import { activeIndexFor } from '../core/feedMath.js';
import { HYSTERESIS, SETTLE_FALLBACK_MS } from '../config.js';

/**
 * Input adapter: scroll events → hysteretic active-index candidates + a settle
 * signal. Separate from FeedView so DOM listener glue stays isolated from layout;
 * owns no geometry (FeedView supplies slide height via getSlideHeight).
 *
 * Settle uses 'scrollend' where available, else a scroll-quiet debounce gated on
 * "no active pointer" — a finger resting mid-drag must never count as settled.
 */
export class ScrollTracker {
  /**
   * @param {HTMLElement} scroller
   * @param {{ onCandidate(i: number): void, onSettle(i: number): void }} sink
   * @param {() => number} getSlideHeight
   */
  constructor(scroller, sink, getSlideHeight) {
    this._scroller = scroller;
    this._sink = sink;
    this._getSlideHeight = getSlideHeight;
    this._prev = 0;
    this._rafId = 0;
    /** @type {number | undefined} */
    this._settleTimer = undefined;
    this._pointerActive = false;
    this._hasScrollEnd = 'onscrollend' in window;
    /** @type {Array<() => void>} */
    this._disposers = [];
  }

  start() {
    /** @param {string} type @param {(e: Event) => void} fn */
    const on = (type, fn) => {
      this._scroller.addEventListener(type, fn, { passive: true });
      this._disposers.push(() => this._scroller.removeEventListener(type, fn));
    };

    on('scroll', () => {
      if (this._rafId === 0) {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = 0;
          this._emitCandidate();
        });
      }
      if (!this._hasScrollEnd) this._armSettleTimer();
    });

    if (this._hasScrollEnd) {
      on('scrollend', () => this._settle());
    } else {
      // scrollend is missing on most current Safari: track the pointer so the
      // fallback debounce can gate on it.
      on('pointerdown', () => {
        this._pointerActive = true;
      });
      on('pointerup', () => {
        this._pointerActive = false;
      });
      on('pointercancel', () => {
        this._pointerActive = false;
      });
    }
  }

  stop() {
    for (const dispose of this._disposers) dispose();
    this._disposers.length = 0;
    if (this._rafId !== 0) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    if (this._settleTimer !== undefined) {
      clearTimeout(this._settleTimer);
      this._settleTimer = undefined;
    }
  }

  _emitCandidate() {
    const h = this._getSlideHeight();
    if (h <= 0) return;
    const candidate = activeIndexFor(this._scroller.scrollTop, h, this._prev, HYSTERESIS);
    if (candidate !== this._prev) {
      this._prev = candidate;
      this._sink.onCandidate(candidate);
    }
  }

  /**
   * Flush any pending rAF candidate first so the settle index reflects the true
   * resting position — scrollend can fire before a scheduled rAF runs. The
   * duplicate-emission guard in _emitCandidate makes the later rAF tick a no-op.
   */
  _settle() {
    this._emitCandidate();
    this._sink.onSettle(this._prev);
  }

  _armSettleTimer() {
    if (this._settleTimer !== undefined) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this._settleTimer = undefined;
      if (this._pointerActive) {
        // Finger still down: not settled — re-check after another quiet period.
        this._armSettleTimer();
        return;
      }
      // NEVER gate settle on `scrollTop % slideHeight === 0`: at non-integer
      // devicePixelRatio scrollTop is fractional, so that equality never holds
      // and the settle signal would never fire, wedging the feed.
      this._settle();
    }, SETTLE_FALLBACK_MS);
  }
}
