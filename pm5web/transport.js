/* PM5 Dashboard — transport module (v1.23.0): the authoritative BLE
 * connection state machine, packet-liveness watchdog, gap recorder,
 * privacy-safe diagnostics, packet minimum-length table, continuity
 * decision, and the deterministic transport simulator. Pure logic
 * first (fully unit-tested); browser glue at the bottom. Classic
 * script after insights.js; network-first in the SW. Thresholds and
 * rules: docs/analysis-methods.md + docs/architecture.md. */

// Connection state machine — one source of truth for TRANSPORT state
// (workout state stays separate). Legal transitions only; superseded
// async completions are ignored via generations.
const BLE_STATES = ["unsupported", "idle", "requesting", "connecting", "discovering",
  "subscribing", "live", "stale", "reconnecting", "resting", "completed",
  "disconnected", "error"];
const BLE_TRANSITIONS = {
  unsupported: [],
  idle: ["requesting", "unsupported"],
  requesting: ["connecting", "idle", "error"],          // idle = chooser cancelled (normal)
  connecting: ["discovering", "disconnected", "error"],
  discovering: ["subscribing", "disconnected", "error"],
  subscribing: ["live", "disconnected", "error"],       // live only after valid telemetry
  live: ["stale", "resting", "completed", "disconnected", "idle"],
  stale: ["live", "resting", "completed", "disconnected", "idle"],
  resting: ["live", "stale", "completed", "disconnected", "idle"],
  completed: ["live", "disconnected", "idle"],          // a new workout can start
  reconnecting: ["connecting", "disconnected", "idle", "error"],
  disconnected: ["reconnecting", "requesting", "idle"],
  error: ["requesting", "idle"],
};
function bleTransitionLegal(from, to) {
  return !!(BLE_TRANSITIONS[from] && BLE_TRANSITIONS[from].includes(to));
}
function createBleMachine(opts) {
  const now = (opts && opts.now) || (() => performance.now());
  const m = {
    state: "idle", gen: 0, history: [],
    // A new user-initiated or reconnect attempt gets a fresh generation;
    // any async completion holding an older generation must be ignored.
    begin() { m.gen++; return m.gen; },
    fresh(g) { return g === m.gen; },
    to(next, why) {
      if (!bleTransitionLegal(m.state, next)) return false;
      m.history.push({ t: Math.round(now()), from: m.state, to: next, why: why || "" });
      if (m.history.length > 100) m.history.shift();
      m.state = next;
      return true;
    },
    is(...ss) { return ss.includes(m.state); },
    // Connect is idempotent: only these states may start a new attempt.
    canStart() { return m.is("idle", "error", "disconnected", "completed"); },
  };
  return m;
}

// Packet-liveness watchdog — driven by the STATUS family only (the
// PM5 emits status continuously while awake, including during rest, so
// status silence = transport stall while stroke/curve silence at rest
// is normal). Only VALIDATED packets refresh liveness; monotonic time
// throughout; a completed workout (state 10/11) disarms staleness.
const LIVENESS_STALE_MS = 5000;     // status silent this long while armed → stale
const LIVENESS_WARN_COOLDOWN_MS = 10000;
const GAP_EVENT_CAP = 20;
const PKT_MIN_LEN = { gs: 19, gs1: 16, gs2: 20, stroke: 20, force: 2 };

