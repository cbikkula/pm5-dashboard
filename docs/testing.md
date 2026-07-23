# Testing notes

What's been verified, where, and against which hardware. The dashboard talks directly to PM5 hardware over BLE — there are firmware, browser, and OS variables that all need to line up.

## PM5 firmware

| Firmware revision | Status | Notes |
|---|:---:|---|
| 35 | ✓ | Earliest version I tested. All four characteristics (GS1 / GS2 / Stroke Data / Force Curve) work. |
| 36–38 | ✓ | No protocol changes observed; same byte layouts as 35. |
| 39 | ✓ | Same. |
| < 35 | ? | Untested. The published spec (revision 1.30) covers 35+ — earlier firmware may not expose all four characteristics. |

The PM5 publishes its firmware version on the Information menu. If you hit a parsing bug, please include the firmware version in the issue (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## Browsers

| Browser | Connect | Render | PWA install | Drive sync | Notes |
|---|:---:|:---:|:---:|:---:|---|
| Chrome desktop (Windows) | ✓ | ✓ | ✓ | ✓ | Primary dev target. |
| Chrome desktop (macOS) | ✓ | ✓ | ✓ | ✓ | Works identically; PWA installs to the Mac dock. |
| Chrome desktop (Linux) | ✓ | ✓ | ✓ | ✓ | Confirmed on Ubuntu 22.04 with BlueZ. |
| Chrome Android (Pixel) | ✓ | ✓ | ✓ | ✓ | Install via menu → "Install app". Web Bluetooth requires Android 6.0+. |
| Chrome Android (Samsung) | ✓ | ✓ | ✓ | ✓ | Verified on Galaxy S22. Some older Samsungs aggressively kill background tabs — keep the dashboard in the foreground. |
| Edge desktop | ✓ | ✓ | ✓ | ✓ | Web Bluetooth + PWA pipeline is the same as Chrome (both Chromium). |
| Brave desktop | ✓ | ✓ | ✓ | needs setting | Brave disables Web Bluetooth by default — enable at `brave://flags/#brave-web-bluetooth-api`. |
| Opera desktop | ✓ | ✓ | ✓ | ✓ | Works; not extensively tested. |
| **Safari (any platform)** | ✗ | n/a | ~ | n/a | Safari does not implement Web Bluetooth and Apple has shown no signs of adding it. iOS users can't connect to the PM5 from any browser. |
| **Firefox (any platform)** | ✗ | n/a | ~ | n/a | Firefox does not implement Web Bluetooth (intentional decision; see [Mozilla's position](https://mozilla.github.io/standards-positions/)). |
| Samsung Internet | ✗ | n/a | ✓ | n/a | Installable as PWA but no Web Bluetooth. Use Chrome instead. |

## Operating systems

- **Windows 10 / 11** — fully working. Built-in BT stack pairs the PM5 cleanly.
- **macOS** (Sequoia tested) — fully working. The OS Bluetooth menu doesn't need to "pair" the PM5; the Web Bluetooth pairing dialog handles it directly.
- **Linux** (Ubuntu 22.04, BlueZ) — fully working. May need `bluetoothctl` to ensure your BT controller is up.
- **Android 13** — fully working with Chrome.
- **iOS / iPadOS** — not supported (Safari + no Web Bluetooth alternative). If you have an iPhone, you'll need to use a different device.

## Manual test plan

When releasing a new version I walk through this checklist:

1. **Cold connect.** Power-cycle the PM5. Open the app fresh, click Connect, pair. Verify status goes connected → strokes appear within 30 sec of rowing.
2. **Reconnect.** Disconnect the PM5 (turn it off). Reconnect. Verify no state corruption — distance / elapsed should reset cleanly.
3. **Force-curve overlays.** Row 5 strokes hard, then 5 strokes easy. Verify the best-stroke ghost is the hardest stroke; the average ghost trends between the two groups.
4. **Workout builder.** Build a 3-interval plan with mixed distance + time, save, use, complete. Verify per-interval results capture; verify history entry has correct totals.
5. **Benchmark test.** Tap **TEST** on 2k. Verify the active plan is `8 × 250 m, 0 rest`; verify monitor view shows the plan banner.
6. **Focus presets.** Cycle through all 6. Verify the layout, accent colours, and primary font sizes all update; verify Settings shows locked metrics for the active preset.
7. **Drive sync.** Sign in. Make a change. Sign in on a second device with the same Google account. Verify the change shows up.
8. **PWA install.** On Android Chrome: menu → Install. Verify it installs, opens standalone, the splash uses the maskable icon.
9. **Service worker update.** Bump cache version, deploy, hard-refresh. Verify the new version lands; verify offline reload still works.
10. **Themes.** Switch through all 8 themes. Verify no contrast catastrophes; verify the per-preset accent colours still read correctly against each theme.

## Performance budget

Corrected in v1.21.0 — the previous table dated from the ~330 KB single-file era and
had not been re-measured since.

| Metric | Guard / target | Last measured (v1.21.0) |
|---|---|---|
| Offline app size (index + analysis + curves + sw) | < 768 KB (enforced by `npm test`) | ~767 KB |
| index.html alone | < 660 KB (enforced) | ~640 KB |
| Curve payload, typical 30-min session | ≤ 512 KiB/session (enforced) | ~112 KB binary (1,500 strokes) |
| Curve decode (validate + index a full 512 KiB payload) | < 250 ms (enforced in suite) | ~15 ms (Node; see suite output) |
| Single-stroke curve decode during replay scrub | imperceptible | O(1), 64 samples via bounded LRU |
| First paint / interactive | no regression vs v1.20 | see release notes; re-measure per release |

Render-per-BLE-update and long-session memory figures from the old table were removed
rather than restated — they predate the current codebase and would be misleading.

## v1.21.0 note

The suite (see `npm run check` for the current assertion count — 400+ since v1.21.0)
runs all three app scripts — `analysis.js` + `curves.js` + the inline main script —
concatenated in one Node vm sandbox in load order. The v1.21 groups (curve codec,
retention, import/compat, stroke evidence, window baselines, replay curve sync) use
deterministic synthetic fixtures only; no personal workout data is committed.
