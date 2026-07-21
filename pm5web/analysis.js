// =====================================================================
// PM5 Dashboard — analysis.js (v1.20.0 modular split)
// =====================================================================
// The PURE analysis layer: import sanitizers, curve shape analysis,
// drift detection, performance analytics, replay readiness, and the
// v1.20 baseline / cue / race / power engines. No DOM access at top
// level. Loaded as a classic script BEFORE the main script in
// index.html, cached by the service worker for offline use, and
// concatenated with the main script by tests/harness.js. Functions here
// may reference main-script globals (fmtTime, BENCHMARKS, uid, state,
// ...) — resolution happens at call time, after both scripts load.
// Counted by the total offline-app size guard in tests/run.js.
// =====================================================================

// v1.18.1 — bounds for the remaining imported per-entry collections.
// Sized to comfortably cover legitimate erg data: a marathon logged at
// 100 m splits is ~422 result rows; bookmarks are one manual keypress
// each; tags are short comma-separated words.
const IMPORT_MAX_RESULTS = 500;
const IMPORT_MAX_BOOKMARKS = 200;
const IMPORT_MAX_TAGS = 50;
const IMPORT_MAX_TAG_LEN = 60;
const IMPORT_MAX_BOOKMARK_LABEL_LEN = 80;
const IMPORT_MAX_RESULT_LABEL_LEN = 80;
const IMPORT_MAX_PLAN_INTERVALS = 200;

// Shared coercers for import sanitization. Strings accept only string/
// number primitives — objects (incl. toString tricks) never survive.
function _impNum(v, lo, hi) {
  return (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null;
}
function _impStr(v, cap) {
  return (typeof v === "string" || typeof v === "number") ? String(v).slice(0, cap) : null;
}

// Imported per-interval result rows: documented ResultRow fields only,
// malformed rows discarded (a real row always has time or distance).
function sanitizeResultRows(rows, cap) {
  if (!Array.isArray(rows)) return [];
  cap = cap || IMPORT_MAX_RESULTS;
  const out = [];
  for (const r of rows.slice(0, cap)) {
    if (!r || typeof r !== "object") continue;
    const row = {
      intervalIdx: (Number.isInteger(r.intervalIdx) && r.intervalIdx >= 0 && r.intervalIdx <= 100000)
        ? r.intervalIdx : out.length + 1,
      label: _impStr(r.label, IMPORT_MAX_RESULT_LABEL_LEN) || "",
      elapsedS: _impNum(r.elapsedS, 0, 864000), distanceM: _impNum(r.distanceM, 0, 1e6),
      paceS: _impNum(r.paceS, 0, 3600), watts: _impNum(r.watts, 0, 5000),
      strokeRate: _impNum(r.strokeRate, 0, 300), heartRate: _impNum(r.heartRate, 0, 300),
      restS: _impNum(r.restS, 0, 86400) || 0,
      driveLengthM: _impNum(r.driveLengthM, 0, 10), peakForceLbs: _impNum(r.peakForceLbs, 0, 2000),
    };
    if (row.elapsedS == null && row.distanceM == null) continue;
    out.push(row);
  }
  return out;
}

// Imported bookmarks: the live-bookmark numeric fields, plus an
// optional short label (this app doesn't write one today; a bounded
// plain string is harmless and future-proof).
function sanitizeBookmarks(marks, cap) {
  if (!Array.isArray(marks)) return null;
  cap = cap || IMPORT_MAX_BOOKMARKS;
  const out = [];
  for (const b of marks.slice(0, cap)) {
    if (!b || typeof b !== "object") continue;
    const row = {
      strokeIndex: _impNum(b.strokeIndex, 0, 1e6), distanceM: _impNum(b.distanceM, 0, 1e6),
      elapsedS: _impNum(b.elapsedS, 0, 864000), paceS: _impNum(b.paceS, 0, 3600),
      watts: _impNum(b.watts, 0, 5000), strokeRate: _impNum(b.strokeRate, 0, 300),
      heartRate: _impNum(b.heartRate, 0, 300), driveLengthM: _impNum(b.driveLengthM, 0, 10),
    };
    if (row.distanceM == null && row.elapsedS == null && row.strokeIndex == null) continue;
    const label = _impStr(b.label, IMPORT_MAX_BOOKMARK_LABEL_LEN);
    if (label) row.label = label;
    out.push(row);
  }
  return out.length ? out : null;
}

// Imported tags: short plain strings, empties dropped.
function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const out = [];
  for (const t of tags.slice(0, IMPORT_MAX_TAGS)) {
    const s = _impStr(t, IMPORT_MAX_TAG_LEN);
    if (s && s.trim()) out.push(s.trim());
  }
  return out.length ? out : null;
}

// Imported PR stamp: keys restricted to real benchmark ids, values to
// finite numbers. Anything else is dropped whole.
function sanitizeImportedPr(pr) {
  if (!pr || typeof pr !== "object" || !Array.isArray(pr.keys)) return null;
  const known = new Set(BENCHMARKS.map(b => b.key));
  const keys = pr.keys.filter(k => typeof k === "string" && known.has(k)).slice(0, 20);
  if (!keys.length) return null;
  const numMap = src => {
    const m = {};
    if (src && typeof src === "object") {
      for (const k of keys) if (typeof src[k] === "number" && isFinite(src[k])) m[k] = src[k];
    }
    return m;
  };
  return { keys, achievement: numMap(pr.achievement), delta: numMap(pr.delta) };
}

// Imported plan: bounded strings + whitelisted numeric intervals.
function sanitizeImportedPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const out = {
    id: _impStr(plan.id, 80) || uid(),
    title: _impStr(plan.title, 300) || "",
    description: _impStr(plan.description, 2000) || "",
    timeCapS: _impNum(plan.timeCapS, 0, 864000),
    intervals: [],
  };
  if (Array.isArray(plan.intervals)) {
    for (const iv of plan.intervals.slice(0, IMPORT_MAX_PLAN_INTERVALS)) {
      if (!iv || typeof iv !== "object") continue;
      const kind = iv.kind === "time" ? "time" : (iv.kind === "distance" ? "distance" : null);
      const value = _impNum(iv.value, 0, 1e6);
      if (!kind || value == null || value <= 0) continue;
      out.intervals.push({
        kind, value,
        targetPaceS: _impNum(iv.targetPaceS, 0, 3600), targetWatts: _impNum(iv.targetWatts, 0, 5000),
        targetSpm: _impNum(iv.targetSpm, 0, 300), restS: _impNum(iv.restS, 0, 86400) || 0,
      });
    }
  }
  const known = new Set(BENCHMARKS.map(b => b.key));
  if (typeof plan.benchKey === "string" && known.has(plan.benchKey)) out.benchKey = plan.benchKey;
  return out;
}

