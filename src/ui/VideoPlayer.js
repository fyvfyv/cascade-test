import { AUTO_RETRY_DELAY_MS } from '../config.js';

/** @typedef {import('../types.js').FeedItem} FeedItem */
/** @typedef {import('../types.js').PreloadLevel} PreloadLevel */
/** @typedef {import('../types.js').PlayerState} PlayerState */
/** @typedef {import('../core/PlayerStateMachine.js').PlayerStateMachine} PlayerStateMachine */
/** @typedef {import('../core/PlayerStateMachine.js').PlayerEvent} PlayerEvent */
/** @typedef {import('../core/PlayerStateMachine.js').PlayerEffect} PlayerEffect */
/** @typedef {import('../services/AudioMixer.js').AudioMixer} AudioMixer */

/**
 * The only class that touches HTMLVideoElement. Deliberately dumb: media events
 * in → FSM → effects out. Every DOM playback call (play, pause, src attach/detach)
 * happens exclusively as an FSM effect in _runEffect; the public play()/pause()
 * are intents. Platform hazards (stale play() settlements, autoplay-policy mutes,
 * external-pause reconciliation, transient media errors) are handled here and
 * only here — see the individual methods.
 */
export class VideoPlayer {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {PlayerStateMachine} fsm
   * @param {AudioMixer} [mixer] Shared Web Audio context for hitch-free muting.
   *   Without it — or where Web Audio is unavailable — muting falls back to el.muted.
   */
  constructor(videoEl, fsm, mixer) {
    this._el = videoEl;
    this._fsm = fsm;
    /** @type {AudioMixer | undefined} */
    this._mixer = mixer;
    /**
     * GainNode controlling audibility once Web Audio is engaged; null until then
     * (and permanently on the el.muted fallback). Non-null ⇒ el.muted stays false
     * and mute = gain 0, avoiding the pipeline resync.
     * @type {GainNode | null}
     */
    this._gain = null;
    /** Engagement attempted and failed — latched so it is never retried. */
    this._audioFailed = false;
    /**
     * Binding generation, bumped by bind() and release(). Every async settlement
     * (play() promise, auto-retry timer) captures it and bails if it has moved,
     * so a settlement from a previous binding never touches the current one.
     */
    this._generation = 0;
    /** Current src WITH the #t=0.001 fragment; '' while unbound. */
    this._src = '';
    /** One automatic error retry per binding generation. */
    this._autoRetried = false;
    /**
     * Armed by our own call-pause effect so the permanent 'pause' listener can
     * tell external pauses (iOS backgrounding, PiP, calls) from ours — only
     * external ones become the 'media-pause' fact.
     */
    this._expectedPause = false;
    /** @type {Set<(s: PlayerState) => void>} */
    this._stateCbs = new Set();
    /** @type {Set<() => void>} */
    this._autoMutedCbs = new Set();

    // Set both property and attribute: free insurance for iOS/Chrome autoplay
    // checks, and correct on any bare element even without the template attrs.
    videoEl.muted = true;
    videoEl.setAttribute('muted', '');
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.loop = true; // TikTok semantics — no 'ended' branch to handle
    videoEl.setAttribute('loop', '');

    // All media listeners attached once, permanently. Permanent listeners plus
    // the load() reset on every bind make the "state advanced before listeners
    // attached" race structurally impossible — no readyState polling.
    videoEl.addEventListener('canplay', () => this._dispatch('canplay'));
    videoEl.addEventListener('playing', () => this._dispatch('media-playing'));
    videoEl.addEventListener('waiting', () => this._dispatch('media-waiting'));
    videoEl.addEventListener('pause', () => {
      if (this._expectedPause) {
        this._expectedPause = false; // our own call-pause — not a fact to report
        return;
      }
      this._dispatch('media-pause'); // external pause — reconcile to reality
    });
    videoEl.addEventListener('error', () => this._onMediaError());
  }

  /**
   * New binding: fresh generation (stale settlements discarded), fresh auto-retry
   * budget, then the FSM's attach-src effect sets src + load(). The #t=0.001 media
   * fragment defeats Safari's black first frame on preload='metadata';
   * imperceptible with loop=true.
   * @param {FeedItem} item
   */
  bind(item) {
    this._generation += 1;
    this._autoRetried = false;
    this._src = `${item.video.src}#t=0.001`;
    this._dispatch('bind');
  }

