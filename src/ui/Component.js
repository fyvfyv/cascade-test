/**
 * Base class for every view. Subclasses build their DOM once in
 * createElement() and register listeners via listen() / other disposers via
 * own(); destroy() runs disposers in reverse order and removes the element.
 */
export class Component {
  constructor() {
    /** @type {HTMLElement | null} */
    this.element = null;
    /** @type {Array<() => void>} */
    this._disposers = [];
  }

  /**
   * Subclass builds its DOM once; called lazily on first mount().
   * @returns {HTMLElement}
   */
  createElement() {
    throw new Error(`${this.constructor.name} must implement createElement()`);
  }

  /** @param {HTMLElement} parent */
  mount(parent) {
    if (this.element === null) this.element = this.createElement();
    parent.appendChild(this.element);
  }

  /**
   * Auto-disposed addEventListener.
   * @param {EventTarget} target
   * @param {string} type
   * @param {(e: Event) => void} fn
   * @param {AddEventListenerOptions} [opts]
   */
  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  /**
   * Register any disposer (store unsubscribes, observers, rAF loops).
   * @param {() => void} dispose
   */
  own(dispose) {
    this._disposers.push(dispose);
  }

  destroy() {
    for (let i = this._disposers.length - 1; i >= 0; i--) this._disposers[i]();
    this._disposers.length = 0;
    if (this.element !== null) {
      this.element.remove();
      this.element = null;
    }
  }
}
