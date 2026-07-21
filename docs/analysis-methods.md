# Analysis methods

Every score, estimate, and cue in PM5 Dashboard, with its exact inputs, formula, and
insufficient-data behavior. All analysis lives in [`pm5web/analysis.js`](../pm5web/analysis.js)
as pure functions with deterministic tests in [`tests/run.js`](../tests/run.js).

Guiding rules: nothing is invented when data is missing; estimates are labeled; a personal
baseline is evidence from *your* rowing, never a universal biomechanical ideal; no medical,
injury, or readiness claims.

## Force Curve fundamentals

- **Resampling** (`resampleCurve`, since v1.5): every stored/compared curve is linearly
  interpolated to **64 samples** (`FC_SAMPLES`). Raw PM5 curves are 24–40 samples. Curves
  under 2 samples → `null`.
- **Shape metrics** (`curveShapeMetrics`, v1.19): requires ≥ 8 samples and a positive peak.
  - *peakPos* = argmax / (n−1), 0–1 of the drive.
  - *frontLoad* = Σ force in the first half of the drive ÷ total force area (early-peaked
    drives > 0.5).
  - *smoothness* = clamp(100 − max(0, J − 0.004) × 3000, 0, 100) where J = mean |second
    difference| of the peak-normalized curve.
- **Similarity** (`curveSimilarity`, v1.19): cosine similarity of two peak-normalized,
  64-sample curves × 100. A **shape** measure — scaling a curve by any factor gives 100.
  Unusable input (< 8 samples, zero peak) → `null`.
- **Normalized vs absolute** (Compare tab, v1.19): normalized view rescales each curve to
  peak = 100 and is always labeled "normalized — shape view"; absolute view is raw lbf.

## Personal Baseline Engine (v1.20)

A baseline = `{source, label, curve|null, stats|null, n, dateRange, confidence}`.
`stats` holds mean + CV (%) for Drive Length, Ratio (recovery÷drive), pace, rate, and
peak timing, each requiring ≥ 10 valid finite samples (`strokeStatsOf`).

Sources (`resolveBaseline`):
- **auto** — newest saved session with capture data that is *compatible* with the current work.
- **rolling** — up to 5 recent mutually-compatible sessions; curves averaged sample-wise at
  64 points, stats pooled over all strokes; needs ≥ 2 sessions.
- **locked** — a snapshot of today's average stroke (`⭑ Lock ref` on the Force Curve card),
  stored in preferences (Drive-synced) until changed or cleared.
- **section** — the 20-stroke window of the current session with the lowest pace CV
  (warm-up strokes 1–10 excluded); needs ≥ 30 strokes.
- **off** — no baseline; overlays and vs-baseline cues disappear.

**Compatibility** (`sessionsCompatible`): identical `benchKey`, OR total distance within
±20%, OR total duration within ±20%. Incompatible sessions never pool.

**Confidence** (`baselineConfidence`) is data sufficiency only:
high = ≥ 3 sessions ∧ ≥ 150 strokes ∧ curves saved · medium = ≥ 40 strokes ∧ curves ·
low = anything less, with the reason stated. Shown in Settings with source, sample size,
and date range.

## Live cues (v1.20)

`computeLiveCues(log, baseline, {sensitivity})` compares the **last 15 strokes** against
the baseline stats (falling back to strokes 11–25 of this session) and yields prioritized
candidates; `applyCueGovernor` decides what is shown.

Thresholds (× sensitivity factor: relaxed 1.5, normal 1.0, attentive 0.7):

| Cue | Trigger | Reference |
|---|---|---|
| Drive Length | mean drop > 3% | baseline `dl.mean` or early strokes |
| Ratio | mean change > 12% | baseline `ratio.mean` or early strokes |
| Peak timing | mean shift > 0.06 of drive | baseline **curve** peakPos |
| Pace fade | pace > 2.5% slower ∧ rate +1 spm | early strokes |

