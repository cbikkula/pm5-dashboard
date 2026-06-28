# Known issues

Open bugs, browser quirks, and limitations I haven't fixed yet. PRs welcome (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## Workout title is not HTML-escaped in the history list

The history list interpolates the workout title straight into `innerHTML`, so a title containing markup (e.g. `<img onerror=…>`) would execute when the list renders. This is **self-XSS only** — it's a single-user local app, the only way to inject is to type the payload into your own workout title, and there's no cross-user surface except your own Drive sync. Predates the PR feature; flagged during the v1.4.0 review. **Fix planned:** build history rows with `createElement` + `textContent` instead of template-string `innerHTML`.

## PR badge click opens the session summary

The 🏆 PR badge sits inside the history-row click target, so tapping it opens the session summary (same as clicking the row) rather than showing the PR detail. The detail is in the badge's hover tooltip, which doesn't exist on touch devices. Low-impact UX nit; the summary opening is harmless. **Fix idea:** stop propagation on the badge and surface the PR detail in the summary modal so touch users can see it.

## Bluetooth reconnect

After the PM5 sleeps (a few minutes of inactivity), Chrome's Web Bluetooth connection sometimes goes stale. Pulling a stroke wakes the erg, but the dashboard doesn't always notice — distance and elapsed stay stuck. **Workaround:** click **Disconnect** then **Connect** again, or refresh the page.

Tracking idea: re-subscribe to the characteristics on `gattserverdisconnected` instead of waiting for the user to notice.

## Safari / iOS

Not supported. Safari doesn't implement Web Bluetooth, and Apple blocks third-party browsers from shipping their own engines on iOS. There's no workaround on iPhone or iPad. See [FAQ](faq.md#does-this-work-on-iphone--ipad).

## Firefox

Not supported. Mozilla [chose not to implement Web Bluetooth](https://mozilla.github.io/standards-positions/). The app loads in Firefox — you can browse Settings, build workouts, view history — but the Connect button is dead.

## Drive sync requires Google sign-in

By design. The dashboard has no backend, so cross-device sync uses your own Drive `appdata` folder. If you don't want a Google account in the loop, you can still use everything else — your data stays in `localStorage` on whatever device you used it on.

## Service worker takes one reload to update

The app's HTML uses a **network-first** caching strategy specifically so updates land immediately on the next visit. But if you're already in the middle of a session, the open tab won't pick up the new code until you reload it. The version chip in the header shows the cache version (`pm5-v19` at the time of writing) — if it's a step behind a known fresh deploy, hard-refresh.

## Brave disables Web Bluetooth by default

Brave's "shields" feature blocks Web Bluetooth for privacy reasons. Enable it at `brave://flags/#brave-web-bluetooth-api` if you want to use Brave instead of Chrome.

## Stroke data lags ~1 stroke behind on slow strokes

The PM5 publishes the Stroke Data characteristic at the end of each stroke (recovery → catch transition). At very slow stroke rates (<14 spm), the "current stroke" panel can feel stale because the next packet hasn't arrived yet. The live force curve still updates inside the stroke; it's the per-stroke summary cards (peak force, work/stroke) that briefly show the previous stroke's values.

## Drag factor shows briefly as `—` after connect

The PM5 sends drag factor on its own cadence (~once every few seconds) rather than every characteristic update. So immediately after pairing — before the first DRAG packet arrives — the Drag Factor card shows `—`. Resolves within ~5 seconds.

## Force-curve overlay ghosts don't survive sign-out

The best-stroke and average-stroke ghost buffers are **per-session** only — they exist in memory and reset whenever the session does (or when you tap **Reset best**). They aren't persisted to localStorage or Drive. This is intentional — those overlays should reflect *today's* rowing, not yesterday's.

## Session Replay: interval + bookmark shipped (v1.15.0); stroke + force-curve still need capture

The **interval + bookmark** replay UI shipped in **v1.15.0** (open ▶ from any history row or the Summary modal). It's scoped to exactly what a *saved* session persists, built on `logCurrentWorkout()` and the pure helpers `getSessionReplayCapability()` / `buildIntervalReplayTimeline()` / `mapBookmarksToReplayTimeline()` / `summarizeReplayLimitations()`. The replay modal itself surfaces these limits in a capability-badge row + a "what this replay can't show" panel, so the UI never over-promises.

- **Old sessions:** ✅ handled — `schemaVersion 1` and otherwise-minimal sessions never crash; they resolve to `summary-only` or `none` and the modal degrades to a summary/limitation view.
- **Interval replay:** ✅ **shipped** — per-interval `results` (distance, time, split, watts, rate, HR, drive length) drive the slider + interval list.
- **Bookmark replay:** ✅ **shipped** — stroke bookmarks (`strokeIndex`, `distanceM`, `elapsedS`) are listed and map onto the interval timeline; clicking one jumps to the nearest interval.
- **Stroke-level replay:** ❌ **not built** — only interval-level rows are persisted; there are no per-stroke samples in history.
- **Force-curve replay:** ❌ **not built** — force curves are live-only (the overlay ghosts above are per-session memory; nothing is written to history).
- **Future capture needed:** to unlock stroke / force-curve replay, the logger must start persisting per-stroke samples and a downsampled force-curve series per session — a new, opt-in, **size-bounded** capture step (per-stroke data is large, so it has to be capped to stay within the Drive `appdata` + localStorage budget).

## Heart-rate flickers between values when the strap is weak

If your HR strap signal is marginal (low battery, poor contact), the PM5 publishes alternating real / placeholder values. The dashboard's filter — `30 ≤ hr ≤ 240` — rejects the obvious garbage, but real-but-noisy strap readings will still flicker. **Workaround:** wet the strap contacts; replace the battery; sit still for 30 seconds at the start to let the signal lock.

## Layout grid can clip on very small screens

The bottom strip is a flex row of cards. On phones in portrait orientation with the keyboard up (e.g. when editing a workout name), the bottom strip can squish below readability. Use landscape mode for the monitor view if your phone is small.

## Service worker doesn't intercept cross-origin requests

By design — Google APIs, GIS scripts, the counterapi POST, and the Firebase SDK (when enabled) all go straight to the network. The service worker only manages the local app shell. Listed here so it's not a surprise if you're inspecting network traffic.

## counterapi.dev v1 is namespace-shared

The cross-user "workouts logged" counter uses counterapi.dev v1. The namespace (`pm5dashboard/total_workouts`) is open — anyone with the URL can POST a +1. Not a meaningful security concern (the counter is just a fun gauge), but listing it here in case anyone wonders why the number is sometimes higher than expected.
