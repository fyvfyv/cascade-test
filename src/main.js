// main.js — composition root: the only file with cross-layer `new`.
// (styles.css is loaded via the <link> in index.html — render-blocking, no FOUC.)
import { WINDOW_SIZE, NEAR_RADIUS, RUNWAY_CHUNK, RECENTER_THRESHOLD } from './config.js';
import { MANIFEST } from './data/manifest.js';
import { FeedRepository } from './data/FeedRepository.js';
import { FeedStore } from './core/FeedStore.js';
import { VirtualWindow } from './core/VirtualWindow.js';
import { PlayerStateMachine } from './core/PlayerStateMachine.js';
import { StorageService } from './services/StorageService.js';
import { PlaybackCoordinator } from './services/PlaybackCoordinator.js';
import { MediaSessionService } from './services/MediaSessionService.js';
import { AudioMixer } from './services/AudioMixer.js';
import { VideoPlayer } from './ui/VideoPlayer.js';
import { FeedView } from './ui/FeedView.js';
import { KeyboardController } from './ui/KeyboardController.js';

// Global backstop: programming errors surface loudly rather than being swallowed.
window.addEventListener('error', (e) => {
  console.error('[global error]', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

const storage = new StorageService(localStorage, sessionStorage);
const store = new FeedStore(storage.loadInitialState()); // muted forced true
const repo = new FeedRepository(MANIFEST);
const vwindow = new VirtualWindow({
  size: WINDOW_SIZE,
  cycleLength: MANIFEST.length,
  recenterThreshold: RECENTER_THRESHOLD,
  runwayChunk: RUNWAY_CHUNK,
});
const coordinator = new PlaybackCoordinator(store, { nearRadius: NEAR_RADIUS }); // subscribes FIRST
const mixer = new AudioMixer(); // one shared Web Audio context; engaged lazily on first unmute
const feed = new FeedView({
  store,
  repo,
  vwindow,
  coordinator,
  slideTemplate: /** @type {HTMLTemplateElement} */ (document.getElementById('slide')),
  createPlayer: (el) => {
    const p = new VideoPlayer(el, new PlayerStateMachine(), mixer);
    p.onAutoMuted(() => store.setMuted(true)); // truthful mute icon
    return p;
  },
});
feed.mount(/** @type {HTMLElement} */ (document.getElementById('app'))); // subscribes SECOND
feed.scrollToIndex(store.getState().activeIndex, 'auto'); // instant, pre-first-paint

new KeyboardController(window, store, feed).start();
new MediaSessionService(store, repo, (d) => feed.scrollBySlides(d)).start();
store.subscribe((s) => storage.persist(s));

document.addEventListener('visibilitychange', () => (document.hidden ? coordinator.suspend() : coordinator.resume()));
window.addEventListener('pageshow', () => coordinator.resume());

// First-gesture unlock: re-apply persisted mute inside a real gesture — the only
// autoplay-policy-safe way to honor a persisted unmute (engages Web Audio here).
const unlock = () => {
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
  store.setMuted(storage.preferredMuted);
};
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
