// =====================================================================
// Test runner (#24). Plain Node, no deps. Run: `node tests/run.js`.
// Exits non-zero on any failure (so CI fails the build).
// =====================================================================
const fs = require("fs");
const path = require("path");
const { load, extractMainScript, INDEX } = require("./harness");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("  ✗ " + name); }
}
function eqApprox(name, got, want, tol = 0.51) {
  ok(name + ` (=${got})`, got === want || (typeof got === "number" && Math.abs(got - want) <= tol));
}
function group(title) { console.log("\n• " + title); }

// ---------------------------------------------------------------------
// 0. The app's main script must evaluate without throwing.
// ---------------------------------------------------------------------
group("script loads");
let app;
try { app = load(); ok("main script evaluates in sandbox", true); }
catch (e) { ok("main script evaluates in sandbox", false); console.error(e); process.exit(1); }

// ---------------------------------------------------------------------
// 1. Force-curve resampling (telemetry math).
// ---------------------------------------------------------------------
group("force-curve resample");
if (app.resampleCurve && app.FC_SAMPLES) {
  const rs = app.resampleCurve([10, 50, 90, 50, 10], app.FC_SAMPLES);
  ok("resample length = FC_SAMPLES", rs && rs.length === app.FC_SAMPLES);
  eqApprox("resample first endpoint", rs[0], 10);
  eqApprox("resample last endpoint", rs[rs.length - 1], 10);
  ok("resample peak near 90", Math.max(...rs) > 85);
  ok("resample empty → null", app.resampleCurve([], 64) === null);
}

// ---------------------------------------------------------------------
// 2. PR detection.
// ---------------------------------------------------------------------
group("PR detection");
if (app.evaluatePrsForSession) {
  const leg = (d, e) => ({ distanceM: d, elapsedS: e });
  const twoK = { id: "s1", plan: { benchKey: "2k" },
    totals: { distanceM: 2000, elapsedS: 435 },
    results: Array.from({ length: 8 }, () => leg(250, 435 / 8)) };
  app.state.userPrefs.benchmarks = {};
  const pr = app.evaluatePrsForSession(twoK);
  ok("2k test sets a PR", pr.keys.length === 1 && pr.keys[0] === "2k");
  // slower session does not improve
  app.state.userPrefs.benchmarks = { "2k": 420 };
  ok("slower 2k does not improve PR", app.evaluatePrsForSession(twoK).keys.length === 0);
  // non-test session never sets a PR
  const justRow = { id: "s2", plan: null, totals: { distanceM: 2000, elapsedS: 430 }, results: [] };
  app.state.userPrefs.benchmarks = {};
  ok("non-test session sets no PR", app.evaluatePrsForSession(justRow).keys.length === 0);
}

// ---------------------------------------------------------------------
// 3. Per-key Drive merge (two-device race).
// ---------------------------------------------------------------------
group("benchmark merge");
if (app.mergeBenchmarksInPlace) {
  app.state.userPrefs.benchmarks = { "2k": 420 };     // remote (in place)
  app.state.userPrefs.benchmarkMeta = { "2k": { sessionId: "remote" } };
  app.mergeBenchmarksInPlace({ "2k": 415 }, { "2k": { sessionId: "local" } });
  eqApprox("merge keeps faster local time", app.state.userPrefs.benchmarks["2k"], 415, 0.01);
  ok("merge keeps local meta", app.state.userPrefs.benchmarkMeta["2k"].sessionId === "local");
  // distance-kind: higher wins
  app.state.userPrefs.benchmarks = { "1min": 310 };
  app.state.userPrefs.benchmarkMeta = { "1min": {} };
  app.mergeBenchmarksInPlace({ "1min": 305 }, { "1min": {} });
  eqApprox("merge keeps farther remote distance", app.state.userPrefs.benchmarks["1min"], 310, 0.01);
}