  /**
   * Canonical decoder/memory release. Net DOM sequence via the FSM's
   * [call-pause, detach-src] effects: pause(); removeAttribute('src'); load() —
   * resets to NETWORK_EMPTY without firing a bogus error event (src = '' would
   * request the page URL).
   */
  release() {
    this._generation += 1;
    this._autoRetried = false;
    this._src = '';
    this._dispatch('release');
  }

  /**
   * Preload ladder: 'active' and 'near' warm the buffer; 'far' keeps dimensions
   * and duration only.
   * @param {PreloadLevel} l
   */
  setLevel(l) {
    this._el.preload = l === 'far' ? 'metadata' : 'auto';
  }

  /** Play INTENT — the DOM play() call happens only as an FSM effect. */
  play() {
    this._dispatch('play-intent');
  }

  /** Pause INTENT — the DOM pause() call happens only as an FSM effect. */
  pause() {
    this._dispatch('pause-intent');
  }

  /**
   * Mute/unmute without the Chrome playback hitch: toggling el.muted/el.volume on
   * a playing <video> makes Chromium re-sync the a/v pipeline and jump currentTime
   * ~0.15 s (Chrome-only). So once sound is first wanted we engage a Web Audio
   * GainNode and control audibility by gain, never touching el.muted again. Before
   * that, and where Web Audio is unavailable, we fall back to el.muted.
   * @param {boolean} m
   */
  setMuted(m) {
    if (this._gain !== null) {
      this._gain.gain.value = m ? 0 : 1; // engaged: smooth, no pipeline resync
      return;
    }
    if (!m) {
      const gain = this._engageAudio();
      if (gain !== null) {
        gain.gain.value = 1;
        return;
      }
    }
    // Pre-engagement, or no Web Audio support: element-level mute.
    this._el.muted = m;
    if (m) this._el.setAttribute('muted', '');
    else this._el.removeAttribute('muted');
  }

  /**
   * One-time Web Audio engagement (idempotent). Routes this element through a
   * GainNode on the shared context and flips el.muted → false — the single
   * expected ~0.15 s hitch, after which every toggle is gain-only. Runs inside a
   * user gesture (the only origin of an unmute), so the context's first resume()
   * is gesture-authorised. Returns null, leaving el.muted control in place, when
   * there is no mixer, no Web Audio support, or createMediaElementSource throws.
   * @returns {GainNode | null}
   */
  _engageAudio() {
    if (this._gain !== null) return this._gain;
    if (this._audioFailed || this._mixer === undefined) return null;
    const ctx = this._mixer.engage();
    if (ctx === null) {
      this._audioFailed = true;
      return null;
    }
    try {
      const source = ctx.createMediaElementSource(this._el);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      this._gain = gain;
    } catch {
      this._audioFailed = true; // createMediaElementSource can throw — keep el.muted
      return null;
    }
    this._el.muted = false;
    this._el.removeAttribute('muted');
    return this._gain;
  }

  /**
   * Retry button path: error + retry-intent → loading with [detach-src,
   * attach-src] — a genuinely fresh attempt, not a hopeful play().
   */
  retry() {
    this._dispatch('retry-intent');
  }

  /**
   * Scrub target. No-op until metadata is loaded.
   * @param {number} f fraction of duration, clamped to [0, 1]
   */
  seekToFraction(f) {
    const d = this._el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    this._el.currentTime = Math.min(Math.max(f, 0), 1) * d;
  }

  /** @returns {{ currentTime: number, duration: number }} */
  getProgress() {
    const d = this._el.duration;
    return { currentTime: this._el.currentTime, duration: Number.isFinite(d) ? d : 0 };
  }

  /** @returns {PlayerState} */
  getState() {
    return this._fsm.state;
  }

  /** @returns {boolean} */
  get wantsToPlay() {
    return this._fsm.wantsToPlay;
  }

  /**
   * Per-player state fan-out to the one consumer (SlideView) — deliberately not
   * routed through the store.
   * @param {(s: PlayerState) => void} cb
   * @returns {() => void} unsubscribe
   */
  onStateChange(cb) {
    this._stateCbs.add(cb);
    return () => this._stateCbs.delete(cb);
  }

  /**
   * Fired when autoplay policy forced a mute. main.js wires this to
   * store.setMuted(true) so the mute icon and all players stay truthful.
   * @param {() => void} cb
   * @returns {() => void} unsubscribe
   */
  onAutoMuted(cb) {
    this._autoMutedCbs.add(cb);
    return () => this._autoMutedCbs.delete(cb);
  }

