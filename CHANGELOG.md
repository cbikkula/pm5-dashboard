# Changelog

All notable changes to PM5 Dashboard. Dates are approximate — the early commits weren't in version control yet (see [`docs/reflection.md`](docs/reflection.md) for why).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Viewer role + read-only session sharing
- Multi-erg synchronization (needs a new per-erg Firestore surface + rules — deliberately not built on the club-scoped schema)
- AI technique analysis (peak-timing trends)

## [v1.24.0] — July 2026 — RowTrace Rebrand

**PM5 Dashboard is now RowTrace.** Your workouts, settings, exports, and supported PM5 connections continue to work. This release also ships (and supersedes) the unreleased v1.23.0 "Hardware Confidence" release candidate — see its entry below for the full transport changes.

- **Identity** — product name RowTrace, tagline "Every stroke, explained.", supporting line "Capture every stroke. Understand what changed." Original stroke-trace `R` mark (repository-native SVG, monochrome-safe, no Concept2 imagery), refreshed header, title, metadata, Open Graph, manifest (name/short_name RowTrace + SVG icon), and regenerated PWA icons. "PM5" remains wherever it accurately names the Concept2 device (`Connect PM5`, connection states, protocol docs).
- **Compatibility preserved** — no storage, schema, key, or identifier changes: IndexedDB, localStorage, session ids, Force Curve payloads, Drive sync, bookmarks, tags, preferences, and capture/gap metadata are untouched. Legacy `pm5-history-export` / `pm5-session-export` / `pm5-connection-diagnostics` signatures are retained (documented allowlist) so old exports import and Drive merges stay duplicate-free; new exports add `producer: "RowTrace"` and RowTrace filenames.
- **Service worker** — cache `pm5-v50` → **`rowtrace-v51`**; upgrade deletes only our own obsolete `pm5-v*`/`rowtrace-v*` caches and now explicitly preserves unrelated origin caches; `icon.svg` joins the offline shell.
- **Hardware status** — physical PM5 verification remains **deliberately deferred** (owner-authorized); all v1.23 transport behavior is covered by 541+ automated assertions and deterministic byte-level simulations. No universal hardware-compatibility claim is made; a real-erg smoke test is the recommended follow-up, not a release blocker.
- **Name screen** — a public search found no rowing/fitness product named RowTrace (nearest: the differently-named "Row Tracker"); formal trademark review recorded as an optional owner action, not claimed here.

## [v1.23.0] — July 2026 — Hardware Confidence (shipped inside v1.24.0; physical qualification deferred)

BLE reliability becomes explicit and testable. NOT deployed until the physical-PM5 gate in [`docs/hardware-qualification.md`](docs/hardware-qualification.md) passes on the exact release-candidate commit.

- **Authoritative connection state machine** (`pm5web/transport.js`) — 13 states with an explicit legal-transition table; "Live" only after the first structurally valid status packet (never merely because a GATT object exists); generation tokens retire superseded async completions; repeated Connect clicks are idempotent; chooser cancellation is a normal recoverable outcome; discovery and subscription failures are reported distinctly; notification handlers attach exactly once.
- **Packet-liveness watchdog** — driven by the status family only (the PM5 emits status continuously while awake, including during programmed rest, so status silence = transport stall while stroke/curve silence at rest is normal). Only validated packets refresh liveness; monotonic time; stale after 5 s of status silence with a 10 s warning cooldown; a completed workout (PM5 state 10/11) disarms staleness; nothing is ever interpolated; timers are generation-guarded and cleared on teardown.
- **Safe reconnection** — the existing 1/3/6 s auto-retry now snapshots the erg's counters before resubscribing and resumes the SAME workout only when returning telemetry proves continuity (elapsed/distance/stroke count not regressed); a PM5 reset or different workout finalizes the interrupted session separately and starts clean — never silently merged. Retries never reopen the chooser; exhausted retries preserve all data and hand control to the manual Connect button.
- **Transport-boundary hardening** — minimum-length table before parsing, oversized force packets rejected, exact-duplicate/late stroke notifications dropped deterministically (counter regression = possible reset, left to continuity), malformed packets counted and bounded, no raw packet logging.
- **Session capture quality** — `entry.capture` (clean / interrupted-recovered / interrupted-gap / ended-on-disconnect / simulated) + bounded `entry.gaps` (max 20, whitelisted on import); Replay badges interruption; Insights includes interrupted sessions and flags them as a completeness limitation.
- **Connection Diagnostics** — click the status chip: support, state, last-valid-packet age, per-family accepted/rejected counters, reconnects, gaps, curve capture, HR source, capture quality, plus a bounded (100) event buffer with slug-only details. Export re-sanitizes with a whitelist — no device identifiers, packet bytes, credentials, or workout data, and it says so.
- **Deterministic transport simulator** — byte-accurate PM5 notifications fed through the production parse/apply handlers (normal, malformed, duplicate, stall/recovery scenarios) for tests and browser verification. Simulation never claims to prove physical BLE behavior.
- **Direct BLE HRM pairing: deliberately deferred** — no physical HRM was available to verify against, so nothing unverified ships; PM5 strap relay remains the HR source.
- **Insights date labels fixed** — cohort labels now use local calendar days (matching the range boundaries) instead of UTC ISO conversion.
- **Size** — transport.js ~20 KB; after ~2.8 KB measured cleanup the total guard moved once 832 → **860 KB** (actual ~857; permitted ceiling 864), enforced in CI; index.html cap 660 KB unchanged (~656). Service worker `pm5-v50`. Tests 481 → **541**.

## [v1.22.0] — July 2026 — Insights: Cross-Session Evidence

The stored evidence becomes longitudinal insight: a new top-level **Insights** page answers what measurably changed, what held steady, which sessions prove it, and what to inspect in Replay. Every calculation is deterministic, documented in [`docs/analysis-methods.md`](docs/analysis-methods.md), and traceable to stored sessions — no causation, readiness, recovery, or "perfect stroke" claims, ever.