// ---------------------------------------------------------------------
// 4. Fatigue analysis.
// ---------------------------------------------------------------------
group("fatigue analysis");
if (app.computeFatigue) {
  const leg = (d, e, p, w, r, hr, dl) => ({ distanceM: d, elapsedS: e, paceS: p, watts: w, strokeRate: r, heartRate: hr, driveLengthM: dl });
  const fading = { id: "f", results: [
    leg(250, 52, 104, 300, 30, 150, 1.52), leg(250, 52, 104, 298, 30, 152, 1.51),
    leg(250, 53, 106, 290, 30, 156, 1.50), leg(250, 53, 106, 285, 30, 160, 1.49),
    leg(250, 54, 108, 278, 31, 164, 1.47), leg(250, 55, 110, 270, 31, 168, 1.45),
    leg(250, 56, 112, 262, 32, 172, 1.43), leg(250, 57, 114, 255, 32, 176, 1.42),
  ], totals: { distanceM: 2000, elapsedS: 443, avgWatts: 280 } };
  const fat = app.computeFatigue(fading);
  ok("fatigue computed for 8-interval session", fat != null);
  ok("faded session index < 100", fat.index < 100);
  ok("split fade positive", fat.fade.split > 0);
  ok("watts fade positive", fat.fade.watts > 0);
  ok("main issue is a sentence", typeof fat.mainIssue === "string" && fat.mainIssue.length > 5);
  // short session → null
  ok("short session fatigue null", app.computeFatigue({ id: "x", results: [leg(250, 52, 104, 300, 30, 150, 1.5)] }) === null);
}

// ---------------------------------------------------------------------
// 5. Data quality.
// ---------------------------------------------------------------------
group("data quality");
if (app.computeDataQuality) {
  const clean = { results: [
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 150, watts: 300 },
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 151, watts: 298 },
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 152, watts: 299 },
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 153, watts: 301 },
  ] };
  ok("clean session quality high", app.computeDataQuality(clean).score >= 90);
  const bad = { results: [
    { distanceM: 250, elapsedS: 52, strokeRate: 99, heartRate: 150, watts: 300 },
    { distanceM: 0,   elapsedS: 52, strokeRate: 30, heartRate: 150, watts: 300 },
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 0,   watts: 300 },
    { distanceM: 250, elapsedS: 52, strokeRate: 30, heartRate: 150, watts: 300 },
  ] };
  const q = app.computeDataQuality(bad);
  ok("bad session flags ≥2 issues", q.issues.length >= 2);
  ok("bad session score < clean", q.score < 90);
}

// ---------------------------------------------------------------------
// 6. Target zones.
// ---------------------------------------------------------------------
group("target zones");
if (app.targetZoneStatus) {
  app.state.userPrefs.targetEnabled = true;
  app.state.userPrefs.targetZones = { rate: { min: 18, max: 20 } };
  ok("19 in [18,20] → in", app.targetZoneStatus("rate", 19) === "in");
  ok("17.8 → near", app.targetZoneStatus("rate", 17.8) === "near");
  ok("16 → out", app.targetZoneStatus("rate", 16) === "out");
  app.state.userPrefs.targetEnabled = false;
  ok("disabled → null", app.targetZoneStatus("rate", 19) === null);
}

// ---------------------------------------------------------------------
// 7. Import / merge.
// ---------------------------------------------------------------------
group("import sessions");
if (app.importSessionsFromText) {
  app.state.history = [];
  const exp = JSON.stringify({ kind: "pm5-history-export", history: [
    { id: "a", date: "2026-06-01", title: "2k", totals: { distanceM: 2000, elapsedS: 430 } },
    { id: "b", date: "2026-06-02", title: "5k", totals: { distanceM: 5000, elapsedS: 1200 } },
  ] });
  ok("history export adds 2", app.importSessionsFromText(exp) === 2);
  ok("re-import dedups to 0", app.importSessionsFromText(exp) === 0);
  ok("garbage import adds 0", app.importSessionsFromText("not json") === 0);
}

// ---------------------------------------------------------------------
// 8. Bundle-size guard (#25) — keep the single file under budget.
// ---------------------------------------------------------------------
group("bundle size");
const html = fs.readFileSync(INDEX, "utf8");
const kb = Buffer.byteLength(html, "utf8") / 1024;
console.log(`  index.html = ${kb.toFixed(0)} KB`);
ok("index.html under 600 KB", kb < 600);

// ---------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
