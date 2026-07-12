/** @typedef {import('../types.js').PreloadLevel} PreloadLevel */

/**
 * Hysteretic active-index detection: switching away from prevIndex requires
 * crossing the midpoint by an extra hysteresis band. The dead zone (20% at
 * hysteresis 0.1) stops play/pause flapping while the snap animation oscillates
 * across 0.5. The clamp at 0 absorbs iOS rubber-band overscroll, which emits
 * negative scroll positions.
 * @param {number} scrollTop
 * @param {number} slideHeight
 * @param {number} prevIndex
 * @param {number} hysteresis
 * @returns {number}
 */
export function activeIndexFor(scrollTop, slideHeight, prevIndex, hysteresis) {
  const frac = scrollTop / slideHeight;
  if (Math.abs(frac - prevIndex) > 0.5 + hysteresis) {
    return Math.max(0, Math.round(frac));
  }
  return prevIndex;
}

/**
 * @param {number} index
 * @param {number} slideHeight
 * @returns {number}
 */
export function scrollTopFor(index, slideHeight) {
  return index * slideHeight;
}

/**
 * Sign of a scroll movement.
 * @param {number} prevTop
 * @param {number} nextTop
 * @returns {-1 | 0 | 1}
 */
export function directionOf(prevTop, nextTop) {
  if (nextTop > prevTop) return 1;
  if (nextTop < prevTop) return -1;
  return 0;
}

/**
 * Preload policy: the single place the level policy lives.
 * @param {number} index
 * @param {number} activeIndex
 * @param {number} nearRadius
 * @returns {PreloadLevel} 0 → 'active', ≤ nearRadius → 'near', else 'far'
 */
export function preloadLevelFor(index, activeIndex, nearRadius) {
  const distance = Math.abs(index - activeIndex);
  if (distance === 0) return 'active';
  if (distance <= nearRadius) return 'near';
  return 'far';
}
