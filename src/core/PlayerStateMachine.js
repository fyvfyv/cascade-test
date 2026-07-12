/** @typedef {import('../types.js').PlayerState} PlayerState */

/** @typedef {'bind'|'canplay'|'play-intent'|'pause-intent'|'media-playing'
 *           |'media-waiting'|'media-pause'|'media-error'|'retry-intent'
 *           |'release'} PlayerEvent */
/** @typedef {'attach-src'|'detach-src'|'call-play'|'call-pause'} PlayerEffect */

/**
 * Pure transition table for one player's lifecycle. Intents come from the
 * coordinator/UI; facts come from media events. State advances to 'playing'
 * only on the media-playing fact, never optimistically. 'media-pause' exists
 * because browsers pause videos behind your back (iOS backgrounding, PiP,
 * calls) — the FSM reconciles to reality. No 'ended' handling: video.loop = true.
 */
export class PlayerStateMachine {
  /** @type {PlayerState} */
  #state = 'idle';

  #wantsToPlay = false;

  /** @returns {PlayerState} */
  get state() {
    return this.#state;
  }

  /** @returns {boolean} */
  get wantsToPlay() {
    return this.#wantsToPlay;
  }

  /**
   * Returns effects for the adapter to execute; [] for valid no-ops; null for
   * invalid (state, event) pairs.
   * @param {PlayerEvent} event
   * @returns {PlayerEffect[] | null}
   */
  dispatch(event) {
    // Universal rows: 'release' from ANY state; 'media-error' from any state ≠ idle.
    if (event === 'release') {
      this.#state = 'idle';
      this.#wantsToPlay = false;
      return ['call-pause', 'detach-src'];
    }
    if (event === 'media-error') {
      if (this.#state === 'idle') return null;
      this.#state = 'error';
      return [];
    }

    switch (this.#state) {
      case 'idle':
        if (event === 'bind') {
          this.#state = 'loading';
          return ['attach-src'];
        }
        return null;

      case 'loading':
        if (event === 'play-intent') {
          this.#wantsToPlay = true; // queued autoplay
          return [];
        }
        if (event === 'pause-intent') {
          this.#wantsToPlay = false; // cancels the queue — user swiped past
          return [];
        }
        if (event === 'canplay') {
          this.#state = 'ready';
          return this.#wantsToPlay ? ['call-play'] : [];
        }
        return null;

      case 'ready':
        if (event === 'play-intent') {
          this.#wantsToPlay = true;
          return ['call-play'];
        }
        if (event === 'pause-intent') {
          this.#wantsToPlay = false;
          return [];
        }
        if (event === 'media-playing') {
          this.#state = 'playing';
          return [];
        }
        return null;

      case 'playing':
        if (event === 'play-intent') return []; // valid no-op
        if (event === 'pause-intent') {
          this.#state = 'paused';
          this.#wantsToPlay = false;
          return ['call-pause'];
        }
        if (event === 'media-waiting') {
          this.#state = 'buffering';
          return [];
        }
        if (event === 'media-pause') {
          this.#state = 'paused'; // external pause fact — reconcile, don't fight
          this.#wantsToPlay = false;
          return [];
        }
        return null;

      case 'buffering':
        if (event === 'media-playing') {
          this.#state = 'playing';
          return [];
        }
        if (event === 'play-intent') return []; // valid no-op
        if (event === 'pause-intent') {
          this.#state = 'paused';
          this.#wantsToPlay = false;
          return ['call-pause'];
        }
        if (event === 'media-pause') {
          this.#state = 'paused';
          this.#wantsToPlay = false;
          return [];
        }
        return null;

      case 'paused':
        if (event === 'play-intent') {
          this.#wantsToPlay = true;
          return ['call-play']; // state advances to 'playing' only on the media-playing fact
        }
        if (event === 'pause-intent') return []; // valid no-op
        if (event === 'media-playing') {
          this.#state = 'playing';
          return [];
        }
        return null;

      case 'error':
        if (event === 'retry-intent') {
          this.#state = 'loading';
          return ['detach-src', 'attach-src']; // a genuinely fresh attempt
        }
        return null;

      default:
        return null;
    }
  }
}
