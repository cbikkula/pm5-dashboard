/* RowTracer — stroke-level evidence module (v1.21.0): the
 * IndexedDB curve-detail store, in-memory capture append, retention
 * anchors, and the replay Stroke Evidence UI (selected-stroke curve,
 * A/B pins, evidence navigator, window baselines). Classic script,
 * loaded after analysis.js and before the main script; served
 * network-first so a page load can never mix releases. */

// ====================
// Per-stroke Force Curve storage (v1.21.0)
// ====================
// Curves are captured in memory during the row (one 64-sample record
// per stroke), retained deterministically at save time, and persisted
// as one binary payload per session in IndexedDB — never localStorage
// — so curve detail can never threaten workout-summary storage. The
// entry carries only tiny metadata (curveMeta + strokeStride).

// In-memory capture cap: beyond this the list stride-doubles like the
// sample log (~4.5 h of rowing before any thinning happens).
const CURVE_MEM_CAP = 8192;

// Mirrors strokeCaptureAppend: bounded, deterministic, stride-doubling.
// rec.i must be the true stroke ordinal — it is what keeps curves
// exactly associated with strokes after any decimation.
function curveCaptureAppend(cap, rec, maxRecords) {
  cap.seen++;
  if ((cap.seen - 1) % cap.stride !== 0) return cap;
  if (cap.list.length >= (maxRecords || CURVE_MEM_CAP)) {
    cap.list = cap.list.filter((_, i) => i % 2 === 0);
    cap.stride *= 2;
  }
  cap.list.push(rec);
  return cap;
}

// ---- IndexedDB curve-detail store: one store keyed by session id.
// Every function resolves (never rejects) and degrades to null/false
// when IndexedDB is missing or broken.
const CURVE_DB_NAME = "pm5-curve-detail";
const CURVE_DB_STORE = "sessions";
let _curveDbPromise = null;

function curveDbOpen() {
  if (_curveDbPromise) return _curveDbPromise;
  _curveDbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(CURVE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(CURVE_DB_STORE, { keyPath: "sessionId" }); }
        catch (e) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return _curveDbPromise;
}

function _curveTx(mode, fn) {
  return curveDbOpen().then(db => {
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(CURVE_DB_STORE, mode);
        const store = tx.objectStore(CURVE_DB_STORE);
        const out = fn(store);
        tx.oncomplete = () => resolve(out && out.__result !== undefined ? out.__result : true);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);   // quota failures surface here
      } catch (e) { resolve(null); }
    });
  }).catch(() => null);
}

// Store one session's encoded payload. Resolves true only on success.
function curveDetailPut(sessionId, bytes) {
  if (!sessionId || !(bytes instanceof Uint8Array) ||
      bytes.length > CURVE_SESSION_BUDGET_BYTES) return Promise.resolve(false);
  return _curveTx("readwrite", store => {
    store.put({ sessionId, v: CURVE_CODEC_VERSION,
                bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                savedAt: Date.now() });
  }).then(r => r === true);
}

// Fetch one session's payload → { bytes: Uint8Array } | null.
function curveDetailGet(sessionId) {
  if (!sessionId) return Promise.resolve(null);
  const out = { __result: null };
  return _curveTx("readonly", store => {
    const req = store.get(sessionId);
    req.onsuccess = () => {
      const v = req.result;
      if (v && v.bytes instanceof ArrayBuffer &&
          v.bytes.byteLength <= CURVE_SESSION_BUDGET_BYTES) {
        out.__result = { bytes: new Uint8Array(v.bytes) };
      }
    };
    return out;
  });
}

function curveDetailDelete(sessionId) {
  if (!sessionId) return Promise.resolve(false);
  return _curveTx("readwrite", store => { store.delete(sessionId); })
    .then(r => r === true);
}

// Usage summary for the Settings dialog: { sessions, bytes } | null.
function curveDetailUsage() {
  const out = { __result: { sessions: 0, bytes: 0 } };
  return _curveTx("readonly", store => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        out.__result.sessions++;
        if (cur.value && cur.value.bytes instanceof ArrayBuffer) {
          out.__result.bytes += cur.value.bytes.byteLength;
        }
        cur.continue();
      }
    };
    return out;
  });
}

