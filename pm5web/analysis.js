// ====================
// PM5 Dashboard — analysis.js (v1.20.0 modular split)
// ====================
// The PURE analysis layer: import sanitizers, curve shape analysis,
// drift detection, performance analytics, replay readiness, and the
// v1.20 baseline / cue / race / power engines. No DOM access at top
// level. Loaded as a classic script BEFORE the main script in
// index.html, cached by the service worker for offline use, and
// concatenated with the main script by tests/harness.js. Functions here
// may reference main-script globals (fmtTime, BENCHMARKS, uid, state,
// ...) — resolution happens at call time, after both scripts load.
// Counted by the total offline-app size guard in tests/run.js.
// ====================

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
  // v1.20.0 — race-plan meta is sanitized alongside the plan it rides.
  const race = sanitizeRaceMeta(plan.race);
  if (race) out.race = race;
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

// ====================
// Curve shape analysis (v1.19.0) — pure helpers over force curves.
// ====================
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

// ====================
// Live technique-drift detection (v1.18.0)
// ====================
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

// ====================
// Performance analytics (v1.14.0) — pure, DOM-free rollups over saved
// history. Time-windowed functions take an explicit `nowMs` so tests are
// deterministic. NONE of these invent data: empty history → empty result.
// ====================
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

// ====================
// Session Replay readiness (v1.14.1+) — PURE capability detection over
// a saved session; reports what the persisted data supports (totals /
// intervals / v1.18+ stroke samples + fc curves) and never invents
// data. Pre-v1.18 sessions cap out at interval fidelity.
// ====================
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

// ====================
// Technical-efficiency score (v1.18.0) — pure, explained, 0-100.
// ====================
// Components (weights): curve smoothness 35% (session-average curve),
// peak-timing band 30-45% of drive 25%, ratio band 1.8-2.8:1 with a
// scatter penalty 20%, drive-length consistency 20%. Needs v1.18
// capture; older sessions return {has:false}, never a made-up number.
// Full formulas: docs/analysis-methods.md.
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

// ====================
// Workout-to-workout comparison (v1.18.0) — pure diff over two saved
// sessions: delta-labelled metric rows + overlayable force-curve sets.
// ====================
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

// ====================
// Smarter workout creation (v1.18.0) — PR-informed target paces. Pure.
// ====================
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

// ====================
// Training report (v1.18.0) — pure markdown builder over saved history.
// ====================
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

// ====================
// Personal Baseline Engine (v1.20.0)
// ====================
// A baseline is EVIDENCE from the athlete's own rowing — never a
// universal biomechanical ideal. Shape:
//   { source, label, curve|null (64 samples), stats|null, n,
//     dateRange: {from,to}|null, confidence: {level, why} }
// stats = { dl, ratio, pace, rate } each { mean, cv } plus n.

// Per-stroke aggregate stats over a capture log. null-tolerant.
function strokeStatsOf(samples) {
  if (!Array.isArray(samples) || samples.length < 10) return null;
  const agg = (f) => {
    const vs = samples.map(f).filter(v => v != null && isFinite(v) && v > 0);
    if (vs.length < 10) return null;
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    if (!mean) return null;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vs.length);
    return { mean, cv: (sd / mean) * 100 };
  };
  const stats = {
    dl: agg(s => s.dl), ratio: agg(s => (s.dt && s.rt) ? s.rt / s.dt : null),
    pace: agg(s => s.p), rate: agg(s => s.r),
    peakTiming: agg(s => (s.pt != null && s.pt > 0) ? s.pt : null),
    n: samples.length,
  };
  return (stats.dl || stats.ratio || stats.pace) ? stats : null;
}

// Two sessions are comparable when they are the same kind of work:
// identical benchmark, or total distance within ±20%, or total
// duration within ±20%. Both must carry v1.18+ capture data to
// contribute curves/stats to a baseline.
function sessionsCompatible(a, b) {
  if (!a || !b) return false;
  const ka = a.plan && a.plan.benchKey, kb = b.plan && b.plan.benchKey;
  if (ka && kb) return ka === kb;
  const da = a.totals && a.totals.distanceM, db = b.totals && b.totals.distanceM;
  if (da > 0 && db > 0 && Math.abs(da - db) / Math.max(da, db) <= 0.2) return true;
  const ta = a.totals && a.totals.elapsedS, tb = b.totals && b.totals.elapsedS;
  if (ta > 0 && tb > 0 && Math.abs(ta - tb) / Math.max(ta, tb) <= 0.2) return true;
  return false;
}

// Confidence is about DATA SUFFICIENCY, nothing else.
function baselineConfidence(strokeN, sessionN, hasCurve) {
  if (sessionN >= 3 && strokeN >= 150 && hasCurve) {
    return { level: "high", why: `${sessionN} comparable sessions, ${strokeN} strokes, curves saved` };
  }
  if (strokeN >= 40 && hasCurve) {
    return { level: "medium", why: `${strokeN} strokes${sessionN > 1 ? ` across ${sessionN} sessions` : ""}, curves saved` };
  }
  return { level: "low", why: strokeN < 40 ? `only ${strokeN} strokes` : "no curves saved" };
}

// Baseline from one saved session (the "previous workout" source).
function buildBaselineFromEntry(entry) {
  if (!entry) return null;
  const curve = entry.fc && (entry.fc.avg || entry.fc.best) || null;
  const stats = strokeStatsOf(entry.strokes);
  if (!curve && !stats) return null;
  const d = entry.date ? String(entry.date).slice(0, 10) : null;
  const n = (entry.strokes || []).length;
  return {
    source: "session", label: entry.title || "previous session",
    curve, stats, n,
    dateRange: d ? { from: d, to: d } : null,
    confidence: baselineConfidence(n, 1, !!curve),
  };
}

// Rolling personal baseline: average of up to `maxSessions` recent
// sessions comparable to `ref` (or to each other when ref is null).
function buildRollingBaseline(history, ref, maxSessions) {
  maxSessions = maxSessions || 5;
  const pool = [];
  for (const h of (history || [])) {
    if (!h || (!h.fc && !h.strokes)) continue;
    if (h.demo) continue;   // v1.21 — synthetic demo sessions never pool
    const anchor = ref || pool[0] || h;
    if (pool.length && !sessionsCompatible(anchor, h)) continue;
    if (ref && !sessionsCompatible(ref, h)) continue;
    pool.push(h);
    if (pool.length >= maxSessions) break;
  }
  if (pool.length < 2) return null;
  // Average the sessions' average curves at FC_SAMPLES resolution.
  const curves = pool.map(h => h.fc && (h.fc.avg || h.fc.best)).filter(Boolean)
    .map(c => c.length === FC_SAMPLES ? c : resampleCurve(Array.from(c), FC_SAMPLES))
    .filter(Boolean);
  let curve = null;
  if (curves.length >= 2) {
    curve = new Array(FC_SAMPLES).fill(0);
    for (const c of curves) for (let i = 0; i < FC_SAMPLES; i++) curve[i] += c[i] / curves.length;
    curve = curve.map(v => Math.round(v * 10) / 10);
  }
  const allStrokes = pool.flatMap(h => Array.isArray(h.strokes) ? h.strokes : []);
  const stats = strokeStatsOf(allStrokes);
  if (!curve && !stats) return null;
  const dates = pool.map(h => String(h.date || "").slice(0, 10)).filter(Boolean).sort();
  return {
    source: "rolling", label: `rolling · ${pool.length} sessions`,
    curve, stats, n: allStrokes.length,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    confidence: baselineConfidence(allStrokes.length, pool.length, !!curve),
  };
}

