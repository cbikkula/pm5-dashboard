# Development timeline

The high-level arc, with rough phases. Because the repo wasn't initialized until late in the project (see [`reflection.md`](reflection.md)), individual commit dates don't tell the full story — this is the timeline I'd write if I could have committed at each phase.

```
v0.1     Python + PySide6 + bleak desktop prototype.
         BLE protocol parsed against the Concept2 spec.
         Off-by-3 alignment bug found, fixed.
         Force curve, drive length, ratio working.
         Distributable .exe via PyInstaller.

v0.2     Web port — the constraint was that my school laptop can't
         run downloaded programs, only a browser.
         Web Bluetooth replaces bleak; canvas replaces pyqtgraph;
         localStorage replaces filesystem.
         Feature parity reached.

v0.3     Workout builder. Programmable intervals (distance / time / rest).
         Per-interval results capture + post-workout summary table.
         Interval duplicate button + optional time cap.

v0.4     Google Identity Services + Drive sync.
         Per-user state isolation, merge-on-pull conflict resolution.
         Workouts follow you across devices.

v0.5     Configurable layout.
         Per-area card slots (left / right / bottom).
         8 themes.

v0.6     Heart-rate metrics + zones.
         18 HR-specific metrics: current zone, % max, % HRR,
         time-in-zone, drift, decoupling, recovery deltas, TRIMP.
         Per-user max/resting HR prefs.

v0.7     Focus presets + tier engine.
         Six curated layouts (Balanced, Technical, Power, Heart Rate,
         Endurance, Race).
         Tier-based card sizing — primary / secondary / passive.
         Per-preset body-class themes.
         Locked metrics: defining cards can't be removed without
         leaving the preset.

v0.8     Force-curve overlays.
         Best stroke ghost (hysteresis-stabilized).
         Running-mean average via Welford's online update.
         Peak markers + legend.

v0.9     Benchmark tests.
         11 standard distances with PR-tracking inputs.
         One-tap test workouts (2k → 8×250m, 5k → 10×500m, etc.).

v1.0     Public release.
         PWA install (Android home-screen install + offline shell).
         Cross-user "workouts logged" counter.
         Three Surge.sh mirror subdomains.

v1.0+    Phase 2 Firebase scaffolding shipped behind a placeholder
         config — Auth, Firestore, security rules, real-time
         listeners, sync chip UI. Dormant until config is filled in.

v1.2     Demo Mode shipped. First placed on the home menu as a
         dedicated card ("🎮 Try Demo"). It worked, but the home menu
         started feeling crowded — Just Row, Workouts, History, and
         Focus are all things you do regularly; Demo is something
         you try once and never again. Moved it into
         Settings → DEMO MODE in v1.2.1 so the home menu went back
         to five cards that all serve daily workflow. A useful
         reminder that "what features should ship" and "where they
         should live" are different decisions.
```

The repo's git history (from when I finally initialized it) lives at [`https://github.com/cbikkula/pm5-dashboard/commits/main`](https://github.com/cbikkula/pm5-dashboard/commits/main).