function createLiveness(opts) {
  const now = (opts && opts.now) || (() => performance.now());
  const L = {
    startedAt: now(), lastAt: { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0, hr: 0 },
    accepted: { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0 },
    rejected: { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0 },
    lastWarnAt: -Infinity, gaps: [], openGap: null, gen: 0,
    note(family, ok) {
      if (ok) { L.accepted[family] = (L.accepted[family] || 0) + 1; L.lastAt[family] = now(); }
      else L.rejected[family] = (L.rejected[family] || 0) + 1;
    },
    ageMs(family) {
      const t = L.lastAt[family || "gs"];
      return t ? now() - t : Infinity;
    },
    // ctx: { armed (transport in live/stale/resting), workoutState }.
    // Returns "disarmed" | "live" | "stale". Rest does NOT protect
    // against status silence (the PM5 keeps sending status at rest);
    // a COMPLETED workout does (states 10/11), as does an unarmed
    // transport (idle/connecting/etc.).
    evaluate(ctx) {
      if (!ctx || !ctx.armed) return "disarmed";
      if (ctx.workoutState === 10 || ctx.workoutState === 11) return "disarmed";
      if (!L.lastAt.gs) return "live";          // no telemetry yet — machine still in subscribing
      return L.ageMs("gs") > LIVENESS_STALE_MS ? "stale" : "live";
    },
    warnAllowed() {
      const t = now();
      if (t - L.lastWarnAt < LIVENESS_WARN_COOLDOWN_MS) return false;
      L.lastWarnAt = t; return true;
    },
    gapOpen(state) {
      if (L.openGap || L.gaps.length >= GAP_EVENT_CAP) return;
      L.openGap = { s: Math.round((now() - L.startedAt) / 100) / 10, st: state || "stale" };
    },
    gapClose(recovered) {
      if (!L.openGap) return;
      const e = Math.round((now() - L.startedAt) / 100) / 10;
      L.gaps.push({ s: L.openGap.s, e, d: Math.round((e - L.openGap.s) * 10) / 10,
        st: L.openGap.st, r: recovered ? 1 : 0 });
      L.openGap = null;
    },
    reset() {
      L.startedAt = now();
      L.lastAt = { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0, hr: 0 };
      L.accepted = { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0 };
      L.rejected = { gs: 0, gs1: 0, gs2: 0, stroke: 0, force: 0 };
      L.gaps = []; L.openGap = null; L.lastWarnAt = -Infinity; L.gen++;
    },
  };
  return L;
}

// Continuity after reconnect: resume the SAME workout only when the
// erg's counters prove it (elapsed/distance not backwards beyond small
// tolerance, stroke count not dropped); anything else = reset, NEVER
// merged.
function pm5Continuity(before, after) {
  if (!before || !after) return "same";                  // nothing recorded yet
  if (!isFinite(after.elapsedS) || !isFinite(after.distanceM)) return "reset";
  if (after.elapsedS < (before.elapsedS || 0) - 2) return "reset";
  if (after.distanceM < (before.distanceM || 0) - 5) return "reset";
  if (isFinite(before.strokes) && isFinite(after.strokes) &&
      after.strokes < before.strokes - 1) return "reset";
  return "same";
}

// ==================
// Session capture-quality metadata (entry.capture + entry.gaps) —
// versioned by vocabulary, compact, whitelisted on import.
// ==================
const CAPTURE_STATES = ["clean", "interrupted-recovered", "interrupted-gap",
  "ended-on-disconnect", "simulated"];
function sanitizeCaptureMeta(v) {
  return CAPTURE_STATES.includes(v) ? v : null;
}
function sanitizeGaps(a) {
  if (!Array.isArray(a)) return null;
  const num = (v, hi) => (typeof v === "number" && isFinite(v) && v >= 0 && v <= hi) ? v : null;
  const out = [];
  for (const g of a.slice(0, GAP_EVENT_CAP)) {
    if (!g || typeof g !== "object") continue;
    const s = num(g.s, 864000), e = num(g.e, 864000), d = num(g.d, 864000);
    if (s == null || e == null || d == null || e < s) continue;
    out.push({ s, e, d, st: ["stale", "disconnected"].includes(g.st) ? g.st : "stale",
      r: g.r === 1 ? 1 : 0 });
  }
  return out.length ? out : null;
}