// Best consistent section of the current session: the `win`-stroke
// window with the lowest pace CV. Returns a baseline built from it.
function bestConsistentSection(samples, win) {
  win = win || 20;
  if (!Array.isArray(samples) || samples.length < win + 10) return null;
  let best = null;
  for (let i = 10; i + win <= samples.length; i++) {   // skip warm-up strokes
    const sl = samples.slice(i, i + win);
    const paces = sl.map(s => s.p).filter(v => v != null && v > 0);
    if (paces.length < win * 0.8) continue;
    const m = paces.reduce((a, b) => a + b, 0) / paces.length;
    const cv = Math.sqrt(paces.reduce((a, b) => a + (b - m) * (b - m), 0) / paces.length) / m * 100;
    if (!best || cv < best.cv) best = { cv, start: i };
  }
  if (!best) return null;
  const section = samples.slice(best.start, best.start + win);
  const stats = strokeStatsOf(section.concat(section));   // agg needs >=10 per field; window is 20 — fine
  return {
    source: "section", label: `steadiest ${win} strokes (from stroke ${best.start + 1})`,
    curve: null, stats, n: win, dateRange: null,
    confidence: { level: "medium", why: `${win}-stroke steadiest section of this session (pace cv ${best.cv.toFixed(1)}%)` },
  };
}

// Stats-only baseline for one interval of a saved session (strokes
// windowed by the interval's cumulative distance bounds).
function baselineFromInterval(entry, intervalIdx) {
  if (!entry || !Array.isArray(entry.results) || !Array.isArray(entry.strokes)) return null;
  let from = 0, to = 0;
  for (let i = 0; i < entry.results.length; i++) {
    const d = entry.results[i] && entry.results[i].distanceM || 0;
    if (i < intervalIdx) from += d;
    to += d;
    if (i === intervalIdx) break;
  }
  if (to <= from) return null;
  const section = entry.strokes.filter(s => s && s.d != null && s.d >= from && s.d < to);
  const stats = strokeStatsOf(section);
  if (!stats) return null;
  return {
    source: "interval", label: `interval ${intervalIdx + 1}`,
    curve: null, stats, n: section.length, dateRange: null,
    confidence: baselineConfidence(section.length, 1, false),
  };
}

// Resolve the athlete's chosen baseline source into a concrete
// baseline. Pure: everything arrives via ctx.
//   sourcePref: "auto" (previous compatible session) | "rolling" |
//               "locked" | "section" | "off"
function resolveBaseline(sourcePref, ctx) {
  ctx = ctx || {};
  const history = ctx.history || [];
  if (sourcePref === "off") return null;
  if (sourcePref === "locked") {
    const lb = ctx.lockedBaseline;
    if (lb && (lb.curve || lb.stats)) {
      return { source: "locked", label: lb.label || "locked reference",
        curve: lb.curve || null, stats: lb.stats || null, n: lb.n || 0,
        dateRange: lb.date ? { from: lb.date, to: lb.date } : null,
        confidence: lb.n >= 40 ? { level: "medium", why: `locked reference (${lb.n} strokes)` }
                              : { level: "low", why: "locked reference with few strokes" } };
    }
    return null;
  }
  if (sourcePref === "rolling") return buildRollingBaseline(history, ctx.currentEntryLike || null, 5);
  if (sourcePref === "section") return bestConsistentSection(ctx.currentSamples || [], 20);
  // "auto": newest compatible session with capture data. Synthetic
  // demo sessions are never used as a baseline for real rowing (v1.21).
  for (const h of history) {
    if (!h || (!h.fc && !h.strokes) || h.demo) continue;
    if (ctx.currentEntryLike && !sessionsCompatible(ctx.currentEntryLike, h)) continue;
    const b = buildBaselineFromEntry(h);
    if (b) { b.source = "auto"; return b; }
  }
  return null;
}

// ====================
// Live Technique Intelligence (v1.20.0) — cue engine + governor
// ====================
// computeLiveCues evaluates candidate cues against the session log and
// the active baseline. Every cue reports: what changed, by how much,
// versus which baseline, and its confidence. The governor decides what
// (if anything) the athlete actually sees: minimum persistence,
// hysteresis, cooldown, one cue at a time, quiet mode, sensitivity.

// Sensitivity scales thresholds: "low" = less sensitive (bigger changes
// needed), "high" = more sensitive. Multiplies the base thresholds.
const CUE_SENS = { low: 1.5, normal: 1.0, high: 0.7 };

