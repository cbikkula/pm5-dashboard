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

## Per-stroke Force Curve codec (v1.21)

Every completed stroke's curve is resampled to the standard 64-sample grid at capture
and stored once per session as a compact versioned binary payload in IndexedDB.

**Layout (little-endian).** Header, 16 bytes: magic `PMCV` (0x50 4D 43 56) · codec
version (1) · samples per curve (64) · record count (u16) · total strokes in the session
(u32) · FNV-1a checksum of the record region (u32 — corruption *detection* only, never a
security guarantee). Records, fixed 76 bytes each: stroke ordinal, 1-based, strictly
increasing (u32) · distance at the stroke in metres (u32) · peak force in 0.1 lbf (u16)
· flags (bit0 = synthetic/demo) · reserved · 64 samples, each `u8 =
round(force/peak × 255)`.

**Fidelity.** The representation is *lossy*: samples are peak-scaled 8-bit, so worst-case
per-sample reconstruction error is `peak/510` ≈ 0.196 % of peak (±0.35 lbf at a 180 lbf
peak); the peak itself is stored exactly to 0.1 lbf; peak-timing position can shift by at
most one sample (1/63 of the drive); shape similarity of original vs reconstructed
rounds to 100. Reconstructed curves are never bit-exact and the UI says so.

**Random access.** Fixed-size records give O(1) decoding of any stroke; replay builds an
ordinal→record index by scanning only the 4 ordinal bytes per record, validates the
payload once, then decodes lazily behind a 48-entry LRU cache. Stroke identity is exact:
sample-log position `j` maps to raw ordinal `j × strokeStride + 1`; a stroke whose curve
wasn't retained reports "no stored curve" — a nearby curve may be offered but always
labelled with its own stroke number.

**Validation (fails closed).** Unknown codec versions, magic/size mismatches, counts
inconsistent with the actual byte length, checksum failures, out-of-order ordinals,
non-finite inputs, and payloads over budget are all rejected; base64 input longer than
the 512 KiB-equivalent cap is refused before decoding, so hostile declared lengths never
drive allocation.

## Storage budget and retention (v1.21)

Hard ceiling: **512 KiB of serialized curve detail per session** (= 6,898 records) —
enough to keep *every* stroke of a 2k, 5k, 6k, 30-minute, typical interval session, or
anything up to roughly a 3.5-hour row. In-memory capture stride-doubles above 8,192
strokes (≈ 4.5 h) as a memory backstop.

Beyond the ceiling, retention is deterministic and priority-ordered: (1) the first and
final valid strokes, (2) strokes nearest each anchor distance — bookmarks, drift-event
boundaries, interval transitions, race-segment transitions — then (3) the remaining
slots spread evenly across the whole session (ideal grid positions, walking past
already-kept indexes; no randomness). Exact retained-vs-total counts are stored in
`entry.curveMeta` and shown in replay. Coverage states: `complete`, `partial`,
`unavailable` (storage failed — the workout summary is still saved), `legacy`
(pre-v1.21), `removed`. A quota or codec failure can downgrade coverage but never
touches the session summary, and existing curve detail is never silently evicted —
deleting a session is the one action that deletes its curves.

## Stroke evidence selection (v1.21)

Over the stroke timeline, with deterministic ties (earliest stroke wins):

- *Valid stroke*: split present and 60–360 s/500 m. *Artifact*: a split deviating from
  the median of its ±3 valid neighbours by more than `max(12 s, 25 %)` **while both
  adjacent strokes sit within 12 % of that median** — an isolated spike (dropped BLE
  packet), excluded. A sustained change (paddle break, sprint) is kept.
- **Fastest / slowest** = lowest / highest valid split (≥ 5 valid strokes required).
- **Most typical** = retained curve with the highest cosine shape-similarity to the mean
  of all retained curves, each peak-normalised first (≥ 5 curves required).
- **Closest to baseline / largest deviation** = highest / lowest shape similarity vs the
  active personal baseline curve.

These labels describe *selection rules*, not quality: the fastest stroke is never called
the best-technique stroke, and baseline similarity is a shape comparison, not proof of
correctness.

## Window / interval / race-segment baselines (v1.21)

A window baseline averages **only the retained curves** inside a stroke range — a marked
range, a rolling window, an interval (mapped by cumulative distance), a Race Lab segment
(`fromM–toM`), the steadiest 20-stroke section (lowest pace CV), or the same
interval/segment of a *previous compatible* session (same compatibility rule as the
Baseline Engine; synthetic demo sessions never back a real comparison). Each result
reports retained vs total stroke counts, the exact range, Drive Length / Ratio / split
mean ± sd over the range, and a transparent confidence: `high` needs ≥ 20 curves at
≥ 80 % coverage, `medium` ≥ 8, else `low`; below 8 curves the result is "insufficient"
— a legacy session without stored curves never fabricates a baseline.