// Anchor distances whose strokes must survive long-session retention:
// bookmarks, drift-event boundaries, interval transitions, and race-
// segment transitions. Pure over the entry being saved.
function collectCurveAnchors(entry) {
  const out = [];
  for (const b of (entry.bookmarks || [])) {
    if (b && typeof b.distanceM === "number") out.push(b.distanceM);
  }
  for (const ev of (entry.driftEvents || [])) {
    if (ev && typeof ev.d === "number") out.push(ev.d);
  }
  let cum = 0;
  for (const r of (entry.results || [])) {
    cum += (r && r.distanceM) || 0;
    if (cum > 0) out.push(cum);
  }
  const race = entry.plan && entry.plan.race;
  if (race && Array.isArray(race.segments)) {
    for (const s of race.segments) { if (s && s.toM > 0) out.push(s.toM); }
  }
  return out.slice(0, 120);
}

// ====================
// Replay Stroke Evidence UI (v1.21.0)
// ====================
// All functions below operate on the main script's _replay/state and
// the replay modal DOM. They run only after the main script has loaded.

// Load the session's curve payload into _replay.curves (validated once;
// records decode lazily on access behind a small bounded cache).
function loadReplayCurves(session) {
  _replay.curves = null; _replay.curvesCorrupt = false; _replay.curvesLoading = false;
  _replay.pinA = null; _replay.pinB = null; _replay.windowBl = null;
  _replay.nearOrd = null; _replay.evidence = null;
  const finish = () => {
    if (!_replay || _replay.session !== session) return;
    _replay.curvesLoading = false;
    _replay.evidence = computeReplayEvidence();
    renderReplayEvidence(); renderReplayFc();
  };
  const adopt = bytes => {
    const h = decodeCurveHeader(bytes);
    const idx = h && curveOrdinalIndex(bytes);
    if (h && idx) {
      _replay.curves = { bytes, count: h.count, total: h.totalStrokes,
        stride: (session && session.strokeStride) ||
                (session && session.id ? 1 : (state.strokeCapture ? state.strokeCapture.stride : 1)),
        index: idx, cache: new Map() };
    } else {
      _replay.curvesCorrupt = true;
    }
  };
  if (session && !session.id && state.curveCapture && state.curveCapture.list.length >= 2) {
    // Live (or demo) session straight from memory — same codec path.
    const ret = retainCurveRecords(state.curveCapture.list, {});
    const enc = encodeCurveDetail(ret.kept, state.curveCapture.seen, { synthetic: demoActive() });
    if (enc) adopt(enc);
    finish();
    return;
  }
  if (!session || !session.id || !session.curveMeta ||
      (session.curveMeta.coverage !== "complete" && session.curveMeta.coverage !== "partial")) {
    finish();
    return;
  }
  _replay.curvesLoading = true;
  renderReplayFc();
  curveDetailGet(session.id).then(rec => {
    if (!_replay || _replay.session !== session) return;
    if (rec && rec.bytes) adopt(rec.bytes); else _replay.curvesCorrupt = true;
    finish();
  });
}

// Lazily decode the curve for a timeline position. Exact association
// only — a missing curve returns null, never a neighbour.
function replayCurveAt(pos) {
  const c = _replay && _replay.curves;
  if (!c) return null;
  const ord = strokePosToOrdinal(pos, c.stride);
  const ri = c.index.get(ord);
  if (ri == null) return null;
  let rec = c.cache.get(ri);
  if (!rec) {
    rec = decodeCurveRecordUnchecked(c.bytes, ri);
    c.cache.set(ri, rec);
    if (c.cache.size > 48) c.cache.delete(c.cache.keys().next().value);
  }
  return rec;
}

// Nearest RETAINED curve to a position — offered separately and always
// labelled with its own stroke number.
function replayNearestCurve(pos) {
  const c = _replay && _replay.curves;
  if (!c) return null;
  const want = strokePosToOrdinal(pos, c.stride);
  let best = null, bestErr = Infinity;
  for (const o of c.index.keys()) {
    const err = Math.abs(o - want);
    if (err < bestErr) { bestErr = err; best = o; }
  }
  if (best == null) return null;
  const rec = decodeCurveRecordUnchecked(c.bytes, c.index.get(best));
  return rec ? { rec, ord: best } : null;
}

