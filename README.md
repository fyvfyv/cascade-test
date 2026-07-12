# Vertical Video Feed (TikTok/Reels-style)

Test assignment: an infinite vertical feed of short videos.
Vanilla JS (ES modules, JSDoc types checked by `tsc --noEmit` strict) · Vite · Vitest · **zero runtime dependencies**.

## Running

Requires Node.js ≥ 18 and pnpm (the version is pinned in `package.json` → `packageManager`; `corepack enable` will pick it up automatically).

```bash
pnpm install
pnpm dev          # dev server: http://localhost:5173
pnpm build        # production build to dist/
pnpm preview      # serve the production build: http://localhost:4173
pnpm test         # unit tests (Vitest, node environment, no jsdom)
pnpm typecheck    # tsc --noEmit (strict checkJs)
pnpm check        # Biome: format + lint
```

## Structure & architecture

Four layers with a strict downward dependency rule (`ui → services → core/data → nothing`);
the only file that crosses layers is `src/main.js` — the composition root, the single place with cross-layer `new`.

```
src/
├── main.js       — wires the object graph, page visibility, gesture unlock, error backstop
├── config.js     — all tunable constants
├── types.js      — shared JSDoc types (zero runtime code)
├── styles.css    — the single stylesheet
├── core/         — pure DOM-free logic, fully unit-tested:
│                   feedMath, FeedStore, VirtualWindow, PlayerStateMachine
├── data/         — manifest, FeedRepository (infinite feed = Euclidean modulo over 11 files)
├── services/     — PlaybackCoordinator, StorageService, MediaSessionService, AudioMixer
└── ui/           — Component, FeedView, ScrollTracker, SlideView, VideoPlayer,
                    ActionRail, ProgressBar, KeyboardController
assets/           — 11 MP4s (Vite publicDir; filenames left untouched)
```

### Key decisions

- **Virtualization: exactly 5 slides in the DOM** (active ± 2) over a "runway" —
  an invisible sizer that grows in 10-slide chunks ahead of time, at the moment the
  active candidate changes (mid-gesture): a burst of fast flicks never hits the end of the track.
- **Arithmetic activation with hysteresis, not IntersectionObserver.**
  `activeIndexFor(scrollTop, h, prev)` is an exact, synchronous, unit-testable function.
  IO would add asynchronous thresholds, coalesced batches, and churn on rebinds —
  all for geometry we already own. The hysteresis band (±0.1 of slide height around the
  0.5 boundary) removes play/pause flicker while the snap animation oscillates near the midpoint.
- **Player FSM.** A pure transition table (`PlayerStateMachine`); the `<video>` adapter is
  deliberately dumb — intents (play/pause/retry/bind/release) and browser facts
  (canplay/playing/waiting/pause/error) map to effects. The `playing` state is entered only
  on a fact from the browser, never optimistically.
- **The pool of 5 `<video>` elements *is* the 5 slides.** Each SlideView owns its element
  for life; elements never leave the document (iOS would otherwise revoke gesture activation).
- **Canonical release** for videos outside the window: `pause(); removeAttribute('src'); load()` —
  frees the decoder and buffers without firing a bogus error event.
- **Recenter.** Beyond a threshold of 20,000, the index is rebased at settle onto a multiple of 11
  (content is invariant: `index % 11` doesn't change) — so "infinity" is honest rather than
  capped by the maximum element height (~33.5M px).
- **First load always muted.** Playback always starts muted regardless of saved preferences;
  a persisted unmute is re-applied synchronously inside the user's first gesture — the only
  approach compatible with iOS/Chrome autoplay policies.

## Resource efficiency

| Distance from active | Level | `<video>` state |
|---|---|---|
| 0 | `active` | src set, `preload=auto`, playing — the single hot decoder |
| ±1 | `near` | src set, `preload=auto`, paused at start — a swipe either way starts instantly |
| ±2 | `far` | src set, `preload=metadata` — dimensions and duration only |
| outside window | — | **src removed** (canonical release) — decoder and memory freed |

Exactly one video plays (a PlaybackCoordinator invariant). The progress bar runs its rAF loop
only while `playing`, painting via `transform: scaleX()` (compositor-only). The scroller is
`position: fixed; inset: 0` with `html, body { overflow: hidden }`: the document never scrolls,
the mobile URL bar never shifts, and there isn't a single vh/dvh unit in the layout.

## Tests

```bash
pnpm test
```

Coverage targets the core — everything that can be wrong: `feedMath` (hysteresis,
preload levels), `VirtualWindow` (window diffs, slot stability, runway, recenter),
`PlayerStateMachine` (the full transition table), `FeedStore`, `FeedRepository`
(Euclidean modulo, `itemAt(-1)`), `StorageService` (forced-muted start, in-memory fallback),
and `PlaybackCoordinator` (exactly-one-playing plus a sequence test of FeedView's real contract).
The DOM layer is deliberately thin — it translates events into FSM/store inputs and states into
class toggles; beyond strict `tsc` there is nothing there worth testing, so there are no DOM tests.

## Deliberate simplifications

| Instead of | We did | Why |
|---|---|---|
| an EventBus | one FeedStore + constructor injection | 4 state facts, a fixed object graph |
| IntersectionObserver | arithmetic with hysteresis | we own the geometry; exact, synchronous, testable |
| `ended` handling | `video.loop = true` | TikTok semantics; drops a state, an event, and a branch |
| a video pool with checkout/checkin | 5 SlideViews own their `<video>`s for life | pool size ≡ slide count |
| a DI container | a ~60-line composition root | the object graph is visible at a glance |
| an ffprobe manifest pipeline | a hand-written `manifest.js` | 11 known files; the real seam is the repository |
| watchdogs, retry with backoff, telemetry | media events + one auto-retry + a Retry button | speculative robustness is overengineering for this scope |
