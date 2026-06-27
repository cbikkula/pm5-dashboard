# Feature backlog

Working list of features I want to add to the dashboard, in roughly the order I plan to tackle them. Each row is sized for ~one focused session — small enough to ship in a single commit, big enough to be meaningful.

To pull the next item: open a chat with me and say `do backlog #N`. I'll build it, commit it, push it, and check the box below.

| #  | Status | Feature                                | Notes |
|---:|:---:|----------------------------------------|-------|
| 1  | ✅ done v1.2.0 | Demo Mode                              | Try-without-erg, simulated PM5 data |
| 2  | ✅ done v1.2.0 | Auto-save recovery                     | Snapshot every 5 s, prompt on next load |
| 3  | ✅ done v1.2.0 | CSV export                             | Whole-history + per-session |
| 4  | ✅ done v1.2.0 | Session notes / rating / tags          | Inside Summary modal |
| 5  | ✅ done v1.2.0 | Better error messages                  | iOS-specific banner, Drive failures surfaced |
| 6  | ✅ done v1.2.0 | Release-notes modal                    | "What's new" after a version bump |
| 7  | ✅ done v1.4.0 | PR tracking                            | Auto-detect PRs from benchmark Test sessions, 🏆 badge on history row, full provenance. *Feeds L13 — Benchmark Progress + Personal Records sections.* |
| 8  | ✅ done v1.4.0 | Live PR pace                           | PR Δ + Proj. Finish metrics during benchmark tests, green/red vs PR pace |
| 9  | ✅ done v1.5.0 | Target zones                           | Pre-workout target ranges + green/yellow/red while rowing |
| 10 | ✅ done v1.8.0 | Local-only privacy mode                | Settings toggle: disable Drive sync, global counter, sign-in |
| 11 | ✅ done v1.5.0 | Connection health panel                | Mini-widget: PM5, HR, Drive sync, last packet, dropped packets |
| 12 | ✅ done v1.7.0 | Versioned workout format               | `schemaVersion` + `appVersion` on every saved session |
| 13 | ✅ done v1.6.0 | Data quality flags                     | "Data quality: 93% · 7 dropped packets" — flag suspect spikes |
| 14 | ✅ done v1.5.0 | Stroke bookmarks                       | Mark moments mid-piece with `M` keyboard shortcut |
| 15 | ✅ done v1.6.0 | Fatigue analysis                       | First 25% vs last 25% breakdown after a session. *Feeds L13 — Fatigue Trends section.* |
| 16 | ✅ done v1.6.0 | Technique insight cards                | Rule-based callouts: "Peak force moved later", etc. *Feeds L13 — Insights + Technique Trends sections.* |
| 17 | ✅ done v1.7.0 | Import sessions                        | Paste JSON or upload CSV from another device |
| 18 |        | Smarter workout builder                | Repeat-group blocks (3× [8 min / 2 min rest]) |
| 19 |        | First-time setup wizard                | Athlete/coach mode, max HR, resting HR, units, default layout |
| 20 | ✅ done v1.5.0 | Fullscreen race mode                   | Distraction-free: split + rate + dist remaining + PR delta |
| 21 |        | Session replay                         | Stroke-by-stroke scrubber. Needs per-stroke history persistence. |
| 22 |        | Telemetry view                         | Multi-chart post-workout analysis page. *Feeds L13 — Performance Trends section.* |
| 23 |        | Compare sessions                       | Side-by-side: pick two from history. *Feeds L13 — Compare Sessions button.* |
| 24 | ✅ done v1.9.0 | Synthetic PM5 test harness             | `tests/bleParser.test.js` + fake packet fixtures |
| 25 | ✅ done v1.9.0 | GitHub Actions CI                      | Syntax check + bundle size guard + Lighthouse PWA score |
| 26 | ✅ done v1.8.0 | Accessibility pass                     | Keyboard nav, screen-reader labels, reduced-motion mode |
| 27 |        | Mobile portrait polish                 | Bottom-nav, swipe between metric pages, wake lock |
| 28 | ✅ done v1.8.0 | Performance monitor                    | Hidden devtools panel — render time, packet rate, memory |
| 29 | ✅ done v1.7.0 | Session history filters                | Date range, distance, PR-only, has-HR, has-force-curve |
| 30 | ✅ done v1.7.0 | Export raw JSON                        | Single-session JSON with full metadata + force curves |
| 31 | ✅ done v1.12.0 | Lineup readiness + rowing intelligence | Pure readiness engine (Ready / Needs attention / Blocked), upgraded stroke→bow seat map, equipment validation (sweep/scull + boat class), compact P/S notation, rowing-specific copy/export + athlete view. *Partial down-payment on L9 (crew compatibility) and L11 (rigging).* |
| 32 | ✅ done v1.13.0 | Workout assignment to lineups          | Assign a practice workout to a lineup / team / squad / club / athlete (saved plan or free text, rate/split/HR targets, focus tags, coach-private + athlete-visible notes). New `workoutAssignments` subcollection + rules; athlete *Today's assignment* view; no personal history copied into club data. |