// Imported totals: numeric whitelist, zeros for the required pair.
function sanitizeImportedTotals(t) {
  if (!t || typeof t !== "object") return { elapsedS: 0, distanceM: 0 };
  return {
    elapsedS: _impNum(t.elapsedS, 0, 864000) || 0,
    distanceM: _impNum(t.distanceM, 0, 1e6) || 0,
    avgWatts: _impNum(t.avgWatts, 0, 5000), avgPaceS: _impNum(t.avgPaceS, 0, 3600),
    strokes: _impNum(t.strokes, 0, 1e6), avgHr: _impNum(t.avgHr, 0, 300),
  };
}

// =====================================================================
// Curve shape analysis (v1.19.0) — pure helpers over force curves.
// =====================================================================
// Shape metrics for one curve (any sample count >= 8):
//   peak       highest force (same unit as the input — lbf here)
//   peakPos    where the peak lands, 0-1 of the drive
//   frontLoad  fraction of total curve area before the peak — a leg-
//              driven catch loads the front half (> 0.5)
//   smoothness 0-100 from mean |second difference| of the peak-
//              normalised curve (100 = one clean accelerating push)
function curveShapeMetrics(curve) {
  if (!curve || curve.length < 8) return null;
  let peak = 0, peakIdx = 0, area = 0;
  for (let i = 0; i < curve.length; i++) {
    const v = Math.max(0, curve[i]);
    area += v;
    if (v > peak) { peak = v; peakIdx = i; }
  }
  if (peak <= 0 || area <= 0) return null;
  // Front-load = share of total force area delivered in the FIRST HALF
  // of the drive (not area-before-peak, which shrinks as the peak moves
  // earlier and would invert the meaning).
  let firstHalf = 0;
  const mid = Math.floor(curve.length / 2);
  for (let i = 0; i < mid; i++) firstHalf += Math.max(0, curve[i]);
  let jerk = 0;
  for (let i = 1; i < curve.length - 1; i++) {
    jerk += Math.abs((curve[i + 1] - 2 * curve[i] + curve[i - 1]) / peak);
  }
  jerk /= (curve.length - 2);
  return {
    peak,
    peakPos: peakIdx / (curve.length - 1),
    frontLoad: firstHalf / area,
    smoothness: Math.max(0, Math.min(100, Math.round(100 - Math.max(0, jerk - 0.004) * 3000))),
  };
}

// Shape similarity of two curves, 0-100: cosine similarity of the
// peak-normalised, length-aligned curves. Peak-normalising first makes
// this a SHAPE measure, not a power measure — a lighter athlete with
// the same drive shape scores ~100. null when either curve is unusable.
function curveSimilarity(a, b) {
  if (!a || !b || a.length < 8 || b.length < 8) return null;
  const ra = a.length === FC_SAMPLES ? a : resampleCurve(Array.from(a), FC_SAMPLES);
  const rb = b.length === FC_SAMPLES ? b : resampleCurve(Array.from(b), FC_SAMPLES);
  if (!ra || !rb) return null;
  let pa = 0, pb = 0;
  for (const v of ra) if (v > pa) pa = v;
  for (const v of rb) if (v > pb) pb = v;
  if (pa <= 0 || pb <= 0) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < FC_SAMPLES; i++) {
    const x = Math.max(0, ra[i]) / pa, y = Math.max(0, rb[i]) / pb;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return null;
  return Math.round((dot / Math.sqrt(na * nb)) * 100);
}

// =====================================================================
// Live technique-drift detection (v1.18.0)
// =====================================================================
// Compares the last 15 strokes against an early-session baseline
// (strokes 11-25 — the first 10 are warm-up noise). Pure: takes the
// capture log, returns display-ready items. null-tolerant on every
// field so demo mode and HR-less rows never crash it.
function computeTechniqueDrift(samples) {
  if (!Array.isArray(samples) || samples.length < 40) return { has: false };
  const base = samples.slice(10, 25);
  const recent = samples.slice(-15);
  const mean = (rows, f) => {
    const vs = rows.map(f).filter(v => v != null && isFinite(v));
    return vs.length >= 5 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const cv = (rows, f) => {
    const vs = rows.map(f).filter(v => v != null && isFinite(v));
    if (vs.length < 5) return null;
    const m = vs.reduce((a, b) => a + b, 0) / vs.length;
    if (!m) return null;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / vs.length);
    return (sd / m) * 100;
  };
  const ratioOf = s => (s.dt && s.rt) ? s.rt / s.dt : null;
  const items = [];
  const push = (key, label, b, c, fmt, warn, text) => {
    if (b == null || c == null) return;
    items.push({ key, label, base: b, cur: c, tone: warn ? "warn" : "ok",
      text: text, baseText: fmt(b), curText: fmt(c) });
  };

  const dlB = mean(base, s => s.dl), dlC = mean(recent, s => s.dl);
  if (dlB != null && dlC != null) {
    const pct = ((dlC - dlB) / dlB) * 100;
    push("driveLen", "Drive length", dlB, dlC, v => v.toFixed(2) + " m",
      pct < -3, pct < -3 ? `Drive shortened ${Math.abs(pct).toFixed(1)}% vs early strokes` : "Drive length holding");
  }
  const rtB = mean(base, ratioOf), rtC = mean(recent, ratioOf);
  if (rtB != null && rtC != null) {
    const pct = ((rtC - rtB) / rtB) * 100;
    push("ratio", "Ratio", rtB, rtC, v => v.toFixed(1) + " : 1",
      Math.abs(pct) > 12, Math.abs(pct) > 12
        ? `Ratio ${pct > 0 ? "lengthened" : "collapsed"} ${Math.abs(pct).toFixed(0)}%`
        : "Rhythm steady");
  }
  const ptB = mean(base, s => s.pt), ptC = mean(recent, s => s.pt);
  if (ptB != null && ptC != null) {
    const shift = ptC - ptB;
    push("peakTiming", "Peak timing", ptB, ptC, v => Math.round(v * 100) + "%",
      Math.abs(shift) > 0.06, Math.abs(shift) > 0.06
        ? `Peak force moved ${shift > 0 ? "later" : "earlier"} in the drive`
        : "Peak timing steady");
  }
  const rvB = cv(base, s => s.r), rvC = cv(recent, s => s.r);
  if (rvB != null && rvC != null) {
    push("rateCv", "Rate steadiness", rvB, rvC, v => v.toFixed(1) + "% cv",
      rvC - rvB > 1.5, rvC - rvB > 1.5 ? "Stroke rate getting ragged" : "Rate steady");
  }

  if (!items.length) return { has: false };
  const warns = items.filter(i => i.tone === "warn");
  return {
    has: true, drifting: warns.length > 0, items,
    headline: warns.length ? warns[0].text : "Technique stable",
  };
}