function replayEvCurveAt(pos) { const r = replayCurveAt(pos); return r ? r.samples : null; }
function computeReplayEvidence() {
  if (!_replay || _replay.mode !== "stroke") return null;
  return findEvidenceStrokes(_replay.tl, {
    curveAt: replayEvCurveAt,
    baselineCurve: state.baseline && state.baseline.curve ? Array.from(state.baseline.curve) : null,
  });
}

// One coverage sentence — honest for every state.
function replayCurveCoverageText() {
  const s = _replay && _replay.session;
  const meta = s && s.curveMeta;
  if (_replay && _replay.curvesLoading) return "Loading stroke curves…";
  if (_replay && _replay.curves) {
    const c = _replay.curves;
    const partial = c.count < c.total;
    let t = `Stroke curves: ${c.count} of ${c.total} strokes ` +
      (partial ? "(partial — first/last, bookmarked, drift and segment-transition strokes kept, the rest evenly sampled)" : "(complete)");
    if (c.stride > 1) t += ` · timeline shows every ${c.stride}${c.stride === 2 ? "nd" : "th"} stroke`;
    return t;
  }
  if (_replay && _replay.curvesCorrupt) return "Stored curve data is missing or failed validation — showing session-level curves only.";
  if (meta && meta.coverage === "unavailable") return "Stroke curves couldn't be stored for this session (storage error or quota).";
  if (meta && meta.coverage === "removed") return "Stroke curve detail was removed for this session.";
  return "No per-stroke curves for this session (recorded before v1.21 or without curve capture).";
}

function renderReplayFc() {
  if (!_replay) return;
  const covEl = document.getElementById("rplCov");
  if (covEl) covEl.textContent = replayCurveCoverageText();
  const box = document.getElementById("replayFc");
  const s = _replay.session;
  const fc = s && s.fc;
  const normEl = document.getElementById("rplNorm");
  const norm = !!(normEl && normEl.checked);
  const sets = [], leg = [];
  const push = (samples, label, color, o) => {
    if (!samples || samples.length < 2) return;
    let arr = Array.from(samples);
    if (norm) {
      let p = 0;
      for (const v of arr) if (v > p) p = v;
      if (p <= 0) return;
      arr = arr.map(v => (v / p) * 100);
    }
    sets.push(Object.assign({ samples: arr, color }, o || {}));
    leg.push(label);
  };
  if (state.baseline && state.baseline.curve) {
    push(state.baseline.curve, `·· baseline (${state.baseline.label})`, "rgba(155,167,189,0.5)", { dashed: true, width: 1.5 });
  }
  if (fc && fc.avg) push(fc.avg, "- - session avg", "rgba(255,143,60,0.55)", { dashed: true, width: 1.5 });
  if (fc && fc.best && !(_replay.curves && _replay.mode === "stroke")) {
    push(fc.best, "— session best", "rgba(86,249,179,0.7)", { width: 1.5 });
  }
  if (_replay.windowBl && _replay.windowBl.curve) {
    push(_replay.windowBl.curve, `–·– ${_replay.windowBl.label}`, "rgba(186,124,255,0.9)", { dash: [8, 3, 2, 3], width: 2 });
  }
  if (_replay.pinA) push(_replay.pinA.curve, `A: ${_replay.pinA.label}`, "rgba(86,249,179,0.95)", { dash: [2, 3], width: 2 });
  if (_replay.pinB) push(_replay.pinB.curve, `B: ${_replay.pinB.label}`, "rgba(255,99,132,0.95)", { dash: [9, 4], width: 2 });
  const nearEl = document.getElementById("rplNearWrap");
  if (_replay.mode === "stroke") {
    const rec = replayCurveAt(_replay.pos);
    if (rec) {
      push(rec.samples, `— stroke ${_replay.pos + 1}${rec.synthetic ? " (synthetic)" : ""} · ${Math.round(rec.peak)} lbf`,
        "rgba(91,157,255,1)", { width: 2.5 });
      if (nearEl) nearEl.innerHTML = "";
      _replay.nearOrd = null;
    } else if (_replay.curves) {
      // Honest gap: say it is missing; offer the nearest separately.
      leg.push(`(no stored curve for stroke ${_replay.pos + 1})`);
      if (_replay.nearOrd != null) {
        const near = replayNearestCurve(_replay.pos);
        if (near) push(near.rec.samples,
          `— nearby stroke #${near.ord} of ${_replay.curves.total} (NOT stroke ${_replay.pos + 1})`,
          "rgba(94,214,255,0.8)", { width: 1.5 });
      } else if (nearEl && !nearEl.firstChild) {
        const b = document.createElement("button");
        b.textContent = "Show nearest stored curve";
        b.addEventListener("click", () => { _replay.nearOrd = -1; renderReplayFc(); });
        nearEl.appendChild(b);
      }
    } else if (nearEl) {
      nearEl.innerHTML = "";
    }
  }
  if (box) box.style.display = sets.length ? "" : "none";
  const legEl = document.getElementById("replayFcLegend");
  if (legEl) legEl.textContent = (norm ? "[normalized to each peak] " : "") + leg.join("   ");
  if (sets.length) drawCurveSet(document.getElementById("replayFcCanvas"), sets);
  renderReplayAb();
}

