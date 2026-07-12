import { describe, expect, it } from 'vitest';
import { FeedStore } from '../core/FeedStore.js';
import { PlaybackCoordinator } from './PlaybackCoordinator.js';

/** @typedef {import('../types.js').PlayerLike} PlayerLike */
/** @typedef {import('../types.js').PlayerState} PlayerState */

/**
 * PlayerLike fake as a plain object literal: records every call in order and
 * models just enough state for getState(). "Wants to play" ⇔ its last intent
 * was play, mirroring the real FSM's wantsToPlay.
 */
function makeFake() {
  /** @type {string[]} */
  const calls = [];
  /** @type {PlayerState} */
  let state = 'idle';
  /** @type {PlayerLike} */
  const player = {
    play() {
      calls.push('play');
      state = 'playing';
    },
    pause() {
      calls.push('pause');
      state = 'paused';
    },
    setMuted(m) {
      calls.push(`muted:${m}`);
    },
    setLevel(l) {
      calls.push(`level:${l}`);
    },
    getState() {
      return state;
    },
  };
  return {
    player,
    calls,
    wantsToPlay: () => state === 'playing',
    /** Last applied preload level, or undefined if none yet. */
    lastLevel: () => {
      const entry = [...calls].reverse().find((c) => c.startsWith('level:'));
      return entry === undefined ? undefined : entry.slice('level:'.length);
    },
  };
}

/** @typedef {ReturnType<typeof makeFake>} Fake */

/**
 * Post-condition asserted after every step of the sequence test: attached
 * keys === expected window indices; exactly one player wants to play (zero
 * when userPaused).
 * @param {Map<number, Fake>} attached test-side mirror of the registry
 * @param {number[]} windowIndices expected keys, ascending
 * @param {number | null} playingIndex null ⇒ zero playing
 */
function expectPostCondition(attached, windowIndices, playingIndex) {
  expect([...attached.keys()].sort((a, b) => a - b)).toEqual(windowIndices);
  const playing = [...attached.entries()].filter(([, fake]) => fake.wantsToPlay()).map(([index]) => index);
  expect(playing).toEqual(playingIndex === null ? [] : [playingIndex]);
}

/** Standard rig: five players attached at 0..4, active 0 (store defaults). */
function rig() {
  const store = new FeedStore();
  const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
  const fakes = [makeFake(), makeFake(), makeFake(), makeFake(), makeFake()];
  fakes.forEach((fake, index) => {
    coordinator.attach(index, fake.player);
  });
  return { store, coordinator, fakes };
}

describe('PlaybackCoordinator.attach', () => {
  it('synchronously applies level, mute, then play-intent for the active index', () => {
    const store = new FeedStore(); // activeIndex 0, muted true
    const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
    const fake = makeFake();
    coordinator.attach(0, fake.player);
    expect(fake.calls).toEqual(['level:active', 'muted:true', 'play']);
  });

  it('applies level and mute but never play-intent for non-active indices', () => {
    const store = new FeedStore();
    const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
    const near = makeFake();
    const far = makeFake();
    coordinator.attach(1, near.player);
    coordinator.attach(2, far.player);
    expect(near.calls).toEqual(['level:near', 'muted:true']);
    expect(far.calls).toEqual(['level:far', 'muted:true']);
  });

  it('does not play the active player while userPaused', () => {
    const store = new FeedStore();
    const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
    store.setUserPaused(true);
    const fake = makeFake();
    coordinator.attach(0, fake.player);
    expect(fake.calls).toEqual(['level:active', 'muted:true']);
  });
});

describe('exactly one playing across active changes', () => {
  it('pauses the old active and plays the new active on every change', () => {
    const { store, fakes } = rig();
    expect(fakes.map((f) => f.wantsToPlay())).toEqual([true, false, false, false, false]);
    store.setActiveIndex(1);
    expect(fakes.map((f) => f.wantsToPlay())).toEqual([false, true, false, false, false]);
    store.setActiveIndex(2);
    expect(fakes.map((f) => f.wantsToPlay())).toEqual([false, false, true, false, false]);
    store.setActiveIndex(1); // reversal — users bounce back constantly
    expect(fakes.map((f) => f.wantsToPlay())).toEqual([false, true, false, false, false]);
  });
});

describe('levels and mute', () => {
  it('re-applies preload levels to every attached player on a move', () => {
    const { store, fakes } = rig();
    store.setActiveIndex(2);
    expect(fakes.map((f) => f.lastLevel())).toEqual(['far', 'near', 'active', 'near', 'far']);
  });

  it('fans a mute change out to all attached players', () => {
    const { store, fakes } = rig();
    store.toggleMute(); // true → false
    for (const fake of fakes) {
      expect(fake.calls[fake.calls.length - 1]).toBe('muted:false');
    }
  });
});

describe('userPaused', () => {
  it('pauses the active player on userPaused and resumes on unpause', () => {
    const { store, fakes } = rig();
    store.setUserPaused(true);
    expect(fakes[0].wantsToPlay()).toBe(false);
    store.setUserPaused(false);
    expect(fakes[0].wantsToPlay()).toBe(true);
  });
});

describe('detach', () => {
  it('forgets the player without releasing it — no further calls ever', () => {
    const { store, coordinator, fakes } = rig();
    coordinator.detach(1);
    const callCount = fakes[1].calls.length;
    store.setActiveIndex(1); // the detached player must NOT be played…
    store.toggleMute(); // …nor re-muted
    expect(fakes[1].calls.length).toBe(callCount);
    // detach issued nothing: release is FeedView's job and happens after detach.
  });
});

