/** @typedef {import('../types.js').AppState} AppState */

/**
 * Single source of truth for shared UI state and the app's only pub/sub.
 * Notifies synchronously: synchrony is what lets a mute toggle reach
 * <video>.muted inside the user's gesture context, required by iOS audio
 * policy. Subscribers fire in subscription order, which main.js relies on to
 * run the coordinator before FeedView.
 */
export class FeedStore {
  /** @type {number} */ #activeIndex;
  /** @type {boolean} */ #muted;
  /** @type {ReadonlySet<string>} */ #likedIds;
  /** @type {boolean} */ #userPaused;
  /** @type {Array<(s: AppState, changed: ReadonlySet<keyof AppState>) => void>} */
  #subscribers = [];

  /** @param {Partial<AppState>} [initial] */
  constructor(initial = {}) {
    this.#activeIndex = initial.activeIndex ?? 0;
    this.#muted = initial.muted ?? true;
    this.#likedIds = initial.likedIds ?? new Set();
    this.#userPaused = initial.userPaused ?? false;
  }

  /** @returns {AppState} */
  getState() {
    return {
      activeIndex: this.#activeIndex,
      muted: this.#muted,
      likedIds: this.#likedIds,
      userPaused: this.#userPaused,
    };
  }

  /**
   * Also resets userPaused → false: a new slide always autoplays.
   * @param {number} i
   */
  setActiveIndex(i) {
    /** @type {Array<keyof AppState>} */
    const changed = [];
    if (i !== this.#activeIndex) {
      this.#activeIndex = i;
      changed.push('activeIndex');
    }
    if (this.#userPaused) {
      this.#userPaused = false;
      changed.push('userPaused');
    }
    this.#notify(changed);
  }

  /**
   * Recenter support: shifts activeIndex by -delta without resetting userPaused.
   * Notifies normally so persistence picks up the rebased index.
   * @param {number} delta
   */
  rebaseActiveIndex(delta) {
    if (delta === 0) return;
    this.#activeIndex -= delta;
    this.#notify(['activeIndex']);
  }

  toggleMute() {
    this.#muted = !this.#muted;
    this.#notify(['muted']);
  }

  /**
   * Idempotent: setting the current value does not notify.
   * @param {boolean} m
   */
  setMuted(m) {
    if (m === this.#muted) return;
    this.#muted = m;
    this.#notify(['muted']);
  }

  /**
   * Keyed by video id, so a like applies to all cycles of that video and
   * survives recenter. Copy-on-write: the handed-out ReadonlySet is never mutated.
   * @param {string} videoId
   */
  toggleLike(videoId) {
    const next = new Set(this.#likedIds);
    if (next.has(videoId)) next.delete(videoId);
    else next.add(videoId);
    this.#likedIds = next;
    this.#notify(['likedIds']);
  }

  /** @param {boolean} p */
  setUserPaused(p) {
    if (p === this.#userPaused) return;
    this.#userPaused = p;
    this.#notify(['userPaused']);
  }

  /**
   * @param {(s: AppState, changed: ReadonlySet<keyof AppState>) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    this.#subscribers.push(fn);
    return () => {
      const i = this.#subscribers.indexOf(fn);
      if (i !== -1) this.#subscribers.splice(i, 1);
    };
  }

  /** @param {ReadonlyArray<keyof AppState>} keys */
  #notify(keys) {
    if (keys.length === 0) return;
    const state = this.getState();
    const changed = new Set(keys);
    // Iterate a copy: an unsubscribe during notify must not skip a sibling.
    for (const fn of [...this.#subscribers]) fn(state, changed);
  }
}