function computeLiveCues(samples, baseline, opts) {
  opts = opts || {};
  const k = CUE_SENS[opts.sensitivity] || 1.0;
  const cues = [];
  if (!Array.isArray(samples) || samples.length < 40) return { cues };
  const recent = samples.slice(-15);
  const base = samples.slice(10, 25);
  const mean = (rows, f) => {
    const vs = rows.map(f).filter(v => v != null && isFinite(v) && v > 0);
    return vs.length >= 5 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const blab = baseline ? baseline.label : "this session's early strokes";
  const bstats = baseline && baseline.stats;

  // 1. Drive Length shortening — vs baseline stats when present, else
  //    the session's own early strokes.
  const dlRef = (bstats && bstats.dl) ? bstats.dl.mean : mean(base, s => s.dl);
  const dlNow = mean(recent, s => s.dl);
  if (dlRef && dlNow) {
    const pct = ((dlNow - dlRef) / dlRef) * 100;
    if (pct < -3 * k) cues.push({ id: "driveLen", priority: 1,
      text: `Drive Length shortened ${Math.abs(pct).toFixed(1)}% vs ${bstats && bstats.dl ? blab : "early strokes"}`,
      deltaText: `${dlNow.toFixed(2)} m vs ${dlRef.toFixed(2)} m`,
      baselineLabel: bstats && bstats.dl ? blab : "session start",
      confidence: recent.length >= 15 ? "medium" : "low" });
  }
  // 2. Ratio collapse/stretch.
  const ratioOf = s => (s.dt && s.rt) ? s.rt / s.dt : null;
  const rRef = (bstats && bstats.ratio) ? bstats.ratio.mean : mean(base, ratioOf);
  const rNow = mean(recent, ratioOf);
  if (rRef && rNow) {
    const pct = ((rNow - rRef) / rRef) * 100;
    if (Math.abs(pct) > 12 * k) cues.push({ id: "ratio", priority: 2,
      text: `Ratio ${pct < 0 ? "collapsed" : "stretched"} ${Math.abs(pct).toFixed(0)}% vs ${bstats && bstats.ratio ? blab : "early strokes"}`,
      deltaText: `${rNow.toFixed(1)}:1 vs ${rRef.toFixed(1)}:1`,
      baselineLabel: bstats && bstats.ratio ? blab : "session start",
      confidence: "medium" });
  }
  // 3. Peak-force timing shift vs baseline curve (needs a baseline curve).
  if (baseline && baseline.curve) {
    const bShape = curveShapeMetrics(baseline.curve);
    const ptNow = mean(recent, s => (s.pt != null && s.pt > 0) ? s.pt : null);
    if (bShape && ptNow != null) {
      const shift = ptNow - bShape.peakPos;
      if (Math.abs(shift) > 0.06 * k) cues.push({ id: "peakTiming", priority: 3,
        text: `Force Curve peak is ${Math.round(Math.abs(shift) * 100)}% ${shift > 0 ? "later" : "earlier"} in the drive than ${blab}`,
        deltaText: `${Math.round(ptNow * 100)}% vs ${Math.round(bShape.peakPos * 100)}% of drive`,
        baselineLabel: blab, confidence: "medium" });
    }
  }
  // 4. Pace fading while rate rises — the classic "working harder,
  //    going slower" pattern. Session-internal only.
  const pEarly = mean(base, s => s.p), pNow = mean(recent, s => s.p);
  const rateEarly = mean(base, s => s.r), rateNow = mean(recent, s => s.r);
  if (pEarly && pNow && rateEarly && rateNow) {
    const paceLossPct = ((pNow - pEarly) / pEarly) * 100;    // + = slower
    const rateGain = rateNow - rateEarly;
    if (paceLossPct > 2.5 * k && rateGain > 1) cues.push({ id: "paceFade", priority: 4,
      text: `Pace faded ${paceLossPct.toFixed(1)}% while rate rose ${rateGain.toFixed(1)} spm vs early strokes`,
      deltaText: `${pNow.toFixed(1)}s vs ${pEarly.toFixed(1)}s /500 · ${rateNow.toFixed(0)} vs ${rateEarly.toFixed(0)} spm`,
      baselineLabel: "session start", confidence: "medium" });
  }
  cues.sort((a, b) => a.priority - b.priority);
  return { cues };
}

// Governor state machine. state = { active|null, streaks:{}, cooldown:{},
// stableStreak, events:[] } — pass the previous return value back in.
// latchEvals: consecutive evaluations (≈5 strokes each) required before
// a cue shows. cooldownEvals: evaluations after a cue clears during
// which the same cue id stays silent.
function applyCueGovernor(prev, cueResult, opts) {
  opts = opts || {};
  const latchEvals = opts.latchEvals || 3;
  const cooldownEvals = opts.cooldownEvals || 6;
  const st = {
    active: prev && prev.active || null,
    streaks: Object.assign({}, prev && prev.streaks),
    cooldown: Object.assign({}, prev && prev.cooldown),
    stableStreak: prev && prev.stableStreak || 0,
    event: null,
  };
  // tick cooldowns
  for (const id of Object.keys(st.cooldown)) {
    st.cooldown[id]--;
    if (st.cooldown[id] <= 0) delete st.cooldown[id];
  }
  if (opts.quiet) {           // quiet mode: never surface, still decay state
    st.active = null; st.streaks = {}; return st;
  }
  const cues = (cueResult && cueResult.cues) || [];
  const present = new Set(cues.map(c => c.id));
  // streak bookkeeping
  for (const c of cues) st.streaks[c.id] = (st.streaks[c.id] || 0) + 1;
  for (const id of Object.keys(st.streaks)) if (!present.has(id)) delete st.streaks[id];

  if (st.active) {
    if (present.has(st.active.id)) {
      // still sustained — refresh text/persistence, stay up
      const c = cues.find(x => x.id === st.active.id);
      st.active = Object.assign({}, c, { persistEvals: (st.active.persistEvals || latchEvals) + 1 });
      st.stableStreak = 0;
      return st;
    }
    st.stableStreak++;
    if (st.stableStreak >= latchEvals) {
      // recovered — clear, start cooldown, close the event
      st.cooldown[st.active.id] = cooldownEvals;
      st.event = { id: st.active.id, text: st.active.text, endEval: true };
      st.active = null;
      st.stableStreak = 0;
    }
    return st;
  }
  // no active cue: promote the highest-priority sustained, non-cooling cue
  for (const c of cues) {
    if ((st.streaks[c.id] || 0) >= latchEvals && !st.cooldown[c.id]) {
      st.active = Object.assign({}, c, { persistEvals: latchEvals });
      st.event = { id: c.id, text: c.text, startEval: true };
      st.stableStreak = 0;
      return st;
    }
  }
  return st;
}

// Sanitize imported drift-event lists (v1.20.0 persisted field).
function sanitizeDriftEvents(events) {
  if (!Array.isArray(events)) return null;
  const out = [];
  for (const e of events.slice(0, 50)) {
    if (!e || typeof e !== "object") continue;
    const row = {
      t: _impNum(e.t, 0, 864000), d: _impNum(e.d, 0, 1e6),
      id: _impStr(e.id, 20) || "cue",
      text: _impStr(e.text, 200) || "",
    };
    const tEnd = _impNum(e.tEnd, 0, 864000);
    if (tEnd != null) row.tEnd = tEnd;
    if (row.t == null && row.d == null) continue;
    out.push(row);
  }
  return out.length ? out : null;
}

// ====================
// Race Lab (v1.20.0) — plan, execute, debrief
// ====================
// A race plan is segments over a distance, each with a target split
// (and optional rate), built from a pacing strategy around the
// athlete's chosen base split. Predicted finish is arithmetic over the
// segment targets — an estimate relative to this plan, nothing more.

function buildRacePlan(distanceM, strategy, basePaceS, opts) {
  opts = opts || {};
  if (!(distanceM >= 300) || !(basePaceS > 60) || !(basePaceS < 300)) return null;
  const sprintLen = Math.min(300, Math.max(200, Math.round(distanceM * 0.1 / 50) * 50));
  const startLen = Math.max(100, Math.round(distanceM * 0.05 / 50) * 50);
  const settleLen = Math.max(150, Math.round(distanceM * 0.1 / 50) * 50);
  // strategy offset applied to the BASE section only; start/sprint are
  // always faster than base, settle slightly slower than start.
  const off = { even: [0, 0], negative: [1.5, -1.5], positive: [-1.5, 1.5] }[strategy] || [0, 0];
  const segs = [];
  const push = (fromM, toM, phase, pace, spm) => {
    if (toM > fromM) segs.push({ fromM, toM, phase, targetPaceS: Math.round(pace * 10) / 10,
      targetSpm: spm || null });
  };
  const baseFrom = startLen + settleLen;
  const baseTo = distanceM - sprintLen;
  const mid = Math.round((baseFrom + baseTo) / 2 / 50) * 50;
  push(0, startLen, "start", basePaceS - 4, opts.startSpm || null);
  push(startLen, baseFrom, "settle", basePaceS + 1, opts.baseSpm || null);
  if (baseTo > baseFrom) {
    if (strategy === "even") {
      push(baseFrom, baseTo, "base", basePaceS, opts.baseSpm || null);
    } else {
      push(baseFrom, mid, "base", basePaceS + off[0], opts.baseSpm || null);
      push(mid, baseTo, "push", basePaceS + off[1], opts.baseSpm || null);
    }
  }
  push(baseTo, distanceM, "sprint", basePaceS - 3, opts.sprintSpm || null);
  let predicted = 0;
  for (const s of segs) predicted += (s.toM - s.fromM) / 500 * s.targetPaceS;
  return {
    distanceM, strategy: strategy || "even", basePaceS,
    segments: segs, predictedFinishS: Math.round(predicted * 10) / 10,
  };
}

// Turn a race plan into ordinary builder intervals (one per segment)
// so the whole existing tracker/summary/persistence path just works.
function racePlanToIntervals(plan) {
  if (!plan || !Array.isArray(plan.segments)) return [];
  return plan.segments.map(s => ({
    kind: "distance", value: s.toM - s.fromM,
    targetPaceS: s.targetPaceS, targetWatts: null,
    targetSpm: s.targetSpm, restS: 0,
  }));
}

// Where the athlete stands against the plan RIGHT NOW.
//   deltaS < 0 → ahead of plan. Bands: ±1.5 s = "on".
// Projected finish uses the rolling pace over the recent strokes —
// deliberately conservative: it assumes you keep rowing like the last
// minute, not like your best split.
function planTimeAtDistance(plan, d) {
  let t = 0;
  for (const s of plan.segments) {
    if (d <= s.fromM) break;
    const cover = Math.min(d, s.toM) - s.fromM;
    if (cover > 0) t += cover / 500 * s.targetPaceS;
  }
  return t;
}
function raceSegmentAt(plan, d) {
  for (let i = 0; i < plan.segments.length; i++) {
    if (d < plan.segments[i].toM) return { seg: plan.segments[i], idx: i };
  }
  const last = plan.segments.length - 1;
  return last >= 0 ? { seg: plan.segments[last], idx: last } : null;
}
function computeRaceStatus(plan, distanceM, elapsedS, rollingPaceS) {
  if (!plan || !(distanceM >= 0) || !(elapsedS > 0)) return null;
  const planT = planTimeAtDistance(plan, distanceM);
  const deltaS = Math.round((elapsedS - planT) * 10) / 10;
  const status = deltaS < -1.5 ? "ahead" : deltaS > 1.5 ? "behind" : "on";
  const at = raceSegmentAt(plan, distanceM);
  const remaining = Math.max(0, plan.distanceM - distanceM);
  const pace = (rollingPaceS && rollingPaceS > 0) ? rollingPaceS : null;
  const projectedFinishS = pace ? Math.round((elapsedS + remaining / 500 * pace) * 10) / 10 : null;
  return { deltaS, status, segment: at && at.seg || null, segIdx: at ? at.idx : null,
    planTimeAtD: Math.round(planT * 10) / 10, projectedFinishS };
}

// Post-race debrief over a saved entry whose plan carried race meta.
// Per-segment actuals come from the captured stroke log (distance-
// windowed). "Time gained/lost" is (actual − planned) segment time —
// an ESTIMATE relative to the selected race plan only.
function computeRaceDebrief(entry) {
  if (!entry || !entry.plan || !entry.plan.race || !Array.isArray(entry.strokes) ||
      entry.strokes.length < 10) return { has: false };
  const plan = entry.plan.race;
  const strokes = entry.strokes;
  const inWin = (s, a, b) => s && s.d != null && s.d >= a && s.d < b;
  const mean = (rows, f) => {
    const vs = rows.map(f).filter(v => v != null && isFinite(v) && v > 0);
    return vs.length >= 3 ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
  };
  const segRows = [];
  for (const s of plan.segments) {
    const win = strokes.filter(x => inWin(x, s.fromM, s.toM));
    const actualPace = mean(win, x => x.p);
    const planT = (s.toM - s.fromM) / 500 * s.targetPaceS;
    const actualT = actualPace != null ? (s.toM - s.fromM) / 500 * actualPace : null;
    segRows.push({
      phase: s.phase, fromM: s.fromM, toM: s.toM,
      planPaceS: s.targetPaceS, actualPaceS: actualPace != null ? Math.round(actualPace * 10) / 10 : null,
      deltaS: actualT != null ? Math.round((actualT - planT) * 10) / 10 : null,   // + = time lost vs plan (estimate)
      rate: mean(win, x => x.r), dl: mean(win, x => x.dl),
      ratio: mean(win, x => (x.dt && x.rt) ? x.rt / x.dt : null),
      pf: mean(win, x => x.pf), strokes: win.length,
    });
  }
  const known = segRows.filter(r => r.deltaS != null);
  if (known.length < 2) return { has: false };
  const totalDelta = Math.round(known.reduce((a, r) => a + r.deltaS, 0) * 10) / 10;
  // fade: last base/push segment pace vs first base pace; sprint lift:
  // sprint pace vs preceding segment.
  const baseRows = segRows.filter(r => (r.phase === "base" || r.phase === "push") && r.actualPaceS != null);
  const fadePct = baseRows.length >= 2
    ? Math.round(((baseRows[baseRows.length - 1].actualPaceS - baseRows[0].actualPaceS) / baseRows[0].actualPaceS) * 1000) / 10
    : null;
  const sprintRow = segRows.find(r => r.phase === "sprint");
  const beforeSprint = segRows[segRows.indexOf(sprintRow) - 1];
  const sprintLiftPct = (sprintRow && sprintRow.actualPaceS != null && beforeSprint && beforeSprint.actualPaceS != null)
    ? Math.round(((beforeSprint.actualPaceS - sprintRow.actualPaceS) / beforeSprint.actualPaceS) * 1000) / 10
    : null;
  // findings: worst time loss, best gain, technique change in the worst
  // segment — max three, prioritized by |time delta|.
  const findings = [];
  const worst = known.slice().sort((a, b) => b.deltaS - a.deltaS)[0];
  const bestSeg = known.slice().sort((a, b) => a.deltaS - b.deltaS)[0];
  if (bestSeg && bestSeg.deltaS < -0.5) findings.push({ type: "success",
    title: `Strongest vs plan: ${bestSeg.phase} (${bestSeg.fromM}–${bestSeg.toM} m)`,
    body: `≈${Math.abs(bestSeg.deltaS).toFixed(1)} s faster than planned (estimate vs this plan).` });
  if (worst && worst.deltaS > 0.5) {
    let tech = "";
    const firstBase = baseRows[0];
    if (worst.dl != null && firstBase && firstBase.dl != null && firstBase.dl > 0) {
      const dlPct = ((worst.dl - firstBase.dl) / firstBase.dl) * 100;
      if (dlPct < -2.5) tech = ` Drive Length there averaged ${worst.dl.toFixed(2)} m, ${Math.abs(dlPct).toFixed(1)}% shorter than your opening base pace — worth a look, though pacing and technique influence each other.`;
    }
    findings.push({ type: "improve",
      title: `Biggest opportunity: ${worst.phase} (${worst.fromM}–${worst.toM} m)`,
      body: `≈${worst.deltaS.toFixed(1)} s slower than planned (estimate vs this plan).${tech}` });
  }
  if (fadePct != null && fadePct > 1.5) findings.push({ type: "pattern",
    title: "Pace faded through the middle",
    body: `Base pace drifted ${fadePct.toFixed(1)}% slower from first to last base segment.` });
  else if (sprintLiftPct != null && sprintLiftPct > 1) findings.push({ type: "pattern",
    title: "Real finishing sprint",
    body: `Sprint pace was ${sprintLiftPct.toFixed(1)}% faster than the preceding segment.` });
  return {
    has: true, segments: segRows, totalDeltaS: totalDelta,
    plannedFinishS: plan.predictedFinishS || null,
    actualFinishS: entry.totals && entry.totals.elapsedS || null,
    fadePct, sprintLiftPct,
    findings: findings.slice(0, 3),
    method: "Segment actuals are averaged from the captured stroke log windowed by distance; time gained/lost per segment = actual − planned segment time, an estimate relative to this race plan only.",
  };
}

// Sanitize imported race meta on plans (rides sanitizeImportedPlan).
function sanitizeRaceMeta(race) {
  if (!race || typeof race !== "object") return null;
  const distanceM = _impNum(race.distanceM, 300, 100000);
  const basePaceS = _impNum(race.basePaceS, 60, 300);
  if (distanceM == null || basePaceS == null || !Array.isArray(race.segments)) return null;
  const segs = [];
  for (const s of race.segments.slice(0, 40)) {
    if (!s || typeof s !== "object") continue;
    const fromM = _impNum(s.fromM, 0, 100000), toM = _impNum(s.toM, 0, 100000);
    const pace = _impNum(s.targetPaceS, 60, 300);
    if (fromM == null || toM == null || toM <= fromM || pace == null) continue;
    segs.push({ fromM, toM, targetPaceS: pace,
      phase: ["start","settle","base","push","sprint"].includes(s.phase) ? s.phase : "base",
      targetSpm: _impNum(s.targetSpm, 10, 60) });
  }
  if (segs.length < 2) return null;
  return { distanceM, basePaceS, segments: segs,
    strategy: ["even","negative","positive"].includes(race.strategy) ? race.strategy : "even",
    predictedFinishS: _impNum(race.predictedFinishS, 30, 86400) };
}

// ====================
// Rowing Power Profile (v1.20.0)
// ====================
// Best recorded average power over supported durations, from captured
// per-stroke samples (and whole-piece watts for short pieces). Honest
// by construction: estimates are labeled, ordinary rows are never
// treated as maximal tests, and insufficient data says exactly what
// benchmark would unlock the number.

const POWER_DURATIONS = [
  { s: 60, label: "1:00" }, { s: 240, label: "4:00" },
  { s: 480, label: "8:00" }, { s: 1200, label: "20:00" },
];

// Best rolling average watts over `durS` inside one session's stroke
// log. Requires sample coverage ≥ 80% of the window's expected strokes.
function bestRollingPower(samples, durS) {
  if (!Array.isArray(samples) || samples.length < 10) return null;
  const pts = samples.filter(s => s && s.t != null && s.w != null && s.w > 0);
  if (pts.length < 10) return null;
  let best = null;
  let j = 0, sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].w;
    while (pts[i].t - pts[j].t > durS) { sum -= pts[j].w; j++; }
    const span = pts[i].t - pts[j].t;
    const count = i - j + 1;
    if (span >= durS * 0.9 && count >= (durS / 3) * 0.8) {   // ≥80% stroke coverage at ~20 spm floor
      const avg = sum / count;
      if (!best || avg > best.watts) best = { watts: Math.round(avg), startT: pts[j].t };
    }
  }
  return best;
}

