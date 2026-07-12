import { describe, expect, it } from 'vitest';
import { FeedStore } from './FeedStore.js';

describe('FeedStore state', () => {
  it('defaults: index 0, muted, no likes, not paused', () => {
    expect(new FeedStore().getState()).toEqual({
      activeIndex: 0,
      muted: true,
      likedIds: new Set(),
      userPaused: false,
    });
  });

  it('accepts partial initial state', () => {
    const s = new FeedStore({ activeIndex: 4, likedIds: new Set(['a']) }).getState();
    expect(s.activeIndex).toBe(4);
    expect(s.likedIds.has('a')).toBe(true);
    expect(s.muted).toBe(true); // untouched defaults survive
    expect(s.userPaused).toBe(false);
  });
});

describe('FeedStore notifications', () => {
  it('notifies synchronously with the changed-key set', () => {
    const store = new FeedStore();
    /** @type {Array<{ index: number, changed: Array<keyof import('../types.js').AppState> }>} */
    const calls = [];
    store.subscribe((s, changed) => {
      calls.push({ index: s.activeIndex, changed: [...changed] });
    });
    store.setActiveIndex(3);
    // Synchronous: already recorded by the time setActiveIndex returned.
    expect(calls).toEqual([{ index: 3, changed: ['activeIndex'] }]);
  });

  it('notifies subscribers in subscription order', () => {
    const store = new FeedStore();
    /** @type {string[]} */
    const order = [];
    store.subscribe(() => {
      order.push('first');
    });
    store.subscribe(() => {
      order.push('second');
    });
    store.toggleMute();
    expect(order).toEqual(['first', 'second']);
  });

  it('unsubscribe stops notifications', () => {
    const store = new FeedStore();
    let a = 0;
    let b = 0;
    const unsub = store.subscribe(() => {
      a += 1;
    });
    store.subscribe(() => {
      b += 1;
    });
    store.toggleMute();
    unsub();
    store.toggleMute();
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});

describe('setActiveIndex / rebaseActiveIndex', () => {
  it('setActiveIndex resets userPaused (a new slide always autoplays)', () => {
    const store = new FeedStore();
    store.setUserPaused(true);
    /** @type {string[][]} */
    const changedSets = [];
    store.subscribe((_s, changed) => {
      changedSets.push([...changed].sort());
    });
    store.setActiveIndex(1);
    expect(store.getState().userPaused).toBe(false);
    expect(changedSets).toEqual([['activeIndex', 'userPaused']]);
  });

  it('setActiveIndex to the same index with userPaused false does not notify', () => {
    const store = new FeedStore({ activeIndex: 2 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setActiveIndex(2);
    expect(calls).toBe(0);
  });

  it('rebaseActiveIndex shifts by -delta and does NOT reset userPaused', () => {
    const store = new FeedStore({ activeIndex: 20005 });
    store.setUserPaused(true);
    /** @type {string[][]} */
    const changedSets = [];
    store.subscribe((_s, changed) => {
      changedSets.push([...changed]);
    });
    store.rebaseActiveIndex(19910);
    expect(store.getState().activeIndex).toBe(95);
    expect(store.getState().userPaused).toBe(true); // survives the rebase
    expect(changedSets).toEqual([['activeIndex']]); // notifies normally (persistence)
  });
});

describe('mute', () => {
  it('toggleMute flips and notifies', () => {
    const store = new FeedStore(); // muted: true
    /** @type {boolean[]} */
    const seen = [];
    store.subscribe((s) => {
      seen.push(s.muted);
    });
    store.toggleMute();
    store.toggleMute();
    expect(seen).toEqual([false, true]);
    expect(store.getState().muted).toBe(true);
  });

  it('setMuted is idempotent: same value does not notify', () => {
    const store = new FeedStore(); // muted: true
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setMuted(true);
    expect(calls).toBe(0);
    store.setMuted(false);
    expect(calls).toBe(1);
    expect(store.getState().muted).toBe(false);
  });
});

describe('likes', () => {
  it('toggleLike is keyed by video id and toggles membership', () => {
    const store = new FeedStore();
    store.toggleLike('vid-7');
    expect(store.getState().likedIds.has('vid-7')).toBe(true);
    store.toggleLike('vid-7');
    expect(store.getState().likedIds.has('vid-7')).toBe(false);
  });

  it('is copy-on-write: previously handed-out sets are never mutated', () => {
    const store = new FeedStore();
    const before = store.getState().likedIds;
    store.toggleLike('vid-7');
    const after = store.getState().likedIds;
    expect(before.has('vid-7')).toBe(false); // old snapshot untouched
    expect(after.has('vid-7')).toBe(true);
    expect(after).not.toBe(before); // a new Set instance
  });
});

describe('userPaused', () => {
  it('setUserPaused updates and skips no-op notifications', () => {
    const store = new FeedStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setUserPaused(false); // already false
    expect(calls).toBe(0);
    store.setUserPaused(true);
    expect(calls).toBe(1);
    expect(store.getState().userPaused).toBe(true);
  });
});
