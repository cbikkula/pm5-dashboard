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
payloads against the live mirrors. Best-effort response — this is a solo project.

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
- **Google Drive `appdata`** (your account, only if signed in): the same personal state,
  as one JSON file, for cross-device sync.
- **Cloud Firestore** (only if you use Clubs): club roster, lineups, assignments, audit
  log — governed by [`firestore.rules`](firestore.rules).
- **Never stored**: OAuth access tokens are memory-only and revoked on sign-out; nothing
  is written to IndexedDB; the service worker caches only the app shell.

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
