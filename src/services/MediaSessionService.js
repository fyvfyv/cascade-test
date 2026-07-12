/**
 * Media Session API adapter: OS/browser media UI ⇄ FeedStore. Metadata
 * follows activeIndex, playbackState mirrors userPaused; no-ops entirely
 * when navigator.mediaSession is absent.
 */
export class MediaSessionService {
  /** @type {import('../core/FeedStore.js').FeedStore} */ #store;
  /** @type {import('../data/FeedRepository.js').FeedRepository} */ #repo;
  /** @type {(delta: 1|-1) => void} */ #navigate;
  /** @type {(() => void) | null} */ #unsubscribe = null;

  /**
   * @param {import('../core/FeedStore.js').FeedStore} store
   * @param {import('../data/FeedRepository.js').FeedRepository} repo
   * @param {(delta: 1|-1) => void} navigate — narrow function (FeedView.scrollBySlides)
   *   so this service never sees the view.
   */
  constructor(store, repo, navigate) {
    this.#store = store;
    this.#repo = repo;
    this.#navigate = navigate;
  }

  start() {
    const session = navigator.mediaSession;
    if (!session) return; // feature absent — the whole service is a no-op

    // play/pause record intent via store.setUserPaused — the same single path
    // as an in-app tap, so OS controls and taps can't diverge; nothing here
    // touches a player.
    session.setActionHandler('play', () => this.#store.setUserPaused(false));
    session.setActionHandler('pause', () => this.#store.setUserPaused(true));
    session.setActionHandler('previoustrack', () => this.#navigate(-1));
    session.setActionHandler('nexttrack', () => this.#navigate(1));

    this.#unsubscribe = this.#store.subscribe((s, changed) => {
      if (changed.has('activeIndex')) this.#applyMetadata(s.activeIndex);
      if (changed.has('userPaused')) this.#applyPlaybackState(s.userPaused);
    });

    // Reflect current state immediately; don't wait for the first mutation.
    const s = this.#store.getState();
    this.#applyMetadata(s.activeIndex);
    this.#applyPlaybackState(s.userPaused);
  }

  stop() {
    const session = navigator.mediaSession;
    if (!session) return;
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    session.setActionHandler('play', null);
    session.setActionHandler('pause', null);
    session.setActionHandler('previoustrack', null);
    session.setActionHandler('nexttrack', null);
    session.metadata = null;
    session.playbackState = 'none';
  }

  /** @param {number} activeIndex */
  #applyMetadata(activeIndex) {
    const item = this.#repo.itemAt(activeIndex); // Euclidean modulo — any index maps to catalog
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.video.title,
      artist: item.video.author,
      // no artwork
    });
  }

  /** @param {boolean} userPaused */
  #applyPlaybackState(userPaused) {
    navigator.mediaSession.playbackState = userPaused ? 'paused' : 'playing';
  }
}
