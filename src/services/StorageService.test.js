import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageService } from './StorageService.js';
import { PERSIST_DEBOUNCE_MS } from '../config.js';

/** @typedef {import('../types.js').AppState} AppState */

/**
 * In-memory fake for the narrow Storage surface StorageService consumes.
 * @returns {{ storage: Pick<Storage, 'getItem'|'setItem'>,
 *             data: Map<string, string>,
 *             calls: { get: number, set: number } }}
 */
function fakeStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  const calls = { get: 0, set: 0 };
  /** @type {Pick<Storage, 'getItem'|'setItem'>} */
  const storage = {
    getItem(key) {
      calls.get += 1;
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      calls.set += 1;
      data.set(key, value);
    },
  };
  return { storage, data, calls };
}

/**
 * Fake whose setItem always throws (Safari private mode / quota).
 * @returns {{ storage: Pick<Storage, 'getItem'|'setItem'>, calls: { set: number } }}
 */
function quotaStorage() {
  const calls = { set: 0 };
  /** @type {Pick<Storage, 'getItem'|'setItem'>} */
  const storage = {
    getItem: () => null,
    setItem: () => {
      calls.set += 1;
      throw new Error('QuotaExceededError');
    },
  };
  return { storage, calls };
}

/**
 * @param {Partial<AppState>} [overrides]
 * @returns {AppState}
 */
function appState(overrides = {}) {
  /** @type {ReadonlySet<string>} */
  const noLikes = new Set();
  return { activeIndex: 0, muted: true, likedIds: noLikes, userPaused: false, ...overrides };
}

describe('StorageService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadInitialState', () => {
    it('returns autoplay-safe defaults when storage is empty', () => {
      const service = new StorageService(fakeStorage().storage, fakeStorage().storage);
      const state = service.loadInitialState();
      expect(state.muted).toBe(true);
      expect(state.activeIndex).toBe(0);
      expect(state.likedIds).toEqual(new Set());
    });

    it('forces muted: true even when the persisted preference is unmuted', () => {
      const local = fakeStorage();
      const session = fakeStorage();
      const writer = new StorageService(local.storage, session.storage);
      writer.persist(appState({ muted: false }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      const reader = new StorageService(local.storage, session.storage);
      expect(reader.loadInitialState().muted).toBe(true);
    });

    it('round-trips likes and activeIndex written by persist()', () => {
      const local = fakeStorage();
      const session = fakeStorage();
      const writer = new StorageService(local.storage, session.storage);
      writer.persist(appState({ activeIndex: 7, likedIds: new Set(['vid-a', 'vid-c']) }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      const reader = new StorageService(local.storage, session.storage);
      const state = reader.loadInitialState();
      expect(state.activeIndex).toBe(7);
      expect(state.likedIds).toEqual(new Set(['vid-a', 'vid-c']));
    });

    it('returns defaults when both stores hold corrupt JSON', () => {
      /** @type {Pick<Storage, 'getItem'|'setItem'>} */
      const corrupt = { getItem: () => '{not json!!', setItem: () => {} };
      const service = new StorageService(corrupt, corrupt);
      const state = service.loadInitialState();
      expect(state.muted).toBe(true);
      expect(state.activeIndex).toBe(0);
      expect(state.likedIds).toEqual(new Set());
    });

    it('sanitizes a negative persisted activeIndex to 0', () => {
      /** @type {Pick<Storage, 'getItem'|'setItem'>} */
      const seeded = { getItem: () => JSON.stringify({ activeIndex: -3 }), setItem: () => {} };
      const service = new StorageService(fakeStorage().storage, seeded);
      expect(service.loadInitialState().activeIndex).toBe(0);
    });

    it('sanitizes a non-integer persisted activeIndex to 0', () => {
      /** @type {Pick<Storage, 'getItem'|'setItem'>} */
      const seeded = { getItem: () => JSON.stringify({ activeIndex: 2.5 }), setItem: () => {} };
      const service = new StorageService(fakeStorage().storage, seeded);
      expect(service.loadInitialState().activeIndex).toBe(0);
    });

    it('sanitizes a non-number persisted activeIndex to 0', () => {
      /** @type {Pick<Storage, 'getItem'|'setItem'>} */
      const seeded = { getItem: () => JSON.stringify({ activeIndex: '9' }), setItem: () => {} };
      const service = new StorageService(fakeStorage().storage, seeded);
      expect(service.loadInitialState().activeIndex).toBe(0);
    });

    it('returns defaults instead of crashing when getItem throws', () => {
      /** @type {Pick<Storage, 'getItem'|'setItem'>} */
      const hostile = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      };
      const service = new StorageService(hostile, hostile);
      const state = service.loadInitialState();
      expect(state.muted).toBe(true);
      expect(state.activeIndex).toBe(0);
      expect(state.likedIds).toEqual(new Set());
    });
  });

  describe('preferredMuted', () => {
    it('defaults to true when nothing is persisted', () => {
      const service = new StorageService(fakeStorage().storage, fakeStorage().storage);
      expect(service.preferredMuted).toBe(true);
    });

    it('reflects the persisted unmuted preference', () => {
      const local = fakeStorage();
      const session = fakeStorage();
      const writer = new StorageService(local.storage, session.storage);
      writer.persist(appState({ muted: false }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      const reader = new StorageService(local.storage, session.storage);
      expect(reader.preferredMuted).toBe(false);
    });
  });

  describe('persist (debounced by PERSIST_DEBOUNCE_MS)', () => {
    it('writes nothing before PERSIST_DEBOUNCE_MS elapses', () => {
      const local = fakeStorage();
      const session = fakeStorage();
      const service = new StorageService(local.storage, session.storage);
      service.persist(appState());
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      expect(local.calls.set).toBe(0);
      expect(session.calls.set).toBe(0);
    });

    it('coalesces a burst into one write per storage, latest state winning', () => {
      const local = fakeStorage();
      const session = fakeStorage();
      const service = new StorageService(local.storage, session.storage);
      service.persist(appState({ activeIndex: 1 }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      service.persist(appState({ activeIndex: 5 })); // resets the debounce window
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      expect(local.calls.set).toBe(0); // still quiet
      expect(session.calls.set).toBe(0);
      vi.advanceTimersByTime(1); // window elapses
      expect(local.calls.set).toBe(1);
      expect(session.calls.set).toBe(1);
      const reader = new StorageService(local.storage, session.storage);
      expect(reader.loadInitialState().activeIndex).toBe(5);
    });
  });

  describe('in-memory fallback after storage failure', () => {
    it('swallows the first setItem throw instead of crashing', () => {
      const local = quotaStorage();
      const service = new StorageService(local.storage, fakeStorage().storage);
      service.persist(appState({ muted: false }));
      expect(() => vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)).not.toThrow();
      expect(local.calls.set).toBe(1);
    });

    it('never touches the throwing storage again after the flip', () => {
      const local = quotaStorage();
      const service = new StorageService(local.storage, fakeStorage().storage);
      service.persist(appState({ muted: false }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      service.persist(appState({ muted: true }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      expect(local.calls.set).toBe(1); // only the first, throwing, attempt
    });

    it('serves persisted values from memory after the flip', () => {
      const local = quotaStorage();
      const service = new StorageService(local.storage, fakeStorage().storage);
      service.persist(appState({ muted: false, likedIds: new Set(['vid-b']) }));
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      expect(service.preferredMuted).toBe(false); // read back from memory
      expect(service.loadInitialState().likedIds).toEqual(new Set(['vid-b']));
      expect(service.loadInitialState().muted).toBe(true); // first-load policy still holds
    });
  });
});
