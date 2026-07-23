# Known issues

## v1.23.0 is a release candidate until a physical PM5 passes the gate

The transport work (state machine, watchdog, reconnection continuity, diagnostics) is
fully unit- and simulation-tested, but "Hardware Confidence" is not tagged or deployed
until the checklist in [`docs/hardware-qualification.md`](hardware-qualification.md)
passes on a real PM5 with the exact release-candidate commit. Direct BLE HRM pairing is
deliberately deferred for the same reason — no physical HRM was available to verify.
One passing PM5 will not prove every firmware/browser/OS combination; the tested
environment will be recorded verbatim.

## Insights is evidence-limited by what you have stored (v1.22)

The Insights page computes only from sessions recorded or imported into this app.
Consequences it states rather than hides: change findings need at least 3 usable
sessions in each compared period; pace trends require mutually comparable sessions
(shared benchmark or distances within ×1.25); curve trends need saved session-average
curves and a chosen baseline; within-session consistency needs stored stroke curves on
this device (curve detail is per-device — see the v1.21 note below). Insufficient data
is presented as a valid result with reasons, never guessed around.

## Performance tab "Insights" renamed to "Observations" (v1.22)

The old per-session rule-based list on the Performance page is now called
**Observations**; the new top-level **Insights** page is the cross-session evidence
tool. Behavior of the old tab is unchanged.

## Stroke curves are per-device unless exported or Drive-synced (v1.21)

Per-stroke Force Curve detail lives in the browser's IndexedDB, not in localStorage —
by design, so curve bulk can never endanger workout summaries. It travels in JSON
exports (a base64 `curves` map) and rides Drive sync up to a ~3 MB budget
(newest sessions first). Consequences worth knowing:

- Clearing site data / IndexedDB deletes curve detail but not your workouts; replay
  then reports coverage honestly ("couldn't be stored" / "missing").
- On a second device, curves appear only after a Drive sync or import that carried
  them; older sessions beyond the Drive budget sync summaries only.
- A local payload is never overwritten by Drive or import data (local wins), and
  deleting a session from History is the one thing that deletes its curves.

## Demo Mode can now save — one clearly-marked synthetic session (v1.21)

Auto-logging and Drive sync stay paused in Demo Mode, but pressing **Log** saves a
SYNTHETIC-badged session (title "Demo — …", `demo: true`) so stroke-level replay,
A/B comparison, and window baselines can be tried without a PM5. Synthetic sessions
never earn PRs and are excluded from baselines and the power profile.

## Race meta is dropped if you restructure a race plan's intervals

A Race Lab plan stays a race plan through renames and target tweaks, but editing it in
the builder in a way that changes the *number* of intervals drops the race meta (the
segment map would no longer match). The plan keeps working as a normal interval workout;
rebuild it in Race Lab to get the live delta and debrief back. Deliberate, but worth
knowing.

## Live cues need capture data

Live cues, baselines, the race debrief, and the power profile are all built on the
v1.18+ per-stroke capture. Sessions logged before v1.18 (or imported without `strokes`)
contribute nothing to them — the UI says so rather than guessing.

Open bugs, browser quirks, and limitations I haven't fixed yet. PRs welcome (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## ~~Workout title is not HTML-escaped in the history list~~ — fixed in v1.18.0

**Fixed in v1.18.0:** the title (and the PR-badge tooltip) are now escaped before interpolation. Historical note: the history list used to interpolate the workout title straight into `innerHTML`, so a title containing markup would execute on render — self-XSS only (single-user local app), flagged during the v1.4.0 review.

## ~~PR badge click opens the session summary~~ — fixed in v1.18.0

**Fixed in v1.18.0:** tapping the 🏆 badge now shows the full PR line as a toast (stopping the row click), and the same detail is prepended to the Summary modal's subtitle — so touch users are no longer stuck without the hover tooltip.

## Bluetooth reconnect — auto-retry since v1.18.0

Since v1.18.0 the dashboard listens for `gattserverdisconnected` and silently retries the GATT connection (1 s / 3 s / 6 s backoff, no chooser — the browser retains device permission). The stale-after-nap case now recovers on its own in most runs; auto-log fires only if all retries fail. Remaining gap: if the PM5 sleeps *without* the OS reporting a disconnect, the app still can't tell silence from rest — a `lastPacketAt` watchdog is the tracking idea for that.

## Safari / iOS