// ==================
// Diagnostics — bounded in-memory buffer with a fixed event vocabulary.
// Detail strings are normalized slugs only; free-form text, device
// identifiers, packet bytes, and workout content can never enter. The
// export path re-sanitizes with a slug whitelist as defense in depth.
// ==================
const DIAG_EVENT_CAP = 100;
const _DIAG_SLUG = /^[a-z0-9:._%|-]{0,48}$/i;
function createDiagnostics(opts) {
  const now = (opts && opts.now) || (() => performance.now());
  const D = {
    startedAt: now(), events: [], reconnects: 0,
    push(type, detail) {
      const t = Math.round((now() - D.startedAt) / 100) / 10;
      const dd = String(detail == null ? "" : detail).slice(0, 48);
      D.events.push({ t, type: String(type).slice(0, 24), d: _DIAG_SLUG.test(dd) ? dd : "redacted" });
      if (D.events.length > DIAG_EVENT_CAP) D.events.shift();
    },
    exportSafe(extra) {
      return {
        kind: "pm5-connection-diagnostics",
        appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "?",
        exportedAtRelS: Math.round((now() - D.startedAt) / 100) / 10,
        note: "Relative timestamps, normalized state/packet categories, and counters only — no device identifiers, packet bytes, credentials, or workout content.",
        reconnects: D.reconnects,
        events: D.events.filter(e => _DIAG_SLUG.test(e.type) && _DIAG_SLUG.test(e.d)),
        ...(extra && typeof extra === "object" ? { summary: extra } : {}),
      };
    },
    reset() { D.startedAt = now(); D.events = []; D.reconnects = 0; },
  };
  return D;
}

// Simulated transport — byte-accurate PM5 notifications fed through
// the PRODUCTION handlers. Simulation never proves physical BLE
// behavior; simulated sessions stay labeled synthetic.
function simPktGS(f) {
  f = f || {};
  const b = new Uint8Array(19);
  const w24 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; };
  w24(0, Math.round((f.elapsedS || 0) * 100));
  w24(3, Math.round((f.distanceM || 0) * 10));
  b[6] = f.workoutType || 1; b[7] = f.intervalType || 255;
  b[8] = f.workoutState != null ? f.workoutState : 1;
  b[9] = f.rowingState != null ? f.rowingState : 1;
  b[10] = f.strokeState != null ? f.strokeState : 2;
  b[18] = f.drag || 120;
  return b;
}
function simPktGS1(f) {
  f = f || {};
  const b = new Uint8Array(17);
  const w24 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; };
  const w16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
  w24(0, Math.round((f.elapsedS || 0) * 100));
  w16(3, Math.round((f.speed || 4) * 1000));
  b[5] = f.rate || 24; b[6] = f.hr != null ? f.hr : 255;
  w16(7, Math.round((f.paceS || 120) * 100));
  w16(9, Math.round((f.avgPaceS || 120) * 100));
  return b;
}
function simPktStroke(f) {
  f = f || {};
  const b = new Uint8Array(20);
  const w24 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; };
  const w16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
  w24(0, Math.round((f.elapsedS || 0) * 100));
  w24(3, Math.round((f.distanceM || 0) * 10));
  b[6] = Math.round((f.dl || 1.35) * 100); b[7] = Math.round((f.dt || 0.8) * 100);
  w16(8, Math.round((f.rt || 1.6) * 100));
  w16(12, Math.round((f.pf || 150) * 10));
  w16(14, Math.round((f.af || 95) * 10));
  w16(16, Math.round((f.work || 380) * 10));
  w16(18, f.strokeCount || 1);
  return b;
}
function simPktForce(seq, totalPackets, samples) {
  const n = Math.min(15, samples.length);
  const b = new Uint8Array(2 + n * 2);
  b[0] = ((totalPackets & 15) << 4) | n;
  b[1] = seq;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.round(samples[i] * 10));
    b[2 + i * 2] = v & 255; b[3 + i * 2] = (v >> 8) & 255;
  }
  return b;
}

// ==================
// Browser glue — the singleton transport controller. Created lazily;
// references main-script globals (state, setStatus, render, handlers)
// at call time only, so the module stays loadable in any order and in
// the test sandbox.
// ==================
let bleCtl = null;
function initTransportLayer() {
  if (bleCtl) return bleCtl;
  bleCtl = {
    machine: createBleMachine({}),
    live: createLiveness({}),
    diag: createDiagnostics({}),
    watchTimer: null, watchGen: 0,
    preDrop: null, pendingContinuity: false,
  };
  if (typeof navigator !== "undefined" && !navigator.bluetooth) {
    bleCtl.machine.to("unsupported", "no-web-bluetooth");
  }
  return bleCtl;
}

