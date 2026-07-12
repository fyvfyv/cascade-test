/**
 * The one shared Web Audio context for the whole feed.
 *
 * Toggling `el.muted`/`el.volume` on a playing <video> makes Chromium
 * re-negotiate the a/v pipeline and jump currentTime by ~0.15 s (Chrome only;
 * Safari is unaffected). Changing gain in a Web Audio graph never touches the
 * element, so VideoPlayer routes through a GainNode here and mutes by gain.
 *
 * One context serves all 5 pooled players (browsers cap concurrent contexts),
 * created and resumed lazily on the first audible-playback request — which the
 * app only issues inside a user gesture (AudioContext autoplay policy), so a
 * silent-scrolling session never spins up an audio graph.
 */

/** @returns {(typeof AudioContext) | null} */
function resolveAudioCtx() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext ?? null;
}

export class AudioMixer {
  /**
   * @param {(typeof AudioContext) | null} [AudioCtx] Injectable for tests;
   *   defaults to the platform AudioContext (webkit-prefixed fallback).
   */
  constructor(AudioCtx) {
    /** @type {(typeof AudioContext) | null} */
    this._Ctor = AudioCtx ?? resolveAudioCtx();
    /** @type {AudioContext | null} */
    this._ctx = null;
  }

  /**
   * Lazily creates and resumes the shared context; idempotent. The first call
   * must happen inside a user gesture (AudioContext autoplay policy).
   * @returns {AudioContext | null} null when Web Audio is unavailable.
   */
  engage() {
    if (this._Ctor === null) return null;
    if (this._ctx === null) this._ctx = new this._Ctor();
    if (this._ctx.state === 'suspended') void this._ctx.resume();
    return this._ctx;
  }
}