- **Evidence summary** — at most three prioritized findings, each stating the absolute change (before any percentage), the sessions and strokes behind it, both comparison periods, a documented confidence level, missing data, and an **Inspect evidence** action straight into Replay. Insufficient data is a first-class result with structured reasons.
- **Ranges, comparisons, filters** — 7/28/90-day, all-history, and custom ranges (local calendar days); previous-equal-period or custom Period A vs B comparison; workout-type, distance, and Race Lab filters; synthetic sessions excluded by default behind a toggle. Every chart, finding, and evidence link honors the same cohort, and excluded sessions list their reasons.
- **Technique trends** — Force Curve similarity vs ONE fixed, labeled reference (the active baseline — never silently changed between points), absolute peak force, Drive Length, Ratio, peak timing, and lazy within-session curve consistency (up to 16 decoded curves for up to 12 sessions, bounded cache, stale-run cancellation). One point per session, so long rows never dominate. Legacy sessions are skipped honestly.
- **Performance & execution** — power per stroke (watts / strokes-per-second), pacing stability, race-plan execution (median |delta| vs plan, estimate-labeled), and period-vs-all-time power bests via the existing power engine (training rows never become "maximal tests"). Incompatible distances/plans are never merged into one pace trend.
- **Training history** — recorded sessions, distance, duration, weekly bars, interval/continuous split, HR and curve-coverage counts — explicitly labeled as what was recorded or imported, not the athlete's entire training.
- **Comparable-session explorer** — pick a session, see every compatible one (Baseline-Engine rule, reasons shown), with previous/best/median context and one-click Replay or A/B handoff. Incompatible sessions are never substituted.
- **Data confidence panel** — sessions available/used, strokes and curve coverage, reference identity, and exactly what additional evidence would unlock more.
- **Demo history** — one click generates 12 deterministic synthetic sessions across 8 weeks (progression, intervals, races, partial coverage, a legacy-style row) through the production storage paths, SYNTHETIC-badged and excluded by default; one click removes only demo data.
- **Charts** — dependency-free canvas: keyboard point navigation (arrows/Home/End/Enter opens Replay), exact values on focus, accessible text summaries, gaps instead of invented values, reduced-motion-safe (no animation), responsive at 375 px.
- **Size decision (documented)** — Insights adds `pm5web/insights.js` (~55 KB). After measured cleanup (~3 KB of stale comments/markup removed) a responsible implementation could not fit under the 768 KB total guard, so the **total offline-app limit moved once to 832 KB** (current total ~830 KB), enforced in CI. `index.html` keeps its 660 KB cap (~649 KB); every asset stays measured; no dependencies or generated bulk.
- **Tests 413 → 481** — six new deterministic groups: cohorts/filters, aggregation, findings, curve trends, performance/race, explorer/prefs/security. The old Performance-tab "Insights" was renamed **Observations** to avoid confusion.

## [v1.21.0] — July 2026 — Stroke-Level Evidence

Replay stops showing you a session average and starts showing you *the stroke*. Every stroke's actual Force Curve is now captured, stored, and replayable — with exact stroke identity, honest coverage reporting, and comparison tools built on the athlete's own evidence. Backward compatible: schema v3 unchanged, old sessions and v1.20 exports load exactly as before.

- **Per-stroke Force Curve persistence** — each completed stroke's 64-sample curve is saved through a new versioned binary codec (16-byte header + fixed 76-byte records; FNV-1a checksum for corruption detection; peak exact to 0.1 lbf, samples peak-scaled 8-bit with worst-case error ≈ 0.196% of peak — reconstruction is disclosed, never called bit-exact). Payloads live in **IndexedDB**, one per session, hard-capped at **512 KiB/session**, deliberately separate from localStorage so curve bulk can never endanger workout summaries. Ordinary sessions (2k/5k/6k/30:00/intervals, up to ~3.5 h) keep *every* stroke; longer rows use deterministic retention that always keeps the first/final strokes, bookmarked strokes, drift-event boundaries, and interval/race-segment transitions, then spreads the rest evenly — with exact retained-vs-total coverage stored and shown.
- **True stroke-level replay** — the selected stroke shows *its own* recorded curve (synchronized with the timeline, metrics, race segment, and baseline overlays), a coverage line states exactly what was retained, and a missing curve says so — a nearby stored curve can be shown but is always labelled with its real stroke number. `,`/`.` step between stored curves; decoding is lazy behind a small bounded cache.
- **A/B stroke comparison** — pin any stroke as A and another as B (keys `a`/`b`), overlay their curves absolute or normalized, and read split/watts/rate/Drive Length/Ratio/peak-force/peak-timing/front-load deltas plus shape similarity side by side, with interval or race-segment context and an explicit reconstruction note. Window averages can be pinned too.
- **Stroke Evidence navigator** — one-click (and `f`/`s`/`t`/`c`/`d` key) jumps to the fastest, slowest, most typical, closest-to-baseline, and largest-deviation strokes. Isolated one-stroke split spikes are excluded as connection artifacts (sustained changes are kept), ties are deterministic, every pick states its selection rule — and none of them claim technique quality.
- **Window baselines** — average the stored curves of a marked stroke range, an interval, a Race Lab segment, the steadiest 20 strokes, or the *same segment of a previous compatible attempt*; each reports retained/total counts, DL/Ratio/split mean±sd, and a transparent confidence. Start-vs-base, first-vs-last-interval, and attempt-vs-attempt comparisons drop straight into the A/B table.
- **Demo Mode: deterministic + persistable** — demo runs are now seeded (identical every run) with built-in technique wobbles; auto-log and Drive sync stay paused, but an explicit Log press saves a SYNTHETIC-badged session through the production path so all of the above can be tried without a PM5. Synthetic sessions never earn PRs and are excluded from baselines and the power profile.
- **Sync + portability** — JSON exports carry curve payloads as a base64 map (`curves`), imports validate them byte-first (size caps before decoding, checksum, ordinal order, fail-closed on unknown versions, prototype-pollution keys inert) and never overwrite existing local detail; Drive sync carries newest sessions' curves inside a ~3 MB budget with the same local-wins rule.
- **Third module + guard** — the storage layer and Stroke Evidence UI live in `pm5web/curves.js`, network-first alongside index.html/analysis.js (cache `pm5-v48`) so releases can never mix. The 768 KB total-app and 660 KB index guards are **unchanged** — v1.21 fit by trimming stale comments/release notes, not by raising limits.
- **Tests 316 → 413** — six new deterministic groups: curve codec (fidelity, corruption, hostile input), retention/budget, import/compat (incl. v1.20-export round trips and demo quarantine), stroke evidence, window baselines, replay curve sync (off-by-one and worst-case decode timing). Stale performance table in `docs/testing.md` corrected.

## [v1.20.0] — July 2026 — Personal Race & Technique Intelligence

One workflow — Plan → Row → Live cue → Debrief → Replay → Compare — built on the athlete's own evidence instead of a generic "optimal stroke". Every formula is documented in the new [`docs/analysis-methods.md`](docs/analysis-methods.md). Backward compatible: schema v3 unchanged (all new fields optional), old sessions untouched.

