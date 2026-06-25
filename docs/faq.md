# FAQ

## Can I try it without a PM5?

Yes — open the live site and go to **Settings → DEMO MODE → Start Demo Mode**. The dashboard runs against synthetic stroke data (force curve animating, pace varying around a target, HR drifting upward) so you can explore every screen and preset before pairing real hardware. Drive sync auto-pauses while demo is running so the fake workouts never reach your real history. *Useful if you're a coach previewing the app before practice, or a first-time visitor curious what it actually does.*

## Does this work on Mac?

Yes. Chrome and Edge on macOS both implement Web Bluetooth — connection, force curves, Drive sync, PWA install all work identically to Windows. Tested on macOS Sequoia.

## Does this work on Android?

Yes, in Chrome on Android 6.0+. Open one of the live URLs, tap the three-dot menu → **Install app** to add it to your home screen as a PWA. The installed app uses Chrome's Web Bluetooth stack so the PM5 connection works.

## Does this work on iPhone / iPad?

No. Safari doesn't implement Web Bluetooth, and Apple's policy prevents third-party browsers (Chrome on iOS, Firefox on iOS, etc.) from shipping their own engines. There's no way to read BLE from a web page on iOS today. If you want a PM5 dashboard on iPhone, you need a native app like ErgData.

## Does it require internet?

After the first load: only for Drive sync, the global workout counter, and the initial Google sign-in flow. The core rowing functions — connecting to your PM5, displaying live metrics, drawing the force curve, saving workouts locally — all work fully offline. The service worker caches the app shell so even the first page load is instant on subsequent visits.

## Can I use ErgData simultaneously?

No. Bluetooth is point-to-point — only one device can be paired to the PM5 at a time. If you connect from this dashboard, ErgData on your phone won't see the erg, and vice versa. Disconnect from one before connecting from the other.

## How is my data stored?

Three places, in this order of preference:

1. **`localStorage`** in your browser — the primary cache. Workouts, plans, layout, and prefs all persist locally even if you never sign in.
2. **Google Drive `appdata` folder** — a hidden per-user folder that only this app can access (not other apps, not anyone else, not even me). One JSON file (`pm5dashboard-data.json`) per Google account, written on every state change. This is what lets your workouts follow you across devices.
3. **Nothing else.** There's no backend server. I can't see your data, your workouts, your HR, or anything else. The cross-user counter is fire-and-forget: when you log a workout, the app POSTs a +1 to counterapi.dev with no user identifier attached.

## Why no Firefox?

Mozilla [chose not to implement Web Bluetooth](https://mozilla.github.io/standards-positions/) — they argue the security model is hard to get right. So Firefox can't connect to BLE devices from a web page. The dashboard will load and let you build workouts / manage plans in Firefox, but the **Connect** button is dead. Use Chrome or Edge.

## Why no Safari?

Same reason as Firefox plus Apple's own policy. Safari has no Web Bluetooth and there's no third-party engine on iOS that could provide it.

## Does it work with the PM4 / PM3?

Untested. The BLE characteristic UUIDs in this app are PM5-specific. Older Concept2 monitors used different communication paths (PM3 over USB; PM4 had a limited BLE module that doesn't match the PM5's spec). It almost certainly won't work as-is.

## What about other ergs (Hydrow, RowErg, RP3)?

This app is built specifically for the **Concept2 PM5**. Other ergs publish their data over different protocols (RP3 has its own BLE spec; Hydrow doesn't expose live data at all). The architecture would port — the parsing layer is small — but I haven't done it.

## My PM5 won't connect

In rough order of likelihood:

1. **You're not on HTTPS.** Web Bluetooth requires HTTPS (or `localhost`). Use one of the deployed URLs (they're all HTTPS), or run `npx serve` and hit `http://localhost:3000`.
2. **Wrong browser.** Chrome / Edge / Brave only. See [Testing](testing.md#browsers) for the full matrix.
3. **PM5 firmware too old.** Check the Information menu on the monitor. Firmware 35+ is known good; older versions may not expose all BLE characteristics.
4. **The PM5 is already paired to another device.** Disconnect from ErgData on your phone, your laptop's OS-level Bluetooth, etc.
5. **The PM5 is sleeping.** Pull a stroke or two to wake it; the BLE radio sleeps after a few minutes of inactivity.
6. **Brave with Web Bluetooth disabled.** Brave ships with WB off by default. Enable at `brave://flags/#brave-web-bluetooth-api`.

If none of those work, open an issue with the steps above + your browser console output.

## Can multiple people use the app on the same erg?

Yes — but not simultaneously over the same Bluetooth pairing. The dashboard pairs to one PM5 from one browser at a time. If you and a teammate share a PM5, you each open the dashboard in your own browser, take turns connecting, take turns rowing. Your workouts go to your own Drive folders so they don't mix.

## I want my school / club to use this. What now?

The site is free to use. If you have feedback on features I should build for clubs, open an issue. The Phase 2 multi-coach mode (in the codebase, dormant) is specifically designed for clubs — when it ships you'll be able to share lineups with athletes via invite links.

## Can I self-host?

Yes. It's a single HTML file, a service worker, a manifest, and some icons. Drop the `pm5web/` folder onto any HTTPS static host — Netlify, Vercel, Cloudflare Pages, GitHub Pages, your own server. You'll want to:

1. Set up your own Google OAuth client ID at console.cloud.google.com and paste it into `GOOGLE_CLIENT_ID` near the top of `index.html`.
2. Add your hosting domain to the OAuth client's authorized origins.
3. Deploy.

If you also want the multi-coach Phase 2 features, see the `FIREBASE_CONFIG` block near the top of `index.html` — instructions are inline.