// ---- A/B pinning ----------------------------------------------------
function replayContextAt(pos) {
  const s = _replay.session, p = _replay.tl[pos] || {};
  if (s && s.plan && s.plan.race && p.distanceM != null) {
    const at = raceSegmentAt(s.plan.race, p.distanceM);
    if (at && at.seg) return at.seg.phase;
  }
  if (p.distanceM != null && _replay.ivTl && _replay.ivTl.length > 1) {
    const hit = _replay.ivTl.find(q => q.cumulativeDistanceM >= p.distanceM);
    if (hit) return `interval ${hit.index + 1}`;
  }
  return "";
}
function pinReplayStroke(slot) {
  if (!_replay || _replay.mode !== "stroke") return;
  const pos = _replay.pos;
  const rec = replayCurveAt(pos);
  const p = _replay.tl[pos] || {};
  _replay[slot] = { kind: "stroke", pos, label: `stroke ${pos + 1}`,
    curve: rec ? rec.samples : null,
    split: p.split, watts: p.watts, rate: p.strokeRate, dl: p.driveLengthM,
    ratio: p.ratio, pf: p.peakForceLbs, pt: p.peakTiming,
    ctx: replayContextAt(pos) };
  renderReplayFc();
}
function clearReplayPins() {
  if (!_replay) return;
  _replay.pinA = null; _replay.pinB = null; _replay.windowBl = null;
  renderReplayFc();
}
function renderReplayAb() {
  const el = document.getElementById("rplAbTable");
  if (!el || !_replay) return;
  const A = _replay.pinA, B = _replay.pinB;
  const clr = document.getElementById("rplPinClear");
  if (clr) clr.style.display = (A || B || _replay.windowBl) ? "" : "none";
  if (!A || !B) { el.style.display = "none"; el.textContent = ""; return; }
  el.style.display = "";
  const fmt = (v, f) => (v == null || !isFinite(v)) ? "—" : f(v);
  const d = (a, b, f, unit) => (a == null || b == null || !isFinite(a) || !isFinite(b))
    ? "—" : `${b - a >= 0 ? "+" : ""}${f(b - a)}${unit || ""}`;
  const rows = [
    ["Split", "split", v => fmtPace(v), v => v.toFixed(1) + " s"],
    ["Watts", "watts", v => String(Math.round(v)), v => Math.round(v) + " W"],
    ["Rate", "rate", v => String(Math.round(v)), v => Math.round(v) + " spm"],
    ["Drive Length", "dl", v => v.toFixed(2) + " m", v => v.toFixed(2) + " m"],
    ["Ratio", "ratio", v => v.toFixed(1) + ":1", v => v.toFixed(1)],
    ["Peak force", "pf", v => Math.round(v) + " lbf", v => Math.round(v) + " lbf"],
    ["Peak timing", "pt", v => Math.round(v * 100) + "%", v => Math.round(v * 100) + " pp"],
  ];
  let out = `<div class="abr abh"><span></span><span>A · ${fbEsc(A.label)}</span><span>B · ${fbEsc(B.label)}</span><span>B − A</span></div>`;
  for (const [name, k, f, fd] of rows) {
    out += `<div class="abr"><span>${name}</span><span>${fmt(A[k], f)}</span><span>${fmt(B[k], f)}</span><span>${d(A[k], B[k], fd)}</span></div>`;
  }
  const shA = A.curve && curveShapeMetrics(A.curve), shB = B.curve && curveShapeMetrics(B.curve);
  if (shA && shB) {
    out += `<div class="abr"><span>Front-load</span><span>${Math.round(shA.frontLoad * 100)}%</span><span>${Math.round(shB.frontLoad * 100)}%</span><span>${d(shA.frontLoad * 100, shB.frontLoad * 100, v => Math.round(v) + " pp")}</span></div>`;
  }
  const sim = (A.curve && B.curve) ? curveSimilarity(A.curve, B.curve) : null;
  out += `<div class="abr"><span>Similarity</span><span class="wide">${sim != null ? sim + "% (curve shape only)" : "needs both stored curves"}</span><span></span><span></span></div>`;
  out += `<div class="abr"><span>Context</span><span>${fbEsc(A.ctx || "—")}</span><span>${fbEsc(B.ctx || "—")}</span><span></span></div>`;
  const missing = [];
  if (A.kind === "stroke" && !A.curve) missing.push("A has no stored curve");
  if (B.kind === "stroke" && !B.curve) missing.push("B has no stored curve");
  out += `<div class="abr abn"><span class="wide">${missing.length ? fbEsc(missing.join(" · "))
    : "Curves are reconstructed from compact storage (≤0.2% of peak per sample; peak exact to 0.1 lbf) — not bit-exact."}</span></div>`;
  el.innerHTML = out;
}