function wattsToPace(w) { return (w > 0) ? Math.pow(2.8 / w, 1 / 3) * 500 : null; }

function computePowerProfile(history, nowMs) {
  // v1.21 — synthetic demo sessions never contribute to power bests.
  history = (history || []).filter(h => h && !h.demo);
  const rows = [];
  const RECENT_MS = 90 * 86400000;
  for (const d of POWER_DURATIONS) {
    let allTime = null, recent = null;
    for (const h of history) {
      if (!Array.isArray(h.strokes)) continue;
      const b = bestRollingPower(h.strokes, d.s);
      if (!b) continue;
      const when = Date.parse(h.date);
      const rec = { watts: b.watts, dateISO: String(h.date || "").slice(0, 10), title: h.title || "" };
      if (!allTime || b.watts > allTime.watts) allTime = rec;
      if (!isNaN(when) && nowMs - when <= RECENT_MS && (!recent || b.watts > recent.watts)) recent = rec;
    }
    rows.push({
      durS: d.s, label: d.label,
      best: allTime, recent,
      paceS: allTime ? Math.round(wattsToPace(allTime.watts) * 10) / 10 : null,
      sufficient: !!allTime,
      need: allTime ? null : `a captured session with ≥${d.label} of continuous work`,
    });
  }
  // Critical power: only from ≥2 benchmark TESTS with distinct
  // durations (ratio ≥ 2×) — ordinary rows never qualify.
  const tests = history.filter(h => h && h.plan && h.plan.benchKey &&
    h.totals && h.totals.avgWatts > 0 && h.totals.elapsedS > 120);
  let cp = null;
  if (tests.length >= 2) {
    const pts = [];
    const seen = new Set();
    for (const t of tests) {
      if (seen.has(t.plan.benchKey)) continue;
      seen.add(t.plan.benchKey);
      pts.push({ t: t.totals.elapsedS, work: t.totals.avgWatts * t.totals.elapsedS, key: t.plan.benchKey });
    }
    if (pts.length >= 2) {
      const tMin = Math.min(...pts.map(p => p.t)), tMax = Math.max(...pts.map(p => p.t));
      if (tMax / tMin >= 2) {
        // linear work-time model: W = CP·t + W′  (least squares)
        const n = pts.length;
        const sx = pts.reduce((a, p) => a + p.t, 0), sy = pts.reduce((a, p) => a + p.work, 0);
        const sxx = pts.reduce((a, p) => a + p.t * p.t, 0), sxy = pts.reduce((a, p) => a + p.t * p.work, 0);
        const denom = n * sxx - sx * sx;
        if (denom > 0) {
          const cpW = (n * sxy - sx * sy) / denom;
          const wPrime = (sy - cpW * sx) / n;
          if (cpW > 40 && cpW < 1000 && wPrime > 0) {
            cp = { watts: Math.round(cpW), wPrimeJ: Math.round(wPrime),
              paceS: Math.round(wattsToPace(cpW) * 10) / 10,
              fromTests: pts.map(p => p.key),
              method: "Estimate from the linear work–time model (W = CP·t + W′) over your benchmark tests. Only formal Tests count — training rows are never treated as maximal." };
          }
        }
      }
    }
  }
  const cpNeed = cp ? null :
    "Two benchmark Tests of clearly different lengths (e.g. a 2k and a 10k or 30:00) are needed for a critical-power estimate.";
  return { has: rows.some(r => r.sufficient), rows, cp, cpNeed,
    method: "Best rolling average watts inside captured sessions (≥90% window span, ≥80% stroke coverage). Pace equivalents via pace = (2.8/W)^(1/3) × 500. All values are estimates from saved data — not lab measurements." };
}

