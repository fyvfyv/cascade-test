/**
 * Shared typedefs — zero runtime code. The lone `export {}` makes this a module
 * so `import('../types.js').X` resolves under checkJs.
 */

/** @typedef {{ id: string, src: string, title: string, author: string }} VideoMeta */
/** @typedef {{ feedIndex: number, video: VideoMeta }} FeedItem */
/** @typedef {'active'|'near'|'far'} PreloadLevel */
/** @typedef {'idle'|'loading'|'ready'|'playing'|'buffering'|'paused'|'error'} PlayerState */
/** @typedef {{ activeIndex: number, muted: boolean,
 *              likedIds: ReadonlySet<string>, userPaused: boolean }} AppState */
/**
 * Narrow player surface the coordinator needs (faked in tests) so it never
 * depends on HTMLVideoElement's ~250 members.
 * @typedef {{ play(): void, pause(): void, setMuted(m: boolean): void,
 *             setLevel(l: PreloadLevel): void, getState(): PlayerState }} PlayerLike
 */

export {};