// ---- Evidence navigator ---------------------------------------------
function renderReplayEvidence() {
  const box = document.getElementById("rplEvid");
  const btns = document.getElementById("rplEvBtns");
  if (!box || !btns || !_replay) return;
  const ev = _replay.evidence;
  if (!ev || _replay.mode !== "stroke") { box.style.display = "none"; return; }
  box.style.display = "";
  const items = [
    ["fastest", ev.fastest, ev.fastest && `fastest valid split ${fmtPace(ev.fastest.split)} · key f`],
    ["slowest", ev.slowest, ev.slowest && `slowest valid split ${fmtPace(ev.slowest.split)} · key s`],
    ["most typical", ev.representative, ev.representative && `most similar to session mean shape (${ev.representative.sim}%) · key t`],
    ["closest to baseline", ev.closest, ev.closest && `shape similarity ${ev.closest.sim}% · key c`],
    ["largest deviation", ev.deviation, ev.deviation && `shape similarity ${ev.deviation.sim}% · key d`],
  ];
  btns.innerHTML = "";
  for (const [name, pick, why] of items) {
    const b = document.createElement("button");
    b.className = "rpl-ev-btn";
    const bb = document.createElement("b"), ii = document.createElement("i");
    bb.textContent = pick ? `${name} — stroke ${pick.pos + 1}` : name;
    ii.textContent = pick ? (why || "") : "not enough valid data";
    b.appendChild(bb); b.appendChild(ii);
    if (pick) b.addEventListener("click", () => { _replay.pos = pick.pos; renderReplayPos(); });
    else b.disabled = true;
    btns.appendChild(b);
  }
  const note = document.createElement("div");
  note.className = "rpl-ev-x";
  note.textContent = `${ev.validCount} valid strokes · ${ev.artifactsExcluded} artifact${ev.artifactsExcluded === 1 ? "" : "s"} excluded · ${ev.curveCount || 0} with stored curves`;
  btns.appendChild(note);
}
function replayJumpEvidence(key) {
  const ev = _replay && _replay.evidence;
  if (!ev) return;
  const pick = { f: ev.fastest, s: ev.slowest, t: ev.representative, c: ev.closest, d: ev.deviation }[key];
  if (pick) { _replay.pos = pick.pos; renderReplayPos(); }
}

