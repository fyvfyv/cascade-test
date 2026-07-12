import { describe, expect, it } from 'vitest';
import { AudioMixer } from './AudioMixer.js';

/** Minimal fake AudioContext constructor: records instances + resume() calls. */
function makeFakeCtx() {
  /** @type {any[]} */
  const instances = [];
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.resumeCount = 0;
      instances.push(this);
    }
    resume() {
      this.resumeCount += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  }
  return { FakeAudioContext, instances };
}

describe('AudioMixer', () => {
  it('returns null when Web Audio is unavailable', () => {
    const mixer = new AudioMixer(); // node env: no window.AudioContext
    expect(mixer.engage()).toBeNull();
  });

  it('creates exactly one context across repeated engage() calls', () => {
    const { FakeAudioContext, instances } = makeFakeCtx();
    const mixer = new AudioMixer(/** @type {any} */ (FakeAudioContext));
    const a = mixer.engage();
    const b = mixer.engage();
    expect(a).toBe(b);
    expect(instances).toHaveLength(1);
  });

  it('resumes a suspended context to running on first engage', () => {
    const { FakeAudioContext } = makeFakeCtx();
    const mixer = new AudioMixer(/** @type {any} */ (FakeAudioContext));
    const ctx = /** @type {any} */ (mixer.engage());
    expect(ctx.state).toBe('running');
    expect(ctx.resumeCount).toBe(1);
  });

  it('does not resume again once the context is running', () => {
    const { FakeAudioContext } = makeFakeCtx();
    const mixer = new AudioMixer(/** @type {any} */ (FakeAudioContext));
    const ctx = /** @type {any} */ (mixer.engage());
    mixer.engage();
    mixer.engage();
    expect(ctx.resumeCount).toBe(1); // only the initial suspended → running resume
  });
});
