/**
 * Desktop input adapter (renders nothing): document-level keydown mapping
 * arrow/page keys to slide navigation, Space to pause, KeyM to mute.
 */
export class KeyboardController {
  /** @type {Window} */ #win;
  /** @type {import('../core/FeedStore.js').FeedStore} */ #store;
  /** @type {{ scrollBySlides(d: 1|-1): void }} */ #nav;
  /** @type {(e: KeyboardEvent) => void} */ #onKeyDown;

  /**
   * @param {Window} win
   * @param {import('../core/FeedStore.js').FeedStore} store
   * @param {{ scrollBySlides(d: 1|-1): void }} nav
   */
  constructor(win, store, nav) {
    this.#win = win;
    this.#store = store;
    this.#nav = nav;
    this.#onKeyDown = (e) => this.#handle(e);
  }

  start() {
    this.#win.document.addEventListener('keydown', this.#onKeyDown);
  }

  stop() {
    this.#win.document.removeEventListener('keydown', this.#onKeyDown);
  }

  /** @param {KeyboardEvent} e */
  #handle(e) {
    // Skip interactive targets entirely: Space must still ACTIVATE a focused
    // Like button (native button semantics), not toggle playback.
    const target = e.target;
    if (target instanceof Element && target.closest('button, input, [contenteditable]')) {
      return;
    }

    switch (e.code) {
      case 'ArrowDown':
      case 'PageDown':
        this.#nav.scrollBySlides(1);
        break;
      case 'ArrowUp':
      case 'PageUp':
        this.#nav.scrollBySlides(-1);
        break;
      case 'Space':
        this.#store.setUserPaused(!this.#store.getState().userPaused);
        break;
      case 'KeyM':
        this.#store.toggleMute();
        break;
      default:
        return; // unhandled key — never preventDefault
    }

    // preventDefault on all handled keys: kills the Space page-scroll lurch and
    // Firefox's native Arrow/Page scrolling of the focused scroller.
    e.preventDefault();
  }
}