// ---- Window comparison ----------------------------------------------
function populateReplayWindowUi() {
  const box = document.getElementById("rplWin");
  const sel = document.getElementById("rwSource");
  if (!box || !sel || !_replay) return;
  if (_replay.mode !== "stroke") { box.style.display = "none"; return; }
  box.style.display = "";
  _replay.rwFrom = null; _replay.rwTo = null;
  const s = _replay.session;
  sel.innerHTML = "";
  const add = (value, text) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = text;
    sel.appendChild(o);
  };
  add("range", "Marked stroke range");
  add("steady", "Steadiest 20 strokes");
  const nIv = (_replay.ivTl || []).length;
  for (let k = 0; k < nIv && k < 40; k++) add(`iv:${k}`, `Interval ${k + 1}`);
  const segs = (s && s.plan && s.plan.race && s.plan.race.segments) || [];
  segs.forEach((sg, k) =>
    add(`sg:${k}`, `Race segment: ${sg.phase || "?"} ${Math.round(sg.fromM)}–${Math.round(sg.toM)} m`));
  const out = document.getElementById("rwOut");
  if (out) out.textContent = "";
  const prev = findPrevCompatibleSession(s);
  const prevWrap = document.getElementById("rwPrevWrap");
  if (prevWrap) prevWrap.style.display = prev ? "" : "none";
  const prevCk = document.getElementById("rwPrev");
  if (prevCk) prevCk.checked = false;
  _replay.prevSession = prev || null;
}
function findPrevCompatibleSession(s) {
  if (!s || !s.id) return null;
  for (const h of (state.history || [])) {
    if (!h || h.id === s.id) continue;
    if (h.demo && !s.demo) continue;   // synthetic never backs a real comparison
    if (!h.curveMeta || (h.curveMeta.coverage !== "complete" && h.curveMeta.coverage !== "partial")) continue;
    if (!Array.isArray(h.strokes) || h.strokes.length < 10) continue;
    if (String(h.date) >= String(s.date)) continue;
    if (!sessionsCompatible(s, h)) continue;
    return h;
  }
  return null;
}
function rwMark(which) {
  if (!_replay || _replay.mode !== "stroke") return;
  if (which === "from") _replay.rwFrom = _replay.pos; else _replay.rwTo = _replay.pos;
  const out = document.getElementById("rwOut");
  if (out) out.textContent =
    `Range: ${_replay.rwFrom != null ? "stroke " + (_replay.rwFrom + 1) : "…"} → ${_replay.rwTo != null ? "stroke " + (_replay.rwTo + 1) : "…"}`;
}
function buildReplayWindow() {
  if (!_replay || _replay.mode !== "stroke") return;
  const sel = document.getElementById("rwSource");
  const prevCk = document.getElementById("rwPrev");
  const usePrev = !!(prevCk && prevCk.checked) && _replay.prevSession;
  const out = document.getElementById("rwOut");
  const say = t => { if (out) out.textContent = t; };
  const finish = (bl, sourceLabel) => {
    if (bl && bl.curve) {
      bl.label = sourceLabel;
      _replay.windowBl = bl;
      say(`${sourceLabel}: ${bl.retained}/${bl.total} curves · ` +
        `DL ${bl.stats.dl ? bl.stats.dl.mean.toFixed(2) + "±" + bl.stats.dl.sd.toFixed(2) : "—"} · ` +
        `ratio ${bl.stats.ratio ? bl.stats.ratio.mean.toFixed(1) + "±" + bl.stats.ratio.sd.toFixed(1) : "—"} · ` +
        `split ${bl.stats.split ? fmtPace(bl.stats.split.mean) : "—"} · ` +
        `${bl.confidence} confidence (${bl.confidenceWhy})`);
      renderReplayFc();
      if (out) {
        for (const slot of ["pinA", "pinB"]) {
          const b = document.createElement("button");
          b.textContent = `Use as ${slot === "pinA" ? "A" : "B"}`;
          b.addEventListener("click", () => {
            _replay[slot] = { kind: "window", label: sourceLabel, curve: bl.curve,
              split: bl.stats.split && bl.stats.split.mean, dl: bl.stats.dl && bl.stats.dl.mean,
              ratio: bl.stats.ratio && bl.stats.ratio.mean, ctx: sourceLabel };
            renderReplayFc();
          });
          out.appendChild(document.createTextNode(" "));
          out.appendChild(b);
        }
      }
    } else {
      say(bl && bl.insufficient ? bl.insufficient : "Not enough stored curves in that range.");
      _replay.windowBl = null;
      renderReplayFc();
    }
  };
  const buildOn = (tl, curveAt, sess, label) => {
    const v = sel ? sel.value : "range";
    if (v === "range") {
      if (usePrev) { say("Marked ranges apply to this session — pick an interval, segment, or steadiest section for the previous attempt."); return; }
      if (_replay.rwFrom == null || _replay.rwTo == null) { say("Mark a start and end stroke first (⇤ / ⇥)."); return; }
      const a = Math.min(_replay.rwFrom, _replay.rwTo), b = Math.max(_replay.rwFrom, _replay.rwTo);
      finish(buildCurveWindowBaseline(tl, a, b, { curveAt }), `${label}strokes ${a + 1}–${b + 1}`);
    } else if (v === "steady") {
      const sec = bestConsistentSection(sess.strokes || [], 20);
      const start = sec ? parseInt((sec.label.match(/stroke (\d+)/) || [])[1], 10) - 1 : -1;
      if (!(start >= 0)) { say("No steady 20-stroke section found."); return; }
      finish(buildCurveWindowBaseline(tl, start, Math.min(start + 19, tl.length - 1), { curveAt }),
        `${label}steadiest 20 (from stroke ${start + 1})`);
    } else if (v.startsWith("iv:")) {
      const r = strokeRangeForInterval(sess, tl, parseInt(v.slice(3), 10));
      if (!r) { say(usePrev ? "The previous attempt has no matching interval." : "That interval has no captured strokes."); return; }
      finish(buildCurveWindowBaseline(tl, r.from, r.to, { curveAt }), `${label}${r.label}`);
    } else if (v.startsWith("sg:")) {
      const r = strokeRangeForRaceSegment(sess, tl, parseInt(v.slice(3), 10));
      if (!r) { say(usePrev ? "The previous attempt has no matching race segment." : "That segment has no captured strokes."); return; }
      finish(buildCurveWindowBaseline(tl, r.from, r.to, { curveAt }), `${label}${r.label}`);
    }
  };
  if (!usePrev) {
    buildOn(_replay.tl, replayEvCurveAt, _replay.session, "");
    return;
  }
  // Previous compatible attempt: load ITS payload, build on ITS timeline.
  const prev = _replay.prevSession;
  say("Loading previous attempt…");
  curveDetailGet(prev.id).then(rec => {
    if (!_replay || _replay.prevSession !== prev) return;
    const bytes = rec && rec.bytes;
    const h = bytes && decodeCurveHeader(bytes);
    const idx = h && curveOrdinalIndex(bytes);
    if (!h || !idx) { say("The previous attempt's curve data is unavailable on this device."); return; }
    const ptl = buildStrokeReplayTimeline(prev);
    const stride = prev.strokeStride || 1;
    const pCurveAt = pos => {
      const ri = idx.get(strokePosToOrdinal(pos, stride));
      if (ri == null) return null;
      const r = decodeCurveRecordUnchecked(bytes, ri);
      return r && r.samples;
    };
    buildOn(ptl, pCurveAt, prev, `prev ${String(prev.date || "").slice(0, 10)} · `);
  });
}

// Wire the Stroke Evidence controls once at startup (called from the
// main script's init).
function initStrokeEvidenceUi() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("rplPinA", () => pinReplayStroke("pinA"));
  on("rplPinB", () => pinReplayStroke("pinB"));
  on("rplPinClear", clearReplayPins);
  on("rwFrom", () => rwMark("from"));
  on("rwTo", () => rwMark("to"));
  on("rwBuild", buildReplayWindow);
  const norm = document.getElementById("rplNorm");
  if (norm) norm.addEventListener("change", renderReplayFc);
}

// Previous/next stroke that HAS a stored curve (keys , and . / buttons).
function replayStepStoredCurve(dir) {
  const c = _replay && _replay.curves;
  if (!c || _replay.mode !== "stroke") return;
  let pos = _replay.pos;
  for (let n = 0; n < _replay.tl.length; n++) {
    pos += dir;
    if (pos < 0 || pos >= _replay.tl.length) return;
    if (c.index.has(strokePosToOrdinal(pos, c.stride))) {
      _replay.pos = pos;
      renderReplayPos();
      return;
    }
  }
}