- **Personal Baseline Engine** — row against *your* rowing: previous compatible session (auto), a rolling average of up to 5 comparable sessions, the steadiest 20-stroke section of today, or a **⭑ locked reference** captured from today's average (stored in prefs, Drive-synced). Baselines carry source, sample size, date range, and a data-sufficiency confidence level shown in Settings; sessions pool only when *compatible* (same benchmark, or distance/duration within ±20%). The v1.19 "previous-session ghost" is now driven by whichever baseline you choose.
- **Live cues with discipline** — one plain-English cue at a time, each stating what changed, by how much, versus which baseline, for how long, and at what confidence. Cues need ~15 strokes of sustained change to appear (3×5-stroke evaluations), 3 stable evaluations to clear, and a cooldown before the same cue can repeat. Quiet mode records without showing; sensitivity has relaxed/normal/attentive levels. Fired cues are saved as **drift events** on the session.
- **Race Lab** — build a race plan (500 m→10k or custom, even/negative/positive split) around a base split (PR-suggested when blank): start · settle · base · push · sprint segments with a predicted finish. While racing, the workout bar shows the current phase, **ahead/on/behind ±delta vs plan**, and a projected finish from your rolling pace. Afterward the Summary gains a **race debrief**: per-segment plan vs actual with estimated time gained/lost (labeled, methodology attached), fade and sprint patterns, and at most three prioritized findings. Race plans are ordinary saved workouts — reusable and comparable.
- **Unified replay** — drift events appear as timeline ticks with ‹ ⚠ / ⚠ › navigation (and `[` `]` keys), the active baseline curve overlays the session curves, race-segment context shows at the scrub position, and the meta line adds exact Drive Length/Ratio deltas vs the baseline at the selected stroke.
- **Rowing power profile** — best recorded watts over 1:00 / 4:00 / 8:00 / 20:00 with pace equivalents, all-time vs 90-day, and source sessions; a **critical-power estimate appears only when two formal benchmark Tests of clearly different lengths exist** (linear work–time model, labeled). Ordinary rows are never treated as maximal tests; insufficient data states exactly what's needed. No pseudo-medical "readiness" by design.
- **Modular split, stricter guard** — the pure analysis layer moved to `pm5web/analysis.js` (network-first alongside the HTML so both always come from the same release; cached for offline). The size guard now measures the **total offline app** (index.html + analysis.js + sw.js < 768 KB) *and* still caps index.html at the old 660 KB. Current total **714 KB**.
- **Security** — the new persisted fields ride the existing sanitizer: race meta (whitelisted phases/numeric ranges, ≤ 40 segments) and drift events (≤ 50, bounded text) are scrubbed on import; hostile payloads verified inert through debrief and replay.
- **Tests 235 → 316** — five new groups (baseline engine, live cues, race lab, power profile, v1.20 compat) plus the split guard, all deterministic synthetic fixtures. Service worker `pm5-v47`.

## [v1.19.0] — July 2026 — Force Curve Intelligence

The Force Curve stops being a per-session picture and becomes a comparison instrument — against your previous session live, between any two sessions, and inside replay. Everything is computed from data the PM5 actually provides; shape scores are explained, session-relative guidance, never absolute coaching truth.

- **Previous-session ghost** — the live Force Curve now overlays your last saved session's average curve as a muted dashed reference (Settings → Force Curve Overlays toggle), with the axis scaled to fit and the legend naming the session date. The card hint shows a live **shape similarity %** against it once ≥10 strokes are averaged, and a new **Vs Last Row** metric card (Technical preset) carries the same number.
- **Curve shape analysis** — new pure helpers: `curveShapeMetrics` (peak, peak position, front-load = share of force area in the first half of the drive, smoothness 0-100) and `curveSimilarity` (cosine similarity of peak-normalised curves, 0-100 — a shape measure, deliberately blind to raw power).
- **Compare tab, sharper** — a **normalize** toggle switches between absolute lbf and peak-normalised shape view (clearly labelled either way); the delta table gains peak-timing, front-load, and smoothness rows; a one-line **shape similarity** readout explains itself in plain words. Sessions without saved curves still compare on numbers only.
- **Synchronized replay timeline** — a metric strip (split preferred, falling back to watts / rate / HR) under the scrubber with a synced cursor, bookmark ticks, and click-to-seek; **▶ play/pause** steps through the session (~8 strokes/s at stroke fidelity); **keyboard navigation** while the modal is open: ← → step, Space play/pause, Home/End jump. The series is computed once per open — seeking repaints one small canvas, never the history.
- **Drift detection with hysteresis** — the live Tech Drift card now requires **3 consecutive drifting evaluations (~15 strokes)** to warn and 3 stable ones to clear (`applyDriftHysteresis`, pure + tested), so a single ragged stroke can't flicker the card. The latched headline keeps naming the drifted metric and its baseline.
- **Efficiency transparency** — the Summary breakdown now lists every component that could **not** be scored ("Not scored: curve smoothness — no session curves saved; remaining weights renormalised") and states that scores are session-relative guidance, not a universal ranking.
- **Bundle discipline, guard unchanged** — funded by deleting dead weight, not raising the cap: the in-file duplicate of `firestore.rules` (~5.7 KB) is now a pointer to the canonical `/firestore.rules`, and pre-1.18.1 `RELEASE_NOTES` entries were trimmed (full history stays in this file). Bundle 654 → **658 KB**, still under the untouched **660 KB** guard.
- **Tests 212 → 235** — a "curve intelligence" group with deterministic synthetic curve fixtures: shape metrics, similarity invariants (scaled copy = 100), hysteresis latching/clearing sequences, efficiency missing-component reporting, and reference-curve loader selection. No club / Firestore / security changes.

## [v1.18.1] — July 2026 — Import Hardening

A minimal security patch closing the import-validation gap flagged in the v1.18.0 post-release verification. No feature changes; valid existing exports import exactly as before.

- **Every imported field is now sanitized** — the v1.18.0 pass covered `strokes`/`fc`; this patch extends the same pure-sanitizer architecture to the rest of the entry: `results` (≤ 500 rows, documented ResultRow fields only), `bookmarks` (≤ 200, live-bookmark fields + optional 80-char label), `tags` (≤ 50, 60-char strings), plus `plan` (≤ 200 whitelisted intervals, bounded title/description, benchKey checked against real benchmark ids), `pr` (keys restricted to real benchmark ids, numeric values only), `totals` (numeric whitelist), and bounded `notes`/`rating`. Only string/number primitives coerce to strings — hostile nested objects are discarded, and the parsed input is never mutated.
- **Defense in depth** — replay capability badges are HTML-escaped (PR keys were the one code path where imported strings could reach `innerHTML` unescaped).
- **Tests 190 → 212** — a new "import bounds" group: caps, malformed-entry discards, unknown-property stripping, string truncation, valid-import round-trip, hostile nested objects, end-to-end markup inertness.
- Bundle 647 → **654 KB** — still under the unchanged 660 KB guard (not raised). Service worker cache `pm5-v45`. No Firestore-rules changes.

## [v1.18.0] — July 2026 — Stroke Capture & Technique Analytics

The capture release — sessions finally persist what the live monitor sees, and a set of technique features cashes that in immediately. Backward compatible: pre-v1.18 sessions are untouched and every consumer treats the new fields as optional.

