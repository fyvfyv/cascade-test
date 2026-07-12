import { describe, it, expect } from 'vitest';
import { PlayerStateMachine } from './PlayerStateMachine.js';

/** @typedef {import('../types.js').PlayerState} PlayerState */
/** @typedef {import('./PlayerStateMachine.js').PlayerEvent} PlayerEvent */
/** @typedef {import('./PlayerStateMachine.js').PlayerEffect} PlayerEffect */

/** @type {ReadonlyArray<PlayerState>} */
const STATES = ['idle', 'loading', 'ready', 'playing', 'buffering', 'paused', 'error'];

/** @type {ReadonlyArray<PlayerEvent>} */
const EVENTS = [
  'bind',
  'canplay',
  'play-intent',
  'pause-intent',
  'media-playing',
  'media-waiting',
  'media-pause',
  'media-error',
  'retry-intent',
  'release',
];

/**
 * Real-transition paths that drive a fresh machine into each state — no
 * internal poking, so the fixtures themselves exercise table rows.
 * @type {Record<PlayerState, PlayerEvent[]>}
 */
const PATH = {
  idle: [],
  loading: ['bind'],
  ready: ['bind', 'canplay'],
  playing: ['bind', 'play-intent', 'canplay', 'media-playing'],
  buffering: ['bind', 'play-intent', 'canplay', 'media-playing', 'media-waiting'],
  paused: ['bind', 'play-intent', 'canplay', 'media-playing', 'pause-intent'],
  error: ['bind', 'media-error'],
};

/**
 * @param {PlayerState} state
 * @returns {PlayerStateMachine}
 */
function machineIn(state) {
  const m = new PlayerStateMachine();
  for (const event of PATH[state]) m.dispatch(event);
  return m;
}

/**
 * The transition table, verbatim. Key: `<state> <event>`.
 * `wants` = expected wantsToPlay AFTER the event; omitted = unchanged.
 * Pairs missing from this map are invalid and must return null.
 * NOTE 'loading canplay' expects [] here because the walk fixture never
 * queued a play-intent (wantsToPlay === false); the call-play-iff-queued
 * branch is asserted in the "queued autoplay" scenario below.
 * @type {Record<string, { next: PlayerState, effects: PlayerEffect[], wants?: boolean }>}
 */
const TABLE = {
  'idle bind': { next: 'loading', effects: ['attach-src'] },
  'loading play-intent': { next: 'loading', effects: [], wants: true },
  'loading pause-intent': { next: 'loading', effects: [], wants: false },
  'loading canplay': { next: 'ready', effects: [] },
  'ready play-intent': { next: 'ready', effects: ['call-play'], wants: true },
  'ready pause-intent': { next: 'ready', effects: [], wants: false },
  'ready media-playing': { next: 'playing', effects: [] },
  'playing play-intent': { next: 'playing', effects: [] },
  'playing pause-intent': { next: 'paused', effects: ['call-pause'], wants: false },
  'playing media-waiting': { next: 'buffering', effects: [] },
  'playing media-pause': { next: 'paused', effects: [], wants: false },
  'buffering media-playing': { next: 'playing', effects: [] },
  'buffering play-intent': { next: 'buffering', effects: [] },
  'buffering pause-intent': { next: 'paused', effects: ['call-pause'], wants: false },
  'buffering media-pause': { next: 'paused', effects: [], wants: false },
  'paused play-intent': { next: 'paused', effects: ['call-play'], wants: true },
  'paused pause-intent': { next: 'paused', effects: [] },
  'paused media-playing': { next: 'playing', effects: [] },
  'error retry-intent': { next: 'loading', effects: ['detach-src', 'attach-src'] },
};
// Universal rows: 'release' from ANY state; 'media-error' from any state ≠ idle.
for (const state of STATES) {
  TABLE[`${state} release`] = { next: 'idle', effects: ['call-pause', 'detach-src'], wants: false };
  if (state !== 'idle') TABLE[`${state} media-error`] = { next: 'error', effects: [] };
}

describe('PlayerStateMachine', () => {
  describe('initial state', () => {
    it('starts idle with wantsToPlay === false', () => {
      const m = new PlayerStateMachine();
      expect(m.state).toBe('idle');
      expect(m.wantsToPlay).toBe(false);
    });
  });

  describe('fixture paths', () => {
    for (const state of STATES) {
      it(`drives a fresh machine to ${state}`, () => {
        expect(machineIn(state).state).toBe(state);
      });
    }
  });

  describe('full table walk: 7 states × 10 events', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const row = TABLE[`${state} ${event}`];
        if (row) {
          it(`${state} + ${event} → ${row.next} [${row.effects.join(', ')}]`, () => {
            const m = machineIn(state);
            const wantsBefore = m.wantsToPlay;
            expect(m.dispatch(event)).toEqual(row.effects);
            expect(m.state).toBe(row.next);
            expect(m.wantsToPlay).toBe(row.wants ?? wantsBefore);
          });
        } else {
          it(`${state} + ${event} → null (invalid pair; state unchanged)`, () => {
            const m = machineIn(state);
            const wantsBefore = m.wantsToPlay;
            expect(m.dispatch(event)).toBeNull();
            expect(m.state).toBe(state);
            expect(m.wantsToPlay).toBe(wantsBefore);
          });
        }
      }
    }
  });

  describe('queued autoplay', () => {
    it('play-intent while loading queues; canplay then emits call-play', () => {
      const m = new PlayerStateMachine();
      m.dispatch('bind');
      expect(m.dispatch('play-intent')).toEqual([]);
      expect(m.state).toBe('loading');
      expect(m.wantsToPlay).toBe(true);
      expect(m.dispatch('canplay')).toEqual(['call-play']);
      expect(m.state).toBe('ready');
    });

    it('pause-intent while loading cancels the queue (user swiped past)', () => {
      const m = new PlayerStateMachine();
      m.dispatch('bind');
      m.dispatch('play-intent');
      expect(m.dispatch('pause-intent')).toEqual([]);
      expect(m.wantsToPlay).toBe(false);
      expect(m.dispatch('canplay')).toEqual([]); // no call-play — queue canceled
      expect(m.state).toBe('ready');
    });
  });

  describe('media-pause reconciliation (browser paused behind our back)', () => {
    it('playing + media-pause → paused with no effects and wantsToPlay === false', () => {
      const m = machineIn('playing');
      expect(m.wantsToPlay).toBe(true);
      expect(m.dispatch('media-pause')).toEqual([]);
      expect(m.state).toBe('paused');
      expect(m.wantsToPlay).toBe(false);
    });
  });
});
