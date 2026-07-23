# Physical PM5 qualification — v1.23.0 release gate

"Hardware Confidence" may not be tagged, released, or deployed until this checklist
passes on at least one physical PM5, using the exact release-candidate commit.
Simulated results (Demo Mode, transport simulator, unit fixtures) do not count as
physical validation. One passing PM5 does not prove every monitor/firmware/browser/OS
combination — record exactly what was tested.

## Record (no serial numbers or Bluetooth identifiers)

- PM5 firmware version (PM5 → More Options → Utilities → Product ID)
- Equipment type (RowErg / SkiErg / BikeErg)
- Operating system + version · Browser + version · Connection method (built-in radio/dongle)
- Test date · App commit hash (release candidate)

## Protocol (tester must NOT touch the browser while actively rowing)

1. Fresh connection (chip should read "Subscribed — waiting for PM5 data…" then "PM5 live") and clean disconnect.
2. Short continuous workout at an easy self-selected effort.
3. Workout containing an active section and a normal programmed rest — confirm NO stale warning during rest.
4. Confirm Force Curve, Drive Length, Ratio, rate, pace, watts, distance, elapsed all capture.
5. Complete the workout; reload; confirm the session persisted with `capture: "clean"`.
6. Open the session in Replay and Insights.
7. While stopped and safely able to operate the browser: intentionally disconnect (power off / walk out of range).
8. Reconnect to the same PM5; confirm the status chip claims "live" only after telemetry resumes.
9. Confirm no duplicate strokes or curves (stroke count on PM5 display vs stored session; Connection Diagnostics accepted/rejected counters).
10. Confirm any gap is labeled accurately (Replay badge + session `gaps`).
11. Row a second, new workout after reconnection; confirm it is a separate session.
12. Offline reload of the saved session.

## Measure

Time GATT-connect → first valid telemetry · packet cadence per family (Diagnostics
counters over a timed minute) · time to stale indication after power-off ·
reconnect time · duplicate strokes (must be 0) · missing strokes vs PM5 display ·
gap duration accuracy · Force Curve coverage (retained/total).

Compare stored events against the PM5 display; report exact discrepancies, never
"looks correct". Use synthetic/test rows only — do not commit or publish private
workout exports.
