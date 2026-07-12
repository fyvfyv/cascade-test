import { Component } from './Component.js';
import { SlideView } from './SlideView.js';
import { ScrollTracker } from './ScrollTracker.js';
import { WINDOW_SIZE } from '../config.js';

/** @typedef {import('../core/FeedStore.js').FeedStore} FeedStore */
/** @typedef {import('../core/VirtualWindow.js').VirtualWindow} VirtualWindow */
/** @typedef {import('../data/FeedRepository.js').FeedRepository} FeedRepository */
/** @typedef {import('../services/PlaybackCoordinator.js').PlaybackCoordinator} PlaybackCoordinator */
/** @typedef {import('./VideoPlayer.js').VideoPlayer} VideoPlayer */

// INVARIANT: settled ⇒ scrollTop === activeIndex * slideHeight

/**
 * Owns the scroller, runway sizer, the fixed set of SlideViews, and all geometry.
 * One px source of truth: slideHeight = feed.clientHeight; no viewport unit ever
 * enters the math. Sole caller of coordinator.attach/detach, under the ordering
 * contract in _applyWindow.
 */
export class FeedView extends Component {
  /**
   * createPlayer is a factory injected by main.js so FeedView never constructs
   * cross-layer classes itself.
   * @param {{ store: FeedStore, repo: FeedRepository, vwindow: VirtualWindow,
   *           coordinator: PlaybackCoordinator,
   *           createPlayer: (el: HTMLVideoElement) => VideoPlayer,
   *           slideTemplate: HTMLTemplateElement }} deps
   */
  constructor(deps) {
    super();
    this._store = deps.store;
    this._repo = deps.repo;
    this._vwindow = deps.vwindow;
    this._coordinator = deps.coordinator;
    this._createPlayer = deps.createPlayer;
    this._template = deps.slideTemplate;

    /** @type {SlideView[]} slot → view; fixed forever after mount */
    this._slides = [];
    /** @type {Map<number, SlideView>} bound feed index → the slide showing it */
    this._bound = new Map();
    this._slideHeight = 0;
    this._runwaySlideCount = 0;
    this._runway = document.createElement('div');
    this._runway.className = 'runway';
    /** @type {ScrollTracker | null} */
    this._tracker = null;
  }

  /** @returns {HTMLElement} */
  createElement() {
    const feed = document.createElement('div');
    feed.className = 'feed';
    feed.appendChild(this._runway);
    return feed;
  }

  /** @param {HTMLElement} parent */
  mount(parent) {
    super.mount(parent);
    const feed = /** @type {HTMLElement} */ (this.element);

    // Exactly WINDOW_SIZE slides, cloned once; never reordered, added, or
    // removed after this loop.
    for (let slot = 0; slot < WINDOW_SIZE; slot++) {
      const slide = new SlideView(this._store, this._template, this._createPlayer);
      slide.mount(feed);
      this._slides.push(slide);
      this.own(() => slide.destroy());
    }

    this._slideHeight = feed.clientHeight;

    this.own(
      this._store.subscribe((state, changed) => {
        if (changed.has('activeIndex')) void this._applyWindow(state.activeIndex);
      }),
    );

    // Re-measure and restore scrollTop synchronously so rotation never flashes
    // a misaligned frame.
    const ro = new ResizeObserver(() => this._relayout());
    ro.observe(feed);
    this.own(() => ro.disconnect());

    this._tracker = new ScrollTracker(
      feed,
      {
        onCandidate: (i) => this._onCandidate(i),
        onSettle: (i) => this._onSettle(i),
      },
      () => this._slideHeight,
    );
    this._tracker.start();
    this.own(() => {
      if (this._tracker !== null) this._tracker.stop();
    });

    const active = this._store.getState().activeIndex;
    this._growRunway(active);
    void this._applyWindow(active);
  }

  /**
   * Programmatic navigation; honors prefers-reduced-motion (smooth → auto).
   * Targets exact snap offsets so mandatory snap has nothing to fight, and the
   * resulting scroll flows through ScrollTracker like any user scroll — scroll
   * position stays the single source of truth for activeIndex.
   * @param {number} i
   * @param {ScrollBehavior} behavior
   */
  scrollToIndex(i, behavior) {
    const feed = /** @type {HTMLElement} */ (this.element);
    this._growRunway(i); // ensure runway covers the destination
    void this._applyWindow(i);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    feed.scrollTo({
      top: i * this._slideHeight,
      behavior: behavior === 'smooth' && reduce ? 'auto' : behavior,
    });
  }