// Watchdog timer: 1 s tick while armed; generation-guarded so stale
// callbacks can never touch a newer session; cleared on teardown.
function bleWatchStart() {
  const c = initTransportLayer();
  bleWatchStop();
  const gen = ++c.watchGen;
  c.watchTimer = setInterval(() => {
    if (gen !== c.watchGen || !bleCtl) return;
    const verdict = c.live.evaluate({
      armed: c.machine.is("live", "stale", "resting"),
      workoutState: state.workoutState,
    });
    if (verdict === "stale" && c.machine.is("live", "resting")) {
      if (c.machine.to("stale", "status-overdue")) {
        c.live.gapOpen("stale");
        c.diag.push("liveness", "stale");
        setStatus("connecting", `PM5 silent ${Math.round(c.live.ageMs("gs") / 1000)}s — checking…`);
        if (c.live.warnAllowed()) setToast("PM5 telemetry paused — no data is being invented. Checking the connection…", "warn");
        render();
      }
    }
    if (c.machine.is("stale")) renderConnDiag(false);
  }, 1000);
}
function bleWatchStop() {
  if (bleCtl && bleCtl.watchTimer) { clearInterval(bleCtl.watchTimer); bleCtl.watchTimer = null; }
  if (bleCtl) bleCtl.watchGen++;
}

// Valid-packet hook called by the notification handlers AFTER a parse
// succeeded. Handles stale→live recovery and reconnect continuity.
function bleValidPacket(family, parsed) {
  const c = bleCtl;
  if (!c) return;
  c.live.note(family, true);
  if (family === "gs" && parsed) {
    if (c.machine.is("subscribing")) {
      c.machine.to("live", "first-telemetry");
      state.connected = true;
      setStatus("connected-ble", "PM5 live");
      c.diag.push("state", "live");
      render();
    } else if (c.machine.is("stale")) {
      c.machine.to("live", "telemetry-resumed");
      c.live.gapClose(true);
      c.diag.push("liveness", "recovered");
      setStatus("connected-ble", "PM5 live");
      render();
    }
    if (c.pendingContinuity) {
      c.pendingContinuity = false;
      const verdict = pm5Continuity(c.preDrop, {
        elapsedS: parsed.elapsed_time_s, distanceM: parsed.distance_m,
        strokes: state.strokeCount,
      });
      c.diag.push("continuity", verdict);
      if (verdict === "reset") {
        // Different workout / PM5 reset: preserve the interrupted
        // session, then start clean. Never merged silently.
        maybeAutoLog("disconnected");
        resetForceCurveOverlays();
        resetStrokeCapture();
        state.bookmarks = [];
        state.cueEvents = [];
        c.live.gaps = []; c.live.openGap = null;
        setToast("The PM5 reports a different workout than before the disconnect — the interrupted session was saved separately and a fresh capture has started.", "warn");
      } else {
        setToast("Reconnected to the same workout — capture continues (gap recorded).", "ok");
      }
    }
  }
}
function bleRejectPacket(family) {
  if (bleCtl) bleCtl.live.note(family, false);
}

// Session capture-quality summary for logCurrentWorkout.
function bleCaptureQuality() {
  if (typeof demoActive === "function" && demoActive()) return { capture: "simulated", gaps: null };
  const c = bleCtl;
  if (!c) return { capture: null, gaps: null };
  if (c.live.openGap) c.live.gapClose(false);
  const gaps = c.live.gaps.slice(0, GAP_EVENT_CAP);
  if (!gaps.length) return { capture: "clean", gaps: null };
  const allRecovered = gaps.every(g => g.r === 1);
  return { capture: allRecovered ? "interrupted-recovered" : "interrupted-gap", gaps };
}