describe('suspend/resume (Page Visibility policy)', () => {
  it('resume re-plays a policy pause', () => {
    const { coordinator, fakes } = rig(); // fake 0 is playing
    coordinator.suspend();
    expect(fakes[0].wantsToPlay()).toBe(false);
    coordinator.resume();
    expect(fakes[0].wantsToPlay()).toBe(true);
  });

  it('resume never undoes a user pause', () => {
    const { store, coordinator, fakes } = rig();
    store.setUserPaused(true); // user pause — active is now 'paused'
    coordinator.suspend(); // not playing/buffering ⇒ NOT our pause
    coordinator.resume();
    expect(fakes[0].wantsToPlay()).toBe(false);
  });

  it('resume stays paused when the user paused while suspended', () => {
    const { store, coordinator, fakes } = rig();
    coordinator.suspend(); // policy pause
    store.setUserPaused(true); // user pauses while hidden
    coordinator.resume(); // pause was ours, but !userPaused fails
    expect(fakes[0].wantsToPlay()).toBe(false);
  });
});

describe('rebase', () => {
  it('shifts registry keys so the rebaseActiveIndex notification is a pure no-op', () => {
    const store = new FeedStore({ activeIndex: 22 });
    const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
    /** @type {Fake[]} */
    const fakes = [];
    for (let index = 20; index <= 24; index++) {
      const fake = makeFake();
      fakes.push(fake);
      coordinator.attach(index, fake.player);
    }
    expect(fakes[2].wantsToPlay()).toBe(true); // 22 is active

    coordinator.rebase(11); // keys 20..24 → 9..13; lastActive 22 → 11
    const counts = fakes.map((fake) => fake.calls.length);
    store.rebaseActiveIndex(11); // activeIndex 22 → 11 — already equals lastActive
    expect(fakes.map((fake) => fake.calls.length)).toEqual(counts); // pure no-op

    // The registry really is rekeyed: moving to 12 plays the player that
    // was attached at 23 and pauses the one that was attached at 22.
    store.setActiveIndex(12);
    expect(fakes[3].wantsToPlay()).toBe(true);
    expect(fakes[2].wantsToPlay()).toBe(false);
  });
});

describe('sequence: the FeedView ordering contract', () => {
  it('replays the production call order and holds the post-condition after every step', () => {
    const store = new FeedStore(); // boot: activeIndex 0, userPaused false
    const coordinator = new PlaybackCoordinator(store, { nearRadius: 1 });
    /** @type {Map<number, Fake>} */
    const attached = new Map(); // test-side mirror of the registry, keyed like it

    /**
     * bind-then-attach: creating the fake stands in for SlideView.bind, so
     * attach always acts on a bound player.
     * @param {number} index
     */
    const bindAndAttach = (index) => {
      const fake = makeFake();
      attached.set(index, fake);
      coordinator.attach(index, fake.player);
      return fake;
    };
    /**
     * detach-then-unbind: the coordinator is told first, so the release that
     * follows can never reach a player it still holds.
     * @param {number} index
     */
    const detach = (index) => {
      coordinator.detach(index);
      attached.delete(index);
    };

    // BOOT — FeedView._applyWindow(0): window [0, 1, 2] (active ± 2, clamped at 0).
    const f0 = bindAndAttach(0);
    expectPostCondition(attached, [0], 0); // the active plays the instant it attaches
    bindAndAttach(1);
    expectPostCondition(attached, [0, 1], 0);
    bindAndAttach(2);
    expectPostCondition(attached, [0, 1, 2], 0);

    // SWIPE to 1 — the coordinator reacts synchronously INSIDE
    // setActiveIndex (it subscribed first, before FeedView shifts the window):
    store.setActiveIndex(1);
    expectPostCondition(attached, [0, 1, 2], 1);
    // …then FeedView's window shift for active 1: enter [3].
    bindAndAttach(3);
    expectPostCondition(attached, [0, 1, 2, 3], 1);

    // SWIPE to 2: enter [4].
    store.setActiveIndex(2);
    expectPostCondition(attached, [0, 1, 2, 3], 2);
    bindAndAttach(4);
    expectPostCondition(attached, [0, 1, 2, 3, 4], 2);

    // SWIPE to 3: exit [0] (detach BEFORE unbind), enter [5] (bind BEFORE attach).
    store.setActiveIndex(3);
    expectPostCondition(attached, [0, 1, 2, 3, 4], 3);
    detach(0);
    const f0Calls = f0.calls.length;
    expectPostCondition(attached, [1, 2, 3, 4], 3);
    bindAndAttach(5);
    expectPostCondition(attached, [1, 2, 3, 4, 5], 3);

    // USER PAUSE: zero attached players want to play.
    store.setUserPaused(true);
    expectPostCondition(attached, [1, 2, 3, 4, 5], null);

    // SWIPE to 4 (setActiveIndex resets userPaused — a new slide autoplays):
    store.setActiveIndex(4);
    expectPostCondition(attached, [1, 2, 3, 4, 5], 4);
    detach(1);
    bindAndAttach(6);
    expectPostCondition(attached, [2, 3, 4, 5, 6], 4);

    // Preload ladder for the final window around active 4:
    expect([...attached.entries()].map(([i, f]) => [i, f.lastLevel()])).toEqual([
      [2, 'far'],
      [3, 'near'],
      [4, 'active'],
      [5, 'near'],
      [6, 'far'],
    ]);

    // The player detached at "swipe to 3" never heard another word:
    expect(f0.calls.length).toBe(f0Calls);
  });
});