// ====================
// Stroke-Level Evidence (v1.21.0) — per-stroke Force Curve codec,
// deterministic retention, evidence-stroke selection, and window
// baselines. Everything here is pure: no DOM, no storage, no clocks.
// ====================
//
// Codec v1 — one fixed-size binary payload per session: 16-byte header
// (magic "PMCV" · version · samples=64 · count u16 · totalStrokes u32 ·
// FNV-1a checksum of the records, corruption detection only) followed
// by fixed 76-byte records (ordinal u32, strictly increasing · distance
// u32 m · peak u16 at 0.1 lbf · flags bit0=synthetic · reserved · 64
// peak-scaled u8 samples). Fixed records → O(1) random access. LOSSY:
// worst per-sample error = peak/510 (≈0.196% of peak); peak itself is
// exact to 0.1 lbf; reconstructed curves are never bit-exact. Full
// byte layout table: docs/analysis-methods.md.

const CURVE_CODEC_VERSION = 1;
const CURVE_SAMPLES = 64;                 // same grid as FC_SAMPLES
const CURVE_HEADER_BYTES = 16;
const CURVE_RECORD_BYTES = 12 + CURVE_SAMPLES;
// Hard per-session ceiling for serialized curve detail (512 KiB) —
// enough for every stroke of a ~3.5 h row before retention kicks in.
const CURVE_SESSION_BUDGET_BYTES = 512 * 1024;
const CURVE_MAX_RECORDS =
  Math.floor((CURVE_SESSION_BUDGET_BYTES - CURVE_HEADER_BYTES) / CURVE_RECORD_BYTES);
