import { Component } from './Component.js';
import { ActionRail } from './ActionRail.js';
import { ProgressBar } from './ProgressBar.js';
import { SPINNER_DELAY_MS } from '../config.js';

/** @typedef {import('../types.js').FeedItem} FeedItem */
/** @typedef {import('./VideoPlayer.js').VideoPlayer} VideoPlayer */

/**
 * One recyclable slide. Renders from two inputs: player.onStateChange (spinner /
 * error panel / play glyph) and a store subscription (active-slide gating of the
 * error panel). Player-internal state is deliberately kept out of the store — it
 * is per-player and flows straight from the FSM to this view.
 *
 * The <video> is cloned once and NEVER detached from the document — recycling is
 * bind()/unbind() on the same element, which preserves iOS gesture activation.
 */
export class SlideView extends Component {
  /**
   * @param {import('../core/FeedStore.js').FeedStore} store
   * @param {HTMLTemplateElement} template
   * @param {(el: HTMLVideoElement) => VideoPlayer} createPlayer
   */
  constructor(store, template, createPlayer) {
    super();
    this._store = store;
    /** @type {FeedItem | null} */
    this._item = null;
    /** @type {number} spinner-delay timeout handle; 0 = none pending */
    this._spinnerTimer = 0;

    const fragment = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
    this._root = /** @type {HTMLElement} */ (fragment.firstElementChild);
    // Hidden until bound: at the top boundary 1-2 slots stay unbound, and without
    // this they collapse to top:auto (= 0) and overlay the active slide.
    this._root.hidden = true;
    this._video = /** @type {HTMLVideoElement} */ (this._root.querySelector('.slide__video'));
    this._spinner = /** @type {HTMLElement} */ (this._root.querySelector('.slide__spinner'));
    this._glyph = /** @type {HTMLElement} */ (this._root.querySelector('.slide__glyph'));
    this._errorPanel = /** @type {HTMLElement} */ (this._root.querySelector('.slide__error'));
    this._retryBtn = /** @type {HTMLElement} */ (this._root.querySelector('.slide__retry'));
    this._meta = /** @type {HTMLElement} */ (this._root.querySelector('.slide__meta'));
    this._title = /** @type {HTMLElement} */ (this._root.querySelector('.slide__title'));
    this._author = /** @type {HTMLElement} */ (this._root.querySelector('.slide__author'));

    this._player = createPlayer(this._video);
    this.own(this._player.onStateChange(() => this._render()));

    this._progress = new ProgressBar(this._player);
    this._progress.mount(/** @type {HTMLElement} */ (this._root.querySelector('.slide__progress')));
    this.own(() => this._progress.destroy());

    this._rail = new ActionRail(this._store);
    this._rail.mount(/** @type {HTMLElement} */ (this._root.querySelector('.slide__rail')));
    this.own(() => this._rail.destroy());

    // Re-render on activeIndex change: an errored neighbor shows nothing until
    // scrolled to, and activation can flip wantsToPlay with no state change.
    this.own(
      this._store.subscribe((_state, changed) => {
        if (changed.has('activeIndex')) this._render();
      }),
    );

    // Tap/glyph record intent on the store and never touch the player — tap,
    // Space, and Media Session all take this one path so they cannot disagree.
    this.listen(this._video, 'click', () => this._togglePause());
    this.listen(this._glyph, 'click', () => this._togglePause());
    this.listen(this._retryBtn, 'click', () => this._player.retry());

    this.own(() => this._clearSpinnerTimer());
    this._render();
  }

  /** @returns {HTMLElement} */
  createElement() {
    return this._root;
  }

  /**
   * The player this slide owns for life.
   * @returns {VideoPlayer}
   */
  get player() {
    return this._player;
  }

  /**
   * Absolute top in px, not transforms: a layout-positioned box's snap area is
   * unambiguous in every browser.
   * @param {number} topPx
   * @param {number} heightPx
   */
  layout(topPx, heightPx) {
    this._root.style.top = `${topPx}px`;
    this._root.style.height = `${heightPx}px`;
  }

  /**
   * @param {FeedItem} item
   * @param {number} topPx
   */
  bind(item, topPx) {
    this._item = item;
    this._root.hidden = false;
    this._root.style.top = `${topPx}px`;
    this._title.textContent = item.video.title;
    this._author.textContent = item.video.author;
    this._meta.hidden = false;
    this._rail.setItem(item);
    this._player.bind(item);
  }

  /**
   * Releases the player (decoder/memory) and hides content so a momentarily
   * unbound slide shows nothing stale.
   */
  unbind() {
    this._item = null;
    this._player.release();
    this._meta.hidden = true;
    this._root.hidden = true; // spare slot must not intrude (see constructor)
  }

  _togglePause() {
    this._store.setUserPaused(!this._store.getState().userPaused);
  }

  /** @returns {boolean} */
  _isActive() {
    return this._item !== null && this._item.feedIndex === this._store.getState().activeIndex;
  }

  _clearSpinnerTimer() {
    if (this._spinnerTimer !== 0) {
      clearTimeout(this._spinnerTimer);
      this._spinnerTimer = 0;
    }
  }

  /**
   * Single render path: every overlay derives from player state (plus the store,
   * for active gating).
   */
  _render() {
    const state = this._player.getState();

    // Spinner shown only after SPINNER_DELAY_MS so fast loads never flash it. The
    // condition is evaluated WHEN THE TIMER FIRES, not when scheduled: play-intent
    // flips wantsToPlay while state stays 'loading' with no state-change callback,
    // so an at-scheduling-time check would miss exactly the slow-load case.
    this._clearSpinnerTimer();
    this._spinner.hidden = true;
    if (state === 'loading' || state === 'buffering') {
      this._spinnerTimer = setTimeout(() => {
        this._spinnerTimer = 0;
        const s = this._player.getState();
        this._spinner.hidden = !((s === 'loading' && this._player.wantsToPlay) || s === 'buffering');
      }, SPINNER_DELAY_MS);
    }

    this._glyph.hidden = state !== 'paused';

    // Error panel: only on the ACTIVE slide — an errored neighbor shows nothing
    // until scrolled to.
    this._errorPanel.hidden = !(state === 'error' && this._isActive());
  }
}
