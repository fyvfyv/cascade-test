import { Component } from './Component.js';
// Icon SVGs imported as raw strings via Vite's `?raw` suffix (typed as string
// by vite/client) and inlined into the bundle.
import HEART_SVG from './icons/heart.svg?raw';
import SOUND_ON_SVG from './icons/sound-on.svg?raw';
import SOUND_OFF_SVG from './icons/sound-off.svg?raw';
import SHARE_SVG from './icons/share.svg?raw';
import CHECK_SVG from './icons/check.svg?raw';

/** @typedef {import('../core/FeedStore.js').FeedStore} FeedStore */
/** @typedef {import('../types.js').FeedItem} FeedItem */

/**
 * Like / mute / share-stub column. Buttons only mutate the store or call a
 * platform API — never the player or coordinator. Likes are keyed by video id
 * (so all cycles share one heart); mute reflects the global store.muted.
 *
 * Icons are inline SVG drawn with currentColor: emoji ignore CSS `color`, so
 * neither the ghost-white rail nor the accent-tinted liked heart would render.
 */

// UI-local feedback timing, not a feed tunable — deliberately not in config.js.
const COPIED_FEEDBACK_MS = 1500;

export class ActionRail extends Component {
  /** @param {FeedStore} store */
  constructor(store) {
    super();
    this._store = store;
    /** @type {FeedItem | null} */
    this._item = null;
    /** @type {number} transient-Copied timeout handle; 0 = none pending */
    this._copiedTimer = 0;

    this._likeBtn = this._button('Like', HEART_SVG);
    this._likeBtn.setAttribute('aria-pressed', 'false');
    this._muteBtn = this._button('Unmute', SOUND_OFF_SVG);
    this._shareBtn = this._button('Share', SHARE_SVG);

    this.listen(this._likeBtn, 'click', () => {
      if (this._item !== null) this._store.toggleLike(this._item.video.id);
    });
    this.listen(this._muteBtn, 'click', () => this._store.toggleMute());
    this.listen(this._shareBtn, 'click', () => {
      void this._onShare();
    });

    this.own(
      this._store.subscribe((_state, changed) => {
        if (changed.has('muted') || changed.has('likedIds')) this._renderState();
      }),
    );
    this.own(() => {
      if (this._copiedTimer !== 0) clearTimeout(this._copiedTimer);
    });

    this._renderState();
  }

  /** @returns {HTMLElement} */
  createElement() {
    const root = document.createElement('div');
    // display: contents keeps the required single root layout-transparent, so
    // the buttons act as direct flex items of the template's .slide__rail.
    root.style.display = 'contents';
    root.append(this._likeBtn, this._muteBtn, this._shareBtn);
    return root;
  }

  /**
   * Re-render like state for a new item; likes are keyed by video id, so all
   * cycles of a video share one heart.
   * @param {FeedItem} item
   */
  setItem(item) {
    this._item = item;
    this._renderState();
  }

  /**
   * @param {string} label
   * @param {string} svg
   * @returns {HTMLButtonElement}
   */
  _button(label, svg) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }

  _renderState() {
    const { muted, likedIds } = this._store.getState();
    const liked = this._item !== null && likedIds.has(this._item.video.id);
    this._likeBtn.setAttribute('aria-pressed', String(liked));
    this._muteBtn.innerHTML = muted ? SOUND_OFF_SVG : SOUND_ON_SVG;
    this._muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  async _onShare() {
    const url = location.href;
    if (navigator.share !== undefined) {
      // A rejection here is the user closing the sheet — not an error.
      try {
        await navigator.share({ url });
      } catch {
        /* cancelled */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // clipboard unavailable/denied — nothing sensible to show
    }
    // Transient Copied state, restored after the timeout.
    if (this._copiedTimer !== 0) clearTimeout(this._copiedTimer);
    this._shareBtn.innerHTML = CHECK_SVG;
    this._shareBtn.setAttribute('aria-label', 'Copied');
    this._copiedTimer = setTimeout(() => {
      this._copiedTimer = 0;
      this._shareBtn.innerHTML = SHARE_SVG;
      this._shareBtn.setAttribute('aria-label', 'Share');
    }, COPIED_FEEDBACK_MS);
  }
}
