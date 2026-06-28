<div align="center">

<img src="docs/logo.svg" alt="PM5 Dashboard" width="320">

# PM5 Dashboard

**Real-time Bluetooth dashboard for the Concept2 PM5 — built by a rower, for rowers.**

[![CI](https://github.com/cbikkula/pm5-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/cbikkula/pm5-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Vanilla JS](https://img.shields.io/badge/JavaScript-vanilla%20%C2%B7%20no%20bundler-yellow.svg)
![PWA](https://img.shields.io/badge/PWA-installable-9b66ff.svg)
![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-supported-4cc2ff.svg)
![Chrome / Edge](https://img.shields.io/badge/browser-Chrome%20%C2%B7%20Edge-22a753.svg)
![Concept2 PM5](https://img.shields.io/badge/Concept2-PM5-f5712f.svg)

**Live demo:**
[pm5row.surge.sh](https://pm5row.surge.sh) · [rowerg-dashboard.surge.sh](https://rowerg-dashboard.surge.sh) · [ergdash.surge.sh](https://ergdash.surge.sh)

</div>

> Open in Chrome or Edge on a desktop or Android phone. Click **Connect**, pair the PM5 over Bluetooth, and row.

**Current release: `v1.17.0`** ([changelog](CHANGELOG.md)) · single 598 KB `index.html`, no framework, no build step.

---

## Engineering highlights

The part I'd want a reviewer to see first:

- 🔐 **Role-based access control with no server.** A full multi-coach club system (owner / admin / coach / athlete) enforced *entirely* by **Firestore Security Rules** — on Firebase's free Spark plan there are no Cloud Functions, so [the rules **are** the backend](firestore.rules). Invite/approval flows with unguessable bearer-token join codes, an append-only audit log that **nobody — not even the owner — can edit or delete**, and a client permission engine that mirrors the rules so the UI never offers what the server will reject.
- 🛡️ **Designed adversarially.** I wrote the rules, then tried to break them — a pass that found **5 root-cause auth holes** (invite-bypass join, self-chosen athlete link, availability null-trap, audit backdating, revoked-invite readability). Then I reviewed the client across **5 dimensions and fixed 12 more bugs** (3 data-loss-critical) before release. The whole threat model + findings table is in [`docs/security.md`](docs/security.md).
- 📡 **Reverse-engineered the PM5 BLE protocol** from the Concept2 GATT spec — 64-sample force-curve resampling, ~20 Hz stroke parsing, `< 10 ms` render — documented in [`docs/ble-protocol.md`](docs/ble-protocol.md) (including the off-by-3 byte bug I shipped first).
- 🧪 **Tested & CI'd.** A 29-assertion zero-dependency test suite (`npm test`) runs in GitHub Actions on every push alongside a syntax check and a bundle-size guard.
- ⚙️ **One file, zero dependencies, $0/mo.** ~13,600 lines of vanilla HTML/CSS/JS in a single installable PWA. No framework, no bundler, no server I run.

---

## What it does

| | |
|---|---|
| **Live force curve** | Reads the raw force-vs-position curve from the PM5 every stroke, draws it smoothed in real time, and overlays your **best stroke** and **session average** as ghost curves. Peak-force markers show where in the drive the peak occurs — early peak vs late peak is the most actionable technique signal you can give a rower. |
| **Multi-coach club system** *(v1.11)* | A full role-based club: **owner / admin / coach / athlete**, invite links + expiring join codes, pending-request approval, a members panel (change role, suspend, remove, link a member to a roster athlete), an append-only **audit log**, and athlete self-service availability. Enforced end-to-end by Firestore Security Rules — see [Engineering highlights](#engineering-highlights) and [`docs/security.md`](docs/security.md). |
| **Cloud sync (Firebase)** *(v1.10)* | Sign in from the Clubs view and your club, roster, shells, oars, and lineups sync to **Cloud Firestore** with real-time `onSnapshot` updates across every device. Separate from, and complementary to, the Google Drive sync of your personal workout history. |
| **Performance page** *(v1.3)* | A real top-level analysis area (not a teaser): tabs for **Overview / Insights / Technique / Fitness / Goals / Compare** that answer *"am I getting faster / fitter / more consistent?"* with trends, fatigue, technique drift, and rule-based per-workout insights. |
| **Session replay** *(v1.15)* | Replay a saved session **interval by interval** — slider + prev/next step through each interval (split / watts / rate / HR), active-interval highlight, and **🔖 bookmarks** that jump to the interval they fall in. Honest by design: capability badges + a limitations panel spell out that this is interval + bookmark replay, *not* stroke-by-stroke or force-curve replay (those samples aren't persisted yet). |
| **PR tracking + live PR pace** *(v1.4)* | Auto-detects personal records from benchmark Test sessions (500 m / 1k / 2k / 5k / 6k / 10k / 30 min) with full provenance and a 🏆 badge on history rows. During a test, a live **PR Δ** (*"ahead by 2.8 s"*) and projected finish update every stroke. |
| **48 live metrics** | Stroke rate, pace, watts, distance, peak force, avg force, work/stroke, drive length, drive ratio, slip (catch/release), peak force timing, meters/stroke, drag factor, calories, splits, and 20 HR-specific metrics (current zone, % max, % HRR, time-in-zone, drift, decoupling, recovery deltas, TRIMP load). |
| **Tier-based layouts + 6 focus presets** | Cards size themselves by importance tier (primary / secondary / passive). Six curated presets — Balanced, Technical, Power, Heart Rate, Endurance, Race — rewrite the entire screen in one tap. Race mode pins **split** as a 168 px primary; Heart Rate mode swaps the force curve out for HR-zone-driven metrics. Each preset enforces **locked metrics** that can't be removed without breaking the mode. |
| **Workout builder + benchmark tests** | Build interval workouts (1 min · 500 m · 1k · 2k · 5k · 6k · 10k · 30 min · 1 hour · half & full marathon). One-tap tests for the standard distances pre-fill the right interval structure (e.g. 2k → 8×250 m, no rest). Plans sync across devices. |
| **Demo Mode** *(v1.2)* | Don't have a PM5? Open Settings → DEMO MODE → **Start Demo Mode** and the dashboard runs against synthetic stroke data — force curve, pace, watts, HR all move realistically. Drive sync auto-pauses so demo workouts never leak into your real history. Lets coaches and visitors explore every screen before practice. |
| **Auto-save recovery** *(v1.2)* | In-flight session totals snapshot to localStorage every 5 seconds. If the browser crashes or the tab is killed mid-row, the next page load prompts to recover the session as a `RECOVERED`-tagged history entry. |
| **CSV / JSON export** *(v1.2)* | Whole-history CSV dump or per-session interval CSV from the Summary modal. Export the raw JSON for downstream analysis in Python or Excel. |
| **Session notes, rating, tags** *(v1.2)* | Every saved workout gets a notes editor — 1–10 rating, free-text notes, comma-separated tags (e.g. `test, steady-state, technical`). Saved with the rest of Drive-synced state so context follows you across devices. |
| **PWA + Drive sync** | Installable on Android (and desktop) with an offline-capable service worker. Google Drive `appdata` scope syncs your workout history, saved plans, layout, HR prefs, **and session notes** across every device you sign into. |
| **Cross-user counter** | A global workout counter ticks every time anyone, anywhere, logs a session. |

---

## Screenshots

### Live monitor — real-time telemetry

> The headline feature: a live PM5 dashboard over Web Bluetooth. Force curve (live‑vs‑best overlay), drive/recovery ratio, stroke rate, pace, split, watts, drag factor, distance, and heart rate — 48 metrics in all, arranged per focus preset. *(Shown here in Demo Mode against synthetic stroke data, so every screen is explorable without hardware.)*

![Live monitor with real-time stroke metrics](docs/screenshots/live-monitor.png)

### Home menu

> Three-column grid of action cards. The active Drive sync session and global workout counter sit at the bottom.

![Home menu](docs/screenshots/home.png)

### Focus preset picker

> Six curated layouts. The primary (defining) metrics are pinned with a coloured pill; each preset has its own accent. Tapping one rewrites the whole on-screen layout and applies a body-class theme.

![Focus preset picker](docs/screenshots/focus-presets.png)

### Workout builder

> Programmable intervals — distance or time, with rest, with a duplicate button and an optional time cap. Saving stores the plan in your library and syncs it to Drive.

![Workout builder](docs/screenshots/workout-builder.png)

### Saved workouts library

> Every plan you've built. Click **Use →** to activate, **Edit** to modify, ✕ to delete.

![Saved workouts library](docs/screenshots/workouts-library.png)

### Settings — layout, theme, HR, force-curve overlays

> Per-area card slots (left column, right column, bottom strip). Each slot picks any of the 48 metrics. Theme picker, FC overlay toggles, and HR prefs all live here.

![Settings dialog](docs/screenshots/settings.png)

### Benchmarks — personal records + one-tap tests

> Inside Settings. Each row is a standard rowing distance or time-trial; the **TEST** button spawns the right interval workout (2k → 8×250 m, 5k → 10×500 m, etc.) and drops you into the monitor view.

![Benchmarks section in Settings](docs/screenshots/benchmarks.png)

### Demo Mode *(v1.2)* — explore without a PM5

> Also inside Settings. Runs the full dashboard against synthetic stroke data so coaches and visitors can explore every screen before pairing real hardware. Drive sync pauses while active so demo workouts never leak into your real history.

![Demo Mode section in Settings](docs/screenshots/demo-mode-settings.png)

### Performance page *(v1.14 — Phase 2)*

> A real top-level analysis area answering *"what does all this data actually mean?"* — now computed live from your saved history. The **Overview** tab rolls up 7/30-day metres, workouts, training time, average split/watts/rate/HR, your best recent session, **Personal Records** (500m → 60 min, flagged when set from a benchmark Test), and **Benchmark progress** sparklines. **Insights** surfaces rule-based per-workout observations; **Fitness** summarises fatigue and HR drift in plain English; **Technique** trends drive length, peak force, and stroke consistency. *(Shown with Demo Mode data.)*

![Performance overview — real 7/30-day rollups + best recent session](docs/screenshots/performance-overview-real.png)
![Personal records + benchmark-progress sparklines](docs/screenshots/performance-pr-trends.png)
![Fatigue & heart-rate summary in plain English](docs/screenshots/performance-fatigue-technique.png)

### Session Replay *(v1.15.0)*

> Replay any saved session **interval by interval** — a slider + prev/next step through each interval with its split, watts, rate, and HR, the active interval highlighted, and your dropped **🔖 bookmarks** mapped to the interval they fall in (click one to jump). Capability badges and an honest limitations panel make the scope explicit: this is **interval + bookmark replay**, *not* stroke-by-stroke — per-stroke samples and force curves aren't saved to history yet, and the UI says so rather than faking them. *(Shown with Demo Mode data.)*

![Session Replay — interval timeline, capability badges, bookmarks, and an honest limitations panel](docs/screenshots/session-replay-overview.png)
![Bookmark jump — clicking a bookmark moves the scrubber to its interval](docs/screenshots/session-replay-bookmarks.png)

---

### Club system *(v1.11 — shipped)*

> Full multi-coach club management — invite athletes, build lineups, track equipment, manage roles. Enforced end-to-end by Firestore Security Rules; no Cloud Functions required.

**Club overview** — stat cards for teams, athletes, shells, oar sets, and lineups at a glance.

![Club overview](docs/screenshots/club-overview.png)

**Roster** — full athlete list with side preference (Port/Starboard/Coxswain), squad, and injury flags. Each athlete links to a club member account for approval-flow access.

![Club roster](docs/screenshots/club-roster.png)

**Lineups** — seat-by-seat lineup cards with status (Confirmed / Planned / Cancelled), equipment assignment, team, and scheduled date.

![Club lineups](docs/screenshots/club-lineups.png)

**Lineup builder + readiness** *(v1.12)* — a real rowing seat map: stroke→bow, Stroke/Bow labelled, a compact **P / S / P/S / Scull / Cox** side badge on every seat, with empty-seat and side-mismatch highlighting plus quick rower-profile hints (preferred side, weight, availability). A pure **readiness engine** scores each boat **Ready / Needs attention / Blocked** — checking the coxswain, seat count, duplicate or double-booked athletes, availability, side balance, and shell/oar (sweep vs scull + boat class) compatibility.

![Lineup seat map — stroke→bow with per-seat side badges](docs/screenshots/lineup-seat-map.png)
![Lineup readiness — Ready / Needs attention / Blocked with an issue checklist](docs/screenshots/lineup-readiness.png)

**Workout assignment** *(v1.13)* — assign a practice workout to a lineup (or team / squad / club / individual athlete) with a saved plan or free text, target rate / split / watts / HR, technical-focus tags, and **separate coach-private and athlete-visible notes**. Lineup cards get a *📋 Workout assigned* badge; athletes get a rowing-specific *Today's assignment* card — and the private coach note is **never** shown to them.

![Coach assigns a workout to a lineup](docs/screenshots/workout-assignment-coach.png)
![Athlete's "Today's assignment" view](docs/screenshots/workout-assignment-athlete.png)

**Invite & approval flow** — generate a role-scoped share link or join code with an expiry. New members join as **pending** and must be approved before they can read anything; invites are listed for management and can be revoked at any time. Invite validity is re-checked by the Firestore rules *on the join write itself* — the client can't bypass it.

![Invite and approval flow](docs/screenshots/club-invite-flow.png)

**Members panel** — pending join requests (Approve / Decline), active members with role badges, and per-member controls (promote to Admin, suspend, remove, link to roster athlete).

![Members panel](docs/screenshots/club-members.png)

**Activity log** — append-only audit trail of every administrative action (approvals, role changes, invites). Nobody — not even the owner — can edit or delete entries; enforced by the Firestore rules.

![Activity log](docs/screenshots/club-activity.png)

**Athlete view** — what a linked athlete sees: their seat assignments across upcoming lineups (read-only) and a self-service control to mark their own availability. An athlete can't touch lineups, equipment, or other members — only their *own* availability, and only once a coach has linked them to a roster entry. All enforced by the rules.

![Athlete assignment view](docs/screenshots/athlete-assignment-view.png)

**Danger zone** — destructive actions are deliberately hard. Deleting a club is a five-step gauntlet that ends in typing the club's exact name; for a cloud club it spells out that every coach and athlete loses access and the entire activity log is destroyed.

![Club danger zone — guarded delete](docs/screenshots/club-danger-zone.png)

---

## By the numbers

|                                  |               |
|----------------------------------|---------------|
| Lines of code (web app)          | **~13,600** (single `index.html`) |
| Shipped bundle                   | **598 KB**    |
| Live metrics                     | **48**        |
| Of those, heart-rate metrics     | **20**        |
| Focus presets                    | **6**         |
| Roles enforced by Firestore rules | **4** (owner / admin / coach / athlete) |
| Firestore security rules         | **~220 lines** — the entire access-control layer |
| Auth holes found + fixed in adversarial review | **5** (rules) **+ 12** (client) |
| Supported boat classes (lineup builder) | **8**  |
| Force-curve resample resolution  | **64 samples**|
| Updates per stroke               | every PM5 BLE notification (~20 Hz peak) |
| Render time (mid-tier hardware)  | < 10 ms       |
| Offline-capable                  | yes (after first load) |
| Crash-resistant                  | yes (auto-save recovery every 5 s) |
| Released versions                | **25** (v1.0.0 → v1.17.0; [changelog](CHANGELOG.md)) · 7 git tags |
| Total commits                    | **48** ([activity](https://github.com/cbikkula/pm5-dashboard/commits/main)) |
| Server I run                     | **none** — serverless by design (Firebase Spark, **$0/mo**) |

---

## Architecture (TL;DR)

```mermaid
flowchart LR
    PM5[Concept2 PM5<br/>BLE GATT]
    Chrome[Browser<br/>Chrome / Edge<br/>desktop or Android]
    Drive[Google Drive<br/>appdata folder]
    GIS[Google Identity<br/>Services]
    SW[Service Worker<br/>cache-aware shell]
    Counter[counterapi.dev<br/>cross-user counter]
    FBAuth[Firebase Auth<br/>Google sign-in]
    FS[(Cloud Firestore<br/>clubs · members · athletes<br/>lineups · invites · audit)]
    Rules{{Security Rules<br/>= the entire backend}}

    PM5 -- Web Bluetooth --> Chrome
    Chrome -- OAuth --> GIS
    GIS --> Drive
    Chrome -- per-user history JSON --> Drive
    Chrome --- SW
    Chrome -- POST --> Counter
    Chrome -- auth --> FBAuth
    Chrome -- "real-time onSnapshot" --> FS
    FS -. "every read/write checked by" .- Rules

    subgraph "Browser (single index.html)"
      Chrome
      SW
    end
    subgraph "Firebase (free Spark plan, no Cloud Functions)"
      FBAuth
      FS
      Rules
    end
```

The full deep-dive lives in [`docs/architecture.md`](docs/architecture.md) — state model, BLE pipeline, force-curve resampling, layout engine, focus presets, auth + Drive flow, service worker strategy, PWA vs TWA vs native tradeoffs.

For the BLE byte-layouts I reverse-engineered against the Concept2 spec (and the off-by-3 bug I shipped first), see [`docs/ble-protocol.md`](docs/ble-protocol.md).

---

## Tech stack

**Web (`pm5web/`)**
- Vanilla HTML / CSS / JavaScript (no framework, no bundler, no build step)
- Web Bluetooth API
- **Firebase Auth + Cloud Firestore** — multi-coach club sync, access control enforced entirely by Firestore Security Rules on the free Spark plan
- Google Identity Services + Google Drive API (`drive.appdata` scope) — personal history sync
- Service Worker (PWA install + offline shell)
- Surge.sh hosting (free static)

**Desktop (`pm5dashboard/`)** — original prototype
- Python 3.11+, PySide6 (Qt), bleak (BLE), pyqtgraph (real-time plots), qasync (asyncio + Qt loop), PyInstaller (single-exe)

---

## Running it

### Web (recommended)

Open one of the live URLs in Chrome or Edge:

- https://pm5row.surge.sh
- https://rowerg-dashboard.surge.sh
- https://ergdash.surge.sh

Click **Connect**, pair your PM5, and row. On Android Chrome, tap the menu → **Install app** to add it to your home screen as a PWA.

### Desktop (Python original)

```bash
cd pm5dashboard
pip install -r requirements.txt
python pm5dashboard.py
```

Or build a single-file `.exe` with PyInstaller (Windows): `build_exe.bat`.

---

## Project repo

```
pm5-dashboard/
├── pm5web/                       ← The web app (deployed)
│   ├── index.html                ← The entire app (one file)
│   ├── sw.js                     ← Service worker (PWA / offline)
│   └── firebase-config.example.js ← Cloud-sync config template (real one gitignored)
├── pm5dashboard/                 ← Original Python desktop prototype
├── firestore.rules               ← The access-control layer (the "backend")
├── tests/                        ← run.js + harness.js — 29-assertion suite
├── scripts/syntax-check.js       ← Standalone main-script linter (used by CI)
├── .github/workflows/ci.yml      ← Syntax check · unit tests · bundle-size guard
├── package.json                  ← npm test / lint / check
└── docs/
    ├── architecture.md           ← System design deep dive
    ├── security.md               ← Threat model, rules walkthrough, review findings
    ├── club-schema.md            ← Club / membership data model + join flow
    ├── ble-protocol.md           ← PM5 BLE byte-layouts I reverse-engineered
    ├── reflection.md             ← What I learned + would do differently
    ├── feature-backlog.md        ← Roadmap + shipped-item tracker
    ├── testing.md                ← Browsers / devices / firmware tested
    ├── timeline.md               ← Development timeline
    ├── faq.md                    ← Mac? iOS? ErgData? Privacy?
    ├── known-issues.md           ← Open bugs / browser limitations
    ├── logo.svg                  ← Vector logo
    └── screenshots/              ← In-app captures
```

---

## Coming soon

Most of the original roadmap has shipped — PR tracking, target zones, fatigue analysis, technique insights, race mode, the Performance page, GitHub Actions CI, cloud sync, and the whole multi-coach club system are all live (see the [changelog](CHANGELOG.md)). The full tracker lives in [`docs/feature-backlog.md`](docs/feature-backlog.md). What's still ahead:

**Club system (next phases):**
- Read-only **viewer** role + signed session-sharing URLs
- Real-time presence — see who's online during a session

**Analysis & data:**
- Session replay — **stroke-by-stroke + force-curve** scrubber (interval + bookmark replay shipped in v1.15.0; per-stroke and force-curve capture still needed)
- AI technique analysis — peak-timing + fatigue patterns across many sessions
- Garmin / Apple Health HR integration

**Bigger bets:**
- **Multi-erg synchronization** — winter team training: 8 ergs paired to one coach screen via WebRTC for crew-rhythm analysis. Genuinely useful in a way nothing else on the market is.
- Wear OS companion · TWA build for the Play Store

---

## Documentation

| File | What's inside |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design deep dive |
| [`docs/security.md`](docs/security.md) | **Threat model, Firestore-rules walkthrough, adversarial-review findings** |
| [`docs/club-schema.md`](docs/club-schema.md) | Club / membership data model + join flow |
| [`docs/ble-protocol.md`](docs/ble-protocol.md) | PM5 BLE byte-layouts I reverse-engineered |
| [`docs/reflection.md`](docs/reflection.md) | What I learned, what I'd do differently |
| [`docs/feature-backlog.md`](docs/feature-backlog.md) | Roadmap + shipped-item tracker |
| [`docs/testing.md`](docs/testing.md) | Browsers / devices / PM5 firmware tested |
| [`docs/timeline.md`](docs/timeline.md) | Development timeline |
| [`docs/faq.md`](docs/faq.md) | Common questions |
| [`docs/known-issues.md`](docs/known-issues.md) | Open bugs and browser limitations |
| [`CHANGELOG.md`](CHANGELOG.md) | Versioned release notes |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to run locally + contribute |

---

## License

[MIT](LICENSE) — do whatever you want with it.

---

<sub>*Built by Charan Bikkula. The PM5 BLE protocol reference belongs to Concept2; this is an independent project not affiliated with or endorsed by Concept2 Inc.*</sub>
