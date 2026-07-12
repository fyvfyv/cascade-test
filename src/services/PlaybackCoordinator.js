import { preloadLevelFor } from '../core/feedMath.js';

/** @typedef {import('../core/FeedStore.js').FeedStore} FeedStore */
/** @typedef {import('../types.js').PlayerLike} PlayerLike */
/** @typedef {import('../types.js').AppState} AppState */

/**
 * Guarantees exactly one video plays; applies preload levels and mute; owns
 * play/pause and visibility policy. Sees only PlayerLike (never
 * HTMLVideoElement) so it is unit-testable with plain fakes.
 *
 * FeedView is the only caller of attach/detach, and orders them so the
 * coordinator never holds a released player: detach(idx) before unbind,
 * bind before attach(idx, player).
 */
export class PlaybackCoordinator {
  /**
   * @param {FeedStore} store
   * @param {{ nearRadius: number }} config
   */
  constructor(store, config) {
    this._store = store;
    this._nearRadius = config.nearRadius;
    /** @type {Map<number, PlayerLike>} feed index → attached player */
    this._players = new Map();
    this._lastActive = store.getState().activeIndex;
    /**
     * True while the active player's current pause was issued by suspend()
     * (visibility policy), not the user — so resume() never undoes a user pause.
     */
    this._policyPaused = false;

    store.subscribe((state, changed) => this._onStoreChange(state, changed));
  }

  /**
   * Applies level, mute, and play-intent synchronously, so no store-subscriber
   * ordering can leave a newly attached player in the wrong state; the
   * coordinator-first subscription order in main.js is a latency optimization,
   * not a correctness dependency.
   * @param {number} index
   * @param {PlayerLike} player
   */
  attach(index, player) {
    this._players.set(index, player);
    const { activeIndex, muted, userPaused } = this._store.getState();
    player.setLevel(preloadLevelFor(index, activeIndex, this._nearRadius));
    player.setMuted(muted);
    if (index === activeIndex && !userPaused) player.play();
  }

  /**
   * Forgets the player without releasing it — FeedView owns release and
   * calls detach before unbind.
   * @param {number} index
   */
  detach(index) {
    this._players.delete(index);
  }

  /**
   * Shifts registry keys and lastActive by -delta so the following
   * rebaseActiveIndex notification arrives as a no-op by construction.
   * @param {number} delta
   */
  rebase(delta) {
    /** @type {Map<number, PlayerLike>} */
    const shifted = new Map();
    for (const [index, player] of this._players) shifted.set(index - delta, player);
    this._players = shifted;
    this._lastActive -= delta;
  }

  /**
   * Pauses the active player and records whether the pause was ours (it was
   * actually playing/buffering); a user pause arms nothing, so resume() won't
   * undo it.
   */
  suspend() {
    const player = this._players.get(this._store.getState().activeIndex);
    if (player === undefined) return;
    const state = player.getState();
    if (state === 'playing' || state === 'buffering') {
      this._policyPaused = true;
      player.pause();
    }
  }

  /** Re-issue play-intent only if the pause was ours AND !store.userPaused. */
  resume() {
    if (!this._policyPaused) return;
    this._policyPaused = false;
    const { activeIndex, userPaused } = this._store.getState();
    if (userPaused) return;
    const player = this._players.get(activeIndex);
    if (player !== undefined) player.play();
  }

  /**
   * @param {AppState} state
   * @param {ReadonlySet<keyof AppState>} changed
   */
  _onStoreChange(state, changed) {
    if (changed.has('muted')) {
      // Fan out to all attached players so a neighbor never blasts audio on
      // arrival; the store's synchronous notify keeps this inside the user's
      // gesture context (iOS).
      for (const player of this._players.values()) player.setMuted(state.muted);
    }
    if (changed.has('activeIndex') && state.activeIndex !== this._lastActive) {
      // Pause the old active, play the new (its FSM queues via wantsToPlay if
      // still loading), then re-apply levels across the registry.
      const old = this._players.get(this._lastActive);
      if (old !== undefined) old.pause();
      this._lastActive = state.activeIndex;
      this._applyIntent(state);
      for (const [index, player] of this._players) {
        player.setLevel(preloadLevelFor(index, state.activeIndex, this._nearRadius));
      }
    } else if (changed.has('userPaused')) {
      // Tap, Space, and Media Session all mutate userPaused; this is the only
      // consumer that touches players.
      this._applyIntent(state);
    }
    // A rebaseActiveIndex notification lands here as a no-op: rebase() already
    // shifted lastActive to match activeIndex, with no userPaused change.
  }

  /**
   * Play or pause the active player per userPaused.
   * @param {AppState} state
   */
  _applyIntent(state) {
    const player = this._players.get(state.activeIndex);
    if (player === undefined) return;
    if (state.userPaused) player.pause();
    else player.play();
  }
}
