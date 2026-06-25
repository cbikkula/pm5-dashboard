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
| 7  |        | PR tracking                            | Auto-detect 500m/1k/2k/5k/6k/10k PRs, badge on history row |
| 8  |        | Live PR pace                           | During benchmark tests, show "Ahead by 2.8 sec" delta |
| 9  |        | Target zones                           | Pre-workout target ranges + green/yellow/red while rowing |
| 10 |        | Local-only privacy mode                | Settings toggle: disable Drive sync, global counter, sign-in |
| 11 |        | Connection health panel                | Mini-widget: PM5, HR, Drive sync, last packet, dropped packets |
| 12 |        | Versioned workout format               | `schemaVersion` + `appVersion` on every saved session |
| 13 |        | Data quality flags                     | "Data quality: 93% · 7 dropped packets" — flag suspect spikes |
| 14 |        | Stroke bookmarks                       | Mark moments mid-piece with `M` keyboard shortcut |
| 15 |        | Fatigue analysis                       | First 25% vs last 25% breakdown after a session |
| 16 |        | Technique insight cards                | Rule-based callouts: "Peak force moved later", etc. |
| 17 |        | Import sessions                        | Paste JSON or upload CSV from another device |
| 18 |        | Smarter workout builder                | Repeat-group blocks (3× [8 min / 2 min rest]) |
| 19 |        | First-time setup wizard                | Athlete/coach mode, max HR, resting HR, units, default layout |
| 20 |        | Fullscreen race mode                   | Distraction-free: split + rate + dist remaining + PR delta |
| 21 |        | Session replay                         | Stroke-by-stroke scrubber. Needs per-stroke history persistence. |
| 22 |        | Telemetry view                         | Multi-chart post-workout analysis page |
| 23 |        | Compare sessions                       | Side-by-side: pick two from history |
| 24 |        | Synthetic PM5 test harness             | `tests/bleParser.test.js` + fake packet fixtures |
| 25 |        | GitHub Actions CI                      | Syntax check + bundle size guard + Lighthouse PWA score |
| 26 |        | Accessibility pass                     | Keyboard nav, screen-reader labels, reduced-motion mode |
| 27 |        | Mobile portrait polish                 | Bottom-nav, swipe between metric pages, wake lock |
| 28 |        | Performance monitor                    | Hidden devtools panel — render time, packet rate, memory |
| 29 |        | Session history filters                | Date range, distance, PR-only, has-HR, has-force-curve |
| 30 |        | Export raw JSON                        | Single-session JSON with full metadata + force curves |

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
