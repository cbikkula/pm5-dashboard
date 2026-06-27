// =====================================================================
// Test harness (#24) — loads the single-file app, extracts its main
// script, and runs it inside a stubbed DOM/browser sandbox so the pure
// logic functions can be unit-tested without a browser.
//
//   const { load } = require("./harness");
//   const app = load();            // returns the sandbox's globals
//   app.computeFatigue(entry);     // call any top-level function
//
// The sandbox stubs just enough of document/window/localStorage/etc.
// for the top-level module code to evaluate without throwing.
// =====================================================================
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const INDEX = path.join(__dirname, "..", "pm5web", "index.html");

function stubNode() {
  const n = {
    style: {}, value: "", textContent: "", innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {},
    getAttribute: () => null, querySelectorAll: () => [], focus() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
  };
  n.querySelector = () => n;
  n.children = [];
  return n;
}

function makeSandbox() {
  const doc = {
    getElementById: () => stubNode(),
    querySelector: () => stubNode(),
    querySelectorAll: () => [],
    createElement: () => stubNode(),
    addEventListener() {}, removeEventListener() {},
    body: stubNode(), documentElement: stubNode(),
    fullscreenElement: null, exitFullscreen: () => Promise.resolve(),
    dispatchEvent() {},
  };
  const sb = {
    document: doc,
    window: {
      addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      location: { protocol: "https:", hostname: "localhost", href: "", replace() {} },
      requestAnimationFrame: () => 0,
    },
    localStorage: (() => { const d = {}; return {
      getItem: (k) => (k in d ? d[k] : null),
      setItem: (k, v) => { d[k] = String(v); },
      removeItem: (k) => { delete d[k]; },
    }; })(),
    navigator: { bluetooth: {}, onLine: true, userAgent: "node" },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    requestAnimationFrame: () => 0,
    console, Date, Math, JSON, performance: { now: () => 0 },
    fetch: () => Promise.reject(new Error("no network in tests")),
    prompt: () => null, confirm: () => true, alert() {},
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    TextEncoder, TextDecoder, URL,
  };
  sb.globalThis = sb;
  sb.self = sb;
  sb.location = sb.window.location;
  return sb;
}

function extractMainScript(html) {
  const blocks = [...html.matchAll(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/g)];
  if (blocks.length < 2) throw new Error("expected a module + main script block");
  // The main (classic) script is the large one.
  let main = blocks[0][1];
  for (const b of blocks) if (b[1].length > main.length) main = b[1];
  return main;
}

function load() {
  const html = fs.readFileSync(INDEX, "utf8");
  const src = extractMainScript(html);
  const sb = makeSandbox();
  const ctx = vm.createContext(sb);
  // Re-export the top-level declarations we test onto globalThis so the
  // runner can reach them (vm lexical bindings aren't visible otherwise).
  const exposed = [
    "state", "BENCHMARKS", "METRICS",
    "benchmarkAchievement", "evaluatePrsForSession", "exactAchievementFromIntervals",
    "currentPrDelta", "fmtPrDelta", "prDeltaColor", "mergeBenchmarksInPlace",
    "computeFatigue", "computeDataQuality", "computeInsights", "quartileAverages", "analyzeSession",
    "targetZoneStatus", "targetLiveValue", "fmtPlainPace", "TARGET_METRIC_ZONE",
    "importSessionsFromText", "mergeHistory", "SESSION_SCHEMA_VERSION",
    "resampleCurve", "FC_SAMPLES",
    "fmtTime", "fmtPace", "fmtInt",
    // v1.12 — rowing lineup-readiness engine
    "evaluateLineupReadiness", "emptySeatsFor", "BOAT_CLASSES", "AVAILABILITY",
    "sideToken", "seatRole",
    // v1.13 — workout assignments
    "athleteSeesAssignment", "assignmentsForAthlete", "assignmentsForLineup",
    "formatAssignmentAthlete", "assignmentWorkoutText", "assignmentTargetLabel",
    "WORKOUT_TYPES",
    // v1.14 — performance analytics
    "computePerformanceOverview", "computePrCards", "computeBenchmarkProgress",
    "computeFatigueTrend", "computeTechniqueTrend", "computeHrSummary",
    "perfSessionMetrics", "sessionAvgRate", "PR_KEYS",
    // v1.14.1 — session replay readiness
    "getSessionReplayCapability", "buildIntervalReplayTimeline",
    "mapBookmarksToReplayTimeline", "summarizeReplayLimitations",
  ];
  const shim = "\n;globalThis.__APP = {" +
    exposed.map((n) => `${n}: (typeof ${n}!=="undefined"?${n}:undefined)`).join(",") +
    "};";
  vm.runInContext(src + shim, ctx, { timeout: 8000 });
  return sb.__APP;
}

module.exports = { load, extractMainScript, makeSandbox, INDEX };
