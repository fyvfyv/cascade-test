/** @typedef {import('../types.js').VideoMeta} VideoMeta */
/** @typedef {import('../types.js').FeedItem} FeedItem */

/**
 * Maps the unbounded virtual feed index onto the finite catalog — the one
 * place the infinite feed lives.
 */
export class FeedRepository {
  /** @type {ReadonlyArray<VideoMeta>} */
  #manifest;

  /** @param {ReadonlyArray<VideoMeta>} manifest */
  constructor(manifest) {
    this.#manifest = manifest;
  }

  /**
   * Async on purpose: the seam where a real network feed plugs in without
   * touching any consumer. Resolves same-tick for the local catalog.
   * @param {number} startIndex
   * @param {number} count
   * @returns {Promise<FeedItem[]>}
   */
  async getItems(startIndex, count) {
    /** @type {FeedItem[]} */
    const items = [];
    for (let i = 0; i < count; i += 1) {
      items.push(this.itemAt(startIndex + i));
    }
    return items;
  }

  /**
   * Euclidean modulo ((i % n) + n) % n, correct for any integer including
   * negatives — plain JS `%` keeps the sign and would map itemAt(-1) to -1.
   * @param {number} index
   * @returns {FeedItem}
   */
  itemAt(index) {
    const n = this.#manifest.length;
    return { feedIndex: index, video: this.#manifest[((index % n) + n) % n] };
  }
}
