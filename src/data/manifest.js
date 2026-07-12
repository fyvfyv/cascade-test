/** @typedef {import('../types.js').VideoMeta} VideoMeta */

/**
 * Catalog of the 11 local videos, referenced as plain URL strings rather than
 * imports to sidestep Vite's case-sensitive `assetsInclude` (filenames are
 * uppercase .MP4 with leading dashes). BASE_URL prefix supports subpath deploys.
 * @type {ReadonlyArray<VideoMeta>}
 */
export const MANIFEST = [
  {
    id: '-1381854028232193089',
    src: `${import.meta.env.BASE_URL}-1381854028232193089.MP4`,
    title: 'Golden hour',
    author: '@cascade',
  },
  {
    id: '-2466797579047759691',
    src: `${import.meta.env.BASE_URL}-2466797579047759691.MP4`,
    title: 'City lights',
    author: '@nightowl',
  },
  {
    id: '-2635594312504430960',
    src: `${import.meta.env.BASE_URL}-2635594312504430960.MP4`,
    title: 'Morning brew',
    author: '@cafedaily',
  },
  {
    id: '-425148686832983381',
    src: `${import.meta.env.BASE_URL}-425148686832983381.MP4`,
    title: 'Ocean walk',
    author: '@saltandsun',
  },
  {
    id: '-6974447037748169156',
    src: `${import.meta.env.BASE_URL}-6974447037748169156.MP4`,
    title: 'Rooftop view',
    author: '@skylinehunter',
  },
  {
    id: '3698940505591559678',
    src: `${import.meta.env.BASE_URL}3698940505591559678.MP4`,
    title: 'Weekend ride',
    author: '@twowheels',
  },
  {
    id: '3746059563046546718',
    src: `${import.meta.env.BASE_URL}3746059563046546718.MP4`,
    title: 'Street beat',
    author: '@urbanpulse',
  },
  {
    id: '6702137189532704568',
    src: `${import.meta.env.BASE_URL}6702137189532704568.MP4`,
    title: 'Quiet forest',
    author: '@trailmix',
  },
  {
    id: '6737137111559968548',
    src: `${import.meta.env.BASE_URL}6737137111559968548.MP4`,
    title: 'Neon rain',
    author: '@aftermidnight',
  },
  {
    id: '7578542087815133230',
    src: `${import.meta.env.BASE_URL}7578542087815133230.MP4`,
    title: 'Slow waves',
    author: '@driftwood',
  },
  {
    id: '7870372071727092435',
    src: `${import.meta.env.BASE_URL}7870372071727092435.MP4`,
    title: 'Last light',
    author: '@duskchaser',
  },
];
