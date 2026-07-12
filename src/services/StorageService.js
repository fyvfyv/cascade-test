import { PERSIST_DEBOUNCE_MS } from '../config.js';

/** @typedef {import('../types.js').AppState} AppState */

/** localStorage key: durable preferences (mute, likes). */
const PREFS_KEY = 'cascade-feed:prefs';
/** sessionStorage key: per-tab feed position. */
const POSITION_KEY = 'cascade-feed:position';

/**
 * @param {unknown} value
 * @returns {number} value if it is a non-negative integer, else 0
 */
function sanitizeIndex(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Typed, fail-safe persistence facade. Durable prefs (mute, likes) go to
 * localStorage; feed position goes to sessionStorage (a reload should restore
 * it, a week-old "slide 4713" should not). The first storage throw (Safari
 * private mode, quota) flips the instance to an in-memory fallback for the
 * session — degrades to no persistence, never a crash.
 */
export class StorageService {
  /** @type {Pick<Storage, 'getItem'|'setItem'>} */
  #local;

  /** @type {Pick<Storage, 'getItem'|'setItem'>} */
  #session;

  /** Flipped by the first storage failure; never flipped back this session. */
  #fallback = false;

  /** @type {Map<string, string>} */
  #memLocal = new Map();

  /** @type {Map<string, string>} */
  #memSession = new Map();

  /** @type {number | null} */
  #timer = null;

  /** @type {AppState | null} */
  #pending = null;

  /**
   * @param {Pick<Storage, 'getItem'|'setItem'>} local   — prefs (mute, likes)
   * @param {Pick<Storage, 'getItem'|'setItem'>} session — feed position (per-tab)
   */
  constructor(local, session) {
    this.#local = local;
    this.#session = session;
  }

  /**
   * Autoplay-safe initial state: muted is ALWAYS true here, whatever was
   * persisted; the real preference is re-applied on the first user gesture
   * via `preferredMuted`. Corrupt JSON / missing keys → defaults.
   * @returns {Partial<AppState>}
   */
  loadInitialState() {
    const prefs = this.#readJson(this.#local, this.#memLocal, PREFS_KEY);
    const position = this.#readJson(this.#session, this.#memSession, POSITION_KEY);
    const liked = prefs !== null && Array.isArray(prefs.likedIds) ? prefs.likedIds : [];
    return {
      muted: true,
      likedIds: new Set(liked.filter((id) => typeof id === 'string')),
      activeIndex: sanitizeIndex(position === null ? undefined : position.activeIndex),
    };
  }

  /**
   * The persisted mute preference, re-applied on first user gesture.
   * @returns {boolean}
   */
  get preferredMuted() {
    const prefs = this.#readJson(this.#local, this.#memLocal, PREFS_KEY);
    const muted = prefs === null ? undefined : prefs.muted;
    return typeof muted === 'boolean' ? muted : true;
  }

  /**
   * Debounced internally (PERSIST_DEBOUNCE_MS): scroll bursts coalesce into
   * a single write per storage; the latest state wins.
   * @param {AppState} s
   */
  persist(s) {
    this.#pending = s;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  #flush() {
    const s = this.#pending;
    if (s === null) return;
    this.#pending = null;
    this.#writeJson(this.#local, this.#memLocal, PREFS_KEY, {
      muted: s.muted,
      likedIds: [...s.likedIds],
    });
    this.#writeJson(this.#session, this.#memSession, POSITION_KEY, {
      activeIndex: s.activeIndex,
    });
  }

  /**
   * @param {Pick<Storage, 'getItem'|'setItem'>} store
   * @param {Map<string, string>} mem
   * @param {string} key
   * @returns {Record<string, unknown> | null}
   */
  #readJson(store, mem, key) {
    /** @type {string | null} */
    let raw;
    if (this.#fallback) {
      raw = mem.get(key) ?? null;
    } else {
      try {
        raw = store.getItem(key);
      } catch {
        this.#fallback = true; // degrade to "no persistence", never a crash
        raw = mem.get(key) ?? null;
      }
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null; // corrupt JSON → defaults
    }
  }

  /**
   * Memory always mirrors the latest write, so a mid-session flip loses
   * nothing; after the flip the real storage is never touched again.
   * @param {Pick<Storage, 'getItem'|'setItem'>} store
   * @param {Map<string, string>} mem
   * @param {string} key
   * @param {Record<string, unknown>} value
   */
  #writeJson(store, mem, key, value) {
    const raw = JSON.stringify(value);
    mem.set(key, raw);
    if (this.#fallback) return;
    try {
      store.setItem(key, raw);
    } catch {
      this.#fallback = true; // Safari private mode / quota: silent fallback
    }
  }
}
