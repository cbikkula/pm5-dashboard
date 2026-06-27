# Architecture

This document is a deeper read on how the web app is put together. The TL;DR version is in the [main README](../README.md).

## Design constraints

The architecture was driven by three hard constraints:

1. **Zero ongoing cost.** No backend, no database I have to pay for, no SaaS subscription.
2. **No installation on the user's machine.** Must run in a vanilla browser. (I built this because my school laptop is locked down and can't run downloaded executables.)
3. **Cross-device data sync.** I row at the gym, plan workouts at home, view history on my phone. Same workouts, all three devices.

Those three together ruled out most "normal" architectures (Node + DB + Vercel, Django + Postgres, anything with a server I run). What was left was: a static HTML app + the user's own Google Drive as their database.

## High-level layout

```
Browser (Chrome / Edge — desktop or Android)
│
├── Web Bluetooth ←→ Concept2 PM5 (BLE GATT, ce06xxxx-43e5-11e4-916c-0800200c9a66 service)
│
├── Google Identity Services ←→ OAuth token
│       └─→ Google Drive API (appdata scope — hidden per-user folder)
│           └─→ pm5dashboard-data.json (history, plans, layout, prefs, club, …)
│
├── localStorage ←→ Same data, cached locally for offline + speed
│
├── Service Worker ←→ HTML network-first, static assets cache-first
│
└── counterapi.dev ←→ Cross-user "workouts logged" counter (write-only POST)
```

No server I run. Surge.sh serves the static `index.html` + manifest + service worker + icons. Everything else is direct browser-to-API.

## The state object

There's a single `state` object that holds *everything* — connection status, current BLE readings, force-curve buffers, workout plan, history, layout config, user prefs, Firebase Phase 2 sub-state. Roughly 80 named fields. It's a top-level `const state = { ... }` declared once, mutated in place by every handler, and read by the renderer on every tick.

This is a deliberate choice — flux/redux/zustand would be overkill for an app that has exactly one component. With everything in one bag, the renderer is just a function that reads `state` and writes to the DOM.

## BLE → state pipeline

The PM5 publishes notifications on four characteristics (General Status 1, General Status 2, Stroke Data, Force Curve). When we connect, we subscribe to all four, and a single dispatcher routes incoming bytes to the right parser:

```js
chr.addEventListener("characteristicvaluechanged", (ev) => {
  const dv = ev.target.value;        // DataView of raw bytes
  const uuid = ev.target.uuid;
  switch (uuid) {
    case GS1_UUID:    applyGS(parseGS1(dv));    break;
    case GS2_UUID:    applyGS2(parseGS2(dv));   break;
    case STROKE_UUID: applyStrokeData(parseStrokeData(dv)); break;
    case FORCE_UUID:  applyForceCurvePacket(parseForceCurve(dv)); break;
  }
});
```

Each parser reads its byte-layout from the spec (see [`ble-protocol.md`](ble-protocol.md)) and returns a `{ field: value }` object. The `apply*` functions stitch those values into `state`, do derived-metric math (workout average pace, peak force timing, slip, etc.), and update HR tracking.

The renderer is independent — it reads `state` on every render tick (driven by BLE updates) and doesn't care which parser wrote which field.

## Force curve resampling

PM5 force-curve packets are variable length (24–40 samples per stroke depending on stroke duration). To compare strokes against each other — or maintain a running average of every stroke this session — I resample each completed stroke to a fixed length (`FC_SAMPLES = 64`):

```js
function resampleCurve(curve, n) {
  if (!curve || curve.length < 2) return null;
  const out = new Float64Array(n);
  const last = curve.length - 1;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * last;
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, last);
    const f  = t - lo;
    out[i] = curve[lo] * (1 - f) + curve[hi] * f;
  }
  return out;
}
```

Two parallel buffers:

- **`state.bestStrokeCurve`** — replaced whenever a new stroke beats the current best peak by >0.5 lbf (hysteresis so noisy peaks don't flip-flop the ghost).
- **`state.avgStrokeCurve`** — running mean updated Welford-style: `avg[i] += (newSample[i] - avg[i]) / n`.

The renderer draws all three (live, best, avg) with peak markers and a legend.

## Layout engine

The screen is a CSS grid of three areas (`left`, `right`, `bottom`) plus a central column with the force-curve chart and two hero cards (Ratio, Drive Length). Each area holds a configurable number of metric cards. The user's layout is just an array per area:

```js
state.layoutAreas = {
  left:   ["strokeRate", "pace", "watts"],
  right:  ["distance", "heartRate", "intervals"],
  bottom: ["elapsed", "drag", "rest", "avgSplit", "avgWatts"],
};
```

Each string is a key into a `METRICS` catalogue (~40 entries):

```js
const METRICS = {
  strokeRate: { label: "Stroke Rate", unit: "per min",
                get: () => fmtInt(state.strokeRate) },
  pace:       { label: "Pace",        unit: "/ 500 m",
                get: () => fmtPace(state.paceS) },
  // …
};
```

The renderer maps `left → tier-primary`, `right → tier-secondary`, `bottom → tier-passive`, stamps a `tier-*` class on each card, and CSS scales the font sizes by tier.

## Focus presets

A preset is a curated layout + a visual identity:

```js
const FOCUS_PRESETS = [
  {
    id: "race", name: "Race / Sprint",
    primary:   ["pace"],
    secondary: ["strokeRate", "watts"],
    passive:   ["peakForce", "distance", "elapsed"],
    locked:    ["pace", "strokeRate", "watts"],
    themeClass: "preset-race",
  },
  // …
];
```

Tapping a preset:

1. Rewrites `state.layoutAreas` from the preset's `primary` / `secondary` / `passive` arrays.
2. Stamps `body.preset-race` (or whichever) so the per-preset CSS kicks in — bigger primary, dimmed hero cards, different accent colour.
3. Stores `state.activePresetId` so the Settings dialog can enforce `locked` metrics (the dropdown is disabled, the remove button shows 🔒).

## Auth + Drive sync

Google Identity Services handles the OAuth dance. After sign-in we get an access token with scope `https://www.googleapis.com/auth/drive.appdata`, which gives us access to a hidden per-user folder no other app can see.

We store one file there: `pm5dashboard-data.json`. Every time the user mutates state (logs a workout, saves a plan, changes layout), we:

1. Write to `localStorage` (instant, survives offline).
2. Upload to Drive (async, fire-and-forget).

On sign-in (or page load if a token survived), we pull the Drive copy and merge:

- `history`: merge by `entry.id`. If the same ID exists in both, keep the more recent `date`.
- `savedPlans`: merge by `plan.id`. Last-write-wins per ID.
- `layoutAreas`, `userPrefs`, `club`: last-write-wins (whole-object replace).

## Service worker strategy

```js
// HTML / navigation: network-first
//   Pull the latest from Surge so updates land immediately.
//   Fall back to cache only when offline.
//
// Static assets (manifest, icons): cache-first, refresh in background
//   Instant load on revisit; new icons land on the next visit.
//
// Cross-origin (Drive API, GIS, counterapi):
//   Don't touch — let the browser handle them directly.
```

Cache version is bumped on every meaningful deploy (`pm5-v1` → `pm5-v19` and counting). Old caches are deleted in the `activate` handler.

## Why PWA over native

Compared on three axes:

|             | PWA install | TWA (Trusted Web Activity) | Native rewrite |
|-------------|:---:|:---:|:---:|
| Cost        | $0 | $0 ($25 for Play Store, optional) | Significant time |
| Web Bluetooth works | ✓ | ✓ (uses Chrome under the hood) | Would need native BLE rewrite |
| Cross-platform | ✓ | Android only | One per platform |
| Distributable to Play Store | ✗ | ✓ | ✓ |
| Updates ship instantly | ✓ | ✓ | App-store review delay |

The PWA path covers 95% of what a native app would, with none of the maintenance.

## Multi-coach club system (shipped — v1.10.0 → v1.11.x)

What used to be "Phase 2 scaffolding" is now live. A real Firebase project backs a full role-based club system, and the security model is the interesting part: **on the free Spark plan there are no Cloud Functions, so the Firestore Security Rules *are* the backend.** Every access decision is a stateless rule.

- **Firebase Auth (Google)** for identity; **Cloud Firestore** for shared club data.
- **Data model:** `clubs/{clubId}` holds club settings + equipment; **subcollections** `members/{uid}`, `athletes/{athleteId}`, `lineups/{lineupId}`, `availability/{entryId}`, `invites/{code}`, `auditLogs/{logId}`. Members ≠ athletes: a *member* is a login with a role; an *athlete* is a rowable roster entry; a member may be *linked* to an athlete. (Full schema: [`club-schema.md`](club-schema.md).)
- **Roles** — owner / admin / coach / athlete — enforced by the rules *and* mirrored by a client permission engine (`fbCan`) so the UI only offers what the server will allow.
- **Invite + approval flow:** owners/admins mint role-capped, expiring invite codes (the doc id is an unguessable bearer token); joiners self-create a `pending` row that a manager approves. The rule re-reads the invite on the join write — the only enforcement point available without a server.
- **Append-only audit log** pinned to `request.time` — no client backdating, and `update`/`delete` are denied to *everyone, including the owner*.
- **Real-time** `onSnapshot` listeners; athletes-as-subcollection so coaches (who can't write the club doc) can still edit the roster.

The security reasoning, threat model, and the adversarial-review findings that hardened the rules live in [`security.md`](security.md). The roster moved from a club-doc array into a subcollection mid-project; every entity having a stable `id` from v1 made that migration clean.

### Still ahead
Real-time presence, workout assignment to lineups (v1.13.0), and a read-only viewer role + signed session-sharing URLs (v1.14.0).
