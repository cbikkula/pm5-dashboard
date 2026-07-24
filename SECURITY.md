# Security Policy

## Supported versions

Only the latest release (deployed to the three mirrors below) is supported. The app is a
single static file with no server component; there are no long-lived supported branches.

| Version | Supported |
|---------|-----------|
| latest release (`main`) | ✅ |
| anything older | ❌ — hard-refresh to update |

Live deployments: [pm5row.surge.sh](https://pm5row.surge.sh) · [rowerg-dashboard.surge.sh](https://rowerg-dashboard.surge.sh) · [ergdash.surge.sh](https://ergdash.surge.sh)

## Reporting a vulnerability

Open a GitHub issue at <https://github.com/cbikkula/pm5-dashboard/issues> with the label
`security`, or use GitHub's **private vulnerability reporting** on the repository if the
issue exposes user data. Please include reproduction steps but **not** working exploit
payloads against the live mirrors. Best-effort response — this is a solo project. General/support contact: rowtracer@gmail.com.

## Security model in one paragraph

There is no server. The page is static (Surge.sh); personal workout data lives in the
browser's `localStorage` and, if you sign in, in **your own** Google Drive `appdata`
folder (scope `drive.appdata` — the app cannot see the rest of your Drive). The optional
multi-coach club system stores shared club data in Cloud Firestore, where the
**deny-by-default Firestore security rules are the entire backend** — the client's
permission checks are UX, never enforcement. The full threat model, rules walkthrough,
and adversarial-review findings are in [`docs/security.md`](docs/security.md).

## What is stored where

- **localStorage** (per browser): workout history (including v1.18 per-stroke samples and
  session force curves), saved plans, layout/preferences, PRs, your Google display
  name/email/avatar URL after sign-in. No passwords, no OAuth tokens.
- **IndexedDB** (per browser, since v1.21.0): one compact binary payload per session of
  per-stroke Force Curve detail (versioned codec, ≤ 512 KiB per session, checksummed).
  Deliberately separated from localStorage so curve bulk can never endanger workout
  summaries; deleted when you delete the session.
- **Google Drive `appdata`** (your account, only if signed in): the same personal state
  as one JSON file for cross-device sync, including a bounded (~3 MB) base64 map of
  curve payloads for your newest sessions.
- **Cloud Firestore** (only if you use Clubs): club roster, lineups, assignments, audit
  log — governed by [`firestore.rules`](firestore.rules).
- **Never stored**: OAuth access tokens are memory-only and revoked on sign-out; the
  service worker caches only the app shell.

## Keys that look like secrets but aren't

The Firebase **web API key** and the Google **OAuth client ID** are public-by-design
browser identifiers — they ship to every visitor and grant no data access by themselves
(access = Firestore rules + Google's OAuth consent + authorized domains). The Firebase
config is still kept out of the repo (`pm5web/firebase-config.js`, gitignored) purely to
silence secret scanners; an old copy of the key exists in git history, which is accepted
(see below).

## Accepted risks / owner actions

- **API key in git history** — the current Firebase web API key appears in 4 historical
  commits. Not treated as a secret (see above), and history is deliberately not rewritten.
  *Owner action:* keep the key restricted in Google Cloud Console (HTTP referrers limited
  to the three mirrors + localhost; API restrictions to Firebase services), which cannot
  be verified from this repository.
- **No security response headers** — Surge.sh static hosting cannot set custom response
  headers, so there is no header-level CSP/HSTS/frame-ancestors. A `<meta>` CSP is the
  only option and is deliberately not shipped yet: it cannot express everything and a
  mistake would break Google sign-in/Drive/Firebase for installed PWAs. Tracked as future
  work.
- **Third-party scripts without SRI** — the Firebase SDK (`www.gstatic.com`, version-
  pinned URL) and Google Identity Services load from Google CDNs; ES-module imports have
  no practical SRI story. Accepted as a trust-Google dependency.
- **Drive-synced data is trusted as your own** — content merged from your Drive appdata
  is rendered escaped but not re-sanitized field-by-field; an attacker who can write your
  appdata already controls your Google account.
- **`coachNote` confidentiality is client-side** — documented Spark-plan trade-off, see
  [`docs/security.md`](docs/security.md).
- **PM5 BLE input** — packets are length-checked and range-filtered, but a malicious
  paired BLE device could feed absurd (harmless) numbers. Pairing is a deliberate user
  gesture; accepted.

## Hardening shipped in v1.18.0

- All user-controlled text rendered through `innerHTML` is now escaped or DOM-built
  (history titles, saved-plan titles/descriptions, account chip name/avatar).
- File imports are strictly validated: whitelisted numeric fields, plausible-range
  clamps, capped array lengths and entry counts, bounded text fields.
- Export filenames are sanitized and length-capped.
- OAuth: `drive.appdata` remains the only scope; sign-out revokes the token.
- 18 security regression tests keep these locked in (`npm test`, "security" group).

## Hardening shipped in v1.21.0

- Per-stroke curve payloads are a **versioned binary format that fails closed**: unknown
  codec versions, size mismatches, bad checksums, and misordered stroke ordinals are all
  rejected before storage. Byte and structure limits are enforced **before** any
  decoding or allocation — the declared record count is checked against the actual byte
  length, a base64 string longer than the 512 KiB-equivalent cap is refused unread, and
  the checksum is corruption detection only, never a security guarantee.
- Imported/Drive curve maps are validated with the same path
  (`sanitizeImportedCurveMap`): own string keys only, `__proto__`/`constructor`/
  `prototype` ignored, unknown session ids dropped, results returned as a plain array so
  prototype pollution cannot ride the container. A payload is only stored for a session
  that exists, and an existing local payload is never overwritten.
- New session fields (`curveMeta`, `strokeStride`, `demo`) are whitelisted and bounded
  on import; coverage claims without a valid payload are downgraded to "unavailable"
  rather than trusted.
- `curves.js` joins index.html and analysis.js in the service worker's network-first
  set, so a page load can never mix module versions across releases.

## Hardening shipped in v1.20.0

- The two new persisted fields ride the existing import sanitizer: **race-plan meta**
  (whitelisted phases, numeric ranges, ≤ 40 segments) and **drift events** (≤ 50 per
  session, bounded text) are scrubbed on import and verified inert through the debrief
  and replay renderers by regression tests.
- The analysis layer moved to `pm5web/analysis.js`; it and `index.html` are both served
  network-first by the service worker so a page load can never mix code from two
  releases. The size guard now covers the total offline app.
- What's stored gains one item: recorded drift-event summaries (time, distance, cue id,
  one-line text) inside your own sessions — same localStorage/Drive scope as everything
  else, nothing new leaves the device.

## Hardening shipped in v1.18.1

- Import validation now covers **every** field of an imported session, not just the
  v1.18 capture fields: `results` / `bookmarks` / `tags` / `plan` / `pr` / `totals` /
  `notes` / `rating` are whitelisted, length-capped, and type-coerced; hostile nested
  objects are discarded rather than stored. Replay badges are escaped as defense in
  depth. 22 further regression tests ("import bounds" group).