Not supported. Safari doesn't implement Web Bluetooth, and Apple blocks third-party browsers from shipping their own engines on iOS. There's no workaround on iPhone or iPad. See [FAQ](faq.md#does-this-work-on-iphone--ipad).

## Firefox

Not supported. Mozilla [chose not to implement Web Bluetooth](https://mozilla.github.io/standards-positions/). The app loads in Firefox — you can browse Settings, build workouts, view history — but the Connect button is dead.

## Drive sync requires Google sign-in

By design. The dashboard has no backend, so cross-device sync uses your own Drive `appdata` folder. If you don't want a Google account in the loop, you can still use everything else — your data stays in `localStorage` on whatever device you used it on.

## Service worker takes one reload to update

The app's HTML uses a **network-first** caching strategy specifically so updates land immediately on the next visit. But if you're already in the middle of a session, the open tab won't pick up the new code until you reload it. The version chip in the header shows the cache version (`pm5-v44` at the time of writing) — if it's a step behind a known fresh deploy, hard-refresh.

## Brave disables Web Bluetooth by default

Brave's "shields" feature blocks Web Bluetooth for privacy reasons. Enable it at `brave://flags/#brave-web-bluetooth-api` if you want to use Brave instead of Chrome.

## Stroke data lags ~1 stroke behind on slow strokes

The PM5 publishes the Stroke Data characteristic at the end of each stroke (recovery → catch transition). At very slow stroke rates (<14 spm), the "current stroke" panel can feel stale because the next packet hasn't arrived yet. The live force curve still updates inside the stroke; it's the per-stroke summary cards (peak force, work/stroke) that briefly show the previous stroke's values.

## Drag factor shows briefly as `—` after connect

The PM5 sends drag factor on its own cadence (~once every few seconds) rather than every characteristic update. So immediately after pairing — before the first DRAG packet arrives — the Drag Factor card shows `—`. Resolves within ~5 seconds.

## Force-curve overlay ghosts don't survive sign-out

The best-stroke and average-stroke ghost buffers are **per-session** only — they exist in memory and reset whenever the session does (or when you tap **Reset best**). They aren't persisted to localStorage or Drive. This is intentional — those overlays should reflect *today's* rowing, not yesterday's.

## Session Replay: stroke-level replay shipped (v1.18.0)

The v1.15.1 capture design is now **implemented** (v1.18.0), to its own constraints:

- **Per-stroke capture:** ✅ **shipped** — `logCurrentWorkout()` saves `entry.strokes`: compact per-stroke samples (time, distance, pace, watts, rate, HR, drive length, drive/recovery time, peak force, peak-force timing), capped at **600 samples** with stride-doubling decimation for long rows. Future sessions only; no raw BLE dumps.
- **Session force curves:** ✅ **shipped** — `entry.fc` stores the session's best + average curves (64 samples, 0.1 lbf) — tiny, and enough for replay inspection and the Compare tab's overlay.
- **Old sessions:** ✅ still compatible — schema v3 fields are optional; v1/v2 sessions replay at interval or summary fidelity exactly as before, and `getSessionReplayCapability()` never over-reports.
- **Storage budget:** ✅ enforced — before every save, `enforceHistoryBudget()` strips stroke bulk from the *oldest* sessions if serialized history would exceed ~4 MB; summaries, intervals, and fc curves are always kept.
- **Per-stroke force curves:** ✅ **shipped in v1.21.0** — every stroke's 64-sample curve is stored as one compact binary payload per session in IndexedDB (versioned codec, ≤ 512 KiB/session, deterministic retention for very long rows), with coverage always disclosed in replay. See `docs/analysis-methods.md` for the codec and retention rules.

## Heart-rate flickers between values when the strap is weak

If your HR strap signal is marginal (low battery, poor contact), the PM5 publishes alternating real / placeholder values. The dashboard's filter — `30 ≤ hr ≤ 240` — rejects the obvious garbage, but real-but-noisy strap readings will still flicker. **Workaround:** wet the strap contacts; replace the battery; sit still for 30 seconds at the start to let the signal lock.

## Layout grid can clip on very small screens

The bottom strip is a flex row of cards. On phones in portrait orientation with the keyboard up (e.g. when editing a workout name), the bottom strip can squish below readability. Use landscape mode for the monitor view if your phone is small.

## Service worker doesn't intercept cross-origin requests

By design — Google APIs, GIS scripts, the counterapi POST, and the Firebase SDK (when enabled) all go straight to the network. The service worker only manages the local app shell. Listed here so it's not a surprise if you're inspecting network traffic.

## counterapi.dev v1 is namespace-shared

The cross-user "workouts logged" counter uses counterapi.dev v1. The namespace (`pm5dashboard/total_workouts`) is open — anyone with the URL can POST a +1. Not a meaningful security concern (the counter is just a fun gauge), but listing it here in case anyone wonders why the number is sometimes higher than expected.