// ---- Connection Diagnostics drawer ----------------------------------
function renderConnDiag(open) {
  const box = document.getElementById("diagBody");
  if (!box) return;
  const modal = document.getElementById("diagModal");
  if (open && modal) modal.classList.add("open");
  if (modal && !modal.classList.contains("open")) return;
  const c = initTransportLayer();
  box.innerHTML = "";
  const line = t => { const d = document.createElement("div"); d.textContent = t; box.appendChild(d); };
  line(`Browser support: ${typeof navigator !== "undefined" && navigator.bluetooth ? "Web Bluetooth available" : "not available in this browser"}`);
  line(`Connection state: ${c.machine.state}` + (typeof demoActive === "function" && demoActive() ? " · simulated transport active" : ""));
  const age = c.live.ageMs("gs");
  line(`Telemetry: ${age === Infinity ? "none received" : (age < LIVENESS_STALE_MS ? "live" : "overdue") + ` · last valid status packet ${(age / 1000).toFixed(1)} s ago`}`);
  const fams = ["gs", "gs1", "gs2", "stroke", "force"];
  line("Packets accepted/rejected: " + fams.map(f => `${f} ${c.live.accepted[f] || 0}/${c.live.rejected[f] || 0}`).join(" · "));
  line(`Reconnects: ${c.diag.reconnects} · gaps: ${c.live.gaps.length}` +
    (c.live.gaps.length ? ` · total gap ${(c.live.gaps.reduce((t, g) => t + g.d, 0)).toFixed(1)} s` : ""));
  line(`Force Curve capture: ${state.curveCapture && state.curveCapture.list.length ? state.curveCapture.list.length + " stroke curves this session" : "none this session"}`);
  line(`Heart-rate source: ${state.heartRate >= 30 && state.heartRate <= 240 ? "PM5 strap relay" : "none"} (direct HRM pairing: deferred — not yet hardware-verified)`);
  const q = bleCaptureQuality();
  line(`Session capture: ${q.capture || "no session"}`);
  const evTitle = document.createElement("div");
  evTitle.className = "diag-sub"; evTitle.textContent = `Recent events (${c.diag.events.length}, bounded ${DIAG_EVENT_CAP}):`;
  box.appendChild(evTitle);
  const ev = document.createElement("div"); ev.className = "diag-events";
  ev.textContent = c.diag.events.slice(-25).map(e => `+${e.t}s ${e.type}${e.d ? ":" + e.d : ""}`).join("\n") || "(none yet)";
  box.appendChild(ev);
}
function exportConnDiag() {
  const c = initTransportLayer();
  const payload = c.diag.exportSafe({
    state: c.machine.state,
    accepted: c.live.accepted, rejected: c.live.rejected,
    gaps: c.live.gaps.length, reconnects: c.diag.reconnects,
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  triggerDownload(blob, `pm5-connection-diagnostics-${new Date().toISOString().slice(0, 10)}.json`);
  setToast("Diagnostics exported — relative timestamps, states, and counters only (no identifiers, packets, or workout data).", "ok");
}

// ---- Deterministic transport scenarios (browser verification) -------
// Each scenario drives the PRODUCTION handlers (onGS/onStroke/onForce)
// and the machine/watchdog exactly as real notifications would.
function runTransportScenario(name) {
  const c = initTransportLayer();
  const feed = (fn, pkt) => fn(pkt);
  const gsAt = (t, d, ws) => feed(onGS, simPktGS({ elapsedS: t, distanceM: d, workoutState: ws == null ? 1 : ws }));
  const bell = at => Array.from({ length: 12 }, (_, k) => 150 * Math.sin(Math.min(1, k / (11 * at)) * Math.PI / 2));
  switch (name) {
    case "normal": {
      gsAt(1, 4); gsAt(2, 9);
      feed(onStroke, simPktStroke({ elapsedS: 2.2, distanceM: 10, strokeCount: 1 }));
      feed(onForce, simPktForce(0, 1, bell(0.4)));
      feed(onForce, simPktForce(0, 1, bell(0.42)));   // next stroke commits the previous
      return { state: c.machine.state, accepted: { ...c.live.accepted } };
    }
    case "malformed": {
      feed(onGS, new Uint8Array(5));                   // short — must be rejected
      feed(onStroke, new Uint8Array(3));
      return { rejected: { ...c.live.rejected }, state: c.machine.state };
    }
    case "duplicate-stroke": {
      const p = simPktStroke({ elapsedS: 10, distanceM: 40, strokeCount: 5 });
      feed(onStroke, p); feed(onStroke, p);            // exact duplicate notification
      return { strokeCount: state.strokeCount };
    }
    case "stall": {
      // caller waits past LIVENESS_STALE_MS, watchdog flags stale, then:
      gsAt(30, 120);                                   // recovery packet
      return { state: c.machine.state, gaps: c.live.gaps.slice() };
    }
    default: return null;
  }
}