- **Per-stroke capture (schema v3)** — every logged session now saves a compact per-stroke sample log (`entry.strokes`: time, distance, pace, watts, rate, HR, drive length, drive/recovery time, peak force, peak timing) plus the session's best/average Force Curves (`entry.fc`, 64 samples each). Exactly the size-bounded design from `docs/known-issues.md`: capped at 600 samples with stride-doubling decimation for long rows, no raw BLE dumps, and a 4 MB history budget that sheds the oldest sessions' stroke bulk before summaries are ever at risk.
- **Session Replay 2.0** — captured sessions replay **stroke by stroke**: the scrubber walks a synchronized timeline showing every metric at that moment (split, watts, rate, HR, drive length, peak force, peak timing, ratio), the interval list highlights where you are, bookmarks jump to the nearest stroke, and a Force Curve panel shows the session's saved best/avg curves. Pre-v1.18 sessions keep the v1.15 interval replay; capability badges and the limitation panel stay honest either way.
- **Compare tab is real** — the Performance → Compare placeholder is now a working two-session comparison: pick any two sessions, overlay their Force Curves (A blue, B orange), and read a delta-labelled table (split, watts, rate, HR, drive length, peak force, efficiency score) with the better side bolded.
- **Live technique-drift detection** — a new **Tech Drift** card (in the Technical preset) compares your last 15 strokes against an early-session baseline on drive length, ratio, peak-force timing, and rate steadiness — recomputed every 5th stroke from the capture log, never per-render. The same analyzer runs on saved sessions in the Summary.
- **Technical-efficiency score** — a 0-100 score with nothing hidden: four weighted components (curve smoothness 35%, peak-force timing 25%, rhythm 20%, length consistency 20%), each shown with its own bar, detail line, and a "how it's scored" note in the Summary; a cross-session trend joins the Technique tab. Sessions without capture honestly report nothing rather than a made-up number.
- **✨ Suggest targets** — the workout builder fills per-interval target paces from your PRs (best PR normalised to a 2k-equivalent split via Paul's Law, then banded: sprint / race pace / threshold / sweet spot / steady state). No PRs → it says so.
- **📄 Training report** — one click in Performance → Overview downloads a markdown report: 7/30-day volume and splits, PRs, technique + efficiency trend, fatigue, and HR summary.
- **Bluetooth auto-reconnect** — when the PM5 naps mid-session, the dashboard now silently retries the GATT connection (1 s / 3 s / 6 s backoff, no chooser) instead of sitting stale until you notice; auto-log only fires once retries are exhausted. Manual disconnects don't retry.
- **Fixes** — workout titles are HTML-escaped in the history list (the documented self-XSS); the 🏆 PR badge now shows its detail on tap (toast) and in the Summary subtitle, so touch users aren't stuck without the hover tooltip.
- **Security pass** — a dedicated audit of the whole attack surface before release, written up in the new root [`SECURITY.md`](SECURITY.md): escaped the two remaining user-text `innerHTML` sinks (saved-plan titles/descriptions, account-chip name — now DOM-built with an `https:`-validated avatar URL); file imports are strictly validated (whitelisted numeric stroke fields with plausible-range clamps, capped array/entry counts, bounded text fields); export filenames sanitized + length-capped; verified the OAuth scope is `drive.appdata` only, tokens are memory-only and revoked on sign-out, and no credential ever reaches localStorage; confirmed the Firebase web API key in old git history is the public-by-design browser key (restriction is a console-side owner action, documented). **18 security regression tests** lock the fixes in.
- **Bundle budget 600 → 660 KB** — the first raise since the v1.15.1 reset, deliberately spent on this release's capture + replay + compare + analytics. The guard remains a hard test. Bundle 598 → **647 KB**.
- **Tests 115 → 190** — seven new groups (stroke capture, stroke replay, technique drift, efficiency score, session compare, smart targets + report, security), all pure-helper-level and deterministic. ⚠ Session schema bumped to **v3** (additive — old sessions need no migration). No Firestore-rules changes.

## [v1.17.0] — June 2026 — Live Monitor 2.0

A polish pass on the actual rowing screen — make it read like a serious performance display. CSS-only; **no PM5/Bluetooth parsing or metric math changed.**

- **Stable telemetry numbers** — big live values (metric cards *and* fullscreen race mode) now use tabular figures, so digits don't jitter width as they change stroke-to-stroke.
- **Clearer card hierarchy** — subtle depth on every metric card and a stronger lift on primary cards, consistent with the v1.16.0 theme polish; rounder corners.
- **Theme-safe target zones** — in/near/out tints were hardcoded green/amber/red (wrong on Crimson/Forest/Ocean/Light); now a calm, theme-derived left accent (`var(--good)` / `var(--accent-2)` / `var(--warn)`) with no flashing. Same fix applied to the Heart focus preset's pill.
- **Workout progress bar** — gradient panel + crisper border and a soft glow on the fill so the planned-workout bar reads as "live."
- **Mobile fix** — the live monitor's fixed 3-column grid had no phone breakpoint and overflowed horizontally below ~520px; it now collapses to a single scrollable column at ≤600px so metric cards stack full-width with no overflow.
- Verified in Demo Mode (force curve, cards, race mode) at desktop and 375px; replay, history, and Performance unregressed. Refreshed `live-monitor.png` (demo data). Bundle 597 → **598 KB** (under the 600 KB guard). No club / Firestore / security changes.

## [v1.16.0] — June 2026 — Visual Theme Refresh

A focused visual-polish pass — depth, motion, and theme consistency — kept under the 600 KB guard with no behavior or feature changes.

- **Theme-safe buttons** — fixed a real cross-theme bug: button hover used hardcoded colors (`#222a40`, `#6cd2ff`), so on the Crimson / Forest / Ocean / Light themes the accent buttons still hovered blue. Hover/press now derive from the active theme's own tokens (`var(--border-bright)`, `filter: brightness()`), plus a subtle `:active` press for tactile feedback.
- **Modal depth** — frosted `backdrop-filter` blur behind every modal + a soft elevation shadow, so dialogs read as floating above the page (Settings, Summary, Replay, Builder, Focus, club modals — all share `.modal`).
- **Card & header polish** — menu cards lift with a shadow on hover; the header gets a subtle vertical gradient + crisper border for a more premium top bar.
- **Themed scrollbars** — thin, theme-tinted scrollbars (Chrome/Edge) replace the default chrome.
- All eight themes, the live monitor, Performance page, and the Session Replay MVP are unchanged functionally; verified by UI smoke + 375px overflow checks across home / performance / replay / summary / settings. Bundle 596 → **597 KB** (under the 600 KB guard). No club / Firestore / security changes.

## [v1.15.1] — June 2026 — Bundle Budget Reset

A technical cleanup release — reclaim headroom under the 600 KB bundle guard before the next feature. **No behavior changes.**

- **Removed dead old-workout-panel CSS** — the `.panel*`, `.panel-table`, and `.interval-table` rules. That panel was replaced by the top-of-monitor `#workoutBar` progress bar, and its only renderer (`renderIntervalTable()`) was already removed in v1.15.0; the bare `.panel` class was applied nowhere (the unrelated `.conn-health-panel` / `.force-panel` are untouched).
- **Tightened verbose comments** — the v1.15.0 cleanup notes and the Session Replay banner, with no loss of meaning.
- **Bundle 598.8 → 596.1 KB** — margin under the 600 KB guard widened from ~1.2 KB to ~3.9 KB. Tests unchanged at **115 passing**. No club / Firestore / security changes; no UI, replay, or feature changes.
- **Future replay capture plan** documented in [`docs/known-issues.md`](docs/known-issues.md) (design only — per-stroke + optional downsampled force-curve capture, size-bounded, future-sessions-only, old-session compatible). Not implemented.

## [v1.15.0] — June 2026 — Session Replay MVP

The first real Session Replay — replay a saved session **interval by interval**, honestly scoped to the data that's actually persisted (built on the v1.14.1 readiness helpers).

- **Replay modal** — open from any history row (▶) or the Summary modal. Capability badges (`Interval replay` / `Summary only` / `Bookmarks available` / `Force curve not saved`), a compact totals line, and a 🏆 PR badge when relevant.
- **Interval scrubber** — a range slider + prev/next step through each interval, *"Interval N of M"* with the interval's cumulative distance/time and split / watts / rate / HR, the active interval highlighted in a clickable list.
- **Bookmarks** — dropped 🔖 bookmarks are listed with distance/time and mapped to the interval they fall in; clicking one jumps the scrubber to that (nearest) interval.
- **Honest limitation panel** — interval + bookmark replay only. Stroke-by-stroke and force-curve replay are **not** available because per-stroke samples and force curves were never written to history; the panel says so rather than faking them. Summary-only, bookmark-less, HR-less and old sessions degrade gracefully and never crash.
- **Lean by budget** — no chart library, framework, or dependency. To fit under the 600 KB guard, removed genuinely dead code: the unreachable "Performance — coming soon" teaser modal (superseded when the real Performance page shipped in v1.14.0), the orphaned `.home-*` layout CSS, and the dead `renderIntervalTable()` (the old workout panel it drove was replaced by the progress bar). Bundle 594 → **599 KB** (under the 600 KB guard).
- **Tests** — 12 new replay-MVP assertions (115 total, all green). No club / Firestore / security changes.

## [v1.14.1] — June 2026 — Bundle Budget + Replay Readiness

A small cleanup + scaffolding release before building Session Replay (the app is close to the 600 KB bundle guard).

- **Dead-code cleanup** — removed the orphaned `.menu-card .card-soon` "Coming Soon" pill CSS (the Performance card stopped using it once the page shipped). Fixed `CONTRIBUTING.md`, which incorrectly claimed force-curve history is "persisted per workout" — it isn't.
- **Session-replay readiness** — four pure, tested helpers (no UI yet): `getSessionReplayCapability()` (`none` / `summary-only` / `interval`), `buildIntervalReplayTimeline()`, `mapBookmarksToReplayTimeline()`, `summarizeReplayLimitations()`. They report honestly what saved data supports and never invent it — old/minimal/HR-less sessions don't crash.
- **Replay data audit** (see [`docs/known-issues.md`](docs/known-issues.md)): interval + bookmark replay are buildable from saved data today; **stroke-level and force-curve replay are not** — per-stroke samples and force curves aren't persisted, so they need a new capture step first.
- **Tests** — 17 new replay assertions (103 total, all green). Bundle 590 → 594 KB (under the 600 KB guard). No club / Firestore / security changes.

## [v1.14.0] — June 2026 — Performance Page Phase 2

The Performance page stops being a spec preview and starts computing real analysis from your saved history (no framework, no chart library — inline SVG sparklines and CSS).

- **Overview** — live 7-day / 30-day rollups: metres, workouts, training time, distance-weighted average split, and average watts / rate / HR (each gracefully omitted when the data isn't there), plus a best-recent-session line and a week-on-week volume trend.
- **Personal records** — pulled out of Settings onto the page: 500m / 1k / 2k / 5k / 6k / 10k / 30min / 60min cards with result, pace, date, and a **🏆 from Test** vs *entered* flag. Empty cards read *"not set."*
- **Benchmark progress** — a dependency-free sparkline per benchmark with best result, attempt count, and an improving / stable / slipping direction.
- **Fitness** — fatigue index across recent pieces (most-even vs biggest-fade) and an HR / aerobic summary with drift, both in plain English (*"Recent fade is mostly from power fading in the back half."*). No HR data shows an explicit *"pair a strap"* prompt.
- **Technique** — drive-length, peak-force, and stroke-consistency trends with a rowing-language diagnosis. **Insights** wires the existing rule-based engine to your real recent sessions.
- **Goals / Compare** remain polished coming-next states. None of the logic invents data — empty history yields clean empty states, verified by tests.
- **Tests** — 24 new assertions for the pure analytics (86 total, all green). No club / Firebase changes.

## [v1.13.0] — June 2026 — Workout Assignment to Lineups

Coaches can now assign a practice workout to a lineup (or team / squad / club / individual athlete), and athletes see exactly what they're expected to do before practice — rowing-specific, not a generic calendar event.

- **Assignment model** — a new `clubs/{id}/workoutAssignments` subcollection: title, workout type (steady state / intervals / test piece / technical / starts-sprint / recovery), a saved-plan reference *or* free workout text, practice date, status, target rate range / split / watts / HR zone, technical-focus tags (catches, finishes, ratio, length, suspension, rhythm, starts, sprint), and **two separate notes — a private coach note and an athlete-visible note.** Carries **no personal PM5 history**; completion tracking is lightweight only.
- **Coach flow** — *Assign workout* from any saved lineup (button on the lineup card and in the builder). Lineup cards + the builder show a **📋 Workout assigned** badge with title / date / status.
- **Athlete view** — a *Today's assignment* card: e.g. *"Varsity 8+ — Stroke seat — P · 8×250m / 1:00 rest · rate 36–40 · Focus: catches, ratio · Shell: Demo 8+ · Active."* The **private coach note is never shown to athletes** (verified by tests).
- **Security** — `workoutAssignments` rules mirror lineups: any **active** member may read, only **coach+** may write; suspended/removed members and non-members are denied. Audit-logged (assignment created / edited / removed). **⚠ Firestore rules changed — the new rules must be published to the Firebase Console.**
- **Tests** — 18 new assertions for the pure targeting + athlete-safe formatting (62 total, all green).

## [v1.12.1] — June 2026 — Mobile polish + rowing UI cleanup

A focused phone-width pass closing the one layout issue surfaced during the v1.12.0 preview.

- **Header no longer overflows on phones** — at ≤560px the header tightens padding, shrinks the title, drops the subtitle, and wraps as a safety net so the account / sign-in chip can never push past the viewport. Verified `document.documentElement.scrollWidth ≤ innerWidth` at **375px** across home, Clubs, the lineup builder, the athlete view, and the Performance page.
- **Club rows stack on phones** — lineup cards (with their new readiness chip), roster rows, and member rows now give the title + sub full width and drop the chip / status / action buttons to their own line at ≤480px, instead of squishing text into a vertical sliver.
- No logic, data, or Firestore-rules changes; desktop layout and every v1.12.0 screenshot are unchanged. Tests remain 44/44.

## [v1.12.0] — June 2026 — Lineup Readiness + Rowing Intelligence

Made the lineup builder feel like a real rowing tool. A new pure **readiness engine** (`evaluateLineupReadiness`) scores every boat **Ready / Needs attention / Blocked** and is the single source of truth behind the builder panel, the lineup-list chip, copy/export, and the athlete view.

- **Readiness panel** in the builder — checks coxswain presence, seat count, duplicate athletes, athletes double-booked across other active same-day lineups, availability, side mismatch + sweep side-balance, shell-class and oar (sweep/scull + class) compatibility, plus soft notes/status nudges. Every issue is `block` / `warn` / `info`; the verdict is the worst severity present (e.g. *"Needs attention — 2 issues: no coxswain assigned, 5 P / 3 S"*).
- **Equipment intelligence** — an 8+ needs an 8+ shell; a 4x needs sculling oars; a 2- rejects sculling oars; sculling boats skip port/starboard logic entirely.
- **Better seat map** — stroke→bow, Stroke/Bow labelled, a compact side badge per seat, empty-seat and side-mismatch highlighting, and quick rower-profile hints (preferred side, weight, availability, linked-member).
- **Compact rowing notation everywhere** — P / S / P/S / Scull / Cox / Any in badges, the seat map, warnings, copy/export and the athlete view. New athlete **"Both sides (P/S)"** option for bisweptual rowers; full words kept in `title`/aria for accessibility.
- **Coach copy/export** — a clean, rowing-specific lineup message (stroke→bow, sides, cox, notes) with an auto-generated **Warnings** section from the same engine.
- **Athlete view** — rowing-specific wording: *"You're rowing 6-seat — S"*, stroke/cox names, and the coach note.
- **Tests** — 15 new assertions for the pure readiness logic (44 total, all green). Firestore rules unchanged — the engine is pure client logic over existing club data.

## [v1.11.4] — June 2026 — Club UI polish + docs for review

A design pass on the new club UI (driven by a multi-dimension UI audit) plus a documentation refresh aimed at portfolio/review readers.

- **UI:** compact, consistent action buttons in the Members pane (they were rendering at the chunky global default); role badges now have tinted fills so they stay legible on the light theme; styled the previously-unstyled empty states; tightened the 8-tab strip; centered the awaiting-approval card; a **"danger zone" divider** sets the Delete button apart from Export/Switch; mobile fixes for member rows and the invite form.
- **Docs:** new [`docs/security.md`](docs/security.md) (threat model, Firestore-rules walkthrough, both adversarial-review tables); README modernized to the current feature set (multi-coach, cloud sync, Performance page, PR tracking) with an Engineering-highlights box; architecture/reflection updated to reflect the shipped club system.

## [v1.11.3] — June 2026 — Club client polish + hardening

Follow-ups on the multi-coach client:
- **Delete club** — a deliberate 5-step confirmation gauntlet (escalating warnings + type-the-name) for an irreversible, multi-user-affecting action. Owners delete the whole club (cascading every subcollection); non-owner members get a one-confirm **Leave**. Rules now let a member delete their own membership row (leave / cancel a pending request).
- **Firebase config moved out of the repo** into a gitignored `firebase-config.js` (template: `firebase-config.example.js`). The web apiKey is public by design — data is secured by the rules + auth domains — but it no longer sits in committed source.
- Removed real-club / real-name example placeholders from the create-club and athlete forms.
- "What's new" modal scrolls its list when there are more notes than fit.

## [v1.11.0] — June 2026 — Multi-coach club client (roles, invites, approvals)

Full multi-user club management on top of the v1.10.0 cloud-sync foundation. Built **security-first**: the hardened, adversarially-reviewed Firestore rules came first, then the client UI against them. Everything still runs on the free Spark plan — the rules *are* the backend.

### Added
- **Roles** — `owner` / `admin` / `coach` / `athlete`, each with a distinct capability set enforced by both the rules and the client permission engine (`fbCan`). Coaches manage roster + lineups; admins also manage equipment, teams, members, and invites; only the owner can mint admins.
- **Invite links + join codes** — owners/admins generate a role-capped, expiring invite (`?join=CODE&club=ID`). The doc id is an unguessable bearer token; revoked/expired codes are unreadable by the rules.
- **Pending join requests + approve/decline** — new members self-create a `pending` row (rules validate the invite); a manager approves them to `active` or declines.
- **Members panel** — list, change role, suspend/reactivate, remove, and **link a member to a roster athlete** (makes them seatable + lets them mark their own availability).
- **Athletes → subcollection** — the roster moved out of the club doc into `clubs/{id}/athletes/{id}` so coaches (who can't write the club doc) can edit it. Mirrors the existing lineup-sync pattern; legacy single-user clubs migrate transparently on upload.
- **Append-only audit log** — every membership/invite action is recorded with a server-stamped time the rules pin to `request.time` (no client backdating, no edits or deletes — even by the owner). Owners/admins see an **Activity** tab.
- **Athlete self-service** — athletes get a read-only view of the lineups they're seated in and can mark their own per-date availability.
- **Role-based UI gating** — edit affordances, tabs, and the awaiting-approval state all follow the active role; local single-user mode is unchanged and keeps full control.

### Security
- Rules hardened after an adversarial review that closed 5 root-cause holes (invite-bypass join, self-chosen athlete link, availability null-trap, audit backdating, revoked-invite readability) and an owner-bootstrap fix so club creators can write their own owner row.

## [v1.10.0] — June 2026 — Cloud sync activated (Firebase)

The Phase 2 Foundation (Auth + Firestore + lineup sync), shipped dormant in an earlier release, is now **live** — a real Firebase project is wired in.

### Changed
- `FIREBASE_CONFIG` now holds the live project (`pm5-dashboard-f4bc0`); `FIREBASE_ENABLED` is true.
- Firestore security rules (owner-scoped) published.

### What this unlocks
- **Sign in from the Clubs view** → your club, roster, shells, oars, and lineups sync to Firestore.
- **Real-time** cross-device updates via `onSnapshot` listeners.
- Data is locked to your account by the security rules.

This is the foundation for full multi-coach mode (L1 Steps 4–7: invite links, role enforcement, audit log, presence), which is the next build on top.

## [v1.9.0] — June 2026 — Test suite + CI (repo tooling)

Backlog #24, #25. Repo-only — no app behaviour change.

### Added
- **Test harness + suite (#24)** — `tests/harness.js` loads the single-file app into a stubbed DOM/browser sandbox; `tests/run.js` is a zero-dependency runner with **29 assertions** covering force-curve resampling, PR detection, the two-device benchmark merge, fatigue analysis, data quality, target zones, session import/merge, and a bundle-size guard. `npm test` runs it.
- **GitHub Actions CI (#25)** — `.github/workflows/ci.yml` runs on every push and PR: JS syntax check of the main script, the unit suite, and a `node --check` of the service worker. A CI badge now sits at the top of the README.
- `package.json` with `test` / `lint` / `check` scripts; `scripts/syntax-check.js` standalone linter.

## [v1.8.0] — June 2026 — Privacy, accessibility, dev tools

Backlog #10, #26, #28. (Two other items originally grouped here — #19 first-run wizard and #27 mobile-portrait polish — are still queued.)

### Added
- **Local-only privacy mode (#10)** — a Settings toggle that gates Drive sync *and* the cross-user counter, so a privacy-conscious user can train fully offline-of-cloud.
- **Accessibility pass (#26)** — reduce-motion and larger-text toggles, a `:focus-visible` keyboard ring, `aria-label`s on icon-only buttons, and a `prefers-reduced-motion` media query so the OS setting is honoured automatically.
- **Performance monitor (#28)** — Ctrl+Shift+P toggles a live overlay: render time (ms), frame count, BLE packet rate, force-curve point count, and JS heap usage where the browser exposes it.

## [v1.7.0] — June 2026 — History tools: filter, import, export, schema

Backlog #12, #17, #29, #30. 8/8 import unit tests pass; filters live-verified.

### Added
- **History filters (#29)** — title search, type filter (PRs only / bookmarked / noted / recovered / has-HR), minimum distance, and sort by date / distance / split. A live "N of M" count shows how many match.
- **Import sessions (#17)** — paste an exported history or single-session JSON; accepts whole-history exports, single-session exports, bare arrays, or bare entries. Merges by id (no duplicates), normalises the schema, flags imported records.
- **Single-session raw JSON export (#30)** — from a session's summary, export the full record (metadata, per-interval results, bookmarks, PR record) wrapped in a typed envelope.
- **Versioned session format (#12)** — every logged and recovered session is now stamped with `schemaVersion` + `appVersion`, so future updates have a migration foothold. Exports carry the version too.

## [v1.6.0] — June 2026 — Session analysis

Backlog #13, #15, #16, L4 — turning the raw session into meaning. All implemented as pure functions (`computeFatigue`, `computeDataQuality`, `computeInsights`, `analyzeSession`) so the Performance page (L13) can reuse them. 14/14 analysis unit tests pass.

### Added
- **Fatigue analysis (#15)** — first-quarter vs last-quarter fade across split, power, drive length, and HR drift, rolled into a 0–100 fatigue index with a plain-English headline (*"Drive length dropped 6.1% in the final quarter."*). Shows in the session summary.
- **Technique insights (#16)** — rule-based observation cards after a workout: drive shortening, rate-rose-power-didn't, aerobic drift, even-effort praise, "stronger than your recent average," plus a recommended next focus. Colour-coded by type (positive / warn / technique / fitness / recommendation).
- **Data quality score (#13)** — flags implausible stroke rates, dropped HR mid-session, intervals with no distance, and watts spikes (>2× median). Honest about granularity — interval-level, since per-stroke data isn't persisted.
- **Smarter race prediction (L4)** — fullscreen race mode projects your finish from the observed pace trend across completed intervals (damped extrapolation), not just constant current pace.

## [v1.5.0] — June 2026 — Live monitor tools

Backlog items #9, #11, #14, #20 — a batch of features that live on the monitor screen while you row.

### Added
- **Target Zones (#9)** — set a target range for split, stroke rate, HR, power, drive length, or drag in Settings. The matching live card tints **green** inside the zone, **amber** just outside, **red** far out. Toggleable; split entered as `mm:ss`.
- **Fullscreen Race Mode (#20)** — a distraction-free screen (⛶ in the header, or it tracks browser fullscreen). Giant split up top; rate, power, distance-remaining as a second row; distance, elapsed, HR, PR Δ below; projected finish at the bottom. Esc or ✕ to exit.
- **Stroke Bookmarks (#14)** — mark a moment mid-piece with the 🔖 button or the **M** key. Each bookmark snapshots distance, time, pace, rate, HR, drive length. They show in the session summary and persist with the workout in history + JSON export.
- **Connection Health panel (#11)** — a 📶 dropdown showing PM5 / stroke-data / force-curve / HR liveness (live/stale/off dots), last-packet age, rolling packet rate, and Drive-sync state. Quick way to tell whether weird data is the row or the Bluetooth link.

## [v1.4.0] — June 2026 — PR tracking + live PR pace

Backlog items #7 (PR tracking) and #8 (live PR pace), implemented together since they share the same data plumbing.

### Added
- **Automatic PR detection.** Every benchmark **Test** session is checked against your existing PRs when it's logged. New/improved PRs are recorded with full provenance (which session set it, the date, the distance/time/pace) and surfaced with a 🏆 **PR** badge on the history row. Detection is conservative: only sessions launched as a Test count (a casual 2 km row never silently overwrites your 2k PR), and the workout has to actually reach the benchmark target.
- **Exact PR computation.** PRs are stitched from per-interval results — for a 2k Test (8×250 m) the recorded time is the true time at 2000 m, with per-interval linear interpolation only *within* the boundary interval. This closed a negative-split edge case where a sprint finish could over-credit a PR via naïve whole-session pro-rating. Pro-rating is the fallback when interval data is unavailable.
- **Live PR pace.** During a benchmark Test, a **PR Δ** metric shows seconds-per-500 ahead (−, green) or behind (+, red) your existing PR pace, plus **Proj. Finish** / **Proj. Distance** projecting your result at current pace. Both auto-hide unless a relevant PR exists. Hidden for half/full-marathon tests where the test distance intentionally overshoots the benchmark.
- **PR columns in CSV export** — `bench_key`, `pr_keys`, `pr_achievement` appended to the history CSV (additive; existing columns unmoved).

### Fixed (found by an adversarial self-review of this feature)
- **Drive sync race:** setting a PR previously fired two unserialised Drive PATCHes (one from the prefs write, one from the history write), and if the earlier-built body landed last the new session could vanish from the cloud copy. Collapsed to a single PATCH that carries both the new history entry and the new PR.
- **Two-device PR race:** a Drive pull previously replaced your whole benchmarks object wholesale, wiping a PR set offline on another device. Now merges per-key, keeping the better value (faster time / farther distance) and its provenance.
- **Theme contrast:** the PR badge colour is hard-coded mint instead of the theme accent, so it stays legible across all eight themes.
- **Boundary tolerance:** a 1-minute test that stops at 59.6 s, or a 2k at 1998 m, now still credits the PR (small epsilon) rather than rejecting a clean effort on BLE-timing rounding.

## [v1.3.0] — June 2026 — Performance view, Phase 1 (page shell)

### Added
- **Performance view** — a real navigable top-level page (`performanceView`) replacing the v1.2.2 teaser modal. Six tabs across the top: **Overview · Insights · Technique · Fitness · Goals · Compare**.
- **Overview tab**: empty state when no history exists, pointing users at Demo Mode. Card grid placeholder ready for Phase 2.
- **Insights tab**: a five-card preview of every insight type the engine will emit — positive, warning, technique, fitness, recommendation — each colour-coded with a left border (mint / amber / cyan / red / orange). Real examples from the spec.
- **Technique / Fitness / Goals / Compare tabs**: each shows a 2×2 spec-card grid documenting the planned sub-sections, plus a *"Phase N coming next from backlog pull #M"* callout so visitors know exactly what's pending and where to track it.
- Two new screenshots: `docs/screenshots/performance-overview.png` (empty state) and `docs/screenshots/performance-insights.png` (Insights tab with all five card types).

### Changed
- Home-menu **Performance** card no longer shows the `SOON` pill — tapping it now opens the real view instead of a teaser modal.
- The v1.2.2 teaser modal HTML stays in the file as dead code (one small listener stub preserved) so the diff is additive — clean to revert if needed, easy to delete later.

### Next
- **Phase 2** — Overview tab functional (last 7d / last 30d / best-recent-session / current-trend cards driven by real history).
- **Phase 3** — Insights engine wired to your actual workouts (5 starter rules: drive-length drop, watts fade, HR drift, rate-without-power, peak-timing shift).
- **Phases 4–7** — Technique force-curve comparison, Fitness HR/load/drift, Goals CRUD, Compare two-session overlay.

## [v1.2.2] — June 2026 — Home menu restructure + Performance teaser

### Added
- **Performance card** on the home menu, with an orange `SOON` pill in the top-right corner. Tapping it opens a "Coming Soon" modal that previews the eight planned sections of the future Performance page (Personal Records, Training Overview, Performance Trends, Benchmark Progress, Technique Trends, Fatigue Trends, HR Distribution + Training Load, and **Insights** — the section highlighted as *"the section users will actually read"*). Modal links to [`docs/feature-backlog.md#L13`](docs/feature-backlog.md) for the full spec and roadmap status.
- New screenshot: `docs/screenshots/performance-soon.png` showing the teaser modal.

### Changed
- **Home menu restructured** to a single tight row of five small utility cards (Workouts · History · Performance · Focus · Settings) beneath the wide Just Row banner. Cards shrunk — 30 px icon, 18 px name, 16 px padding, 140 px min-height — to fit the 5-column grid cleanly on desktop. Responsive breakpoints: 3-col at ≤1100 px, 2-col at ≤720, 1-col at ≤460.
- Refreshed `docs/screenshots/home.png` to show the new layout.

## [v1.2.1] — June 2026 — Demo Mode home

### Changed
- **Moved Demo Mode out of the home menu and into Settings → DEMO MODE.** The home menu was starting to feel crowded with cards of very different purposes — daily workflow (Just Row, Workouts, History) sitting next to a one-off "try it without an erg" affordance. Settings is where you go to explore behaviour, not where you go to row, so it belongs there. The home menu is now back to five cards, all of which are things you do regularly.

## [v1.2.0] — June 2026 — Demo Mode + safety nets + export

### Added
- **Demo Mode** — simulated PM5 data for visitors without an erg. New "Try Demo" card on the home menu. Synthetic stroke rate, pace, watts, distance, HR, force curve. Drive sync paused while active so demo data never reaches your real history.
- **Auto-save recovery** — in-flight session totals snapshot to localStorage every 5 s. If the browser crashes or the tab is killed mid-row, the next load prompts to recover the session as a history entry tagged `RECOVERED`.
- **CSV export** — full-history dump from the History modal, per-session interval CSV from the Summary modal.
- **Session notes** — rating (1–10), free-text notes, and tag list per saved workout. Editor lives inside the Summary modal when viewing a history entry.
- **Release-notes modal** — shows "what's new" the first time you open the app after an `APP_VERSION` bump. Skipped on first install so brand-new users aren't greeted with a changelog before they've seen the app.

### Changed
- **Better error messages** — iOS users get an iOS-specific banner explaining the Web Bluetooth situation (no Safari/Chrome-on-iOS workaround) plus a Demo Mode link. Drive sync failures now surface as a toast ("Your workout is still saved locally.") instead of being silently logged. HTTPS-required banner points at the three mirror URLs.

## [v1.1.0] — June 2026 — Repo polish

### Added
- Project repo polish for public release: full README rewrite, badges, logo SVG, FAQ, known issues, testing notes, development timeline, contributing guide, changelog.
- `docs/architecture.md`, `docs/ble-protocol.md`, `docs/reflection.md` split out of the main README.
- 6 in-app screenshots in `docs/screenshots/`.

## [v1.0.0] — June 2026 — Public release

### Added
- PWA install (Android home-screen install + offline shell via service worker).
- Google Drive `appdata` sync — history, saved plans, layout, prefs, and clubs sync across devices.
- Cross-user "workouts logged" counter on the home screen (counterapi.dev).
- Force-curve overlays: best stroke and session-average ghosts with peak markers and an in-canvas legend.
- 6 focus presets (Balanced, Technical, Power, Heart Rate, Endurance, Race) with tier-based card sizing, per-preset body-class themes, and locked-metric enforcement.
- Benchmarks PRs + one-tap test workouts for the standard distances (1 min, 500 m, 1k, 2k, 5k, 6k, 10k, 30 min, 60 min, half marathon, marathon).
- 8-class lineup builder (1x, 2x, 2-, 2+, 4x, 4-, 4+, 8+) with seat assignments, side toggles, conflict detection, and plain-text export. (Hidden from the home menu until Phase 2 multi-user lands.)
- Phase 2 Firebase scaffolding: SDK loader, Firestore CRUD, security-rules block, sign-in chip — all dormant behind a placeholder `FIREBASE_CONFIG`.

### Changed
- Bigger primary fonts across every tier and preset; force-curve Y-axis ceiling tightened (2 % headroom, 10 lbf rounding) so changes feel dramatic, not squashed.
- Force-curve hint shows `N strokes · avg of M` so the running mean's denominator is visible.
- "Force (lbf)" axis caption removed — it overlapped the topmost y-axis tick.

### Fixed
- New-session detection now clears the force-curve Y-axis ceiling so today's first strokes look proportional instead of inheriting yesterday's peak.

## [v0.9.0] — Benchmark tests
- 11 standard distances with PR-tracking inputs.
- Each row has a **TEST** button that pre-fills the right interval workout structure.

## [v0.8.0] — Force-curve overlays
- Best-stroke ghost (highest-peak this session, 0.5 lbf hysteresis to prevent flip-flopping).
- Average-stroke running mean using Welford's online update (no need to keep every stroke in memory).
- Peak markers + legend.
- New-session auto-reset, plus a manual "Reset best" button.

## [v0.7.0] — Focus presets + tier engine
- Tier-based card sizing (primary / secondary / passive) with locked metrics per preset.
- Per-preset body class drives visual identity — Race makes the primary 168 px; Technical uses thinner type; Heart Rate goes red; etc.

## [v0.6.0] — HR metrics + zones
- 18 HR-specific metrics: zones, time-in-zone, drift, decoupling, recovery deltas, TRIMP load, % max, % HRR.
- Per-user max/resting HR prefs.

## [v0.5.0] — Configurable layout
- Per-area card slot configuration (left column, right column, bottom strip).
- 8 themes.

## [v0.4.0] — Drive sync + auth
- Google Identity Services + Drive `appdata`.
- Per-user state isolation, merge-on-pull conflict resolution.

## [v0.3.0] — Workout builder + intervals
- Programmable interval workouts with rest, duplicate, time cap.
- Saved plans library.
- Per-interval results capture + summary table.

## [v0.2.0] — Web port
- Ported the Python desktop app to a single-file PWA.
- Web Bluetooth replaces `bleak`; HTML canvas replaces `pyqtgraph`; localStorage replaces direct file writes.

## [v0.1.0] — Python desktop prototype
- First working version. PySide6 + bleak + pyqtgraph + qasync.
- BLE protocol parsed against the Concept2 spec. Off-by-3 bug found, fixed.
- Single-exe builds via PyInstaller.