// v1.19.0 — hysteresis over the drift analysis so the live card can't
// flicker on one noisy evaluation: a warning must persist for 3
// consecutive evaluations (~15 strokes) to latch, and takes 3
// consecutive stable evaluations to clear. Pure: (previous displayed
// state, fresh evaluation) → next displayed state.
const DRIFT_LATCH_EVALS = 3;
function applyDriftHysteresis(prev, current) {
  if (!current || !current.has) {
    return { has: false, _warnStreak: 0, _stableStreak: 0 };
  }
  const warnStreak = current.drifting ? ((prev && prev._warnStreak) || 0) + 1 : 0;
  const stableStreak = !current.drifting ? ((prev && prev._stableStreak) || 0) + 1 : 0;
  let latched = !!(prev && prev.drifting);
  if (warnStreak >= DRIFT_LATCH_EVALS) latched = true;
  if (stableStreak >= DRIFT_LATCH_EVALS) latched = false;
  const lastWarn = (current.drifting && current.headline)
    ? current.headline : ((prev && prev._lastWarnHeadline) || null);
  return {
    ...current,
    drifting: latched,
    headline: latched ? (lastWarn || "Technique drifting") : current.headline,
    _warnStreak: warnStreak, _stableStreak: stableStreak,
    _lastWarnHeadline: lastWarn,
  };
}

// =====================================================================
// Performance analytics (v1.14.0) — pure, DOM-free rollups over saved
// history. Time-windowed functions take an explicit `nowMs` so tests are
// deterministic. NONE of these invent data: empty history → empty result.
// =====================================================================
const PR_KEYS = ["500m", "1k", "2k", "5k", "6k", "10k", "30min", "60min"];

// Session-average stroke rate — prefer interval data, else strokes/time.
function sessionAvgRate(entry) {
  const rows = (entry && entry.results) || [];
  const rates = rows.map(r => r && r.strokeRate).filter(v => v > 0);
  if (rates.length) return rates.reduce((a, b) => a + b, 0) / rates.length;
  const T = (entry && entry.totals) || {};
  if (T.strokes > 0 && T.elapsedS > 0) return T.strokes * 60 / T.elapsedS;
  return null;
}

// Normalised per-session metrics used by every rollup.
function perfSessionMetrics(entry) {
  const T = (entry && entry.totals) || {};
  return {
    id: entry && entry.id, title: (entry && entry.title) || "Session",
    date: (entry && entry.date) || "", dateMs: entry && entry.date ? Date.parse(entry.date) : NaN,
    distanceM: T.distanceM || 0, elapsedS: T.elapsedS || 0,
    split: (T.avgPaceS != null && T.avgPaceS > 0) ? T.avgPaceS : null,
    watts: (T.avgWatts != null && T.avgWatts > 0) ? T.avgWatts : null,
    hr:    (T.avgHr   != null && T.avgHr   > 0) ? T.avgHr   : null,
    rate:  sessionAvgRate(entry),
    benchKey: (entry && entry.plan && entry.plan.benchKey) || null,
  };
}

// =====================================================================
// Session Replay readiness (v1.14.1, extended v1.18.0) — PURE capability
// detection over a saved session. These helpers report, honestly, what
// the persisted data can support and never invent data.
//
// What history persists (see logCurrentWorkout): totals, plan, per-
// INTERVAL results, optional bookmarks + pr, and — since v1.18.0 —
// optional per-stroke samples (entry.strokes) + session force curves
// (entry.fc). Pre-v1.18 sessions cap out at interval fidelity.
// =====================================================================
// Highest replay fidelity the saved data supports:
//   "none" · "summary-only" (totals only) · "interval" (per-interval) ·
//   "stroke" (v1.18+ capture — per-stroke scrubbing).
function getSessionReplayCapability(session) {
  if (!session) return "none";
  if (Array.isArray(session.strokes) && session.strokes.length >= 2) return "stroke";
  const rows = Array.isArray(session.results)
    ? session.results.filter(r => r && (r.distanceM > 0 || r.elapsedS > 0)) : [];
  if (rows.length >= 1) return "interval";
  const T = session.totals || {};
  if (T.distanceM > 0 || T.elapsedS > 0) return "summary-only";
  return "none";
}

// Stroke-level timeline (v1.18.0) — one point per captured sample,
// expanded from the compact persisted keys to the same field names the
// interval timeline uses. [] when the session has no stroke capture.
function buildStrokeReplayTimeline(session) {
  const rows = (session && Array.isArray(session.strokes)) ? session.strokes : [];
  const num = v => (v != null && isFinite(v) && v > 0) ? v : null;
  return rows.map((s, i) => ({
    index: i,
    elapsedS:  (s.t != null && s.t >= 0) ? s.t : null,
    distanceM: (s.d != null && s.d >= 0) ? s.d : null,
    split: num(s.p), watts: num(s.w), strokeRate: num(s.r),
    heartRate: num(s.hr), driveLengthM: num(s.dl),
    peakForceLbs: num(s.pf),
    peakTiming: (s.pt != null && s.pt >= 0 && s.pt <= 1) ? s.pt : null,
    ratio: (num(s.dt) && num(s.rt)) ? s.rt / s.dt : null,
  }));
}