  /**
   * Route an event through the FSM and execute the returned effects — the FSM is
   * the only decision-maker.
   * @param {PlayerEvent} event
   */
  _dispatch(event) {
    const effects = this._fsm.dispatch(event);
    if (effects === null) {
      // Invalid (state, event) pair: late media-event noise, absorbed
      // structurally. Dev-only visibility, never a throw.
      if (import.meta.env.DEV) {
        console.warn(`[VideoPlayer] ignored '${event}' in state '${this._fsm.state}'`);
      }
      return;
    }
    for (const effect of effects) this._runEffect(effect);
    for (const cb of this._stateCbs) cb(this._fsm.state);
  }

  /** @param {PlayerEffect} effect */
  _runEffect(effect) {
    switch (effect) {
      case 'attach-src':
        this._el.src = this._src;
        this._el.load();
        break;
      case 'detach-src':
        // removeAttribute + load(), never src = '' (which would request the page URL).
        this._el.removeAttribute('src');
        this._el.load();
        break;
      case 'call-play':
        this._callPlay();
        break;
      case 'call-pause':
        // pause() on an already-paused element fires no event — only arm
        // the external-pause filter when an event will actually follow.
        if (!this._el.paused) this._expectedPause = true;
        this._el.pause();
        break;
    }
  }

  /**
   * The one place el.play() is called. Two stale-settlement mechanisms, both
   * required: the generation counter discards settlements from a previous binding
   * (fast swiping interleaves bind/release with in-flight promises, and a stale
   * NotAllowedError must not mute or pause the new binding); AbortError is
   * swallowed by name because a same-generation load()/pause() can still interrupt
   * an in-flight play() (Chrome's "play() interrupted" case) — our own action, not
   * an error. Neither check catches the other's case, hence both.
   */
  _callPlay() {
    const gen = this._generation;
    this._el.play().catch((err) => {
      if (gen !== this._generation) return; // stale settlement from a previous binding
      if (!(err instanceof Error)) return;
      if (err.name === 'AbortError') return; // same-generation load()/pause() race — ours
      if (err.name === 'NotAllowedError') {
        if (!this._el.muted) {
          // Autoplay policy blocked unmuted playback: mute, retry once, and tell
          // the app via onAutoMuted so the mute icon and other players stay truthful.
          this.setMuted(true);
          this._callPlay();
          for (const cb of this._autoMutedCbs) cb();
        } else {
          // Muted and still blocked: iOS Low Power Mode / Data Saver, undetectable
          // directly. Reconcile to a clean paused state with the tap-to-play glyph;
          // the tap is a gesture, so play() inside it succeeds.
          this._dispatch('pause-intent');
        }
      }
      // Anything else: fatal problems arrive via the media 'error' event
      // (video.error), handled in _onMediaError.
    });
  }

  /**
   * Media 'error' event. Transient failures (MEDIA_ERR_NETWORK, MEDIA_ERR_DECODE)
   * get one automatic retry per binding generation after AUTO_RETRY_DELAY_MS,
   * before any UI surfaces: 'media-error' and 'retry-intent' are dispatched
   * back-to-back in the same synchronous task, so no error panel paints in between.
   * MEDIA_ERR_SRC_NOT_SUPPORTED, and a spent retry budget, surface immediately —
   * retrying cannot fix a bad file.
   */
  _onMediaError() {
    const err = this._el.error;
    const transient =
      err !== null && (err.code === MediaError.MEDIA_ERR_NETWORK || err.code === MediaError.MEDIA_ERR_DECODE);
    if (transient && !this._autoRetried) {
      this._autoRetried = true;
      const gen = this._generation;
      setTimeout(() => {
        if (gen !== this._generation) return; // rebound/released since — stale
        this._dispatch('media-error'); // enter 'error'…
        this._dispatch('retry-intent'); // …and leave it before anything paints
      }, AUTO_RETRY_DELAY_MS);
      return;
    }
    this._dispatch('media-error'); // surface: SlideView shows the panel + Retry
  }
}

// Structural conformance: typecheck fails if VideoPlayer drifts from PlayerLike. Zero-runtime.
/** @type {(p: VideoPlayer) => import('../types.js').PlayerLike} */
const toPlayerLike = (p) => p;
void toPlayerLike;