// Longest base64 string we will even LOOK at (decoded ≤ budget). The
// length check runs before any allocation or decoding.
const CURVE_B64_MAX_CHARS = Math.ceil(CURVE_SESSION_BUDGET_BYTES / 3) * 4 + 8;
// Sanity ceiling for the header's total-stroke claim (~10 h at 40 spm).
const CURVE_MAX_TOTAL_STROKES = 200000;

// ---- base64 (realm-safe: no atob/Buffer so tests and browser agree) --
const _B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function curveB64Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0,
          b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += _B64_CHARS[b0 >> 2] + _B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
           (i + 1 < bytes.length ? _B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=") +
           (i + 2 < bytes.length ? _B64_CHARS[b2 & 63] : "=");
  }
  return out;
}
// Strict decoder: whole-string charset check, length % 4 === 0, padding
// only at the end. Returns null instead of guessing on malformed input.
function curveB64Decode(str) {
  if (typeof str !== "string" || !str.length || str.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;
  const pad = str.endsWith("==") ? 2 : (str.endsWith("=") ? 1 : 0);
  const outLen = (str.length / 4) * 3 - pad;
  const lut = curveB64Decode._lut || (curveB64Decode._lut = (() => {
    const t = new Int16Array(128).fill(-1);
    for (let i = 0; i < 64; i++) t[_B64_CHARS.charCodeAt(i)] = i;
    return t;
  })());
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const c0 = lut[str.charCodeAt(i)], c1 = lut[str.charCodeAt(i + 1)];
    const ch2 = str[i + 2], ch3 = str[i + 3];
    const c2 = ch2 === "=" ? 0 : lut[str.charCodeAt(i + 2)];
    const c3 = ch3 === "=" ? 0 : lut[str.charCodeAt(i + 3)];
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;
    if ((ch2 === "=" || ch3 === "=") && i + 4 !== str.length) return null;
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < outLen) out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}