// Place bookmarks on the stroke timeline by distance — nearest sample.
// [] when the session has no bookmarks or no stroke capture.
function mapBookmarksToStrokeTimeline(session) {
  const marks = (session && Array.isArray(session.bookmarks)) ? session.bookmarks : [];
  const tl = buildStrokeReplayTimeline(session);
  if (!tl.length) return [];
  return marks.map((b, i) => {
    let best = null, bestErr = Infinity;
    if (b && b.distanceM != null) {
      for (const p of tl) {
        if (p.distanceM == null) continue;
        const err = Math.abs(p.distanceM - b.distanceM);
        if (err < bestErr) { bestErr = err; best = p.index; }
      }
    }
    return { index: i, distanceM: (b && b.distanceM != null) ? b.distanceM : null,
      elapsedS: (b && b.elapsedS != null) ? b.elapsedS : null, strokePos: best };
  });
}

// Cumulative interval timeline for an interval scrubber — each point is
// the boat's state at the END of that interval. Empty for old / summary-
// only / plain sessions (they must not crash). Missing fields → null.
function buildIntervalReplayTimeline(session) {
  const rows = (session && Array.isArray(session.results) ? session.results : [])
    .filter(r => r && (r.distanceM > 0 || r.elapsedS > 0));
  let cumDist = 0, cumTime = 0;
  return rows.map((r, i) => {
    cumDist += r.distanceM || 0;
    cumTime += r.elapsedS || 0;
    return {
      index: i,
      cumulativeDistanceM: cumDist,
      cumulativeTimeS: cumTime,
      split:        (r.paceS != null && r.paceS > 0) ? r.paceS : null,
      watts:        (r.watts != null && r.watts > 0) ? r.watts : null,
      strokeRate:   (r.strokeRate != null && r.strokeRate > 0) ? r.strokeRate : null,
      heartRate:    (r.heartRate != null && r.heartRate > 0) ? r.heartRate : null,   // missing HR → null
      driveLengthM: (r.driveLengthM != null && r.driveLengthM > 0) ? r.driveLengthM : null,
    };
  });
}

// Place each saved bookmark on the replay timeline by distance, including
// the interval it falls in (when interval data exists). Never invents a
// bookmark; returns [] for a session with none.
function mapBookmarksToReplayTimeline(session) {
  const marks = (session && Array.isArray(session.bookmarks)) ? session.bookmarks : [];
  const timeline = buildIntervalReplayTimeline(session);
  return marks.map((b, i) => {
    let intervalIndex = null;
    if (timeline.length && b && b.distanceM != null) {
      const hit = timeline.find(p => p.cumulativeDistanceM >= b.distanceM);
      intervalIndex = hit ? hit.index : timeline.length - 1;
    }
    return {
      index: i,
      distanceM:   (b && b.distanceM   != null) ? b.distanceM   : null,
      elapsedS:    (b && b.elapsedS    != null) ? b.elapsedS    : null,
      strokeIndex: (b && b.strokeIndex != null) ? b.strokeIndex : null,
      intervalIndex,
    };
  });
}

// Plain-English list of what replay CANNOT show for this session — so the
// future UI can disclose limits rather than pretend. Always honest.
function summarizeReplayLimitations(session) {
  const cap = getSessionReplayCapability(session);
  if (cap === "none") return ["This session has no logged data to replay."];
  const out = [];
  if (cap === "summary-only")
    out.push("Summary only — no per-interval breakdown was saved, so only totals can be shown.");
  if (cap === "stroke") {
    // v1.18 capture: long sessions are decimated to stay in budget, and
    // curves are session-level (best + average), not one per stroke.
    out.push("Long sessions store a thinned stroke sample, so very fine stroke-to-stroke detail may be smoothed.");
    if (session.fc) {
      out.push("Force curves are saved per session (best + average) — individual stroke curves aren't stored.");
    } else {
      out.push("No force-curve history is saved for this session.");
    }
  } else {
    out.push("No per-stroke samples are saved, so stroke-by-stroke replay isn't possible for this session.");
    out.push("No force-curve history is saved, so the drive force curve can't be replayed.");
  }
  const hasHr = (session.results || []).some(r => r && r.heartRate > 0) ||
                (session.totals && session.totals.avgHr > 0) ||
                (Array.isArray(session.strokes) && session.strokes.some(s => s && s.hr > 0));
  if (!hasHr) out.push("No heart-rate data was recorded for this session.");
  return out;
}

