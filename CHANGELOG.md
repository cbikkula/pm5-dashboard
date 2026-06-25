# Changelog

All notable changes to PM5 Dashboard. Dates are approximate — the early commits weren't in version control yet (see [`docs/reflection.md`](docs/reflection.md) for why).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Multi-coach mode (Firebase Phase 2 — scaffolding shipped behind a placeholder config)
- Session replay
- AI technique analysis (peak-timing trends)

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