Governor: a cue must persist **3 consecutive evaluations** (evaluations run every 5th
stroke ⇒ ~15 strokes) to appear; **3 stable evaluations** to clear; after clearing, the
same cue is silent for a **6-evaluation cooldown**; only the highest-priority cue shows;
quiet mode records events without showing anything; "off" disables evaluation. Fired/cleared
cues are recorded as **drift events** (≤ 50/session, `{t, d, id, text, tEnd}`) and saved
with the session for replay navigation. One-stroke noise can never alert (a single bad
stroke cannot survive three 15-stroke-window evaluations).

## Race Lab (v1.20)

- **Plan** (`buildRacePlan(distance ≥ 300 m, strategy, base split 60–300 s)`): segments
  start (5%, ≥ 100 m, base −4 s) → settle (10%, base +1) → base → [push] → sprint (10%,
  200–300 m, base −3). Strategies shift the base/push halves: even 0/0, negative +1.5/−1.5,
  positive −1.5/+1.5. Segments tile the distance exactly.
- **Predicted finish** = Σ (segment length ÷ 500 × segment target pace). Arithmetic over
  the plan, labeled a prediction.
- **Live status** (`computeRaceStatus`): plan time at current distance by piecewise
  segment integration; **delta = elapsed − plan time** (± 1.5 s band = "on plan");
  **projected finish** = elapsed + remaining ÷ 500 × rolling pace (mean of last ~10
  captured strokes — assumes you keep rowing like the last minute, not your best split).
- **Debrief** (`computeRaceDebrief`): per-segment actual pace = mean of captured strokes
  windowed by distance (needs ≥ 3 strokes/segment); **time gained/lost per segment =
  (actual − planned) segment time — an estimate relative to the selected plan only**, and
  the debrief says so verbatim. Fade = % pace change first→last base segment; sprint lift
  = % pace gain vs preceding segment. Findings are capped at 3, ordered by |time delta|:
  best segment, biggest opportunity (with a Drive-Length observation only when the data
  shows ≥ 2.5% shortening, phrased as correlation not cause), then a fade/sprint pattern.
  No race meta or < 10 strokes → no debrief, never a fabricated one.

## Rowing power profile (v1.20)

- **Windows**: best rolling average watts over 1:00 / 4:00 / 8:00 / 20:00
  (`bestRollingPower`) inside each captured session; a window counts only when its time
  span ≥ 90% of the target and stroke coverage ≥ 80% at a 20 spm floor. All-time and
  90-day bests are reported separately with source session and date.
- **Pace equivalent** = (2.8 ÷ W)^⅓ × 500 (the standard Concept2 relationship).
- **Critical power** (estimate, only when defensible): linear work–time model
  W_total = CP·t + W′ least-squares over **formal benchmark Tests only** (distinct
  `benchKey`s, avg watts, ≥ 2:00, longest ÷ shortest ≥ 2). Ordinary training rows are
  never treated as maximal efforts. Missing prerequisites → the UI states exactly which
  Tests are needed. Sanity bounds: 40 < CP < 1000 W, W′ > 0.
- Not a readiness/recovery score by design.

## Technical-efficiency score (v1.18, transparency v1.19)

Weighted components, each 0–100, weights renormalized over the components that could be
scored (unscored ones are listed with the reason): curve smoothness 35% (session-average
curve), peak timing 25% (ideal band 30–45% of drive, −400/unit outside), rhythm 20%
(ratio in 1.8–2.8 band −60/unit outside, minus CV over 6% × 2.5), length consistency 20%
(100 − (CV − 2) × 12). Labeled session-relative guidance, not a universal ranking.

## Known PM5 data limitations

- Per-stroke force curves are not persisted (storage budget) — sessions save best +
  average curves; replay shows session-level curves only.
- Drive time is a 1-byte field (max 2.55 s); heart rate arrives via the PM5's strap relay
  and is filtered to 30–240 bpm; force samples are 0.1 lbf resolution.
- Watts in the stroke log are derived from pace ((2.8/(pace/500)³)), the PM5's own
  convention, not an independent strain measurement.
