# Contributing

PRs welcome. Issues even more welcome.

## Running it locally

There's no build step. The web app is one HTML file.

```bash
git clone https://github.com/cbikkula/pm5-dashboard
cd pm5-dashboard/pm5web
# Open index.html in Chrome / Edge.
# Or serve over http to test PWA install + service worker:
npx serve -l 3000 .
# → http://localhost:3000
```

Web Bluetooth requires **HTTPS** (or `localhost`), so a plain `file://` open won't let you connect to a real PM5. Use `npx serve` or deploy to Surge.

## Editing

- The whole app lives in `pm5web/index.html` (~8,800 lines, single file). Scroll to whatever you want to change.
- State is one global object near the top — `const state = {...}`.
- Metrics are declared in the `METRICS` catalogue. Adding a new one is one entry: `{ label, unit, get, visible? }`.
- Focus presets are in `FOCUS_PRESETS`. Each declares `primary` / `secondary` / `passive` arrays of metric IDs plus a `locked` list.
- The renderer is one function (`render`) that reads `state` and writes to the DOM. Called on every BLE update.

## Coding style

- **Vanilla JS.** No frameworks, no bundler, no transpiler. The single-file constraint is part of the design — it keeps the app installable as a PWA from any free static host, and makes the whole thing readable top-to-bottom.
- **Inline comments where the why is non-obvious.** Code that's clear from naming doesn't need a comment; code that exists because of a specific protocol quirk or browser bug does.
- **Two-space indent, double-quoted strings, semicolons.** Matches what's already there.

## Pull request process

1. Open an issue first if it's a feature or anything bigger than a bug fix. Saves us both time if the change isn't a good fit.
2. Branch off `main`.
3. Make a small, focused commit. One feature per PR.
4. Test against a real PM5 if you can. If you can't, test against the previewable views (Settings, Focus picker, Workout builder, History) and call out in the PR what's untested.
5. Bump the service worker version (`pm5-vN` in `sw.js`) if the change is observable on existing installs.

## Things I'd love help with

If you're looking for somewhere to start:

- **Session replay** — saved sessions persist **interval-level** results + bookmarks, so an interval scrubber is buildable today (see `getSessionReplayCapability()` and `docs/known-issues.md`). **Stroke-level and force-curve replay need new capture first** — per-stroke samples and force curves are *not* persisted to history yet.
- **CSV export** — export workout history to a format other training-log tools understand.
- **Firefox + Safari fallback** — they don't have Web Bluetooth, but they could show a useful "open this in Chrome" landing page instead of failing silently.
- **Translations** — labels are all in `METRICS` and a few sprinkled `setToast()` calls. i18n would be straightforward.

## Reporting bugs

Use [GitHub Issues](https://github.com/cbikkula/pm5-dashboard/issues). Include:

- Browser + version
- OS (especially if Android — vendor + model is helpful for BLE quirks)
- PM5 firmware revision (Information menu on the monitor)
- What happened, what you expected, what actually happened
- Browser console output if there's an error