// 7-day / 30-day rollup + best-recent session + week-on-week trend.
function computePerformanceOverview(history, nowMs) {
  const all = (history || []).map(perfSessionMetrics).filter(m => !isNaN(m.dateMs));
  if (!all.length) return { has: false };
  const DAY = 86400000;
  const win = (days, fromDays) => all.filter(m => {
    const age = nowMs - m.dateMs;
    return age >= 0 && age < days * DAY && (fromDays == null || age >= fromDays * DAY);
  });
  const roll = (rows) => {
    const withBoth = rows.filter(m => m.distanceM > 0 && m.elapsedS > 0);
    const aggMeters = withBoth.reduce((a, m) => a + m.distanceM, 0);
    const aggTime   = withBoth.reduce((a, m) => a + m.elapsedS, 0);
    const mean = (k) => { const v = rows.map(m => m[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return {
      meters:  rows.reduce((a, m) => a + m.distanceM, 0),
      workouts: rows.length,
      timeS:   rows.reduce((a, m) => a + m.elapsedS, 0),
      avgSplit: aggMeters > 0 ? aggTime / aggMeters * 500 : null,   // true distance-weighted split
      avgWatts: mean("watts"), avgRate: mean("rate"), avgHr: mean("hr"),
    };
  };
  // best recent (30d): strongest by watts, else most metres.
  let best = null;
  for (const m of win(30)) {
    if (!best) { best = m; continue; }
    const better = (m.watts != null && best.watts != null) ? m.watts > best.watts
                 : (m.watts != null && best.watts == null) ? true
                 : (m.watts == null && best.watts != null) ? false
                 : m.distanceM > best.distanceM;
    if (better) best = m;
  }
  const thisWk = win(7).reduce((a, m) => a + m.distanceM, 0);
  const prevWk = win(14, 7).reduce((a, m) => a + m.distanceM, 0);
  let trend;
  if (prevWk <= 0) trend = { dir: "new", text: thisWk > 0 ? "First week of logged training — keep it rolling." : "No sessions in the last 7 days." };
  else {
    const ch = (thisWk - prevWk) / prevWk * 100;
    trend = ch > 10  ? { dir: "up",     text: `Volume up ${Math.round(ch)}% vs the previous week.` }
          : ch < -10 ? { dir: "down",   text: `Volume down ${Math.round(-ch)}% vs the previous week.` }
                     : { dir: "steady", text: "Training volume is steady week-on-week." };
  }
  return { has: true, total: all.length, d7: roll(win(7)), d30: roll(win(30)), best, trend };
}

// PR cards from saved benchmarks (NO invented values — has=false if unset).
function computePrCards(prefs) {
  prefs = prefs || {};
  const bm = prefs.benchmarks || {}, meta = prefs.benchmarkMeta || {};
  const TD = (typeof BENCH_TARGET_DIST !== "undefined") ? BENCH_TARGET_DIST : {};
  const TT = (typeof BENCH_TARGET_TIME !== "undefined") ? BENCH_TARGET_TIME : {};
  return PR_KEYS.map(key => {
    const bench = BENCHMARKS.find(b => b.key === key) || { key, label: key, kind: "time" };
    const v = bm[key], has = v != null && v > 0, m = meta[key] || {};
    let resultText = "—", pace = null;
    if (has) {
      if (bench.kind === "time") { resultText = fmtTime(v); pace = m.paceS || (TD[key] ? v / (TD[key] / 500) : null); }
      else                       { resultText = Math.round(v).toLocaleString() + " m"; pace = m.paceS || (TT[key] ? TT[key] / (v / 500) : null); }
    }
    return { key, label: bench.label, kind: bench.kind, value: has ? v : null, has,
             resultText, pace, paceText: (pace && pace > 0) ? fmtPace(pace) : "—",
             date: m.dateISO || null, fromTest: !!m.sessionId };
  });
}

// Benchmark attempt trend from history (every saved Test of that distance).
function computeBenchmarkProgress(history) {
  const out = [];
  for (const bench of BENCHMARKS) {
    if (!PR_KEYS.includes(bench.key)) continue;
    const attempts = (history || [])
      .filter(h => h && h.plan && h.plan.benchKey === bench.key)
      .map(h => ({ date: h.date || "", dateMs: Date.parse(h.date || ""), value: benchmarkAchievement(h, bench.key) }))
      .filter(a => a.value != null && !isNaN(a.dateMs))
      .sort((a, b) => a.dateMs - b.dateMs);
    if (!attempts.length) continue;
    const lower = bench.kind === "time";
    const best = attempts.reduce((b, a) => ((lower ? a.value < b.value : a.value > b.value) ? a : b), attempts[0]);
    const first = attempts[0], latest = attempts[attempts.length - 1];
    let improvement = null, direction = "not-enough-data";
    if (attempts.length >= 2) {
      improvement = lower ? first.value - latest.value : latest.value - first.value;   // +ve = improved
      const betterNow = lower ? latest.value < first.value : latest.value > first.value;
      const worseNow  = lower ? latest.value > first.value : latest.value < first.value;
      direction = betterNow ? "improving" : worseNow ? "declining" : "stable";
    }
    out.push({ key: bench.key, label: bench.label, kind: bench.kind, attempts: attempts.length,
               latest: latest.value, best: best.value, first: first.value, improvement, direction,
               series: attempts.map(a => a.value) });
  }
  return out;
}

// Fatigue summary across recent sessions (reuses computeFatigue).
function computeFatigueTrend(history, max) {
  const scored = (history || []).filter(h => h && (h.results || []).length >= 4).slice(0, max || 10)
    .map(h => ({ entry: h, fat: computeFatigue(h) })).filter(x => x.fat);
  if (!scored.length) return { has: false };
  const idxs = scored.map(x => x.fat.index);
  const avg = Math.round(idxs.reduce((a, b) => a + b, 0) / idxs.length);
  const best  = scored.reduce((b, x) => x.fat.index > b.fat.index ? x : b, scored[0]);
  const worst = scored.reduce((w, x) => x.fat.index < w.fat.index ? x : w, scored[0]);
  const drivers = {};
  for (const x of scored) {
    const f = x.fat.fade;
    if (f.driveLen != null && f.driveLen > 2) drivers.driveLen = (drivers.driveLen || 0) + 1;
    if (f.watts    != null && f.watts    > 2) drivers.watts    = (drivers.watts    || 0) + 1;
    if (f.split    != null && f.split    > 1) drivers.split    = (drivers.split    || 0) + 1;
    if (f.hrDrift  != null && f.hrDrift  > 5) drivers.hr       = (drivers.hr       || 0) + 1;
  }
  const top = Object.keys(drivers).sort((a, b) => drivers[b] - drivers[a])[0];
  const phrase = { driveLen: "drive length dropping late", watts: "power fading in the back half",
                   split: "the split slipping over the piece", hr: "heart-rate drift" };
  const text = avg >= 85 ? "You're pacing well — most recent pieces barely fade."
    : top ? `Recent fade is mostly from ${phrase[top]}, in ${drivers[top]} of your last ${scored.length} pieces.`
          : "Mixed fade pattern — no single recurring cause.";
  return { has: true, n: scored.length, avgIndex: avg,
           best:  { title: best.entry.title,  date: best.entry.date,  index: best.fat.index },
           worst: { title: worst.entry.title, date: worst.entry.date, index: worst.fat.index },
           pattern: top || null, text };
}

// Technique trend across recent sessions (drive length, peak force,
// split consistency) — rowing language, not generic analytics.
function computeTechniqueTrend(history, max) {
  const qas = (history || []).filter(h => h && (h.results || []).length >= 4).slice(0, max || 10)
    .map(h => ({ entry: h, qa: quartileAverages(h.results) })).filter(x => x.qa && x.qa.first && x.qa.last);
  if (!qas.length) return { has: false };
  const items = [];
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const dl = qas.map(x => x.qa.first.driveLengthM).filter(v => v != null);
  const dlFade = qas.map(x => (x.qa.first.driveLengthM != null && x.qa.last.driveLengthM != null)
      ? (x.qa.first.driveLengthM - x.qa.last.driveLengthM) / x.qa.first.driveLengthM * 100 : null).filter(v => v != null);
  if (dl.length) {
    const fade = mean(dlFade) || 0;
    items.push({ key: "drive", label: "Drive length", value: mean(dl).toFixed(2) + " m",
      note: fade > 2 ? `shortening ~${fade.toFixed(0)}% late` : "holding through the piece",
      tone: fade > 2 ? "warn" : "ok" });
  }
  const pf = qas.map(x => x.qa.first.peakForceLbs).filter(v => v != null);
  if (pf.length) items.push({ key: "force", label: "Peak force", value: Math.round(mean(pf)) + " lbf",
    note: `avg first-quarter across ${pf.length} pieces`, tone: "ok" });
  // Split consistency: average within-session CV of interval split (lower = steadier).
  const cvs = qas.map(x => {
    const sp = (x.entry.results || []).map(r => r.paceS).filter(v => v > 0);
    if (sp.length < 3) return null;
    const m = sp.reduce((a, b) => a + b, 0) / sp.length;
    const sd = Math.sqrt(sp.reduce((a, b) => a + (b - m) * (b - m), 0) / sp.length);
    return m > 0 ? sd / m * 100 : null;
  }).filter(v => v != null);
  if (cvs.length) { const cv = mean(cvs); items.push({ key: "consistency", label: "Stroke consistency",
    value: (100 - Math.min(100, cv * 4)).toFixed(0) + "%", note: cv < 2 ? "very even splits" : "some variation piece-to-piece",
    tone: cv < 3 ? "ok" : "warn" }); }
  const driveItem = items.find(i => i.key === "drive");
  const text = (driveItem && driveItem.tone === "warn")
    ? "Drive length has shortened late in your recent longer pieces — hold the finish length as you tire."
    : "Length and connection are holding well across recent sessions.";
  return { has: true, n: qas.length, items, text };
}

// HR / aerobic summary — explicit no-HR empty state.
function computeHrSummary(history, max) {
  const withHr = (history || []).slice(0, max || 20).map(perfSessionMetrics).filter(m => m.hr != null);
  if (!withHr.length) return { has: false, text: "No HR data yet — pair a strap to unlock HR drift and zone summaries." };
  const avgHr = Math.round(withHr.reduce((a, m) => a + m.hr, 0) / withHr.length);
  const drifts = (history || []).map(h => { const qa = quartileAverages(h.results);
    return (qa && qa.first && qa.last && qa.first.heartRate != null && qa.last.heartRate != null) ? qa.last.heartRate - qa.first.heartRate : null; }).filter(v => v != null);
  const avgDrift = drifts.length ? Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length) : null;
  const text = (avgDrift != null && avgDrift > 6) ? `Average HR ${avgHr} bpm, with ~${avgDrift} bpm of drift over a piece — typical on long aerobic work.`
    : (avgDrift != null) ? `Average HR ${avgHr} bpm with very little drift — a strong aerobic base.`
    : `Average HR ${avgHr} bpm across ${withHr.length} recent sessions.`;
  return { has: true, n: withHr.length, avgHr, avgDrift, text };
}

// Tiny dependency-free sparkline (inline SVG). "better" trends up visually.
function sparklineSvg(values, opts) {
  opts = opts || {};
  const w = opts.w || 96, h = opts.h || 26, pad = 3, lower = !!opts.lowerBetter;
  const vals = (values || []).filter(v => v != null && !isNaN(v));
  if (vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
  const pts = vals.map((v, i) => {
    const x = pad + i * (w - 2 * pad) / (vals.length - 1);
    const up = lower ? 1 - (v - min) / range : (v - min) / range;
    return [x, pad + (1 - up) * (h - 2 * pad)];
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="currentColor"/></svg>`;
}

// =====================================================================
// Technical-efficiency score (v1.18.0) — pure, explained, 0-100.
// =====================================================================
// Four PM5-derivable components, each 0-100, weighted:
//   curve  35% — smoothness of the session-AVERAGE force curve (one
//                clean accelerating push scores high; double peaks and
//                bumps score low). Averaging denoises single strokes.
//   peak   25% — where peak force lands in the drive; the front third
//                (30-45%) is the efficient band.
//   ratio  20% — recovery:drive rhythm inside the 1.8-2.8:1 band, with
//                a penalty for stroke-to-stroke ratio scatter.
//   length 20% — drive-length consistency (CV of per-stroke length).
// Needs v1.18 capture (entry.strokes and/or entry.fc); older sessions
// return {has:false} rather than a made-up number.
function computeEfficiencyScore(entry) {
  if (!entry) return { has: false };
  const strokes = Array.isArray(entry.strokes) ? entry.strokes : [];
  const fc = entry.fc || null;
  const clamp = v => Math.max(0, Math.min(100, v));
  const meanOf = vs => vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  const cvOf = vs => {
    const m = meanOf(vs);
    if (m == null || !m) return null;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / vs.length);
    return (sd / m) * 100;
  };
  const components = [];

  // curve smoothness — mean |second difference| of the peak-normalised
  // average curve. The session average smooths sensor noise, so what's
  // left really is shape.
  const curveSrc = fc && (fc.avg || fc.best);
  if (curveSrc && curveSrc.length >= 8) {
    const peak = Math.max(...curveSrc);
    if (peak > 0) {
      const n = curveSrc.map(v => v / peak);
      let jerk = 0;
      for (let i = 1; i < n.length - 1; i++) jerk += Math.abs(n[i + 1] - 2 * n[i] + n[i - 1]);
      jerk /= (n.length - 2);
      const score = clamp(100 - Math.max(0, jerk - 0.004) * 3000);
      components.push({ key: "curve", label: "Curve smoothness", weight: 0.35, score,
        detail: score >= 75 ? "One clean accelerating push — no double peak."
              : score >= 45 ? "Some bumpiness in the drive — think one continuous push."
              : "The force curve has dips or double peaks — leg-back-arm sequence is breaking up." });
    }
  }

  // peak position — front third of the drive is the efficient band.
  let pt = null;
  const pts = strokes.map(s => s && s.pt).filter(v => v != null && v >= 0 && v <= 1);
  if (pts.length >= 5) pt = meanOf(pts);
  else if (curveSrc && curveSrc.length >= 8) {
    let pi = 0;
    for (let i = 1; i < curveSrc.length; i++) if (curveSrc[i] > curveSrc[pi]) pi = i;
    pt = pi / (curveSrc.length - 1);
  }
  if (pt != null) {
    const dist = pt < 0.30 ? 0.30 - pt : pt > 0.45 ? pt - 0.45 : 0;
    const score = clamp(100 - dist * 400);
    components.push({ key: "peak", label: "Peak-force timing", weight: 0.25, score,
      detail: `Peak lands at ${Math.round(pt * 100)}% of the drive` +
        (dist === 0 ? " — right in the efficient front-third band."
         : pt > 0.45 ? " — late; drive the legs harder off the catch."
         : " — very early; keep pressure building through the drive.") });
  }

  // ratio band + steadiness.
  const ratios = strokes.map(s => (s && s.dt && s.rt) ? s.rt / s.dt : null)
    .filter(v => v != null && isFinite(v) && v > 0);
  if (ratios.length >= 5) {
    const m = meanOf(ratios);
    const dist = m < 1.8 ? 1.8 - m : m > 2.8 ? m - 2.8 : 0;
    const scatter = cvOf(ratios);
    const score = clamp(100 - dist * 60 - Math.max(0, (scatter || 0) - 6) * 2.5);
    components.push({ key: "ratio", label: "Rhythm (ratio)", weight: 0.20, score,
      detail: `Average ${m.toFixed(1)} : 1` +
        (dist === 0 ? ", steady in the 1.8-2.8 band." : m < 1.8 ? " — rushing the slide." : " — recovery drifting long.") });
  }

  // drive-length consistency.
  const dls = strokes.map(s => s && s.dl).filter(v => v != null && v > 0);
  if (dls.length >= 5) {
    const cv = cvOf(dls);
    if (cv != null) {
      const score = clamp(100 - Math.max(0, cv - 2) * 12);
      components.push({ key: "length", label: "Length consistency", weight: 0.20, score,
        detail: cv <= 3 ? `Drive length varies just ${cv.toFixed(1)}% stroke to stroke.`
          : `Drive length varies ${cv.toFixed(1)}% stroke to stroke — hold full compression when tired.` });
    }
  }

  if (!components.length) return { has: false };
  // v1.19.0 — say exactly which components could NOT be scored and why,
  // instead of silently renormalising around them.
  const missing = [];
  const missIf = (key, label, why) => {
    if (!components.some(c => c.key === key)) missing.push({ key, label, why });
  };
  missIf("curve", "Curve smoothness", "no session curves saved");
  missIf("peak", "Peak-force timing", "not enough peak-timing samples");
  missIf("ratio", "Rhythm (ratio)", "not enough drive/recovery samples");
  missIf("length", "Length consistency", "not enough drive-length samples");
  const wSum = components.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(components.reduce((a, c) => a + c.score * c.weight, 0) / wSum);
  return {
    has: true, score, components, missing,
    explanation: "Weighted blend of " +
      components.map(c => `${c.label.toLowerCase()} (${Math.round(c.weight / wSum * 100)}%)`).join(", ") +
      ", each 0-100 from this session's captured strokes and curves.",
  };
}

// Cross-session efficiency trend for the Technique tab. Sessions
// without v1.18 capture are skipped, never faked.
function computeEfficiencyTrend(history, max) {
  const scored = [];
  for (const h of (history || []).slice(0, max || 10)) {
    const r = computeEfficiencyScore(h);
    if (r.has) scored.push({ id: h.id, title: h.title, date: h.date, score: r.score });
  }
  if (!scored.length) return { has: false };
  const series = scored.slice().reverse().map(s => s.score);   // oldest → newest
  return {
    has: true, n: scored.length, latest: scored[0].score,
    avg: Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length),
    series,
  };
}

// =====================================================================
// Workout-to-workout comparison (v1.18.0) — pure diff over two saved
// sessions: delta-labelled metric rows + overlayable force-curve sets.
// =====================================================================
function buildSessionComparison(a, b) {
  if (!a || !b) return { has: false };
  const A = perfSessionMetrics(a), B = perfSessionMetrics(b);
  const rows = [];
  // better: which side wins ("a"/"b"/null) — null for neutral facts.
  const push = (label, va, vb, fmt, deltaFmt, lowerBetter) => {
    if (va == null || vb == null) return;
    const d = vb - va;
    let better = null;
    if (lowerBetter != null && Math.abs(d) > 1e-9) {
      better = (lowerBetter ? d < 0 : d > 0) ? "b" : "a";
    }
    rows.push({ label, aText: fmt(va), bText: fmt(vb),
      deltaText: (d >= 0 ? "+" : "−") + deltaFmt(Math.abs(d)), better });
  };
  const avgFromResults = (e, k) => {
    const vs = ((e && e.results) || []).map(r => r && r[k]).filter(v => v != null && v > 0);
    return vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
  };
  push("Distance", A.distanceM || null, B.distanceM || null, v => Math.round(v).toLocaleString() + " m", v => Math.round(v).toLocaleString() + " m", null);
  push("Time", A.elapsedS || null, B.elapsedS || null, fmtTime, fmtTime, null);
  push("Avg split", A.split, B.split, fmtPace, v => v.toFixed(1) + " s", true);
  push("Avg watts", A.watts, B.watts, v => Math.round(v) + " W", v => Math.round(v) + " W", false);
  push("Stroke rate", A.rate, B.rate, v => Math.round(v) + " spm", v => v.toFixed(1) + " spm", null);
  push("Avg HR", A.hr, B.hr, v => Math.round(v) + " bpm", v => Math.round(v) + " bpm", null);
  push("Drive length", avgFromResults(a, "driveLengthM"), avgFromResults(b, "driveLengthM"),
    v => v.toFixed(2) + " m", v => v.toFixed(2) + " m", false);
  push("Peak force", avgFromResults(a, "peakForceLbs"), avgFromResults(b, "peakForceLbs"),
    v => Math.round(v) + " lbf", v => Math.round(v) + " lbf", false);
  const effA = computeEfficiencyScore(a), effB = computeEfficiencyScore(b);
  if (effA.has && effB.has) {
    push("Efficiency score", effA.score, effB.score, v => Math.round(v) + " / 100", v => Math.round(v), false);
  }
  // Overlayable curves — session AVERAGE preferred (typical stroke),
  // best as fallback. Which one was used is reported so the UI can say.
  const curveOf = e => (e && e.fc && (e.fc.avg || e.fc.best)) || null;
  const curveKind = e => (e && e.fc ? (e.fc.avg ? "avg" : e.fc.best ? "best" : null) : null);
  const ca = curveOf(a), cb = curveOf(b);
  // Curve shape rows (v1.19.0) — only when both sides saved curves, so
  // the table never compares a shape against nothing.
  const shA = curveShapeMetrics(ca), shB = curveShapeMetrics(cb);
  if (shA && shB) {
    push("Peak timing", shA.peakPos * 100, shB.peakPos * 100,
      v => Math.round(v) + "% of drive", v => Math.round(v) + "%", null);
    push("Front-load", shA.frontLoad * 100, shB.frontLoad * 100,
      v => Math.round(v) + "%", v => Math.round(v) + "%", null);
    push("Curve smoothness", shA.smoothness, shB.smoothness,
      v => Math.round(v) + " / 100", v => Math.round(v), false);
  }
  return {
    has: true, rows,
    similarity: (ca && cb) ? curveSimilarity(ca, cb) : null,
    curves: {
      a: ca, aKind: curveKind(a),
      b: cb, bKind: curveKind(b),
    },
  };
}

// =====================================================================
// Smarter workout creation (v1.18.0) — PR-informed target paces. Pure.
// =====================================================================
// Split for a saved benchmark: distance benchmarks store seconds,
// time benchmarks store metres (see BENCHMARKS/applyPrUpdates).
function benchmarkPaceOf(key, prefs) {
  const v = prefs && prefs.benchmarks && prefs.benchmarks[key];
  if (!v || v <= 0) return null;
  const dist = BENCH_TARGET_DIST[key];
  const time = BENCH_TARGET_TIME[key];
  if (dist) return v * 500 / dist;
  if (time) return time * 500 / v;
  return null;
}

// Suggest a target pace per interval from the user's PRs. The best
// available PR is normalised to a 2k-equivalent split with Paul's Law
// (~5 s per 500 per doubling of distance), then each interval gets a
// training band relative to that: sprints under it, steady state well
// over it. Returns {has:false, reason} when there's nothing to go on.
const SUGGEST_REF_ORDER = ["2k", "5k", "6k", "1k", "500m", "10k", "30min", "60min"];
function suggestTargetsForPlan(plan, prefs) {
  const ivs = (plan && Array.isArray(plan.intervals)) ? plan.intervals.filter(Boolean) : [];
  if (!ivs.length) return { has: false, reason: "no-intervals" };
  let refKey = null, refPace = null;
  for (const k of SUGGEST_REF_ORDER) {
    const p = benchmarkPaceOf(k, prefs);
    if (p) { refKey = k; refPace = p; break; }
  }
  if (!refPace) return { has: false, reason: "no-prs" };
  const refDist = BENCH_TARGET_DIST[refKey] ||
    (prefs.benchmarks[refKey] > 0 ? prefs.benchmarks[refKey] : 2000);   // time-bench: stored metres
  const pace2k = refPace - 5 * (Math.log(refDist / 2000) / Math.LN2);
  const targets = ivs.map((iv, i) => {
    // Interval size in metres (time intervals estimated at 2k pace).
    const approxDist = iv.kind === "distance" ? iv.value : (iv.value / pace2k) * 500;
    let band, label;
    if (approxDist <= 300)       { band = -3; label = "sprint"; }
    else if (approxDist <= 700)  { band = -1; label = "race pace"; }
    else if (approxDist <= 1600) { band =  5; label = "threshold"; }
    else if (approxDist <= 4000) { band = 10; label = "sweet spot"; }
    else                         { band = 16; label = "steady state"; }
    return { index: i, targetPaceS: Math.round((pace2k + band) * 10) / 10, label };
  });
  return { has: true, refKey, refPaceS: refPace, pace2kS: pace2k, targets };
}

// =====================================================================
// Training report (v1.18.0) — pure markdown builder over saved history.
// =====================================================================
function buildTrainingReport(history, prefs, nowMs) {
  history = history || [];
  const L = [];
  L.push("# PM5 Dashboard — Training report");
  L.push("");
  L.push(`Generated ${new Date(nowMs).toISOString().slice(0, 10)} · ${history.length} logged session${history.length === 1 ? "" : "s"}`);
  const ov = computePerformanceOverview(history, nowMs);
  if (ov.has) {
    const block = (name, r) => {
      L.push("");
      L.push(`## ${name}`);
      L.push(`- Volume: ${Math.round(r.meters).toLocaleString()} m across ${r.workouts} workout${r.workouts === 1 ? "" : "s"} (${fmtTime(r.timeS)})`);
      if (r.avgSplit) L.push(`- Avg split: ${fmtPace(r.avgSplit)} /500`);
      if (r.avgWatts) L.push(`- Avg watts: ${Math.round(r.avgWatts)} W`);
      if (r.avgHr) L.push(`- Avg HR: ${Math.round(r.avgHr)} bpm`);
    };
    block("Last 7 days", ov.d7);
    block("Last 30 days", ov.d30);
    if (ov.trend && ov.trend.text) { L.push(""); L.push(`Trend: ${ov.trend.text}`); }
  }
  const prCards = computePrCards(prefs || {}).filter(c => c.has);
  if (prCards.length) {
    L.push("");
    L.push("## Personal records");
    for (const c of prCards) {
      L.push(`- ${c.label}: ${c.resultText}${c.paceText ? ` (${c.paceText} /500)` : ""}${c.date ? ` — ${c.date}` : ""}`);
    }
  }
  const tech = computeTechniqueTrend(history);
  if (tech.has && tech.text) { L.push(""); L.push("## Technique"); L.push(tech.text); }
  const eff = computeEfficiencyTrend(history);
  if (eff.has) L.push(`Technical efficiency: latest ${eff.latest}/100, average ${eff.avg}/100 over ${eff.n} captured session${eff.n === 1 ? "" : "s"}.`);
  const fat = computeFatigueTrend(history);
  if (fat.has && fat.text) { L.push(""); L.push("## Fatigue & pacing"); L.push(fat.text); }
  const hr = computeHrSummary(history);
  if (hr.has && hr.text) { L.push(""); L.push("## Heart rate"); L.push(hr.text); }
  L.push("");
  L.push("---");
  L.push("Exported from PM5 Dashboard.");
  return L.join("\n");
}
