/* PM5 Dashboard — Insights module (v1.22.0): deterministic cross-
 * session evidence. Pure engine first, page renderer + charts after.
 * Classic script after curves.js, network-first in the SW. Every
 * threshold and rule is documented in docs/analysis-methods.md. */

// Robust statistics — deterministic, null-tolerant, no mutation.
function insFinite(v) { return typeof v === "number" && isFinite(v); }
function insMedian(vs) {
  const s = vs.filter(insFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function insIqr(vs) {
  const s = vs.filter(insFinite).slice().sort((a, b) => a - b);
  if (s.length < 4) return null;
  const q = p => {
    const t = p * (s.length - 1), lo = Math.floor(t), hi = Math.ceil(t);
    return s[lo] + (s[hi] - s[lo]) * (t - lo);
  };
  return q(0.75) - q(0.25);
}
// Relative spread (%): IQR/|median| — null when the denominator is too
// small for a stable percentage (documented percentage-safety rule).
function insSpreadPct(vs) {
  const med = insMedian(vs), iqr = insIqr(vs);
  if (med == null || iqr == null || Math.abs(med) < 1e-6) return null;
  return (iqr / Math.abs(med)) * 100;
}

// Session facts — ONE summary row per session (the aggregation unit
// everywhere: a marathon contributes one point, same as a 2k). Never
// mutates the entry.
function sessionFacts(entry) {
  if (!entry || typeof entry !== "object") return null;
  const T = entry.totals || {};
  const distanceM = insFinite(T.distanceM) ? T.distanceM : 0;
  const elapsedS = insFinite(T.elapsedS) ? T.elapsedS : 0;
  if (distanceM <= 0 && elapsedS <= 0) return null;
  const dateMs = Date.parse(entry.date);
  if (!isFinite(dateMs)) return null;
  const samples = Array.isArray(entry.strokes) ? entry.strokes : [];
  const col = f => samples.map(f).filter(insFinite);
  const dls = col(s => s && s.dl), rates = col(s => s && s.r);
  const paces = col(s => s && s.p).filter(v => v >= 60 && v <= 360);
  const ratios = samples.map(s => (s && insFinite(s.dt) && insFinite(s.rt) && s.dt > 0) ? s.rt / s.dt : null)
    .filter(insFinite);
  const pts = col(s => s && s.pt).filter(v => v >= 0 && v <= 1);
  // Power per stroke (J) = watts / (strokes per second); valid only
  // when BOTH watts and rate are plausible on that stroke.
  const pps = samples.map(s => (s && insFinite(s.w) && insFinite(s.r) && s.w > 0 && s.r >= 10 && s.r <= 60)
    ? s.w / (s.r / 60) : null).filter(insFinite);
  const hrN = col(s => s && s.hr).length;
  const nIv = Array.isArray(entry.results)
    ? entry.results.filter(r => r && (r.distanceM > 0 || r.elapsedS > 0)).length : 0;
  const cm = entry.curveMeta;
  const curveCoverage =
    (cm && ["complete", "partial", "unavailable", "removed"].includes(cm.coverage)) ? cm.coverage
    : (samples.length >= 2 ? "legacy" : "none");
  const fcAvg = entry.fc && Array.isArray(entry.fc.avg) && entry.fc.avg.length >= 8
    ? entry.fc.avg : null;
  const avgPaceS = insFinite(T.avgPaceS) && T.avgPaceS > 0 ? T.avgPaceS
    : (distanceM > 0 && elapsedS > 0 ? (elapsedS / distanceM) * 500 : null);
  const keyMetrics = [avgPaceS, insFinite(T.avgWatts) ? T.avgWatts : null,
    insMedian(dls), insMedian(ratios), insMedian(rates), fcAvg ? 1 : null];
  return {
    id: String(entry.id || ""), dateISO: String(entry.date || ""), dateMs,
    title: String(entry.title || "Session"),
    demo: entry.demo === true, recovered: entry.recovered === true,
    type: nIv > 1 ? "interval" : "continuous",
    benchKey: (entry.plan && entry.plan.benchKey) || null,
    hasRace: !!(entry.plan && entry.plan.race),
    planTitle: (entry.plan && entry.plan.title) || null,
    distanceM, elapsedS, avgPaceS,
    avgWatts: insFinite(T.avgWatts) && T.avgWatts > 0 ? T.avgWatts : null,
    strokeN: samples.length, intervalN: nIv,
    dlMed: insMedian(dls), dlSpreadPct: insSpreadPct(dls),
    ratioMed: insMedian(ratios), ratioSpreadPct: insSpreadPct(ratios),
    rateMed: insMedian(rates),
    paceMed: insMedian(paces), paceSpreadPct: insSpreadPct(paces),
    ptMed: insMedian(pts), ppsMed: insMedian(pps),
    hrCoverage: samples.length ? hrN / samples.length : 0,
    curveCoverage, curveRetained: cm ? cm.retained : 0, curveTotal: cm ? cm.total : 0,
    interrupted: typeof entry.capture === "string" && entry.capture.startsWith("interrupted") ||
      entry.capture === "ended-on-disconnect",
    fcAvg, fcPeak: entry.fc && insFinite(entry.fc.peak) ? entry.fc.peak : null,
    completeness: keyMetrics.filter(v => v != null).length / keyMetrics.length,
  };
}

// Cohorts — period + filters with stable exclusion reasons. Ranges
// are LOCAL calendar days ("7d" = today + 6 prior, inclusive); "prev"
// = the equal-length window immediately before A. Deterministic via
// opts.nowMs.
function insDayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function insDayEnd(ms) { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); }

function buildInsightsCohort(history, opts) {
  opts = opts || {};
  const nowMs = insFinite(opts.nowMs) ? opts.nowMs : 0;
  const days = { "7d": 7, "28d": 28, "90d": 90 }[opts.range];
  let aFrom, aTo;
  if (opts.range === "custom" && insFinite(opts.fromMs) && insFinite(opts.toMs)) {
    aFrom = insDayStart(Math.min(opts.fromMs, opts.toMs));
    aTo = insDayEnd(Math.max(opts.fromMs, opts.toMs));
  } else if (days) {
    aTo = insDayEnd(nowMs);
    aFrom = insDayStart(nowMs - (days - 1) * 86400000);
  } else { aFrom = -Infinity; aTo = insDayEnd(nowMs || 8640000000000000); }  // "all"
  let bFrom = null, bTo = null;
  if (opts.compare === "custom" && insFinite(opts.bFromMs) && insFinite(opts.bToMs)) {
    bFrom = insDayStart(Math.min(opts.bFromMs, opts.bToMs));
    bTo = insDayEnd(Math.max(opts.bFromMs, opts.bToMs));
  } else if (opts.compare === "prev" && isFinite(aFrom)) {
    const len = aTo - aFrom;
    bTo = aFrom - 1;
    bFrom = aFrom - 1 - len;
  }
  const a = [], b = [], excluded = [];
  const drop = (e, reason) => excluded.push({
    id: String((e && e.id) || ""), title: String((e && e.title) || "Session"), reason });
  for (const e of (Array.isArray(history) ? history : [])) {
    const f = sessionFacts(e);
    if (!f) { drop(e, "no usable totals"); continue; }
    if (f.demo && !opts.includeSynthetic) { drop(e, "synthetic demo session (excluded by default)"); continue; }
    if (opts.type && opts.type !== "all" && f.type !== opts.type) { drop(e, "workout-type filter"); continue; }
    if (insFinite(opts.minDistM) && f.distanceM < opts.minDistM) { drop(e, "distance filter"); continue; }
    if (insFinite(opts.maxDistM) && f.distanceM > opts.maxDistM) { drop(e, "distance filter"); continue; }
    if (opts.racePlanOnly && !f.hasRace) { drop(e, "Race Lab plan filter"); continue; }
    if (opts.benchKey && f.benchKey !== opts.benchKey) { drop(e, "benchmark filter"); continue; }
    if (f.dateMs >= aFrom && f.dateMs <= aTo) a.push(f);
    else if (bFrom != null && f.dateMs >= bFrom && f.dateMs <= bTo) b.push(f);
    else drop(e, "outside selected period");
  }
  const byDate = (x, y) => x.dateMs - y.dateMs || (x.id < y.id ? -1 : 1);
  a.sort(byDate); b.sort(byDate);
  return {
    a: { facts: a, fromMs: aFrom, toMs: aTo },
    b: bFrom != null ? { facts: b, fromMs: bFrom, toMs: bTo } : null,
    excluded,
    coverage: {
      withCurves: a.filter(f => f.curveCoverage === "complete" || f.curveCoverage === "partial").length,
      complete: a.filter(f => f.curveCoverage === "complete").length,
      legacy: a.filter(f => f.curveCoverage === "legacy" || f.curveCoverage === "none").length,
      withStrokes: a.filter(f => f.strokeN >= 2).length,
      completenessMed: insMedian(a.map(f => f.completeness)),
    },
  };
}

// Metric catalogue — priority order mirrors the product priorities
// (Force Curve, DL, Ratio first); thresholds are ABSOLUTE minimum
// changes; "lowerBetter" only affects wording.
const INS_METRICS = [
  { key: "curveSim", family: "curve", label: "Normalized Force Curve similarity to baseline",
    unit: "%", thresh: 3, decimals: 0, normalized: true, needsCurve: true },
  { key: "dlMed", family: "dl", label: "Drive Length (session median)",
    unit: "m", thresh: 0.03, decimals: 2 },
  { key: "dlSpreadPct", family: "dl", label: "Drive Length within-session spread",
    unit: "pp", thresh: 1.5, decimals: 1, lowerBetter: true, spread: true },
  { key: "ratioMed", family: "ratio", label: "Ratio (session median)",
    unit: ":1", thresh: 0.15, decimals: 2 },
  { key: "ratioSpreadPct", family: "ratio", label: "Ratio within-session spread",
    unit: "pp", thresh: 3, decimals: 1, lowerBetter: true, spread: true },
  { key: "ptMed", family: "timing", label: "Peak-force timing (fraction of drive)",
    unit: "", thresh: 0.03, decimals: 2 },
  { key: "ppsMed", family: "power", label: "Power per stroke",
    unit: "J", thresh: 8, decimals: 0 },
  { key: "paceMed", family: "pace", label: "Pace (session median split)",
    unit: "s/500m", thresh: 1.5, decimals: 1, lowerBetter: true, needsComparable: true },
  { key: "paceSpreadPct", family: "pace", label: "Pacing within-session spread",
    unit: "pp", thresh: 1, decimals: 1, lowerBetter: true, spread: true },
  { key: "raceExec", family: "race", label: "Race-plan execution (median |delta| vs plan)",
    unit: "s", thresh: 1.5, decimals: 1, lowerBetter: true, needsRace: true },
];

// Median absolute deviation from the race plan, one value per session:
// for each captured stroke, |elapsed − plan time at that distance|.
// An execution ESTIMATE relative to the selected plan only.
function sessionRaceExec(entry) {
  if (!entry || !entry.plan || !entry.plan.race || !Array.isArray(entry.strokes)) return null;
  const ds = [];
  for (const s of entry.strokes) {
    if (!s || !insFinite(s.t) || !insFinite(s.d) || s.d <= 0) continue;
    const planT = planTimeAtDistance(entry.plan.race, s.d);
    if (insFinite(planT)) ds.push(Math.abs(s.t - planT));
  }
  return ds.length >= 10 ? insMedian(ds) : null;
}

// Are the sessions of a cohort mutually comparable for PACE findings?
// Same benchmark key, or all distances within ×1.25 of each other.
function insPaceComparable(facts) {
  if (facts.length < 2) return false;
  const keys = new Set(facts.map(f => f.benchKey).filter(Boolean));
  if (keys.size === 1 && facts.every(f => f.benchKey)) return true;
  const ds = facts.map(f => f.distanceM).filter(v => v > 0);
  if (ds.length !== facts.length) return false;
  return Math.max(...ds) / Math.min(...ds) <= 1.25;
}

// Findings — ≤3, conservative, evidence-linked. Change: ≥3 sessions
// per side, |delta| ≥ threshold, ≥70% directional agreement vs the
// period-B median. One finding per family; ties break by confidence →
// priority → |rel delta| → key. Template wording only: no causation,
// medical/readiness claims, or "perfect" curves.
function insValueOf(f, key, ctx) {
  if (key === "curveSim") {
    const sim = ctx && ctx.curveSim ? ctx.curveSim.get(f.id) : undefined;
    return insFinite(sim) ? sim : null;
  }
  if (key === "raceExec") {
    const v = ctx && ctx.raceExec ? ctx.raceExec.get(f.id) : undefined;
    return insFinite(v) ? v : null;
  }
  const v = f[key];
  return insFinite(v) ? v : null;
}

function insConfidence(nA, nB, consistency, completeness, extra) {
  let score = 0;
  const why = [];
  if (Math.min(nA, nB) >= 5) { score += 2; why.push(`${nA}+${nB} comparable sessions`); }
  else if (Math.min(nA, nB) >= 3) { score += 1; why.push(`only ${Math.min(nA, nB)} sessions on one side`); }
  if (consistency >= 0.85) { score += 1; why.push(`${Math.round(consistency * 100)}% of sessions agree in direction`); }
  else why.push(`${Math.round(consistency * 100)}% directional agreement`);
  if (completeness >= 0.9) { score += 1; why.push("metric data mostly complete"); }
  else why.push("some sessions missing metrics");
  if (extra) { score += extra.score || 0; if (extra.why) why.push(extra.why); }
  return { level: score >= 4 ? "high" : score >= 2 ? "medium" : "low", why: why.join(" · ") };
}

function generateInsightsFindings(cohort, ctx) {
  ctx = ctx || {};
  const A = cohort.a.facts, B = cohort.b ? cohort.b.facts : [];
  const out = { findings: [], insufficient: [], candidates: 0 };
  if (!cohort.b) {
    out.insufficient.push({ reason: "No comparison period selected — pick a comparison to compute change findings." });
  }
  if (A.length < 3 || B.length < 3) {
    out.insufficient.push({ reason:
      `Change findings need at least 3 usable sessions in each period (have ${A.length} and ${B.length}).` });
  }
  const candidates = [];
  const paceOk = insPaceComparable(A.concat(B));
  for (const m of INS_METRICS) {
    if (m.needsComparable && !paceOk) {
      out.insufficient.push({ metric: m.key,
        reason: "Pace sessions in the selected periods are not mutually comparable (mixed distances/plans) — pace change is not computed." });
      continue;
    }
    const va = A.map(f => insValueOf(f, m.key, ctx)).filter(insFinite);
    const vb = B.map(f => insValueOf(f, m.key, ctx)).filter(insFinite);
    if (va.length < 3 || vb.length < 3) {
      if (va.length || vb.length) out.insufficient.push({ metric: m.key,
        reason: `${m.label}: only ${va.length} vs ${vb.length} sessions carry this metric (minimum 3 each).` });
      continue;
    }
    const medA = insMedian(va), medB = insMedian(vb);
    const delta = medA - medB;
    const dir = delta >= 0 ? 1 : -1;
    const consistency = va.filter(v => dir > 0 ? v > medB : v < medB).length / va.length;
    const completeness = (va.length / A.length + vb.length / B.length) / 2;
    const relPct = Math.abs(medB) > (m.thresh * 2) ? (delta / Math.abs(medB)) * 100 : null;
    const idsA = A.filter(f => insValueOf(f, m.key, ctx) != null).map(f => f.id);
    const idsB = B.filter(f => insValueOf(f, m.key, ctx) != null).map(f => f.id);
    const strokesN = A.concat(B).reduce((t, f) => t + (f.strokeN || 0), 0);
    if (Math.abs(delta) >= m.thresh && consistency >= 0.7) {
      const worse = m.lowerBetter ? delta > 0 : delta < 0;
      const moved = m.spread
        ? (delta < 0 ? "was more consistent" : "varied more")
        : (m.lowerBetter ? (delta < 0 ? "improved" : "slowed") : (delta > 0 ? "increased" : "decreased"));
      candidates.push({
        metric: m.key, family: m.family, kind: "change", priority: INS_METRICS.indexOf(m),
        text: `${m.label} ${moved}: ${fmtInsVal(medB, m)} → ${fmtInsVal(medA, m)} ` +
          `(${delta > 0 ? "+" : ""}${fmtInsVal(delta, m)}${relPct != null ? `, ${relPct > 0 ? "+" : ""}${relPct.toFixed(0)}%` : ""}) ` +
          `across ${va.length} vs ${vb.length} comparable sessions.`,
        absDelta: delta, relPct, tone: worse ? "watch" : "good",
        normalized: !!m.normalized,
        periods: { a: { fromMs: cohort.a.fromMs, toMs: cohort.a.toMs, n: va.length },
                   b: { fromMs: cohort.b.fromMs, toMs: cohort.b.toMs, n: vb.length } },
        evidence: { metric: m.key, sessionIds: idsA, comparisonIds: idsB },
        strokesN,
        confidence: insConfidence(va.length, vb.length, consistency, completeness,
          m.needsCurve ? { score: cohortCurveScore(A), why: curveCoverageNote(A) } : null),
        missing: completeness < 1 ? [`${Math.round((1 - completeness) * 100)}% of period sessions lack this metric`] : [],
      });
    } else if (Math.abs(delta) < m.thresh / 2 && (insIqr(va) || 0) <= m.thresh * 2 && va.length >= 4) {
      candidates.push({
        metric: m.key, family: m.family, kind: "stable", priority: INS_METRICS.indexOf(m) + 100,
        text: `${m.label} held steady at ${fmtInsVal(medA, m)} across ${va.length} sessions ` +
          `(vs ${fmtInsVal(medB, m)} in the previous period).`,
        absDelta: delta, relPct: null, tone: "good", normalized: !!m.normalized,
        periods: { a: { fromMs: cohort.a.fromMs, toMs: cohort.a.toMs, n: va.length },
                   b: { fromMs: cohort.b.fromMs, toMs: cohort.b.toMs, n: vb.length } },
        evidence: { metric: m.key, sessionIds: idsA, comparisonIds: idsB },
        strokesN,
        confidence: insConfidence(va.length, vb.length, 1, completeness, null),
        missing: [],
      });
    }
  }
  out.candidates = candidates.length;
  // One finding per family, change beats stable, then deterministic order.
  const rank = { high: 0, medium: 1, low: 2 };
  candidates.sort((x, y) =>
    rank[x.confidence.level] - rank[y.confidence.level] ||
    x.priority - y.priority ||
    Math.abs(y.relPct || 0) - Math.abs(x.relPct || 0) ||
    (x.metric < y.metric ? -1 : 1));
  const seenFamily = new Set();
  let stableUsed = 0;
  for (const c of candidates) {
    if (seenFamily.has(c.family)) continue;              // redundancy suppression
    if (c.kind === "stable" && stableUsed >= 1) continue; // at most one stability finding
    seenFamily.add(c.family);
    if (c.kind === "stable") stableUsed++;
    out.findings.push(c);
    if (out.findings.length >= 3) break;
  }
  if (!out.findings.length && A.length >= 3 && B.length >= 3) {
    out.insufficient.push({ reason:
      "No reliable trend can be calculated from the available comparable sessions — differences are below the documented thresholds or inconsistent in direction." });
  }
  return out;
}
function fmtInsVal(v, m) {
  if (v == null || !isFinite(v)) return "—";
  if (m.key === "paceMed") {
    // Medians read as splits; small deltas read as seconds.
    if (Math.abs(v) < 30) return v.toFixed(1) + " s";
    return fmtPace(v);
  }
  return v.toFixed(m.decimals) + (m.unit === ":1" ? ":1" : m.unit ? " " + m.unit : "");
}
function cohortCurveScore(facts) {
  const withC = facts.filter(f => f.curveCoverage === "complete").length;
  return facts.length && withC / facts.length >= 0.7 ? 1 : 0;
}
function curveCoverageNote(facts) {
  const c = facts.filter(f => f.curveCoverage === "complete").length;
  const p = facts.filter(f => f.curveCoverage === "partial").length;
  return `${c} complete + ${p} partial curve coverage of ${facts.length} sessions`;
}

// Curve trends — one representative curve per session: the persisted
// session-average (entry.fc.avg, 64 samples), so page load decodes no
// payloads. The reference is FIXED per render, captured once, labeled.
function buildCurveSimSeries(facts, refCurve) {
  if (!Array.isArray(refCurve) || refCurve.length < 8) return { points: [], reason: "No active baseline curve — pick a baseline source in Settings." };
  const points = [];
  let skipped = 0;
  for (const f of facts) {
    if (!f.fcAvg) { skipped++; continue; }
    const sim = curveSimilarity(f.fcAvg, refCurve);
    if (sim == null) { skipped++; continue; }
    points.push({ id: f.id, dateMs: f.dateMs, dateISO: f.dateISO, v: sim,
      coverage: f.curveCoverage, title: f.title });
  }
  return { points, skipped,
    reason: points.length ? null : "No sessions in this period saved a session-average curve." };
}
function buildMetricSeries(facts, key, ctx) {
  const points = [];
  for (const f of facts) {
    const v = insValueOf(f, key, ctx);
    if (v == null) continue;
    points.push({ id: f.id, dateMs: f.dateMs, dateISO: f.dateISO, v,
      coverage: f.curveCoverage, title: f.title, n: f.strokeN });
  }
  return points;
}

// Within-session curve consistency from DECODED stroke curves: the
// median similarity of each sampled curve to their mean shape. Pure —
// the async decode/caching wrapper lives in the page layer.
function curveConsistencyFromSamples(curves) {
  const valid = (curves || []).filter(c => Array.isArray(c) && c.length >= 8);
  if (valid.length < 5) return null;
  const mean = new Array(64).fill(0);
  let n = 0;
  for (const c of valid) {
    let peak = 0;
    for (const v of c) if (v > peak) peak = v;
    if (peak <= 0) continue;
    const rs = c.length === 64 ? c : resampleCurve(Array.from(c), 64);
    if (!rs) continue;
    for (let k = 0; k < 64; k++) mean[k] += Math.max(0, rs[k]) / peak;
    n++;
  }
  if (n < 5) return null;
  for (let k = 0; k < 64; k++) mean[k] /= n;
  const sims = valid.map(c => curveSimilarity(c, mean)).filter(insFinite);
  return sims.length >= 5 ? insMedian(sims) : null;
}

// Comparable-session explorer — Baseline Engine compatibility rule
// (same benchmark, or distance/duration ±20%); incompatible sessions
// are never substituted.
function findInsightsComparables(target, history, opts) {
  opts = opts || {};
  const tf = sessionFacts(target);
  if (!tf) return { target: null, rows: [] };
  const rows = [];
  for (const e of (Array.isArray(history) ? history : [])) {
    if (!e || e.id === target.id) continue;
    const f = sessionFacts(e);
    if (!f) continue;
    if (f.demo && !tf.demo && !opts.includeSynthetic) continue;
    if (!sessionsCompatible(target, e)) continue;
    const why = tf.benchKey && f.benchKey === tf.benchKey
      ? `same benchmark (${tf.benchKey})`
      : `distance/duration within ±20% (${Math.round(f.distanceM)} m vs ${Math.round(tf.distanceM)} m)`;
    rows.push({ facts: f, why,
      diffs: {
        paceS: (insFinite(f.avgPaceS) && insFinite(tf.avgPaceS)) ? tf.avgPaceS - f.avgPaceS : null,
        watts: (f.avgWatts != null && tf.avgWatts != null) ? tf.avgWatts - f.avgWatts : null,
        dl: (f.dlMed != null && tf.dlMed != null) ? tf.dlMed - f.dlMed : null,
        ratio: (f.ratioMed != null && tf.ratioMed != null) ? tf.ratioMed - f.ratioMed : null,
      } });
  }
  rows.sort((x, y) => y.facts.dateMs - x.facts.dateMs || (x.facts.id < y.facts.id ? -1 : 1));
  const paced = rows.filter(r => insFinite(r.facts.avgPaceS));
  const best = paced.length
    ? paced.reduce((b, r) => r.facts.avgPaceS < b.facts.avgPaceS ? r : b, paced[0]) : null;
  const recent = rows.filter(r => tf.dateMs - r.facts.dateMs <= 28 * 86400000);
  return {
    target: tf, rows,
    prev: rows.find(r => r.facts.dateMs < tf.dateMs) || null,
    best,
    recentMedPaceS: insMedian(recent.map(r => r.facts.avgPaceS)),
    historicalMedPaceS: insMedian(rows.map(r => r.facts.avgPaceS)),
  };
}

// Training overview — recorded/imported workouts only (the UI says
// so). No readiness/recovery/calorie/medical outputs.
function buildTrainingOverview(facts) {
  const weeks = new Map();   // local Monday key → {distanceM, n}
  for (const f of facts) {
    const d = new Date(f.dateMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // back to Monday
    const key = d.getTime();
    const w = weeks.get(key) || { weekMs: key, distanceM: 0, n: 0 };
    w.distanceM += f.distanceM; w.n++;
    weeks.set(key, w);
  }
  return {
    sessions: facts.length,
    distanceM: facts.reduce((t, f) => t + f.distanceM, 0),
    elapsedS: facts.reduce((t, f) => t + f.elapsedS, 0),
    weekly: [...weeks.values()].sort((a, b) => a.weekMs - b.weekMs),
    interval: facts.filter(f => f.type === "interval").length,
    continuous: facts.filter(f => f.type === "continuous").length,
    withHr: facts.filter(f => f.hrCoverage >= 0.5).length,
    withRace: facts.filter(f => f.hasRace).length,
    curves: {
      complete: facts.filter(f => f.curveCoverage === "complete").length,
      partial: facts.filter(f => f.curveCoverage === "partial").length,
      legacy: facts.filter(f => f.curveCoverage === "legacy").length,
      none: facts.filter(f => f.curveCoverage === "none" || f.curveCoverage === "unavailable" || f.curveCoverage === "removed").length,
    },
  };
}

// Sanitize persisted Insights preferences (whitelist — hostile or
// stale values fall back to defaults).
function sanitizeInsightsPrefs(p) {
  const d = { range: "28d", compare: "prev", type: "all", racePlanOnly: false,
    includeSynthetic: false, curveView: "normalized", minDistM: null, maxDistM: null };
  if (!p || typeof p !== "object") return d;
  return {
    range: ["7d", "28d", "90d", "all", "custom"].includes(p.range) ? p.range : d.range,
    compare: ["prev", "custom", "none"].includes(p.compare) ? p.compare : d.compare,
    type: ["all", "interval", "continuous"].includes(p.type) ? p.type : d.type,
    racePlanOnly: p.racePlanOnly === true,
    includeSynthetic: p.includeSynthetic === true,
    curveView: ["normalized", "absolute"].includes(p.curveView) ? p.curveView : d.curveView,
    minDistM: insFinite(p.minDistM) && p.minDistM >= 0 && p.minDistM <= 1e6 ? p.minDistM : null,
    maxDistM: insFinite(p.maxDistM) && p.maxDistM >= 0 && p.maxDistM <= 1e6 ? p.maxDistM : null,
  };
}

// Page layer — renders into #insightsView. Dynamic text only via
// textContent; findings/chart points carry stable session ids, never
// array positions.
let _ins = null;   // { model, charts: Map, gen, consistCache: Map, refCurve, refLabel }

function insPrefs() {
  return sanitizeInsightsPrefs(state.userPrefs && state.userPrefs.insights);
}
function insSavePrefs(p) {
  state.userPrefs.insights = sanitizeInsightsPrefs(p);
  persistUserPrefs();
}

function renderInsightsView() {
  if (!_ins) _ins = { charts: new Map(), gen: 0, consistCache: new Map() };
  _ins.gen++;                                   // cancels stale async fills
  const p = insPrefs();
  insWriteControls(p);
  // Fixed reference for every curve trend on this render: the active
  // baseline, captured ONCE and labeled. Recomputed only on re-render.
  loadReferenceCurve();
  _ins.refCurve = state.baseline && state.baseline.curve ? Array.from(state.baseline.curve) : null;
  _ins.refLabel = state.baseline ? state.baseline.label : null;
  const t0 = performance.now();
  const opts = insCohortOpts(p);
  const cohort = buildInsightsCohort(state.history, opts);
  // Context maps: session-average-curve similarity to the fixed
  // reference (no payload decode), and race execution per session.
  const ctx = { curveSim: new Map(), raceExec: new Map() };
  const allFacts = cohort.a.facts.concat(cohort.b ? cohort.b.facts : []);
  for (const f of allFacts) {
    if (f.fcAvg && _ins.refCurve) {
      const sim = curveSimilarity(f.fcAvg, _ins.refCurve);
      if (sim != null) ctx.curveSim.set(f.id, sim);
    }
    if (f.hasRace) {
      const e = state.history.find(h => h && h.id === f.id);
      const v = e ? sessionRaceExec(e) : null;
      if (v != null) ctx.raceExec.set(f.id, v);
    }
  }
  const findings = generateInsightsFindings(cohort, ctx);
  _ins.model = { p, opts, cohort, ctx, findings,
    overview: buildTrainingOverview(cohort.a.facts) };
  insRenderCohortLine();
  insRenderFindings();
  insRenderTechnique();
  insRenderPerformance();
  insRenderOverview();
  insRenderExplorer();
  insRenderConfidence();
  _ins.model.renderMs = performance.now() - t0;
  insFillConsistencyAsync();                    // lazy curve decodes, cancelable
}

function insCohortOpts(p) {
  const dv = id => { const el = document.getElementById(id); const v = el && el.value;
    const ms = v ? Date.parse(v + "T12:00:00") : NaN; return isFinite(ms) ? ms : null; };
  const nv = id => { const el = document.getElementById(id); const v = el && parseFloat(el.value);
    return insFinite(v) && v > 0 ? v : null; };
  return {
    nowMs: Date.now(), range: p.range,
    fromMs: dv("insFrom"), toMs: dv("insTo"),
    compare: p.compare, bFromMs: dv("insBFrom"), bToMs: dv("insBTo"),
    type: p.type, racePlanOnly: p.racePlanOnly, includeSynthetic: p.includeSynthetic,
    minDistM: nv("insMinDist"), maxDistM: nv("insMaxDist"),
  };
}

function insWriteControls(p) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  set("insRange", p.range); set("insCompare", p.compare); set("insType", p.type);
  chk("insRace", p.racePlanOnly); chk("insSynth", p.includeSynthetic);
  set("insCurveView", p.curveView);
  const custom = p.range === "custom", customB = p.compare === "custom";
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none"; };
  show("insCustomA", custom); show("insCustomB", customB);
}

function insFmtDay(ms) {
  // LOCAL calendar-day label — must agree with the local-day range
  // boundaries (an ISO/UTC conversion can shift the visible day).
  if (!isFinite(ms) || ms <= 0 || ms >= 8e15) return "…";
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function insRenderCohortLine() {
  const el = document.getElementById("insCohort");
  if (!el) return;
  const m = _ins.model, A = m.cohort.a, B = m.cohort.b;
  el.textContent =
    `${A.facts.length} session${A.facts.length === 1 ? "" : "s"} in ` +
    (isFinite(A.fromMs) ? `${insFmtDay(A.fromMs)} → ${insFmtDay(A.toMs)}` : "all history") +
    (B ? ` · compared with ${B.facts.length} in ${insFmtDay(B.fromMs)} → ${insFmtDay(B.toMs)}` : " · no comparison period") +
    ` · ${m.cohort.coverage.withCurves} with stroke curves (${m.cohort.coverage.complete} complete)` +
    ` · ${m.cohort.excluded.length} excluded`;
  const ex = document.getElementById("insExcluded");
  if (ex) {
    ex.innerHTML = "";
    const counts = new Map();
    for (const x of m.cohort.excluded) counts.set(x.reason, (counts.get(x.reason) || 0) + 1);
    for (const [reason, n] of [...counts].sort()) {
      const li = document.createElement("li");
      li.textContent = `${n} × ${reason}`;
      ex.appendChild(li);
    }
  }
}

function insRenderFindings() {
  const box = document.getElementById("insFindings");
  if (!box) return;
  box.innerHTML = "";
  const m = _ins.model;
  for (const f of m.findings.findings) {
    const card = document.createElement("div");
    card.className = `ins-card ins-${f.tone} ins-conf-${f.confidence.level}`;
    const t = document.createElement("div"); t.className = "ins-text"; t.textContent = f.text;
    const meta = document.createElement("div"); meta.className = "ins-meta";
    meta.textContent =
      `${insFmtDay(f.periods.a.fromMs)}→${insFmtDay(f.periods.a.toMs)} vs ` +
      `${insFmtDay(f.periods.b.fromMs)}→${insFmtDay(f.periods.b.toMs)} · ` +
      `${f.evidence.sessionIds.length + f.evidence.comparisonIds.length} sessions, ${f.strokesN.toLocaleString()} strokes · ` +
      (f.normalized ? "normalized curves · " : "") +
      `${f.confidence.level} confidence (${f.confidence.why})` +
      (f.missing.length ? ` · missing: ${f.missing.join("; ")}` : "");
    const btn = document.createElement("button");
    btn.className = "ins-evi"; btn.textContent = "Inspect evidence ▸";
    btn.addEventListener("click", () => insOpenEvidence(f.evidence.sessionIds[f.evidence.sessionIds.length - 1], { metric: f.evidence.metric }));
    card.appendChild(t); card.appendChild(meta); card.appendChild(btn);
    box.appendChild(card);
  }
  const insuf = document.getElementById("insInsufficient");
  if (insuf) {
    insuf.innerHTML = "";
    for (const r of m.findings.insufficient.slice(0, 6)) {
      const li = document.createElement("li"); li.textContent = r.reason; insuf.appendChild(li);
    }
    insuf.style.display = m.findings.insufficient.length ? "" : "none";
  }
  const none = document.getElementById("insNoFindings");
  if (none) none.style.display = m.findings.findings.length ? "none" : "";
}

// ---- Chart renderer: canvas points + line, gaps preserved, focusable
// wrapper with arrow-key point navigation, exact values in a readout
// line, click/Enter opens the point's session. Non-color cue: the
// focused point gets a ring + the readout text.
function insChart(id, points, opts) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const canvas = wrap.querySelector("canvas");
  const readout = wrap.querySelector(".ins-read");
  const summary = wrap.querySelector(".ins-sum");
  let st = _ins.charts.get(id);
  if (!st) { st = { focus: -1 }; _ins.charts.set(id, st); insChartBind(wrap, id); }
  st.points = points; st.opts = opts || {};
  st.focus = points.length ? Math.min(Math.max(st.focus, -1), points.length - 1) : -1;
  if (summary) {
    summary.textContent = points.length
      ? `${points.length} sessions from ${insFmtDay(points[0].dateMs)} to ${insFmtDay(points[points.length - 1].dateMs)} · ` +
        `median ${st.opts.fmt(insMedian(points.map(q => q.v)))} · latest ${st.opts.fmt(points[points.length - 1].v)}` +
        (st.opts.refLabel ? ` · reference: ${st.opts.refLabel}` : "")
      : (st.opts.empty || "No data in this period.");
  }
  if (readout) readout.textContent = st.focus >= 0 ? insChartReadText(st, st.focus) : "";
  insChartPaint(id);
  wrap.style.display = "";
}
function insChartReadText(st, i) {
  const q = st.points[i];
  return `${i + 1}/${st.points.length} · ${insFmtDay(q.dateMs)} · ${st.opts.fmt(q.v)} · ${q.title}` +
    (q.coverage && q.coverage !== "complete" ? ` · curves: ${q.coverage}` : "") +
    " — Enter opens Replay";
}
function insChartPaint(id) {
  const wrap = document.getElementById(id);
  const st = _ins.charts.get(id);
  if (!wrap || !st) return;
  const canvas = wrap.querySelector("canvas");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 90;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pts = st.points;
  if (!pts.length) return;
  const padL = 6, padR = 8, padT = 8, padB = 6;
  const xs = pts.map(q => q.dateMs);
  const vs = pts.map(q => q.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let v0 = Math.min(...vs), v1 = Math.max(...vs);
  if (st.opts.ref != null) { v0 = Math.min(v0, st.opts.ref); v1 = Math.max(v1, st.opts.ref); }
  if (v1 - v0 < 1e-9) { v0 -= 1; v1 += 1; }
  const X = q => padL + (x1 === x0 ? 0.5 : (q.dateMs - x0) / (x1 - x0)) * (cssW - padL - padR);
  const Y = v => padT + (1 - (v - v0) / (v1 - v0)) * (cssH - padT - padB);
  if (st.opts.ref != null) {
    ctx.strokeStyle = "rgba(155,167,189,0.5)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(st.opts.ref)); ctx.lineTo(cssW - padR, Y(st.opts.ref)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = st.opts.color || "rgba(91,157,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((q, i) => { const x = X(q), y = Y(q.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  if (pts.length > 1) ctx.stroke();
  pts.forEach((q, i) => {
    ctx.beginPath();
    ctx.fillStyle = st.opts.color || "rgba(91,157,255,0.95)";
    ctx.arc(X(q), Y(q.v), i === st.focus ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (i === st.focus) {
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(q), Y(q.v), 6, 0, Math.PI * 2); ctx.stroke();
    }
  });
}
function insChartBind(wrap, id) {
  const readout = wrap.querySelector(".ins-read");
  const move = d => {
    const st = _ins.charts.get(id);
    if (!st || !st.points.length) return;
    st.focus = st.focus < 0 ? (d > 0 ? 0 : st.points.length - 1)
      : Math.max(0, Math.min(st.points.length - 1, st.focus + d));
    if (readout) readout.textContent = insChartReadText(st, st.focus);
    insChartPaint(id);
  };
  wrap.addEventListener("keydown", ev => {
    if (ev.key === "ArrowRight") { move(1); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { move(-1); ev.preventDefault(); }
    else if (ev.key === "Home") { move(-1e9); ev.preventDefault(); }
    else if (ev.key === "End") { move(1e9); ev.preventDefault(); }
    else if (ev.key === "Enter") {
      const st = _ins.charts.get(id);
      if (st && st.focus >= 0) insOpenEvidence(st.points[st.focus].id, {});
      ev.preventDefault();
    }
  });
  wrap.querySelector("canvas").addEventListener("click", ev => {
    const st = _ins.charts.get(id);
    if (!st || !st.points.length) return;
    const r = ev.target.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    let best = 0, bestErr = Infinity;
    st.points.forEach((q, i) => {
      const xs = st.points.map(p2 => p2.dateMs);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
      const px = x1 === x0 ? 0.5 : (q.dateMs - x0) / (x1 - x0);
      const err = Math.abs(px - fx);
      if (err < bestErr) { bestErr = err; best = i; }
    });
    st.focus = best;
    if (readout) readout.textContent = insChartReadText(st, best);
    insChartPaint(id);
  });
}

function insRenderTechnique() {
  const m = _ins.model, A = m.cohort.a.facts;
  const norm = m.p.curveView !== "absolute";
  const simSeries = buildCurveSimSeries(A, _ins.refCurve);
  insChart("insChSim", norm ? simSeries.points : [], {
    fmt: v => Math.round(v) + "%", refLabel: _ins.refLabel ? `baseline (${_ins.refLabel})` : null,
    empty: simSeries.reason || "Switch to normalized view for shape similarity.",
    color: "rgba(86,249,179,0.9)",
  });
  insChart("insChPeak", !norm ? buildMetricSeries(A, "fcPeak") : [], {
    fmt: v => Math.round(v) + " lbf",
    empty: norm ? "Absolute peak force is shown in the absolute view." : "No sessions saved curve peaks in this period.",
    color: "rgba(86,249,179,0.9)",
  });
  insChart("insChDl", buildMetricSeries(A, "dlMed"), {
    fmt: v => v.toFixed(2) + " m", empty: "No Drive Length data in this period." });
  insChart("insChRatio", buildMetricSeries(A, "ratioMed"), {
    fmt: v => v.toFixed(2) + ":1", empty: "No Ratio data in this period." });
  insChart("insChPt", buildMetricSeries(A, "ptMed"), {
    fmt: v => Math.round(v * 100) + "% of drive", empty: "No peak-timing data in this period." });
  insChart("insChConsist", [], { fmt: v => Math.round(v) + "%",
    empty: "Computing within-session curve consistency…" });
}

function insRenderPerformance() {
  const m = _ins.model, A = m.cohort.a.facts;
  insChart("insChPps", buildMetricSeries(A, "ppsMed"), {
    fmt: v => Math.round(v) + " J", empty: "Power per stroke needs valid watts + rate strokes." });
  insChart("insChPaceSt", buildMetricSeries(A, "paceSpreadPct"), {
    fmt: v => v.toFixed(1) + " pp", empty: "No pacing-stability data in this period." });
  insChart("insChRace", buildMetricSeries(A, "raceExec", m.ctx), {
    fmt: v => v.toFixed(1) + " s", empty: "No Race Lab sessions in this period." });
  // Power profile: recent (period A ids) vs all history — reuses the
  // existing engine; ordinary rows stay labeled as estimates there.
  const box = document.getElementById("insPower");
  if (box) {
    box.innerHTML = "";
    const ids = new Set(A.map(f => f.id));
    const subset = state.history.filter(h => h && ids.has(h.id));
    const pp = computePowerProfile(subset, Date.now());
    const ppAll = computePowerProfile(state.history.filter(h => h && !h.demo), Date.now());
    for (let i = 0; i < pp.rows.length; i++) {
      const r = pp.rows[i], ra = ppAll.rows[i];
      const div = document.createElement("div");
      div.className = "ins-pp-row";
      div.textContent = `${r.label}: ` +
        (r.best ? `${r.best.watts} W in this period` : "no qualifying effort in this period") +
        (ra.best ? ` · all-time ${ra.best.watts} W (${ra.best.dateISO})` : "");
      box.appendChild(div);
    }
    const note = document.createElement("div");
    note.className = "ins-note";
    note.textContent = "Best rolling watts inside captured sessions — training rows are never treated as confirmed maximal tests.";
    box.appendChild(note);
  }
}

function insRenderOverview() {
  const el = document.getElementById("insOverview");
  if (!el) return;
  const o = _ins.model.overview;
  el.innerHTML = "";
  const line = (t) => { const d = document.createElement("div"); d.textContent = t; el.appendChild(d); };
  line(`${o.sessions} sessions · ${Math.round(o.distanceM).toLocaleString()} m · ${fmtTime(o.elapsedS)} recorded`);
  line(`${o.continuous} continuous · ${o.interval} interval · ${o.withRace} with Race Lab plans · ${o.withHr} with heart-rate coverage ≥50%`);
  line(`Stroke curves: ${o.curves.complete} complete · ${o.curves.partial} partial · ${o.curves.legacy} legacy · ${o.curves.none} none/unavailable`);
  // Weekly distance bars (DOM, no canvas needed).
  const wk = document.createElement("div"); wk.className = "ins-weeks";
  const maxD = Math.max(1, ...o.weekly.map(w => w.distanceM));
  for (const w of o.weekly.slice(-16)) {
    const b = document.createElement("div"); b.className = "ins-week";
    const bar = document.createElement("div"); bar.className = "ins-week-bar";
    bar.style.height = Math.max(3, Math.round((w.distanceM / maxD) * 44)) + "px";
    bar.title = `${insFmtDay(w.weekMs)}: ${Math.round(w.distanceM).toLocaleString()} m · ${w.n} session${w.n === 1 ? "" : "s"}`;
    const lab = document.createElement("div"); lab.className = "ins-week-lab";
    lab.textContent = insFmtDay(w.weekMs).slice(5);
    b.appendChild(bar); b.appendChild(lab); wk.appendChild(b);
  }
  el.appendChild(wk);
  const note = document.createElement("div"); note.className = "ins-note";
  note.textContent = "Only workouts recorded or imported into PM5 Dashboard — not your entire training history.";
  el.appendChild(note);
}

function insRenderExplorer() {
  const sel = document.getElementById("insExpSel");
  const out = document.getElementById("insExpOut");
  if (!sel || !out) return;
  const m = _ins.model;
  const cur = sel.value;
  sel.innerHTML = "";
  for (const f of m.cohort.a.facts.slice().reverse()) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = `${insFmtDay(f.dateMs)} · ${f.title}${f.demo ? " (synthetic)" : ""}`;
    sel.appendChild(o);
  }
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  insRenderExplorerRows();
}
function insRenderExplorerRows() {
  const sel = document.getElementById("insExpSel");
  const out = document.getElementById("insExpOut");
  if (!sel || !out) return;
  out.innerHTML = "";
  const target = state.history.find(h => h && h.id === sel.value);
  if (!target) { out.textContent = "Pick a session above."; return; }
  const cmp = findInsightsComparables(target, state.history,
    { includeSynthetic: _ins.model.p.includeSynthetic });
  if (!cmp.rows.length) {
    out.textContent = "No compatible sessions found (same benchmark, or distance/duration within ±20%). Incompatible sessions are never substituted.";
    return;
  }
  const summary = document.createElement("div");
  summary.className = "ins-note";
  summary.textContent =
    (cmp.prev ? `Previous attempt: ${insFmtDay(cmp.prev.facts.dateMs)}. ` : "") +
    (cmp.best && insFinite(cmp.best.facts.avgPaceS) ? `Best comparable pace: ${fmtPace(cmp.best.facts.avgPaceS)} (${insFmtDay(cmp.best.facts.dateMs)}). ` : "") +
    (cmp.recentMedPaceS != null ? `28-day median ${fmtPace(cmp.recentMedPaceS)}. ` : "") +
    (cmp.historicalMedPaceS != null ? `All-history median ${fmtPace(cmp.historicalMedPaceS)}.` : "");
  out.appendChild(summary);
  for (const r of cmp.rows.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "ins-exp-row";
    const info = document.createElement("div");
    info.textContent =
      `${insFmtDay(r.facts.dateMs)} · ${r.facts.title} — ${r.why} · ` +
      (insFinite(r.facts.avgPaceS) ? `${fmtPace(r.facts.avgPaceS)} · ` : "") +
      (r.facts.avgWatts ? `${Math.round(r.facts.avgWatts)} W · ` : "") +
      (r.facts.dlMed != null ? `DL ${r.facts.dlMed.toFixed(2)} · ` : "") +
      (r.facts.ratioMed != null ? `ratio ${r.facts.ratioMed.toFixed(1)}:1 · ` : "") +
      `curves: ${r.facts.curveCoverage}` +
      (r.diffs.paceS != null ? ` · this session ${r.diffs.paceS <= 0 ? "faster" : "slower"} by ${Math.abs(r.diffs.paceS).toFixed(1)} s/500m` : "");
    const bR = document.createElement("button");
    bR.textContent = "Replay";
    bR.addEventListener("click", () => insOpenEvidence(r.facts.id, {}));
    const bAB = document.createElement("button");
    bAB.textContent = "A/B vs this";
    bAB.addEventListener("click", () => insOpenAb(sel.value, r.facts.id));
    row.appendChild(info); row.appendChild(bR); row.appendChild(bAB);
    out.appendChild(row);
  }
}

function insRenderConfidence() {
  const el = document.getElementById("insConf");
  if (!el) return;
  const m = _ins.model, A = m.cohort.a.facts;
  el.innerHTML = "";
  const line = t => { const d = document.createElement("div"); d.textContent = t; el.appendChild(d); };
  const usable = state.history.filter(h => sessionFacts(h)).length;
  line(`Sessions stored: ${state.history.length} · usable: ${usable} · in current period: ${A.length}` +
    (m.cohort.b ? ` · comparison period: ${m.cohort.b.facts.length}` : ""));
  line(`Strokes in period: ${A.reduce((t, f) => t + f.strokeN, 0).toLocaleString()} · ` +
    `curve coverage: ${m.cohort.coverage.complete} complete, ${A.filter(f => f.curveCoverage === "partial").length} partial, ` +
    `${m.cohort.coverage.legacy} legacy/none`);
  line(`Metric completeness (median): ${m.cohort.coverage.completenessMed != null ? Math.round(m.cohort.coverage.completenessMed * 100) + "%" : "—"} · ` +
    `reference for curve trends: ${_ins.refLabel ? _ins.refLabel : "none (choose a baseline in Settings)"}`);
  const nInt = A.filter(f => f.interrupted).length;
  if (nInt) line(`${nInt} session${nInt === 1 ? "" : "s"} in this period had interrupted capture — included, but treat their per-stroke completeness as limited.`);
  const needs = [];
  if (A.length < 3) needs.push("at least 3 sessions in the period");
  if (!m.cohort.b) needs.push("a comparison period");
  else if (m.cohort.b.facts.length < 3) needs.push("at least 3 sessions in the comparison period");
  if (!_ins.refCurve) needs.push("an active baseline for curve trends");
  if (m.cohort.coverage.withCurves === 0) needs.push("sessions with stored stroke curves");
  line(needs.length ? `To compute more: ${needs.join(" · ")}.` : "Enough evidence for the full set of calculations.");
}

// ---- Evidence navigation: stable session ids, straight into Replay.
function insOpenEvidence(sessionId, opts) {
  const e = state.history.find(h => h && h.id === sessionId);
  if (!e) { setToast("That session is no longer in history.", "warn"); return; }
  openReplay(e);
  if (opts && insFinite(opts.pos) && _replay && _replay.tl.length) {
    _replay.pos = Math.max(0, Math.min(_replay.tl.length - 1, opts.pos));
    renderReplayPos();
  }
}
// A/B handoff: open the target in Replay with both session averages
// pinned (window pins — reuses the existing pin plumbing honestly).
function insOpenAb(targetId, otherId) {
  const t = state.history.find(h => h && h.id === targetId);
  const o = state.history.find(h => h && h.id === otherId);
  if (!t || !o) return;
  openReplay(t);
  setTimeout(() => {
    if (!_replay || _replay.session !== t) return;
    const mk = (e, label) => (e.fc && Array.isArray(e.fc.avg))
      ? { kind: "window", label, curve: Array.from(e.fc.avg),
          split: e.totals && e.totals.avgPaceS, dl: null, ratio: null, ctx: label }
      : null;
    const A = mk(t, `this session avg (${insFmtDay(Date.parse(t.date))})`);
    const B = mk(o, `comparable avg (${insFmtDay(Date.parse(o.date))})`);
    if (A) _replay.pinA = A;
    if (B) _replay.pinB = B;
    renderReplayFc();
    if (!A || !B) setToast("One of the sessions has no saved session-average curve — pins were set where possible.", "warn");
  }, 750);
}

// ---- Async within-session curve consistency: bounded, cached,
// cancelable. Decodes ≤16 evenly-spaced records for ≤12 sessions.
function insFillConsistencyAsync() {
  const gen = _ins.gen;
  const A = _ins.model.cohort.a.facts
    .filter(f => f.curveCoverage === "complete" || f.curveCoverage === "partial")
    .slice(-12);
  const points = [];
  let decodes = 0;
  const step = async () => {
    for (const f of A) {
      if (_ins.gen !== gen) return;                       // stale — cancelled
      const cacheKey = f.id + ":" + f.curveRetained;
      let v = _ins.consistCache.get(cacheKey);
      if (v === undefined) {
        const rec = await curveDetailGet(f.id);
        if (_ins.gen !== gen) return;
        v = null;
        if (rec && rec.bytes) {
          const h = decodeCurveHeader(rec.bytes);
          const oi = h && curveOrdinalIndex(rec.bytes);
          if (h && oi) {
            const idxs = [];
            for (let k = 0; k < Math.min(16, h.count); k++) {
              idxs.push(Math.round(k * (h.count - 1) / Math.max(1, Math.min(16, h.count) - 1)));
            }
            const curves = [...new Set(idxs)].map(i => decodeCurveRecordUnchecked(rec.bytes, i).samples);
            decodes += curves.length;
            v = curveConsistencyFromSamples(curves);
          }
        }
        _ins.consistCache.set(cacheKey, v);
        if (_ins.consistCache.size > 40) {
          _ins.consistCache.delete(_ins.consistCache.keys().next().value);
        }
      }
      if (v != null) points.push({ id: f.id, dateMs: f.dateMs, dateISO: f.dateISO,
        v, title: f.title, coverage: f.curveCoverage });
    }
    if (_ins.gen !== gen) return;
    _ins.lastDecodeCount = decodes;
    points.sort((x, y) => x.dateMs - y.dateMs);
    insChart("insChConsist", points, { fmt: v => Math.round(v) + "%",
      empty: "No sessions with stored stroke curves in this period (last 12 with curves are analysed).",
      color: "rgba(186,124,255,0.9)" });
  };
  step();
}

// Demo synthetic history — deterministic multi-week fixtures through
// the production entry shape, saveHistory, and the real curve store.
// All demo:true, excluded unless toggled, removable in one click
// (only demo entries touched).
function generateDemoInsightsHistory() {
  const rng = _demoRngFactory(0x1522AA);
  const now = Date.now();
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2) : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  const entries = [];
  const puts = [];
  const mk = (daysAgo, kind, prog) => {
    const dateMs = now - daysAgo * 86400000;
    const id = "demo-ins-" + daysAgo + "-" + kind;
    // prog 0→1 across the weeks: DL up, peak timing earlier, steadier.
    const dl0 = 1.30 + 0.08 * prog, peakAt = 0.47 - 0.05 * prog;
    const noise = 0.05 * (1 - 0.5 * prog);
    const pace0 = kind === "2k" ? 118 - 2 * prog : kind === "iv" ? 112 : 124 - 2 * prog;
    const nStrokes = kind === "12k" ? 560 : kind === "iv" ? 300 : kind === "2k" ? 230 : 260;
    const strokes = [], recs = [];
    let t = 0, d = 0;
    for (let j = 0; j < nStrokes; j++) {
      const rate = 25 + Math.round((rng() - 0.5) * 4);
      const pace = pace0 + (rng() - 0.5) * 3 + (kind === "iv" && (j % 75) > 60 ? 12 : 0);
      t += 60 / rate; d += (60 / rate) * (500 / pace);
      const dl = dl0 + (rng() - 0.5) * noise;
      const peak = 145 + 18 * prog + (rng() - 0.5) * 10;
      const w = Math.round(2.8 / Math.pow(pace / 500, 3));
      strokes.push({ t: Math.round(t * 10) / 10, d: Math.round(d),
        p: Math.round(pace * 10) / 10, w, r: rate,
        hr: kind === "12k" ? null : 138 + Math.round(20 * prog + (rng() - 0.5) * 6),
        dl: Math.round(dl * 100) / 100, dt: 0.8, rt: Math.round((1.55 - 0.12 * prog) * 100) / 100,
        pf: Math.round(peak * 10) / 10, pt: Math.round((peakAt + (rng() - 0.5) * 0.04) * 100) / 100 });
      recs.push({ i: j + 1, d: Math.round(d), peak, s: bell(peak, peakAt + (rng() - 0.5) * 0.04) });
    }
    const fcAvg = bell(150 + 15 * prog, peakAt);
    const entry = {
      schemaVersion: SESSION_SCHEMA_VERSION, appVersion: APP_VERSION, id,
      date: new Date(dateMs).toISOString(),
      title: `Demo — ${kind === "2k" ? "2k race" : kind === "iv" ? "4×500m intervals" : kind === "12k" ? "12k long row" : "5k steady"} (synthetic)`,
      description: "", demo: true,
      plan: kind === "2k"
        ? { title: "Demo 2k race", benchKey: "2k",
            intervals: [{ kind: "distance", value: 1000 }, { kind: "distance", value: 1000 }],
            race: buildRacePlan(2000, "even", pace0) }
        : kind === "iv"
        ? { title: "Demo 4×500m", intervals: Array.from({ length: 4 }, () => ({ kind: "distance", value: 500, restS: 60 })) }
        : null,
      results: kind === "iv"
        ? Array.from({ length: 4 }, (_, k2) => ({ intervalIdx: k2, distanceM: 500, elapsedS: 112, paceS: 112, watts: 250, strokeRate: 28 }))
        : kind === "2k"
        ? [{ distanceM: 1000, elapsedS: pace0 * 2, paceS: pace0, watts: 220, strokeRate: 27 },
           { distanceM: 1000, elapsedS: pace0 * 2 - 3, paceS: pace0 - 1.5, watts: 226, strokeRate: 28 }]
        : [],
      totals: { distanceM: Math.round(d), elapsedS: Math.round(t),
        avgPaceS: Math.round((t / d) * 500 * 10) / 10, avgWatts: Math.round(2.8 / Math.pow(t / d, 3) / 8) * 8,
        strokes: nStrokes, avgHr: kind === "12k" ? null : 145 },
      strokes, strokeStride: 1,
      fc: { avg: fcAvg.map(v => Math.round(v * 10) / 10),
        best: bell(165 + 15 * prog, peakAt).map(v => Math.round(v * 10) / 10),
        peak: Math.round((165 + 15 * prog) * 10) / 10, n: nStrokes },
    };
    // Curve payloads: most complete, one partial, the long row legacy.
    if (kind === "12k") {
      // legacy-style: no curveMeta at all
    } else if (kind === "partial") {
      const kept = recs.filter((_, j) => j % 2 === 0);
      const enc = encodeCurveDetail(kept, nStrokes, { synthetic: true });
      if (enc) { entry.curveMeta = { v: CURVE_CODEC_VERSION, coverage: "partial", retained: kept.length, total: nStrokes };
        puts.push([id, enc]); }
    } else {
      const enc = encodeCurveDetail(recs, nStrokes, { synthetic: true });
      if (enc) { entry.curveMeta = { v: CURVE_CODEC_VERSION, coverage: "complete", retained: nStrokes, total: nStrokes };
        puts.push([id, enc]); }
    }
    entries.push(entry);
  };
  // 8 weeks of history: steady progression + variety + edge cases.
  const plan = [
    [52, "5k", 0.0], [45, "5k", 0.15], [42, "iv", 0.2], [38, "5k", 0.3],
    [31, "2k", 0.35], [28, "partial", 0.45], [24, "5k", 0.55], [17, "iv", 0.65],
    [14, "12k", 0.7], [10, "5k", 0.8], [6, "2k", 0.9], [2, "5k", 1.0],
  ];
  for (const [days, kind, prog] of plan) mk(days, kind, prog);
  // Insert through production paths (newest-first history order).
  const existing = new Set(state.history.map(h => h && h.id));
  const fresh = entries.filter(e => !existing.has(e.id));
  fresh.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  state.history = fresh.concat(state.history);
  saveHistory();
  for (const [id, enc] of puts) curveDetailPut(id, enc);
  renderHistoryList();
  setToast(`Added ${fresh.length} synthetic demo sessions (SYNTHETIC-badged, excluded from insights by default).`, "ok");
  return fresh.length;
}
function removeDemoInsightsHistory() {
  const demo = state.history.filter(h => h && h.demo === true);
  if (!demo.length) { setToast("No synthetic demo sessions to remove.", "warn"); return 0; }
  state.history = state.history.filter(h => !(h && h.demo === true));
  saveHistory();
  for (const e of demo) curveDetailDelete(e.id);
  if (_ins) _ins.consistCache.clear();
  renderHistoryList();
  setToast(`Removed ${demo.length} synthetic demo sessions (real history untouched).`, "ok");
  return demo.length;
}

// ---- Static wiring, called once from the main script's init.
function initInsightsUi() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  const applyFromControls = () => {
    const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
    const chk = id => { const el = document.getElementById(id); return !!(el && el.checked); };
    insSavePrefs({
      range: val("insRange"), compare: val("insCompare"), type: val("insType"),
      racePlanOnly: chk("insRace"), includeSynthetic: chk("insSynth"),
      curveView: val("insCurveView"),
      minDistM: parseFloat(val("insMinDist")) || null,
      maxDistM: parseFloat(val("insMaxDist")) || null,
    });
    renderInsightsView();
  };
  for (const id of ["insRange", "insCompare", "insType", "insCurveView"]) on(id, "change", applyFromControls);
  for (const id of ["insRace", "insSynth"]) on(id, "change", applyFromControls);
  for (const id of ["insFrom", "insTo", "insBFrom", "insBTo", "insMinDist", "insMaxDist"]) on(id, "change", applyFromControls);
  on("insExpSel", "change", insRenderExplorerRows);
  on("insDemoGen", "click", () => { generateDemoInsightsHistory(); renderInsightsView(); });
  on("insDemoClear", "click", () => { removeDemoInsightsHistory(); renderInsightsView(); });
}