## Long-term roadmap

Bigger items that don't fit in a single session — multi-session features, external dependencies, or things that need design work first. Listed separately so they don't get lost while the short-cycle backlog drives daily work.

| #   | Status | Feature                                | Notes |
|----:|:---:|----------------------------------------|-------|
| L1  | ✅ client shipped v1.11.0 | Multi-coach Firebase mode              | Roles, invite links, join/approval, members panel, audit log, athlete view, **workout assignment (v1.13.0)** — all live. Remaining: real-time presence (deferred), viewer role (v1.14.0). |
| L2  |        | Multi-erg synchronization              | Winter training: 8 ergs paired to one coach screen with WebRTC peer-to-peer sync. Crew rhythm + drive timing alignment. |
| L3  |        | AI technique analysis                  | Peak-timing trends across many sessions, fatigue patterns, "you tend to shorten the drive after stroke 200" callouts. |
| L4  | ✅ done v1.6.0 | Race prediction                        | Extrapolate current pace + HR drift to a finish-line projection. |
| L5  |        | Garmin / Apple Health HR integration   | Pull HR from a watch instead of (or alongside) a chest strap. |
| L6  |        | Wear OS companion                      | Heart-rate complication that mirrors the dashboard's current zone. |
| L7  |        | Session sharing                        | Signed read-only URLs so a coach can review an athlete's finished session. |
| L8  |        | TWA build for Play Store               | Wrap the PWA as an APK via `bubblewrap`. $25 one-time for Play Store; sideload free. |
| L9  |        | Crew compatibility analysis            | Given a roster, suggest lineup combinations that minimize timing variance. |
| L10 |        | Stroke matching                        | Compare current stroke against best session / target / another athlete. |
| L11 |        | Rigging database                       | Per-shell config: pin span, oarlock height, foot height, drag factor target. |
| L12 |        | Live coach broadcast                   | Coach pushes rate / target / message overlays to athletes mid-session. |
| L13 |        | **Performance page** *(marquee)*       | Whole new top-level section that answers *"what does all this data actually mean?"* — see [Performance page spec](#l13-performance-page-spec-marquee) below. Several short-cycle items below feed into it. |

### L13 — Performance page (spec)

A new top-level area in the home menu — not "Analytics" (sounds like a developer tool), but **Performance** (athlete-focused). The home menu becomes:

```
Home
├── Just Row
├── Workouts
├── History
├── Performance   ← NEW (L13)
└── Settings
```

**Design rule.** Don't make it another grid of 20 tiny charts. Every section should answer one of these questions in 15 seconds or less: *Am I getting faster? Am I getting fitter? Am I more consistent? Where did I fade? How does this compare to last month? What should I work on next?*

**Sections** (in display order):

1. **Training Overview** — top-of-page summary cards for the last 30 days. Total metres, total workouts, total hours, average split, average HR, training load. *"6.2 hours · 42,318 m · avg split 1:58.4 · avg HR 153."*
2. **Performance Trends** — single sparkline per metric showing direction over time. Average split, watts, HR, drive length, peak force. Five charts total, not fifty.
3. **Benchmark Progress** — for each PR distance (2k, 5k, 6k, 30 min, hour, half/full marathon): vertical timeline of times. *"7:18 → 7:12 → 7:08 → 7:04."* Built on top of backlog **#7 (PR tracking)**.
4. **Technique Trends** — average drive length over time (*"1.44 → 1.46 → 1.47 → 1.49 m"*), peak-force timing over time (*"38% → 39% → 41% → 40%"*). Built on top of backlog **#16 (Technique insight cards)** which adds the per-session callouts that aggregate here.
5. **Fatigue Trends** — monthly average fade % comparison. *"Last month: 3.2% · This month: 1.7%."* Built on top of backlog **#15 (Fatigue analysis)**.
6. **Consistency** — stroke-rate stddev / per-stroke watts variance trend. *"91% (↑ from 86% last month)."*
7. **Heart-Rate Distribution** — weekly time-in-zone breakdown. *"Z2 64% · Z3 22% · Z4 11% · Z5 3%."*
8. **Training Load** — weekly bar chart. Banister-style TRIMP rollup.
9. **Personal Records** — front-and-centre, not buried in Settings. *"🏆 500m 1:27 · 2k 7:01 · 6k 22:58 · 30min 8,221 m."* Built on top of backlog **#7 (PR tracking)**.
10. **Compare Sessions** — single-click button. Opens backlog **#23 (Compare sessions)** with the two most recent sessions of the same type pre-loaded.
11. **Insights** *(the section users will actually read)* — 4–8 auto-generated observations after every workout, rule-based, no AI:
    - ✓ *"Longest drive length in 3 weeks."*
    - ✓ *"Lowest HR for this pace."*
    - ✓ *"Stroke consistency improved 6%."*
    - ✓ *"Average split was 2.1 s faster than your last 6k."*
    - ⚠ *"Drive shortened after minute 24."*
    - ⚠ *"Peak force shifted later during the final quarter."*

**Why this is L13, not split into individual short-cycle items:** the whole point is that these sections share a layout, a navigation, and a "page identity." Shipping them piecemeal would mean 10 disconnected mini-features that each look out of place. The page should land as a coherent area in one or two big sessions, drawing on the per-session metrics that the short-cycle items add first.

**Suggested build order:**
1. Ship **#7 PR tracking** + **#15 Fatigue analysis** + **#16 Technique insights** in the short-cycle backlog first (their per-session output is the raw material).
2. Then build L13 in two sessions: (a) layout + Training Overview + Personal Records + Insights, (b) Trends + Distributions + Training Load + Compare button.
3. Then move Benchmarks (currently inside Settings) into the Performance page as one of its sections.

## How to pull one

Just message me with `do backlog #N` (e.g. *"do backlog #7"*). I'll:

1. Implement it in `pm5web/index.html`
2. Mirror to the repo
3. Make a focused commit
4. Push to GitHub
5. Update this file (✅ done vX.Y.Z)
6. Bump the service worker and `APP_VERSION` if the change is user-visible

If you'd rather batch a few in one session, say `do backlog #7, #8, #11` and I'll ship them together.

## Roughly when

For an organic-feeling cadence: **one feature every 2–4 days** for the next couple of months. Some weeks you'll skip; some weeks you'll do two in a day. That's exactly how real software gets built.

By the end of the backlog you'll have ~30 distinct commits over actual calendar time, with real dates, real messages, and real iteration. Reads way better than a hundred commits dumped in a weekend.
