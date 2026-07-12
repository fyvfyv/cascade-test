import { describe, it, expect } from 'vitest';
import { FeedRepository } from './FeedRepository.js';

/** @typedef {import('../types.js').VideoMeta} VideoMeta */

/**
 * 3-item fake manifest.
 * @type {ReadonlyArray<VideoMeta>}
 */
const FAKE_MANIFEST = [
  { id: 'vid-a', src: '/a.MP4', title: 'Alpha', author: '@alpha' },
  { id: 'vid-b', src: '/b.MP4', title: 'Bravo', author: '@bravo' },
  { id: 'vid-c', src: '/c.MP4', title: 'Charlie', author: '@charlie' },
];

describe('FeedRepository', () => {
  const repo = new FeedRepository(FAKE_MANIFEST);

  describe('itemAt (Euclidean modulo)', () => {
    it('maps 0..n-1 straight onto the catalog', () => {
      expect(repo.itemAt(0).video).toBe(FAKE_MANIFEST[0]);
      expect(repo.itemAt(1).video).toBe(FAKE_MANIFEST[1]);
      expect(repo.itemAt(2).video).toBe(FAKE_MANIFEST[2]);
    });

    it('wraps forward past the end of the catalog', () => {
      expect(repo.itemAt(3).video).toBe(FAKE_MANIFEST[0]);
      expect(repo.itemAt(4).video).toBe(FAKE_MANIFEST[1]);
      expect(repo.itemAt(302).video).toBe(FAKE_MANIFEST[302 % 3]);
    });

    it('itemAt(-1) returns the LAST item (the JS % sign bug would give index -1)', () => {
      expect(repo.itemAt(-1).video).toBe(FAKE_MANIFEST[2]);
    });

    it('maps deep negatives correctly', () => {
      expect(repo.itemAt(-2).video).toBe(FAKE_MANIFEST[1]);
      expect(repo.itemAt(-3).video).toBe(FAKE_MANIFEST[0]);
      expect(repo.itemAt(-5).video).toBe(FAKE_MANIFEST[1]);
    });

    it('passes the virtual feedIndex through untouched', () => {
      expect(repo.itemAt(0).feedIndex).toBe(0);
      expect(repo.itemAt(7).feedIndex).toBe(7);
      expect(repo.itemAt(-1).feedIndex).toBe(-1);
    });
  });

  describe('getItems (async paging)', () => {
    it('returns count consecutive items starting at startIndex', async () => {
      const items = await repo.getItems(0, 3);
      expect(items.map((i) => i.video.id)).toEqual(['vid-a', 'vid-b', 'vid-c']);
      expect(items.map((i) => i.feedIndex)).toEqual([0, 1, 2]);
    });

    it('pages across the cycle boundary', async () => {
      const items = await repo.getItems(2, 3);
      expect(items.map((i) => i.video.id)).toEqual(['vid-c', 'vid-a', 'vid-b']);
      expect(items.map((i) => i.feedIndex)).toEqual([2, 3, 4]);
    });

    it('pages across the negative boundary', async () => {
      const items = await repo.getItems(-1, 3);
      expect(items.map((i) => i.video.id)).toEqual(['vid-c', 'vid-a', 'vid-b']);
      expect(items.map((i) => i.feedIndex)).toEqual([-1, 0, 1]);
    });

    it('returns a Promise (the honest async seam)', () => {
      expect(repo.getItems(0, 1)).toBeInstanceOf(Promise);
    });

    it('returns an empty array for count 0', async () => {
      expect(await repo.getItems(5, 0)).toEqual([]);
    });
  });
});