// FNV-1a over a byte range — corruption detection, NOT tamper-proofing.
function curveChecksum(bytes, from, to) {
  let h = 0x811c9dc5;
  for (let i = from; i < to; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Encode capture records → binary payload. records: [{i, d, peak, s}]
// where i = 1-based stroke ordinal, d = metres, peak = lbf, s = array
// of CURVE_SAMPLES absolute forces. Invalid records are skipped; the
// input is never mutated. null when nothing valid remains or the
// result would exceed the per-session budget (callers must retain
// first — see retainCurveRecords).
function encodeCurveDetail(records, totalStrokes, opts) {
  if (!Array.isArray(records)) return null;
  const synthetic = !!(opts && opts.synthetic);
  const valid = records.filter(r =>
    r && Number.isInteger(r.i) && r.i >= 1 && r.i <= CURVE_MAX_TOTAL_STROKES &&
    typeof r.peak === "number" && isFinite(r.peak) && r.peak >= 0 && r.peak <= 3000 &&
    Array.isArray(r.s) && r.s.length === CURVE_SAMPLES &&
    r.s.every(v => typeof v === "number" && isFinite(v))
  ).slice().sort((a, b) => a.i - b.i)
   .filter((r, idx, arr) => idx === 0 || r.i > arr[idx - 1].i);
  if (!valid.length || valid.length > CURVE_MAX_RECORDS) return null;
  const total = Math.max(
    Number.isInteger(totalStrokes) && totalStrokes >= valid.length ? totalStrokes : 0,
    valid[valid.length - 1].i);
  if (total > CURVE_MAX_TOTAL_STROKES) return null;
  const bytes = new Uint8Array(CURVE_HEADER_BYTES + valid.length * CURVE_RECORD_BYTES);
  const dv = new DataView(bytes.buffer);
  bytes[0] = 0x50; bytes[1] = 0x4D; bytes[2] = 0x43; bytes[3] = 0x56;
  bytes[4] = CURVE_CODEC_VERSION; bytes[5] = CURVE_SAMPLES;
  dv.setUint16(6, valid.length, true);
  dv.setUint32(8, total, true);
  let off = CURVE_HEADER_BYTES;
  for (const r of valid) {
    dv.setUint32(off, r.i, true);
    dv.setUint32(off + 4, Math.max(0, Math.min(1e6, Math.round(r.d || 0))), true);
    const peak = Math.max(0, Math.min(3000, r.peak));
    dv.setUint16(off + 8, Math.round(peak * 10), true);
    bytes[off + 10] = synthetic ? 1 : 0;
    bytes[off + 11] = 0;
    const denom = peak > 0 ? peak : 1;
    for (let k = 0; k < CURVE_SAMPLES; k++) {
      const v = Math.max(0, Math.min(denom, r.s[k]));
      bytes[off + 12 + k] = Math.round((v / denom) * 255);
    }
    off += CURVE_RECORD_BYTES;
  }
  dv.setUint32(12, curveChecksum(bytes, CURVE_HEADER_BYTES, bytes.length), true);
  return bytes;
}

// Header decode + structural validation. FAILS CLOSED: unknown codec
// versions, size mismatches, over-budget payloads, absurd stroke
// claims, and checksum failures all return null. Never allocates based
// on the declared count — the count is checked against the actual
// byte length instead.
function decodeCurveHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (bytes.length < CURVE_HEADER_BYTES || bytes.length > CURVE_SESSION_BUDGET_BYTES) return null;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4D || bytes[2] !== 0x43 || bytes[3] !== 0x56) return null;
  if (bytes[4] !== CURVE_CODEC_VERSION) return null;   // unknown version → closed
  if (bytes[5] !== CURVE_SAMPLES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(6, true);
  if (!count || count > CURVE_MAX_RECORDS) return null;
  if (bytes.length !== CURVE_HEADER_BYTES + count * CURVE_RECORD_BYTES) return null;
  const totalStrokes = dv.getUint32(8, true);
  if (totalStrokes < count || totalStrokes > CURVE_MAX_TOTAL_STROKES) return null;
  if (dv.getUint32(12, true) !== curveChecksum(bytes, CURVE_HEADER_BYTES, bytes.length)) return null;
  return { v: bytes[4], samples: bytes[5], count, totalStrokes };
}

// Random-access decode of one record (0-based index). Reconstructs
// absolute forces: sample/255 × peak. Bounds-checked; null on any
// invalid input. O(1) — no other record is touched.
function decodeCurveRecord(bytes, idx) {
  const h = decodeCurveHeader(bytes);
  if (!h || !Number.isInteger(idx) || idx < 0 || idx >= h.count) return null;
  return decodeCurveRecordUnchecked(bytes, idx);
}
// Fast path once the payload has been validated ONCE (replay uses
// this behind its own cached header).
function decodeCurveRecordUnchecked(bytes, idx) {
  const off = CURVE_HEADER_BYTES + idx * CURVE_RECORD_BYTES;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peak = dv.getUint16(off + 8, true) / 10;
  const samples = new Array(CURVE_SAMPLES);
  for (let k = 0; k < CURVE_SAMPLES; k++) samples[k] = (bytes[off + 12 + k] / 255) * peak;
  return { i: dv.getUint32(off, true), d: dv.getUint32(off + 4, true),
           peak, synthetic: !!(bytes[off + 10] & 1), samples };
}

// Ordinal → record-index map. Scans only the 4 ordinal bytes of each
// record — no sample expansion, so history rendering stays cheap.
function curveOrdinalIndex(bytes) {
  const h = decodeCurveHeader(bytes);
  if (!h) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const map = new Map();
  let prev = 0;
  for (let idx = 0; idx < h.count; idx++) {
    const ord = dv.getUint32(CURVE_HEADER_BYTES + idx * CURVE_RECORD_BYTES, true);
    if (ord <= prev || ord > h.totalStrokes) return null;  // misordered → corrupt
    map.set(ord, idx);
    prev = ord;
  }
  return map;
}

// Full validation for UNTRUSTED input (file import, Drive merge). The
// cheap checks run first: string length before decoding, actual byte
// length before header parse, checksum before the ordinal scan. Returns
// { bytes, count, totalStrokes } or null — nothing hostile survives.
function sanitizeCurveDetailB64(str) {
  if (typeof str !== "string" || str.length < 24 || str.length > CURVE_B64_MAX_CHARS) return null;
  const bytes = curveB64Decode(str);
  if (!bytes) return null;
  const h = decodeCurveHeader(bytes);
  if (!h) return null;
  if (!curveOrdinalIndex(bytes)) return null;
  return { bytes, count: h.count, totalStrokes: h.totalStrokes };
}

// Session-entry coverage metadata (tiny, rides history/Drive/exports).
const CURVE_COVERAGE_STATES = ["complete", "partial", "unavailable", "legacy", "removed"];
function sanitizeCurveMeta(m) {
  if (!m || typeof m !== "object") return null;
  const v = Number.isInteger(m.v) && m.v >= 1 && m.v <= 99 ? m.v : null;
  const cov = CURVE_COVERAGE_STATES.indexOf(m.coverage) >= 0 ? m.coverage : null;
  if (!v || !cov) return null;
  const n = (x, hi) => (typeof x === "number" && isFinite(x) && x >= 0 && x <= hi)
    ? Math.round(x) : 0;
  return { v, coverage: cov,
           retained: n(m.retained, CURVE_MAX_TOTAL_STROKES),
           total: n(m.total, CURVE_MAX_TOTAL_STROKES) };
}

// ---- Deterministic retention -----------------------------------------
// When a session's curves exceed the budget, keep (in priority order):
// the first and final valid strokes, strokes nearest each anchor
// distance (bookmarks, drift-event boundaries, interval and race-
// segment transitions), then distribute the remaining slots evenly
// across the whole session. Same input → same output, no randomness.
function retainCurveRecords(records, opts) {
  const budget = (opts && opts.budgetBytes) || CURVE_SESSION_BUDGET_BYTES;
  const anchors = (opts && Array.isArray(opts.anchorDistances)) ? opts.anchorDistances : [];
  const rows = Array.isArray(records) ? records : [];
  const total = rows.length;
  const maxRec = Math.max(2, Math.floor((budget - CURVE_HEADER_BYTES) / CURVE_RECORD_BYTES));
  if (total <= maxRec) {
    return { kept: rows.slice(), retained: total, total, complete: true };
  }
  const keep = new Set([0, total - 1]);
  // Anchor distances → nearest record (first-wins on distance ties).
  for (const a of anchors) {
    if (typeof a !== "number" || !isFinite(a)) continue;
    let best = -1, bestErr = Infinity;
    for (let j = 0; j < total; j++) {
      const d = rows[j] && typeof rows[j].d === "number" ? rows[j].d : null;
      if (d == null) continue;
      const err = Math.abs(d - a);
      if (err < bestErr) { bestErr = err; best = j; }
    }
    if (best >= 0 && keep.size < maxRec) keep.add(best);
  }
  // Fill the remaining slots evenly across the session (deterministic:
  // ideal grid positions, walking forward past already-kept indexes).
  const free = maxRec - keep.size;
  if (free > 0) {
    for (let k = 0; k < free; k++) {
      let j = Math.round(((k + 1) * (total - 1)) / (free + 1));
      while (j < total && keep.has(j)) j++;
      if (j >= total) { j = Math.round(((k + 1) * (total - 1)) / (free + 1)); while (j >= 0 && keep.has(j)) j--; }
      if (j >= 0 && j < total) keep.add(j);
    }
  }
  const kept = [...keep].sort((a, b) => a - b).map(j => rows[j]);
  return { kept, retained: kept.length, total, complete: false };
}

// ---- Stroke position ↔ ordinal ---------------------------------------
// entry.strokes is stride-decimated (v1.18): retained sample j always
// corresponds to raw stroke ordinal j×stride+1. v1.21 sessions persist
// the final stride (entry.strokeStride); stride 1 → position == ordinal.
function strokePosToOrdinal(pos, stride) {
  const s = Number.isInteger(stride) && stride >= 1 ? stride : 1;
  return Number.isInteger(pos) && pos >= 0 ? pos * s + 1 : null;
}
function ordinalToStrokePos(ord, stride, len) {
  const s = Number.isInteger(stride) && stride >= 1 ? stride : 1;
  if (!Number.isInteger(ord) || ord < 1) return null;
  if ((ord - 1) % s !== 0) return null;
  const pos = (ord - 1) / s;
  return (Number.isInteger(len) && pos >= len) ? null : pos;
}

// ---- Evidence-stroke selection ---------------------------------------
// Identifies notable strokes for the replay navigator. HONEST BY
// CONSTRUCTION: "fastest" is fastest valid split — never labelled best
// technique; baseline similarity is a shape comparison, never proof of
// correctness. Isolated split spikes (a dropped BLE packet reads as one
// absurd stroke between two normal ones) are excluded as artifacts;
// SUSTAINED slow strokes (a real paddle break) are kept.
// Ties are deterministic: the earliest stroke wins.
function _median(vs) {
  if (!vs.length) return null;
  const s = vs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function findEvidenceStrokes(tl, opts) {
  const rows = Array.isArray(tl) ? tl : [];
  const curveAt = (opts && opts.curveAt) || (() => null);
  const baseline = (opts && Array.isArray(opts.baselineCurve) && opts.baselineCurve.length >= 8)
    ? opts.baselineCurve : null;
  const splitOk = v => v != null && isFinite(v) && v >= 60 && v <= 360;
  // Validity + artifact pass.
  const valid = [];
  let artifacts = 0;
  for (let j = 0; j < rows.length; j++) {
    const sp = rows[j] && rows[j].split;
    if (!splitOk(sp)) continue;
    const neigh = [];
    for (let k = Math.max(0, j - 3); k <= Math.min(rows.length - 1, j + 3); k++) {
      if (k !== j && rows[k] && splitOk(rows[k].split)) neigh.push(rows[k].split);
    }
    if (neigh.length >= 3) {
      const med = _median(neigh);
      const dev = Math.abs(sp - med);
      if (dev > Math.max(12, 0.25 * med)) {
        // Big deviation. Artifact only if it is ISOLATED — both adjacent
        // valid splits sit near the median. A sustained change is rowing.
        const adj = [];
        if (j > 0 && rows[j - 1] && splitOk(rows[j - 1].split)) adj.push(rows[j - 1].split);
        if (j < rows.length - 1 && rows[j + 1] && splitOk(rows[j + 1].split)) adj.push(rows[j + 1].split);
        if (adj.length === 2 && adj.every(v => Math.abs(v - med) <= 0.12 * med)) {
          artifacts++;
          continue;
        }
      }
    }
    valid.push(j);
  }
  const out = { validCount: valid.length, artifactsExcluded: artifacts,
                fastest: null, slowest: null, closest: null, deviation: null,
                representative: null };
  if (valid.length >= 5) {
    let fa = valid[0], sl = valid[0];
    for (const j of valid) {
      if (rows[j].split < rows[fa].split) fa = j;
      if (rows[j].split > rows[sl].split) sl = j;
    }
    out.fastest = { pos: fa, split: rows[fa].split };
    out.slowest = { pos: sl, split: rows[sl].split };
  }
  // Curve-based picks need retained curves.
  const withCurves = [];
  for (const j of valid) {
    const c = curveAt(j);
    if (c && c.length >= 8) withCurves.push({ pos: j, curve: c });
  }
  out.curveCount = withCurves.length;
  if (withCurves.length >= 5) {
    // Session-mean NORMALISED shape → "most representative" = highest
    // similarity to the mean shape.
    const mean = new Array(CURVE_SAMPLES).fill(0);
    for (const w of withCurves) {
      let peak = 0;
      for (const v of w.curve) if (v > peak) peak = v;
      if (peak <= 0) continue;
      for (let k = 0; k < CURVE_SAMPLES; k++) mean[k] += Math.max(0, w.curve[k]) / peak;
    }
    for (let k = 0; k < CURVE_SAMPLES; k++) mean[k] /= withCurves.length;
    let rep = null, repSim = -1;
    for (const w of withCurves) {
      const sim = curveSimilarity(w.curve, mean);
      if (sim != null && sim > repSim) { repSim = sim; rep = w.pos; }
    }
    if (rep != null) out.representative = { pos: rep, sim: repSim };
    if (baseline) {
      let cl = null, clSim = -1, dv = null, dvSim = 101;
      for (const w of withCurves) {
        const sim = curveSimilarity(w.curve, baseline);
        if (sim == null) continue;
        if (sim > clSim) { clSim = sim; cl = w.pos; }
        if (sim < dvSim) { dvSim = sim; dv = w.pos; }
      }
      if (cl != null) out.closest = { pos: cl, sim: clSim };
      if (dv != null) out.deviation = { pos: dv, sim: dvSim };
    }
  }
  return out;
}

// ---- Window / interval / race-segment curve baselines ----------------
// Average the RETAINED curves inside a stroke range and report exactly
// what went in: retained vs total counts, the range, and a transparent
// confidence. Never fabricates — a range without stored curves returns
// an insufficient result, not an invented curve.
function buildCurveWindowBaseline(tl, fromPos, toPos, opts) {
  const rows = Array.isArray(tl) ? tl : [];
  const curveAt = (opts && opts.curveAt) || (() => null);
  const minSamples = (opts && opts.minSamples) || 8;
  const label = (opts && opts.label) || "window";
  if (!Number.isInteger(fromPos) || !Number.isInteger(toPos) ||
      fromPos < 0 || toPos >= rows.length || fromPos > toPos) {
    return { insufficient: "Invalid stroke range." };
  }
  const totalInRange = toPos - fromPos + 1;
  const sum = new Array(CURVE_SAMPLES).fill(0);
  let n = 0;
  const dls = [], ratios = [], splits = [];
  for (let j = fromPos; j <= toPos; j++) {
    const c = curveAt(j);
    if (c && c.length === CURVE_SAMPLES) {
      for (let k = 0; k < CURVE_SAMPLES; k++) sum[k] += Math.max(0, c[k]);
      n++;
    }
    const p = rows[j] || {};
    if (p.driveLengthM != null && isFinite(p.driveLengthM)) dls.push(p.driveLengthM);
    if (p.ratio != null && isFinite(p.ratio)) ratios.push(p.ratio);
    if (p.split != null && isFinite(p.split)) splits.push(p.split);
  }
  if (n < minSamples) {
    return { insufficient:
      `Only ${n} of ${totalInRange} strokes in this range have stored curves (minimum ${minSamples}).`,
      retained: n, total: totalInRange };
  }
  const curve = sum.map(v => v / n);
  const stat = vs => {
    if (vs.length < 2) return null;
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vs.length);
    return { mean, sd, n: vs.length };
  };
  const coverage = n / totalInRange;
  const confidence = (n >= 20 && coverage >= 0.8) ? "high" : (n >= 8 ? "medium" : "low");
  return {
    curve, retained: n, total: totalInRange, from: fromPos, to: toPos, label,
    partial: coverage < 0.999,
    stats: { dl: stat(dls), ratio: stat(ratios), split: stat(splits) },
    confidence,
    confidenceWhy: `${n}/${totalInRange} strokes in the range have stored curves` +
      (coverage < 0.999 ? " (partial retained sample)" : " (complete coverage)"),
  };
}

// Map an interval index or race segment onto a stroke-position range of
// the timeline. Returns {from, to, label} or null when the range can't
// be resolved from the persisted data.
function strokeRangeForDistance(tl, startM, endM, label) {
  const rows = Array.isArray(tl) ? tl : [];
  let from = null, to = null;
  for (let j = 0; j < rows.length; j++) {
    const d = rows[j] && rows[j].distanceM;
    if (d == null) continue;
    if (d >= startM && from == null) from = j;
    if (d <= endM) to = j;
  }
  if (from == null || to == null || from > to) return null;
  return { from, to, label: label || `${Math.round(startM)}–${Math.round(endM)} m` };
}
function strokeRangeForInterval(session, tl, intervalIdx) {
  const ivs = buildIntervalReplayTimeline(session);
  if (!ivs.length || intervalIdx < 0 || intervalIdx >= ivs.length) return null;
  const start = intervalIdx > 0 ? ivs[intervalIdx - 1].cumulativeDistanceM : 0;
  const end = ivs[intervalIdx].cumulativeDistanceM;
  return strokeRangeForDistance(tl, start, end, `interval ${intervalIdx + 1}`);
}
function strokeRangeForRaceSegment(session, tl, segIdx) {
  const race = session && session.plan && session.plan.race;
  if (!race || !Array.isArray(race.segments) || segIdx < 0 || segIdx >= race.segments.length) return null;
  const seg = race.segments[segIdx];
  if (!seg || !(seg.toM > seg.fromM)) return null;
  return strokeRangeForDistance(tl, seg.fromM, seg.toM,
    `${seg.phase || "segment"} (${Math.round(seg.fromM)}–${Math.round(seg.toM)} m)`);
}

// Validate an import's top-level curve map (v1.21): OWN string keys
// only, each id must belong to a session actually being imported, and
// each payload must pass full binary validation (sanitizeCurveDetailB64).
// Hostile keys (__proto__/constructor/prototype), unknown ids, unknown
// codec versions, and malformed payloads are silently dropped. Returns
// a plain ARRAY — never a keyed object — so prototype pollution cannot
// ride the result. Bounded to 100 payloads per import.
function sanitizeImportedCurveMap(curves, validIds) {
  if (!curves || typeof curves !== "object" || Array.isArray(curves)) return [];
  const idSet = new Set(Array.isArray(validIds) ? validIds : []);
  const out = [];
  for (const key of Object.keys(curves)) {
    if (out.length >= 100) break;
    if (typeof key !== "string" || !key || key.length > 80) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!idSet.has(key)) continue;
    const v = curves[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    if (v.v !== CURVE_CODEC_VERSION) continue;             // unknown version → closed
    const p = sanitizeCurveDetailB64(v.b64);
    if (!p) continue;
    out.push({ id: key, bytes: p.bytes, count: p.count, totalStrokes: p.totalStrokes });
  }
  return out;
}
