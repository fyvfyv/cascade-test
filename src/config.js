/** Tunable constants for the feed — single source of truth. */

/** Slides in DOM: active ± 2. @type {number} */
export const WINDOW_SIZE = 5;

/** Distance getting `preload="auto"`. @type {number} */
export const NEAR_RADIUS = 1;

/** Dead band (fraction of slide height) around the 0.5 activation boundary. @type {number} */
export const HYSTERESIS = 0.1;

/** Runway grows in 10-slide chunks, always ≥ activeIndex + RUNWAY_CHUNK. @type {number} */
export const RUNWAY_CHUNK = 10;

/** `scrollend` fallback: scroll-quiet debounce, gated on no active pointer. @type {number} */
export const SETTLE_FALLBACK_MS = 150;

/** Don't flash spinner on fast loads. @type {number} */
export const SPINNER_DELAY_MS = 150;

/** Storage write debounce. @type {number} */
export const PERSIST_DEBOUNCE_MS = 250;

/** Rebase virtual indices at settle beyond this index. @type {number} */
export const RECENTER_THRESHOLD = 20000;

/** Single automatic retry delay for transient media errors. @type {number} */
export const AUTO_RETRY_DELAY_MS = 1000;