  /** @param {1|-1} delta */
  scrollBySlides(delta) {
    const next = Math.max(0, this._store.getState().activeIndex + delta);
    this.scrollToIndex(next, 'smooth');
  }

  /** @param {number} i */
  _onCandidate(i) {
    // Grow runway BEFORE the store mutation. Extending height below the viewport
    // never shifts scrollTop, so it is safe mid-gesture; growing at candidate
    // time (not settle) keeps snap-target headroom ahead of chained flicks.
    this._growRunway(i);
    this._store.setActiveIndex(i);
  }

  /**
   * Settle is the only safe moment to write scrollTop, which is what recenter needs.
   * @param {number} i
   */
  _onSettle(i) {
    const delta = this._vwindow.recenterDelta(i);
    if (delta === 0) return;
    this._recenter(i, delta);
  }

  /**
   * "Honest infinity": rebase every virtual index by -delta in one synchronous
   * frame. Same pixels before and after, so playback never notices. delta is a
   * multiple of both the cycle length and WINDOW_SIZE, so content and slot
   * identity are preserved and nothing rebinds — only numbers shift. Step order:
   *   1. coordinator.rebase — shifts registry keys, making step 5's store
   *      notification a no-op;
   *   2. vwindow.rebase — window indices + runway watermark;
   *   3. shift each bound slide's top by -delta*h (rekeying _bound);
   *   4. scrollTop -= delta*h, THEN shrink the runway — shrinking first could
   *      clamp scrollTop;
   *   5. store.rebaseActiveIndex(delta).
   * @param {number} i settled active index (pre-rebase)
   * @param {number} delta positive rebase amount from recenterDelta
   */
  _recenter(i, delta) {
    const feed = /** @type {HTMLElement} */ (this.element);
    const h = this._slideHeight;
    this._coordinator.rebase(delta); // 1
    this._vwindow.rebase(delta); // 2
    /** @type {Map<number, SlideView>} */ // 3
    const rebound = new Map();
    for (const [idx, slide] of this._bound) {
      slide.layout((idx - delta) * h, h);
      rebound.set(idx - delta, slide);
    }
    this._bound = rebound;
    feed.scrollTop -= delta * h; // 4
    this._growRunway(i - delta); // shrink: runwaySlides reflects the rebased watermark
    this._store.rebaseActiveIndex(delta); // 5
  }

  /** @param {number} activeIndex */
  _growRunway(activeIndex) {
    const slides = this._vwindow.runwaySlides(activeIndex);
    if (slides !== this._runwaySlideCount) {
      this._runwaySlideCount = slides;
      this._runway.style.height = `${slides * this._slideHeight}px`;
    }
  }

  /**
   * Apply the window diff for a new active index, under the attach/detach
   * ordering contract (FeedView is the only caller):
   *   1. detach(idx) BEFORE slide.unbind() — the coordinator never holds a
   *      released player;
   *   2. slide.bind() BEFORE attach() — attach acts on a bound player and
   *      applies level/mute/play-intent synchronously, so no subscriber
   *      ordering can leave a hole.
   * Entering indices land in exactly the slot the exiting index vacated.
   * @param {number} activeIndex
   */
  async _applyWindow(activeIndex) {
    const { enter, exit } = this._vwindow.update(activeIndex);
    for (const idx of exit) {
      const slide = this._bound.get(idx);
      if (slide !== undefined) {
        this._coordinator.detach(idx); // detach first…
        slide.unbind(); // …then release (frees decoder + memory)
        this._bound.delete(idx);
      }
    }
    for (const idx of enter) {
      const slot = this._vwindow.slotFor(idx);
      const slide = this._slides[slot];
      // Same-tick microtask locally; the repo seam stays honestly async.
      const [item] = await this._repo.getItems(idx, 1);
      slide.bind(item, idx * this._slideHeight); // bind first…
      slide.layout(idx * this._slideHeight, this._slideHeight);
      this._coordinator.attach(idx, slide.player); // …then attach
      this._bound.set(idx, slide);
    }
  }

  _relayout() {
    if (this.element === null) return;
    const feed = this.element;
    const h = feed.clientHeight;
    if (h === 0 || h === this._slideHeight) return;
    this._slideHeight = h;
    this._runway.style.height = `${this._runwaySlideCount * h}px`;
    for (const [idx, slide] of this._bound) {
      slide.layout(idx * h, h);
    }
    // Restore the invariant synchronously — no misaligned frame.
    feed.scrollTop = this._store.getState().activeIndex * h;
  }
}
