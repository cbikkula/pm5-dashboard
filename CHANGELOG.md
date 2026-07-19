# Changelog

All notable changes to PM5 Dashboard. Dates are approximate — the early commits weren't in version control yet (see [`docs/reflection.md`](docs/reflection.md) for why).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Viewer role + read-only session sharing
- Multi-erg synchronization (needs a new per-erg Firestore surface + rules — deliberately not built on the club-scoped schema)
- AI technique analysis (peak-timing trends)

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