## Known PM5 data limitations

- Since v1.21 per-stroke force curves *are* persisted (see the codec above) at 64
  samples per stroke — the PM5's raw per-packet samples are not kept beyond that grid.
- Drive time is a 1-byte field (max 2.55 s); heart rate arrives via the PM5's strap relay
  and is filtered to 30–240 bpm; force samples are 0.1 lbf resolution.
- Watts in the stroke log are derived from pace ((2.8/(pace/500)³)), the PM5's own
  convention, not an independent strain measurement.

## Insights: cross-session evidence (v1.22)

Everything on the Insights page is computed by pure functions in `pm5web/insights.js`
from stored session summaries. No causation, readiness, recovery, injury-risk, or
"perfect stroke" claims are ever generated — templates only allow measured,
evidence-linked statements.

**Session facts.** Each stored session reduces to one summary row (the aggregation
unit everywhere, so a marathon counts exactly as much as a 2k): medians and
IQR-based spreads of Drive Length, Ratio (recovery/drive time), pace (60–360 s
plausibility filter), rate, peak timing, and power per stroke
(`watts ÷ (spm/60)`, both fields must be plausible on the same stroke). Non-finite
and object-valued fields are rejected; entries without usable totals are excluded
with a stated reason.

**Cohorts and ranges.** Ranges use LOCAL calendar days ("last 7 days" = today plus
the 6 prior days, inclusive). "Previous equal period" is the window of identical
length immediately before period A; custom A/B windows are day-inclusive. Filters
(workout type, distance bounds, Race Lab plans, benchmark) and the synthetic-session
toggle (off by default) apply before period assignment; every excluded session
carries one deterministic reason.

**Robust statistics.** Medians everywhere; dispersion = interquartile range
(needs ≥4 values). Relative spread = IQR/|median| × 100, refused when |median| <
1e-6 (percentage-safety rule). Within-session variability (a session's own spread)
is always reported separately from between-session change (movement of session
medians).

**Findings.** For each metric in the documented catalogue (priority order: Force
Curve similarity, Drive Length, DL spread, Ratio, Ratio spread, peak timing, power
per stroke, pace, pacing spread, race execution): a CHANGE finding requires ≥3
usable sessions per period, |Δ of medians| ≥ the metric's absolute threshold
(curve similarity 3 pts · DL 0.03 m · DL spread 1.5 pp · Ratio 0.15 · Ratio spread
3 pp · peak timing 0.03 · power/stroke 8 J · pace 1.5 s · pacing spread 1 pp ·
race exec 1.5 s), and ≥70% of period-A sessions on the same side of the period-B
median. A STABLE finding needs |Δ| under half the threshold, small dispersion, ≥4
sessions, and at most one is shown. Pace findings additionally require a mutually
comparable cohort (one shared benchmark, or all distances within ×1.25) — mixed
cohorts state that instead of guessing. Absolute change is always reported before
percentage; percentages are omitted when the baseline median is below twice the
threshold. One finding per metric family; at most three findings, ordered by
confidence → catalogue priority → |relative change| → key (deterministic ties).
Confidence is a documented sum: ≥5 sessions per side (+2, else ≥3 +1), ≥85%
directional agreement (+1), ≥90% metric completeness (+1), ≥70% complete curve
coverage for curve metrics (+1); high ≥4, medium ≥2, low otherwise. Insufficient
data returns structured reasons and is presented as a valid result.

**Force Curve trends.** One representative curve per session: the persisted
64-sample session average (`entry.fc.avg`) — page load decodes no curve payloads.
Similarity uses the shared cosine shape measure against ONE fixed reference (the
active baseline, captured when the page renders and labeled on the chart; it never
silently changes between points). Normalized (shape) and absolute (peak lbf) views
are separate charts. Within-session curve consistency decodes ≤16 evenly-spaced
stored curves for at most the 12 most recent covered sessions, lazily, behind a
40-entry cache keyed by session id + retained count; results are the median
similarity of each sampled curve to their mean shape; stale computations are
cancelled by generation counter when filters change. Partial retention is labeled;
legacy sessions are skipped, never fabricated.

**Race execution.** Per session: median of |stroke elapsed − plan time at that
stroke's distance| over ≥10 usable strokes — an estimate relative to the selected
plan only. Power bests reuse the power-profile engine on the cohort subset;
ordinary rows are never treated as confirmed maximal tests.

**Comparable-session explorer.** The Baseline Engine compatibility rule (same
benchmark key, or distance/duration within ±20%). Incompatible sessions are never
substituted; synthetic sessions never back a real comparison.
