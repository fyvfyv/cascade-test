import { Component } from './Component.js';

/** @typedef {import('./VideoPlayer.js').VideoPlayer} VideoPlayer */

/**
 * Thin scrubber bound to its slide's player.
 *
 * Paints with `transform: scaleX(f)` on the fill, not `width` — a transform
 * composites cheaply per frame, while animating width would invalidate layout up
 * to 60×/s. The rAF loop runs ONLY while the player is 'playing', so paused and
 * off-screen slides cost zero frames.
 *
 * Scrubbing uses Pointer Events + setPointerCapture on the .slide__progress
 * container (the 2 px fill itself would be untappable). That container's
 * `touch-action: none` stops a horizontal scrub turning into a vertical feed
 * scroll, and every handler stopPropagation()s so a scrub never toggles pause.
 */
export class ProgressBar extends Component {
  /** @param {VideoPlayer} player */
  constructor(player) {
    super();
    this._player = player;
    /** @type {number} rAF handle; 0 = loop stopped */
    this._rafId = 0;
    /** True from pointerdown to pointerup/cancel — suspends the rAF repaint. */
    this._dragging = false;
    /** @type {HTMLElement | null} The .slide__progress hit-area container (set on mount). */
    this._track = null;

    this.own(
      this._player.onStateChange((s) => {
        if (s === 'playing') this._startLoop();
        else this._stopLoop();
        if (s === 'loading') this._paint(0); // fresh binding — reset before the first frame
      }),
    );
    this.own(() => this._stopLoop());
  }

  /** @returns {HTMLElement} */
  createElement() {
    const fill = document.createElement('div');
    fill.className = 'progress__fill';
    return fill;
  }

  /**
   * Mounts the fill and wires the pointer handlers on the container.
   * @param {HTMLElement} parent
   */
  mount(parent) {
    super.mount(parent);
    this._track = parent;
    this.listen(parent, 'pointerdown', (e) => this._onDown(/** @type {PointerEvent} */ (e)));
    this.listen(parent, 'pointermove', (e) => this._onMove(/** @type {PointerEvent} */ (e)));
    this.listen(parent, 'pointerup', (e) => this._onEnd(/** @type {PointerEvent} */ (e)));
    this.listen(parent, 'pointercancel', (e) => this._onEnd(/** @type {PointerEvent} */ (e)));
  }

  /** @param {PointerEvent} e */
  _onDown(e) {
    if (this._track === null) return;
    e.stopPropagation(); // a scrub must never toggle pause
    e.preventDefault(); // no synthetic mouse events / text selection
    this._dragging = true;
    this._track.setPointerCapture(e.pointerId); // drag keeps tracking outside the strip
    this._scrubTo(e.clientX);
  }

  /** @param {PointerEvent} e */
  _onMove(e) {
    if (!this._dragging) return;
    e.stopPropagation();
    this._scrubTo(e.clientX);
  }

  /** @param {PointerEvent} e */
  _onEnd(e) {
    if (!this._dragging) return;
    e.stopPropagation();
    this._dragging = false; // rAF repaint resumes on the next frame if playing
  }

  /**
   * Tap + drag: clientX → fraction → seek, with an immediate visual echo.
   * @param {number} clientX
   */
  _scrubTo(clientX) {
    if (this._track === null) return;
    const rect = this._track.getBoundingClientRect();
    if (rect.width === 0) return;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    this._player.seekToFraction(f);
    this._paint(f); // echo even while paused/loading — the bar follows the finger
  }

  _startLoop() {
    if (this._rafId !== 0) return; // idempotent — 'playing' can repeat
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      if (this._dragging) return; // repaint suspended during a drag
      const { currentTime, duration } = this._player.getProgress();
      if (Number.isFinite(duration) && duration > 0) this._paint(currentTime / duration);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId !== 0) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /** @param {number} f Fraction 0..1. */
  _paint(f) {
    if (this.element === null) return; // constructed but not yet mounted
    this.element.style.transform = `scaleX(${f})`;
  }
}
