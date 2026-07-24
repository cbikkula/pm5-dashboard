// =====================================================================
// Test runner (#24). Plain Node, no deps. Run: `node tests/run.js`.
// Exits non-zero on any failure (so CI fails the build).
// =====================================================================
const fs = require("fs");
const path = require("path");
const { load, extractMainScript, INDEX, ANALYSIS } = require("./harness");

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
// 9. Lineup readiness engine (v1.12) — pure rowing validation.
// ---------------------------------------------------------------------
group("lineup readiness");
if (app.evaluateLineupReadiness && app.emptySeatsFor && app.BOAT_CLASSES) {
  const E = app.evaluateLineupReadiness;
  const seatsFor = app.emptySeatsFor;
  const codesOf = (r) => r.issues.map((i) => i.code);
  const has = (r, code) => codesOf(r).includes(code);
  const blocks = (r) => r.issues.filter((i) => i.severity === "block");

  const athletes = [
    { id: "p1", name: "Port One",  side: "port" },      { id: "p2", name: "Port Two",   side: "port" },
    { id: "p3", name: "Port Three", side: "port" },     { id: "p4", name: "Port Four",  side: "port" },
    { id: "s1", name: "Star One",  side: "starboard" }, { id: "s2", name: "Star Two",   side: "starboard" },
    { id: "s3", name: "Star Three", side: "starboard" },{ id: "s4", name: "Star Four",  side: "starboard" },
    { id: "cox", name: "Cox One", side: "cox" },
    { id: "sc1", name: "Scull One", side: "scull" }, { id: "sc2", name: "Scull Two", side: "scull" },
    { id: "sc3", name: "Scull Three", side: "scull" }, { id: "sc4", name: "Scull Four", side: "scull" },
    { id: "inj", name: "Hurt One", side: "port", availability: "injured" },
  ];
  // 8 side-flexible athletes for the balance test (no mismatch noise).
  for (let i = 1; i <= 8; i++) athletes.push({ id: "x" + i, name: "Flex " + i, side: "any" });
  const shells = [
    { id: "sh8", name: "Eight",   boatClass: "8+" }, { id: "sh4p", name: "CoxFour", boatClass: "4+" },
    { id: "sh2", name: "Pair",    boatClass: "2-" }, { id: "sh4x", name: "Quad",    boatClass: "4x" },
  ];
  const oars = [
    { id: "sweep4",  name: "Sweep4",  type: "sweep", boatClass: "4-" },
    { id: "scull4",  name: "Scull4",  type: "scull", boatClass: "4x" },
    { id: "sweep2",  name: "Sweep2",  type: "sweep", boatClass: "2-" },
    { id: "sweep8",  name: "Sweep8",  type: "sweep", boatClass: "8+" },
    { id: "sweep4p", name: "Sweep4+", type: "sweep", boatClass: "4+" },
  ];
  const ctx = (lineups) => ({ athletes, shells, oarSets: oars, lineups: lineups || [], boatClasses: app.BOAT_CLASSES });
  const fill = (boatClass, ids) => {
    const seats = seatsFor(boatClass);
    for (let i = 0; i < seats.length && i < ids.length; i++) seats[i].athleteId = ids[i];
    return seats;
  };
  let r;

  // 1) 8+ missing coxswain
  r = E({ boatClass: "8+", seats: fill("8+", ["p1","s1","p2","s2","p3","s3","p4","s4"]), coxId: null }, ctx());
  ok("8+ no cox flags no-cox", has(r, "no-cox"));
  ok("8+ no cox is not 'ready'", r.level !== "ready");

  // 2) 4x with sweep oars → blocking oar-type mismatch
  r = E({ boatClass: "4x", seats: fill("4x", ["sc1","sc2","sc3","sc4"]), oarSetId: "sweep4" }, ctx());
  ok("4x + sweep oars blocks (oar-type)", blocks(r).some((i) => i.code === "oar-type"));

  // 3) 2- with sculling oars → blocking oar-type mismatch
  r = E({ boatClass: "2-", seats: fill("2-", ["p1","s1"]), oarSetId: "scull4" }, ctx());
  ok("2- + scull oars blocks (oar-type)", blocks(r).some((i) => i.code === "oar-type"));

  // 4) duplicate athlete in one lineup
  r = E({ boatClass: "2-", seats: fill("2-", ["p1","p1"]) }, ctx());
  ok("duplicate athlete blocks (duplicate)", blocks(r).some((i) => i.code === "duplicate"));

  // 5) athlete double-booked across active lineups (same day)
  const lA = { id: "A", name: "Varsity A", boatClass: "2-", date: "2026-07-01", status: "planned", seats: fill("2-", ["p1","s1"]) };
  const lB = { id: "B", name: "Varsity B", boatClass: "2-", date: "2026-07-01", status: "planned", seats: fill("2-", ["p1","s2"]) };
  r = E(lA, ctx([lA, lB]));
  ok("double-booked athlete blocks (double-booked)", blocks(r).some((i) => i.code === "double-booked"));

  // 6) side imbalance in an 8+ (5 P / 3 S), flexible rowers so only imbalance fires
  const imb = fill("8+", ["x1","x2","x3","x4","x5","x6","x7","x8"]);
  ["port","port","port","port","port","starboard","starboard","starboard"].forEach((sd, i) => imb[i].side = sd);
  r = E({ boatClass: "8+", seats: imb, coxId: "cox" }, ctx());
  ok("8+ 5P/3S flags side-imbalance", has(r, "side-imbalance"));
  ok("flexible rowers cause no side-mismatch", !has(r, "side-mismatch"));

  // 7) port rower in a starboard seat → side-mismatch
  const sm = seatsFor("2-");       // seat[0]=stroke(port rig), seat[1]=bow(starboard rig)
  sm[1].athleteId = "p1";          // a Port rower sitting in the Starboard seat
  r = E({ boatClass: "2-", seats: sm }, ctx());
  ok("P rower in S seat flags side-mismatch", has(r, "side-mismatch"));

  // 8) sculling boat must NOT use sweep side-balance/mismatch logic
  r = E({ boatClass: "4x", seats: fill("4x", ["sc1","sc2","sc3","sc4"]), oarSetId: "scull4", shellId: "sh4x" }, ctx());
  ok("4x has no side-imbalance", !has(r, "side-imbalance"));
  ok("4x has no side-mismatch", !has(r, "side-mismatch"));

  // 9) a complete, correct lineup → no blocking issues, level 'ready'
  r = E({ boatClass: "4+", seats: fill("4+", ["p1","s1","p2","s2"]), coxId: "cox",
          shellId: "sh4p", oarSetId: "sweep4p", notes: "Long through the front end.",
          status: "confirmed", date: "2026-07-02" }, ctx());
  ok("ready 4+ has zero blocking issues", blocks(r).length === 0);
  ok("ready 4+ level is 'ready'", r.level === "ready");

  // bonus) injured rower blocks; shell class mismatch blocks
  r = E({ boatClass: "2-", seats: fill("2-", ["inj","s1"]) }, ctx());
  ok("injured rower blocks (injured)", blocks(r).some((i) => i.code === "injured"));
  r = E({ boatClass: "8+", seats: fill("8+", ["p1","s1","p2","s2","p3","s3","p4","s4"]), coxId: "cox", shellId: "sh4p" }, ctx());
  ok("wrong-class shell blocks (shell-class)", blocks(r).some((i) => i.code === "shell-class"));
}

// ---------------------------------------------------------------------
// 10. Workout assignments (v1.13) — pure targeting + athlete-safe display.
// ---------------------------------------------------------------------
group("workout assignments");
if (app.athleteSeesAssignment && app.assignmentsForAthlete && app.formatAssignmentAthlete) {
  const lineups = [
    { id: "lu1", name: "Demo 8+", boatClass: "8+", shellId: "sh1", oarSetId: "o1", coxId: "cox",
      seats: [{ seat: 8, side: "port", athleteId: "alex" }, { seat: 7, side: "starboard", athleteId: "jordan" }] },
    { id: "lu2", name: "Resolute 4+", boatClass: "4+", coxId: null,
      seats: [{ seat: 4, side: "port", athleteId: "taylor" }] },
  ];
  const athletes = [
    { id: "alex",   name: "Alex",   teamIds: ["tV"], squadIds: ["sH"] },
    { id: "jordan", name: "Jordan", teamIds: ["tV"], squadIds: [] },
    { id: "taylor", name: "Taylor", teamIds: ["tJ"], squadIds: [] },
    { id: "morgan", name: "Morgan", teamIds: [],     squadIds: [] },
  ];
  const ctx = (extra) => Object.assign({
    lineups, athletes, shells: [{ id: "sh1", name: "Demo 8+" }], oarSets: [{ id: "o1", name: "Sweep Set A" }],
    teams: [{ id: "tV", name: "Varsity" }], squads: [{ id: "sH", name: "Heavy" }],
    savedPlans: [], boatClasses: app.BOAT_CLASSES,
  }, extra || {});

  const aLineup = { id: "a1", title: "AM row", targetType: "lineup", targetId: "lu1", status: "planned",
                    athleteNote: "clean catches", coachNote: "SECRET selection notes", embeddedWorkout: "8×250m" };
  const aTeam   = { id: "a2", title: "Team erg",  targetType: "team",    targetId: "tV", status: "planned" };
  const aSquad  = { id: "a3", title: "Squad row", targetType: "squad",   targetId: "sH", status: "planned" };
  const aSolo   = { id: "a4", title: "Solo",      targetType: "athlete", targetId: "taylor", status: "planned" };
  const aClub   = { id: "a5", title: "All-club",  targetType: "club",    targetId: null, status: "planned" };
  const aArch   = { id: "a6", title: "Old",       targetType: "lineup",  targetId: "lu1", status: "archived" };

  // target resolution for a lineup
  ok("seated athlete sees lineup assignment",     app.athleteSeesAssignment(aLineup, "alex", ctx()) === true);
  ok("cox sees lineup assignment",                app.athleteSeesAssignment(aLineup, "cox", ctx()) === true);
  ok("non-seated athlete does NOT see it",        app.athleteSeesAssignment(aLineup, "morgan", ctx()) === false);
  // team / squad / athlete / club targeting
  ok("team member sees team assignment",          app.athleteSeesAssignment(aTeam, "alex", ctx()) === true);
  ok("non-team member does NOT see team assign",  app.athleteSeesAssignment(aTeam, "taylor", ctx()) === false);
  ok("squad member sees squad assignment",        app.athleteSeesAssignment(aSquad, "alex", ctx()) === true);
  ok("athlete-target sees own assignment",        app.athleteSeesAssignment(aSolo, "taylor", ctx()) === true);
  ok("athlete-target not seen by others",         app.athleteSeesAssignment(aSolo, "alex", ctx()) === false);
  ok("club assignment seen by everyone",          app.athleteSeesAssignment(aClub, "morgan", ctx()) === true);
  ok("archived assignment is hidden",             app.athleteSeesAssignment(aArch, "alex", ctx()) === false);

  // aggregation + sort, and lineup filtering
  const forAlex = app.assignmentsForAthlete("alex", ctx({ workoutAssignments: [aLineup, aTeam, aArch, aClub] }));
  ok("assignmentsForAthlete aggregates, drops archived", forAlex.length === 3);
  const byLineup = app.assignmentsForLineup("lu1", ctx({ workoutAssignments: [aLineup, aTeam, aArch] }));
  ok("assignmentsForLineup = active lineup-targeted only", byLineup.length === 1 && byLineup[0].id === "a1");

  // athlete-safe display: athleteNote shown, coachNote NEVER leaked
  const f = app.formatAssignmentAthlete(aLineup, ctx({ viewerAthleteId: "alex" }));
  ok("formatted note is the athlete note",        f.note === "clean catches");
  ok("coach note is NEVER exposed to athletes",   JSON.stringify(f).indexOf("SECRET") === -1);
  ok("formatted context names the lineup",        /Demo 8\+/.test(f.context));
  ok("formatted pulls shell from the lineup",     f.shell === "Demo 8+");

  // no personal PM5 history is copied into club assignment docs
  const k1 = Object.keys(aLineup), k2 = Object.keys(f);
  ok("assignment doc carries no history fields",
     !k1.includes("history") && !k1.includes("results") && !k1.includes("totals"));
  ok("formatted assignment carries no history fields",
     !k2.includes("history") && !k2.includes("results") && !k2.includes("totals"));
}

// ---------------------------------------------------------------------
// 11. Performance analytics (v1.14) — pure rollups over saved history.
// ---------------------------------------------------------------------
group("performance analytics");
if (app.computePerformanceOverview && app.computePrCards && app.computeBenchmarkProgress) {
  const NOW = Date.parse("2026-07-01T12:00:00Z");
  const leg = (d, e, p, w, r, hr, dl) => ({ distanceM: d, elapsedS: e, paceS: p, watts: w, strokeRate: r, heartRate: hr, driveLengthM: dl });
  const fading = [
    leg(250,52,104,300,30,150,1.52), leg(250,52,104,298,30,152,1.51),
    leg(250,53,106,290,30,156,1.50), leg(250,53,106,285,30,160,1.49),
    leg(250,54,108,278,31,164,1.47), leg(250,55,110,270,31,168,1.45),
    leg(250,56,112,262,32,172,1.43), leg(250,57,114,255,32,176,1.42),
  ];
  const mk = (id, daysAgo, dist, elap, watts, hr, results, plan) => ({
    id, date: new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 10),
    title: "Demo " + id, plan: plan || null,
    totals: { distanceM: dist, elapsedS: elap, avgWatts: watts, avgPaceS: dist > 0 ? elap / dist * 500 : null, avgHr: hr, strokes: Math.round(elap / 2) },
    results: results || [],
  });
  const hist = [
    mk("s1", 1, 8000, 1920, 200, 150, fading),
    mk("s2", 3, 6000, 1500, 180, null, fading),
    mk("s3", 21, 10000, 2500, 210, 145, fading),
    mk("s4", 61, 5000, 1200, 190, 140, []),   // outside 30d
  ];

  // empty history → empty state, no invented data
  ok("empty history → has:false", app.computePerformanceOverview([], NOW).has === false);
  ok("empty prefs → all PR cards unset", app.computePrCards({}).every(p => p.has === false));
  ok("empty history → no benchmark progress", app.computeBenchmarkProgress([]).length === 0);

  // 7d / 30d totals
  const ov = app.computePerformanceOverview(hist, NOW);
  ok("overview has:true", ov.has === true);
  ok("7d meters = 14,000", ov.d7.meters === 14000);
  ok("7d workouts = 2", ov.d7.workouts === 2);
  ok("30d meters = 24,000 (excludes 61-day-old)", ov.d30.meters === 24000);
  ok("30d workouts = 3", ov.d30.workouts === 3);

  // averages handle missing fields (s2 has no HR)
  ok("30d split is distance-weighted", Math.abs(ov.d30.avgSplit - (5920 / 24000 * 500)) < 0.01);
  ok("30d avg watts = mean(200,180,210)", Math.abs(ov.d30.avgWatts - (200 + 180 + 210) / 3) < 0.01);
  ok("30d avg HR skips HR-less sessions", Math.abs(ov.d30.avgHr - (150 + 145) / 2) < 0.01);
  ok("best recent picked by watts (s3)", ov.best && ov.best.id === "s3");

  // PR cards format correctly
  const pr = app.computePrCards({ benchmarks: { "2k": 420, "5k": 1100 }, benchmarkMeta: { "2k": { sessionId: "x", dateISO: "2026-06-20", paceS: 105 } } });
  ok("PR cards = 8 keys", pr.length === 8 && pr.length === app.PR_KEYS.length);
  const c2k = pr.find(p => p.key === "2k");
  ok("2k PR formats time + flagged from Test", c2k.has === true && c2k.fromTest === true && /7:00/.test(c2k.resultText));
  ok("5k PR present but not from Test (no meta)", pr.find(p => p.key === "5k").fromTest === false);
  ok("unset PR → has:false", pr.find(p => p.key === "6k").has === false);

  // benchmark attempts group + improvement/direction
  const benchHist = [
    mk("b1", 40, 2000, 430, 230, 150, [], { benchKey: "2k" }),
    mk("b2", 10, 2000, 420, 240, 150, [], { benchKey: "2k" }),
  ];
  const prog = app.computeBenchmarkProgress(benchHist);
  ok("2k attempts grouped (2)", prog.length === 1 && prog[0].key === "2k" && prog[0].attempts === 2);
  ok("2k improving + positive improvement", prog[0].direction === "improving" && prog[0].improvement > 0);

  // fatigue / technique / HR handle missing data
  ok("fatigue trend over interval sessions", app.computeFatigueTrend(hist).has === true);
  ok("fatigue trend empty w/o intervals", app.computeFatigueTrend([mk("p", 1, 5000, 1200, 190, 140, [])]).has === false);
  ok("technique trend over interval sessions", app.computeTechniqueTrend(hist).has === true);
  ok("technique trend empty w/o intervals", app.computeTechniqueTrend([mk("z", 1, 5000, 1200, 190, 140, [])]).has === false);
  ok("HR summary has:true with HR", app.computeHrSummary(hist).has === true);
  const noHr = app.computeHrSummary([mk("n", 1, 5000, 1200, 190, null, [])]);
  ok("HR summary empty → pair-a-strap text", noHr.has === false && /pair a strap/i.test(noHr.text));
}

// ---------------------------------------------------------------------
// 12. Session replay readiness (v1.14.1) — honest capability detection.
// ---------------------------------------------------------------------
group("session replay readiness");
if (app.getSessionReplayCapability && app.buildIntervalReplayTimeline) {
  const cap = app.getSessionReplayCapability, tl = app.buildIntervalReplayTimeline,
        bmap = app.mapBookmarksToReplayTimeline, lim = app.summarizeReplayLimitations;
  const interval = { totals: { distanceM: 2000, elapsedS: 480 }, results: [
    { distanceM: 500, elapsedS: 120, paceS: 120, watts: 250, strokeRate: 28, heartRate: 150, driveLengthM: 1.5 },
    { distanceM: 500, elapsedS: 121, paceS: 121, watts: 248, strokeRate: 28, heartRate: 152, driveLengthM: 1.5 },
  ] };
  const summaryOnly = { totals: { distanceM: 5000, elapsedS: 1200 }, results: [] };
  const noHrSess = { totals: { distanceM: 2000, elapsedS: 480 }, results: [{ distanceM: 500, elapsedS: 120, paceS: 120, watts: 250 }] };

  // capability never exceeds what the saved data supports
  ok("null session → none", cap(null) === "none");
  ok("empty session → none", cap({ totals: {}, results: [] }) === "none");
  ok("totals only → summary-only", cap(summaryOnly) === "summary-only");
  ok("intervals → interval", cap(interval) === "interval");
  ok("capability never claims stroke/force-curve", ["none", "summary-only", "interval"].includes(cap(interval)));

  // interval timeline
  const t = tl(interval);
  ok("one timeline point per interval", t.length === 2);
  ok("cumulative distance + time accumulate", t[1].cumulativeDistanceM === 1000 && t[1].cumulativeTimeS === 241);
  ok("timeline carries HR when present", t[0].heartRate === 150);
  ok("missing HR → null (no crash)", tl(noHrSess)[0].heartRate === null);
  ok("summary-only → empty timeline", tl(summaryOnly).length === 0);

  // old / minimal sessions stay compatible (no crashes)
  ok("v1 minimal session → summary-only", cap({ schemaVersion: 1, totals: { distanceM: 2000, elapsedS: 480 } }) === "summary-only");
  ok("blank session never crashes", cap({}) === "none" && tl({}).length === 0 && bmap({}).length === 0 && lim({}).length >= 1);

  // bookmarks mapped, never invented
  ok("no bookmarks → empty map", bmap(interval).length === 0);
  const marked = Object.assign({}, interval, { bookmarks: [{ strokeIndex: 40, distanceM: 750, elapsedS: 180 }] });
  const mb = bmap(marked);
  ok("bookmark mapped to its interval", mb.length === 1 && mb[0].distanceM === 750 && mb[0].intervalIndex === 1);

  // limitations stay honest about the universal gaps
  const L = lim(interval);
  ok("limitations note no per-stroke replay", L.some(s => /stroke/i.test(s)));
  ok("limitations note no force-curve replay", L.some(s => /force/i.test(s)));
  ok("no-HR session adds an HR limitation", lim(noHrSess).some(s => /heart.?rate/i.test(s)));
}

// ---------------------------------------------------------------------
// 13. Session Replay MVP (v1.15.0) — the behaviours the replay UI relies
// on, asserted against the same pure helpers the UI consumes. Honest:
// interval/bookmark replay only, never stroke- or force-curve.
// ---------------------------------------------------------------------
group("session replay MVP");
if (app.getSessionReplayCapability && app.buildIntervalReplayTimeline) {
  const cap = app.getSessionReplayCapability, tl = app.buildIntervalReplayTimeline,
        bmap = app.mapBookmarksToReplayTimeline, lim = app.summarizeReplayLimitations,
        rate = app.sessionAvgRate;
  // 3x500m with a bookmark whose distance (1100 m) lands mid-interval.
  const session = {
    title: "2k Test", date: "2026-06-20T08:00:00Z", plan: { title: "2k Test", benchKey: "2k" },
    pr: { keys: ["2k"] },
    bookmarks: [{ strokeIndex: 60, distanceM: 1100, elapsedS: 268 }],
    totals: { distanceM: 1500, elapsedS: 360, avgPaceS: 120, avgWatts: 245, avgHr: 158, strokes: 174 },
    results: [
      { distanceM: 500, elapsedS: 118, paceS: 118, watts: 250, strokeRate: 30, heartRate: 150 },
      { distanceM: 500, elapsedS: 121, paceS: 121, watts: 244, strokeRate: 29, heartRate: 158 },
      { distanceM: 500, elapsedS: 121, paceS: 121, watts: 241, strokeRate: 28, heartRate: 165 },
    ],
  };
  const summaryOnly = { title: "Long row", totals: { distanceM: 8000, elapsedS: 1900 }, results: [] };
  const noWattsRate = { totals: { distanceM: 1000, elapsedS: 240 },
    results: [{ distanceM: 500, elapsedS: 120, paceS: 120 }, { distanceM: 500, elapsedS: 120, paceS: 120 }] };

  // entry behaviours the UI branches on
  ok("interval session → interval replay", cap(session) === "interval" && tl(session).length === 3);
  ok("summary-only session → summary-only (no timeline)", cap(summaryOnly) === "summary-only" && tl(summaryOnly).length === 0);
  ok("no usable data → none", cap({ totals: {}, results: [] }) === "none");

  // bookmark jump maps to the NEAREST interval (1100 m falls in interval 3)
  const mb = bmap(session);
  ok("bookmark maps to nearest interval", mb.length === 1 && mb[0].intervalIndex === 2);

  // resilient to missing fields (no crash, nulls not fake zeros)
  ok("missing HR → null in timeline", tl(noWattsRate)[0].heartRate === null);
  ok("missing watts/rate → null, no crash", tl(noWattsRate)[0].watts === null && tl(noWattsRate)[0].strokeRate === null);
  ok("avg rate from intervals (sessionAvgRate)", Math.round(rate(session)) === 29);
  ok("malformed/no session never crashes the UI helpers",
     cap(null) === "none" && tl(null).length === 0 && bmap(undefined).length === 0 && lim({}).length >= 1);

  // honesty guarantees the limitation panel makes
  ok("capability never claims stroke/force-curve", !["stroke", "force"].some(w => cap(session).includes(w)));
  const L = lim(session);
  ok("limitation panel discloses no stroke replay", L.some(s => /stroke/i.test(s)));
  ok("limitation panel discloses no force-curve replay", L.some(s => /force/i.test(s)));
  ok("summary-only limitation explains interval breakdown missing", lim(summaryOnly).some(s => /summary/i.test(s)));
}

// ---------------------------------------------------------------------
// 14. Stroke capture (v1.18.0) — bounded append, peak timing, budget.
// ---------------------------------------------------------------------
group("stroke capture");
if (app.strokeCaptureAppend && app.strokePeakTiming && app.enforceHistoryBudget) {
  const cs = { log: [], stride: 1, seen: 0 };
  for (let i = 0; i < 700; i++) app.strokeCaptureAppend(cs, { i }, 100);
  ok("log stays under the cap for long sessions", cs.log.length <= 100);
  ok("decimation keeps meaningful coverage", cs.log.length >= 50);
  ok("stride doubles once the cap is hit", cs.stride >= 2);
  ok("first stroke survives decimation", cs.log[0] && cs.log[0].i === 0);
  ok("recent strokes are still being recorded", cs.log[cs.log.length - 1].i > 690 - cs.stride);
  ok("every stroke was seen", cs.seen === 700);

  eqApprox("peak timing: centered peak = 0.5", app.strokePeakTiming([0, 50, 100, 50, 0]), 0.5, 0.01);
  eqApprox("peak timing: front-loaded peak", app.strokePeakTiming([0, 100, 80, 60, 40, 20, 10, 5]), 1 / 7, 0.01);
  ok("peak timing: short curve → null", app.strokePeakTiming([1, 2]) === null);
  ok("peak timing: null curve → null", app.strokePeakTiming(null) === null);

  const bulky = () => Array.from({ length: 500 }, (_, i) => ({ t: i, d: i * 10, p: 105 }));
  const hist = [
    { id: "new", strokes: bulky(), totals: { distanceM: 2000 } },
    { id: "old", strokes: bulky(), totals: { distanceM: 2000 } },
  ];
  const n = app.enforceHistoryBudget(hist, 20000);
  ok("budget strips oldest session first", n >= 1 && hist[1].strokes === undefined);
  ok("summaries survive stripping", hist[1].totals.distanceM === 2000);
  const hist2 = [{ id: "a", strokes: bulky() }];
  ok("under-budget history untouched", app.enforceHistoryBudget(hist2, 10 * 1024 * 1024) === 0 && !!hist2[0].strokes);
}

// ---------------------------------------------------------------------
// 15. Stroke replay (v1.18.0) — capability, timeline, bookmark mapping.
// ---------------------------------------------------------------------
group("stroke replay");
if (app.buildStrokeReplayTimeline && app.mapBookmarksToStrokeTimeline) {
  const mkStroke = (i, over) => Object.assign({
    t: i * 2.5, d: i * 10, p: 105, w: 200, r: 24, hr: 150,
    dl: 1.4, dt: 0.8, rt: 1.6, pf: 150, pt: 0.38,
  }, over || {});
  const strokes = Array.from({ length: 60 }, (_, i) => mkStroke(i));
  const sesh = {
    title: "Capture test", totals: { distanceM: 600, elapsedS: 150 },
    results: [{ distanceM: 300, elapsedS: 75, paceS: 105 }, { distanceM: 300, elapsedS: 75, paceS: 105 }],
    strokes,
    bookmarks: [{ strokeIndex: 30, distanceM: 296, elapsedS: 74 }],
  };
  ok("capability: captured session → stroke", app.getSessionReplayCapability(sesh) === "stroke");
  ok("capability: intervals only → interval",
    app.getSessionReplayCapability({ totals: { distanceM: 1 }, results: [{ distanceM: 300, elapsedS: 75 }] }) === "interval");
  const tl = app.buildStrokeReplayTimeline(sesh);
  ok("one point per captured stroke", tl.length === 60);
  ok("compact keys expand to full names", tl[10].distanceM === 100 && tl[10].split === 105 && tl[10].heartRate === 150);
  eqApprox("ratio derived from drive/recovery", tl[0].ratio, 2.0, 0.01);
  const noHr = app.buildStrokeReplayTimeline({ strokes: [mkStroke(0, { hr: null }), mkStroke(1, { hr: 0 })] });
  ok("missing HR → null, never 0", noHr[0].heartRate === null && noHr[1].heartRate === null);
  ok("no capture → empty timeline", app.buildStrokeReplayTimeline({ results: [] }).length === 0);
  const marks = app.mapBookmarksToStrokeTimeline(sesh);
  ok("bookmark maps to nearest stroke", marks.length === 1 && marks[0].strokePos === 30);
  ok("no bookmarks → empty", app.mapBookmarksToStrokeTimeline({ strokes }).length === 0);
  const lim = app.summarizeReplayLimitations(sesh);
  ok("stroke session limits mention session-level curves", lim.some(s => /force.?curve/i.test(s)));
  ok("stroke session limits stay honest about thinning", lim.some(s => /thinned|smoothed/i.test(s)));
}

// ---------------------------------------------------------------------
// 16. Technique drift (v1.18.0) — baseline vs recent, live analyzer.
// ---------------------------------------------------------------------
group("technique drift");
if (app.computeTechniqueDrift) {
  const mkStroke = (i, over) => Object.assign({
    t: i * 2.5, d: i * 10, p: 105, w: 200, r: 24, hr: 150,
    dl: 1.4, dt: 0.8, rt: 1.6, pf: 150, pt: 0.38,
  }, over || {});
  const steady = Array.from({ length: 60 }, (_, i) => mkStroke(i));
  const st = app.computeTechniqueDrift(steady);
  ok("steady log → stable", st.has === true && st.drifting === false);
  const fading = Array.from({ length: 60 }, (_, i) => mkStroke(i, i >= 45 ? { dl: 1.28 } : null));
  const fd = app.computeTechniqueDrift(fading);
  ok("drive-length fade detected", fd.has && fd.drifting &&
    fd.items.some(x => x.key === "driveLen" && x.tone === "warn"));
  const rushed = Array.from({ length: 60 }, (_, i) => mkStroke(i, i >= 45 ? { rt: 1.1 } : null));
  const rd = app.computeTechniqueDrift(rushed);
  ok("collapsing ratio detected", rd.has && rd.drifting &&
    rd.items.some(x => x.key === "ratio" && x.tone === "warn"));
  ok("too few strokes → has:false", app.computeTechniqueDrift(steady.slice(0, 30)).has === false);
  ok("null-tolerant", app.computeTechniqueDrift(null).has === false);
}

// ---------------------------------------------------------------------
// 17. Efficiency score (v1.18.0) — explained 0-100, never invented.
// ---------------------------------------------------------------------
group("efficiency score");
if (app.computeEfficiencyScore && app.computeEfficiencyTrend) {
  const mkStroke = (i) => ({ t: i * 2.5, d: i * 10, p: 105, w: 200, r: 24, hr: 150,
    dl: 1.4, dt: 0.8, rt: 1.6, pf: 150, pt: 0.38 });
  const strokes = Array.from({ length: 60 }, (_, i) => mkStroke(i));
  const smooth = Array.from({ length: 64 }, (_, i) => Math.sin(Math.PI * i / 63) * 150);
  const jagged = Array.from({ length: 64 }, (_, i) => Math.sin(Math.PI * i / 63) * 150 + (i % 2 ? 18 : -18));
  const good = app.computeEfficiencyScore({ strokes, fc: { avg: smooth, best: smooth, peak: 150, n: 60 } });
  ok("clean session scores high", good.has && good.score >= 85);
  ok("all four components present", good.components.length === 4);
  ok("weights are disclosed", good.components.every(c => c.weight > 0 && c.detail));
  ok("explanation names the formula", /curve smoothness/i.test(good.explanation));
  const rough = app.computeEfficiencyScore({ strokes, fc: { avg: jagged, peak: 150, n: 60 } });
  ok("jagged curve scores lower", rough.has && rough.score < good.score);
  const strokesOnly = app.computeEfficiencyScore({ strokes });
  ok("strokes without curves still score", strokesOnly.has &&
    strokesOnly.components.every(c => c.key !== "curve"));
  ok("no capture → has:false (never invented)", app.computeEfficiencyScore({ totals: { distanceM: 2000 } }).has === false);
  ok("null-tolerant", app.computeEfficiencyScore(null).has === false);
  const trend = app.computeEfficiencyTrend([
    { id: "a", title: "A", date: "2026-06-30", strokes },
    { id: "b", title: "B", date: "2026-06-29", totals: {} },   // no capture — skipped
  ]);
  ok("trend counts only captured sessions", trend.has && trend.n === 1);
}

// ---------------------------------------------------------------------
// 18. Session compare (v1.18.0) — delta table + curve passthrough.
// ---------------------------------------------------------------------
group("session compare");
if (app.buildSessionComparison) {
  const leg = (d, e, p, w) => ({ distanceM: d, elapsedS: e, paceS: p, watts: w,
    strokeRate: 28, heartRate: 150, driveLengthM: 1.4, peakForceLbs: 150 });
  const sesh = (id, split, watts, fc) => ({
    id, title: id, date: "2026-07-01T12:00:00Z",
    totals: { distanceM: 2000, elapsedS: split * 4, avgPaceS: split, avgWatts: watts, avgHr: 150, strokes: 200 },
    results: [leg(1000, split * 2, split, watts), leg(1000, split * 2, split, watts)],
    fc,
  });
  const slow = sesh("slow", 110, 180, { avg: [10, 50, 10], best: [10, 60, 10], peak: 60, n: 100 });
  const fast = sesh("fast", 105, 205, null);
  const cmp = app.buildSessionComparison(slow, fast);
  ok("comparison builds", cmp.has === true);
  const splitRow = cmp.rows.find(r => r.label === "Avg split");
  ok("lower split wins for B", splitRow && splitRow.better === "b");
  const wattsRow = cmp.rows.find(r => r.label === "Avg watts");
  ok("higher watts wins for B", wattsRow && wattsRow.better === "b");
  ok("neutral facts aren't scored", cmp.rows.find(r => r.label === "Distance").better === null);
  ok("delta is signed", /^[+−]/.test(splitRow.deltaText));
  ok("curves pass through with their kind", cmp.curves.a && cmp.curves.aKind === "avg" && cmp.curves.b === null);
  ok("null input → has:false", app.buildSessionComparison(null, fast).has === false);
}

// ---------------------------------------------------------------------
// 19. Smart targets + training report (v1.18.0).
// ---------------------------------------------------------------------
group("smart targets + report");
if (app.benchmarkPaceOf && app.suggestTargetsForPlan && app.buildTrainingReport) {
  eqApprox("2k PR 7:00 → 1:45 split", app.benchmarkPaceOf("2k", { benchmarks: { "2k": 420 } }), 105, 0.01);
  eqApprox("30min 7500m → 2:00 split", app.benchmarkPaceOf("30min", { benchmarks: { "30min": 7500 } }), 120, 0.01);
  ok("missing PR → null", app.benchmarkPaceOf("2k", { benchmarks: {} }) === null);

  const plan = { intervals: [
    { kind: "distance", value: 250, restS: 60 },
    { kind: "distance", value: 5000, restS: 0 },
    { kind: "time", value: 120, restS: 60 },
  ] };
  const sug = app.suggestTargetsForPlan(plan, { benchmarks: { "2k": 420 } });
  ok("suggestions build from the 2k PR", sug.has && sug.refKey === "2k");
  eqApprox("sprint interval under 2k pace", sug.targets[0].targetPaceS, 102, 0.6);
  eqApprox("long interval well over 2k pace", sug.targets[1].targetPaceS, 121, 0.6);
  eqApprox("time interval sized at 2k pace", sug.targets[2].targetPaceS, 104, 0.6);
  ok("no PRs → honest refusal", app.suggestTargetsForPlan(plan, { benchmarks: {} }).reason === "no-prs");
  ok("no intervals → honest refusal", app.suggestTargetsForPlan({ intervals: [] }, { benchmarks: { "2k": 420 } }).reason === "no-intervals");

  const NOWR = Date.parse("2026-07-01T12:00:00Z");
  const rep = app.buildTrainingReport([
    { id: "r1", title: "Steady", date: "2026-06-30T10:00:00Z",
      totals: { distanceM: 8000, elapsedS: 2000, avgPaceS: 125, avgWatts: 170, avgHr: 150 },
      results: [] },
  ], { benchmarks: { "2k": 420 }, benchmarkMeta: { "2k": { sessionId: "x", dateISO: "2026-06-01", distanceM: 2000, elapsedS: 420, paceS: 105 } } }, NOWR);
  ok("report has a title", /# RowTrace — Training report/.test(rep));
  ok("report rolls up the week", /Last 7 days/.test(rep) && /8,000 m/.test(rep));
  ok("report lists PRs", /Personal records/.test(rep) && /2k/.test(rep));
}

// ---------------------------------------------------------------------
// 20. Security regressions (v1.18.0) — escaping + untrusted-input
// sanitization. These lock in the security-pass fixes.
// ---------------------------------------------------------------------
group("security");
if (app.fbEsc && app.sanitizeStrokeLog && app.sanitizeSessionCurves && app.importSessionsFromText) {
  ok("fbEsc neutralises markup", app.fbEsc('<img src=x onerror=alert(1)>&"') === "&lt;img src=x onerror=alert(1)&gt;&amp;\"");
  ok("fbEsc tolerates null/undefined", app.fbEsc(null) === "" && app.fbEsc(undefined) === "");

  const hostileStrokes = [
    { t: 1, d: 10, p: 105, evil: "<img onerror=alert(1)>", __proto__: { hacked: true } },
    { t: 2, d: 20, hr: 9999, pf: -5, pt: 3 },
    "not-an-object", null,
    { t: NaN, d: Infinity },
  ];
  const clean = app.sanitizeStrokeLog(hostileStrokes);
  ok("sanitizer keeps only whitelisted numeric fields",
    clean && clean.every(s => Object.keys(s).every(k => ["t","d","p","w","r","hr","dl","dt","rt","pf","pt"].includes(k))));
  ok("sanitizer drops injected keys", clean && clean.every(s => !("evil" in s) && !("hacked" in s)));
  ok("sanitizer nulls out-of-range values", clean && clean[1].hr === null && clean[1].pf === null && clean[1].pt === null);
  ok("sanitizer drops non-object and non-finite rows", clean && clean.length === 2);
  ok("sanitizer caps length", app.sanitizeStrokeLog(Array.from({ length: 5000 }, (_, i) => ({ t: i, d: i })), 2000).length === 2000);
  ok("sanitizer returns null for garbage", app.sanitizeStrokeLog("junk") === null && app.sanitizeStrokeLog([{}]) === null);

  const fc = app.sanitizeSessionCurves({ best: Array.from({ length: 500 }, () => 1e9), avg: [10, "x", 20], peak: -50, n: 2.7, extra: "nope" });
  ok("curve sanitizer caps + clamps", fc && fc.best.length === 128 && fc.best[0] === 2000);
  ok("curve sanitizer zeroes non-numbers", fc && fc.avg[1] === 0);
  ok("curve sanitizer clamps peak and rounds n", fc && fc.peak === 0 && fc.n === 3);
  ok("curve sanitizer drops unknown keys", fc && !("extra" in fc));
  ok("curve sanitizer rejects garbage", app.sanitizeSessionCurves("x") === null && app.sanitizeSessionCurves({}) === null);

  // Hostile import end-to-end: markup titles stay inert data, bulk is
  // capped, v1.18 fields arrive sanitized.
  app.state.history = [];
  const hostile = {
    kind: "pm5-history-export",
    history: [{
      id: "h1", title: "<script>alert(1)</script>", description: { toString: () => "obj" },
      totals: { distanceM: 1000, elapsedS: 240 },
      results: [], strokes: hostileStrokes, fc: { best: [1, 2, 3], avg: "junk" },
    }],
  };
  const n = app.importSessionsFromText(JSON.stringify(hostile));
  ok("hostile import still imports (as data)", n === 1);
  const imported = app.state.history[0];
  ok("imported title is a plain bounded string", typeof imported.title === "string" && imported.title.includes("<script>"));
  ok("imported strokes are sanitized", imported.strokes && imported.strokes.length === 2 && !("evil" in imported.strokes[0]));
  ok("imported fc is sanitized", imported.fc && imported.fc.best.length === 3 && !imported.fc.avg);
  app.state.history = [];
  const flood = { kind: "pm5-history-export", history: Array.from({ length: 2500 }, (_, i) => ({ id: "f" + i, totals: { distanceM: 100, elapsedS: 30 }, results: [] })) };
  ok("import volume is capped", app.importSessionsFromText(JSON.stringify(flood)) <= 2000);
  app.state.history = [];
}

// ---------------------------------------------------------------------
// 21. Import bounds (v1.18.1) — the remaining per-entry collections are
// whitelisted, capped, and coerced; malformed pieces are discarded.
// ---------------------------------------------------------------------
group("import bounds");
if (app.sanitizeResultRows && app.sanitizeBookmarks && app.sanitizeTags &&
    app.sanitizeImportedPr && app.sanitizeImportedPlan && app.sanitizeImportedTotals) {
  // Oversized arrays are capped.
  const bigResults = Array.from({ length: 1000 }, (_, i) => ({ distanceM: 100, elapsedS: 30, label: "leg " + i }));
  ok("results capped at IMPORT_MAX_RESULTS", app.sanitizeResultRows(bigResults).length === app.IMPORT_MAX_RESULTS);
  const bigMarks = Array.from({ length: 500 }, (_, i) => ({ distanceM: i * 10 }));
  ok("bookmarks capped at IMPORT_MAX_BOOKMARKS", app.sanitizeBookmarks(bigMarks).length === app.IMPORT_MAX_BOOKMARKS);
  ok("tags capped at IMPORT_MAX_TAGS", app.sanitizeTags(Array.from({ length: 100 }, (_, i) => "t" + i)).length === app.IMPORT_MAX_TAGS);

  // Malformed entries are discarded, not preserved.
  const rows = app.sanitizeResultRows([
    { distanceM: 500, elapsedS: 120, paceS: 120, watts: 180, strokeRate: 26, heartRate: 150, restS: 60, driveLengthM: 1.4, peakForceLbs: 150, label: "500m", intervalIdx: 1 },
    { paceS: 120 },                      // no time/distance → dropped
    "junk", null, 42,                    // non-objects → dropped
    { distanceM: NaN, elapsedS: Infinity },
  ]);
  ok("malformed result rows discarded", rows.length === 1);
  ok("valid result row preserved exactly", rows[0].distanceM === 500 && rows[0].paceS === 120 &&
    rows[0].driveLengthM === 1.4 && rows[0].label === "500m" && rows[0].intervalIdx === 1);

  // Unknown properties are stripped; hostile nested objects don't survive.
  const dirty = app.sanitizeResultRows([{ distanceM: 100, elapsedS: 30, evil: "<x>", nested: { a: 1 }, label: { toString: () => "obj" } }])[0];
  ok("unknown result props stripped", !("evil" in dirty) && !("nested" in dirty));
  ok("object-valued label rejected, not coerced", dirty.label === "");
  const bm = app.sanitizeBookmarks([{ distanceM: 100, hacked: {}, label: "x".repeat(500) }])[0];
  ok("unknown bookmark props stripped", !("hacked" in bm));
  ok("bookmark label truncated", bm.label.length === app.IMPORT_MAX_BOOKMARK_LABEL_LEN);
  ok("tag strings truncated", app.sanitizeTags(["y".repeat(300)])[0].length === app.IMPORT_MAX_TAG_LEN);
  ok("object tags dropped", app.sanitizeTags([{ evil: 1 }, ["arr"], "ok"]).length === 1);

  // PR / plan / totals whitelisting.
  ok("pr keys restricted to real benchmarks",
    app.sanitizeImportedPr({ keys: ["2k", "<img>", "bogus"], achievement: { "2k": 420, "<img>": 1 }, delta: "junk" }).keys.join() === "2k");
  ok("pr with no valid keys dropped whole", app.sanitizeImportedPr({ keys: [{}, "nope"] }) === null);
  const plan = app.sanitizeImportedPlan({ title: "T".repeat(500), benchKey: "evil", intervals: [
    { kind: "distance", value: 500, restS: 60, junk: true }, { kind: "weird", value: 100 }, "junk",
    ...Array.from({ length: 300 }, () => ({ kind: "time", value: 60 })) ] });
  ok("plan title bounded + bad benchKey dropped", plan.title.length === 300 && !("benchKey" in plan));
  // 303 candidates slice to 200, of which 2 are invalid → 198 survive.
  ok("plan intervals whitelisted + capped", plan.intervals.length === 198 && !("junk" in plan.intervals[0]));
  const tot = app.sanitizeImportedTotals({ distanceM: 2000, elapsedS: 480, avgHr: 9999, avgWatts: { evil: 1 }, extra: "x" });
  ok("totals numeric whitelist", tot.distanceM === 2000 && tot.avgHr === null && tot.avgWatts === null && !("extra" in tot));

  // Valid imports remain unchanged end-to-end; input object not mutated.
  app.state.history = [];
  const good = {
    kind: "pm5-history-export",
    history: [{ id: "OK-1", date: "2026-07-01T10:00:00Z", title: "5x500", schemaVersion: 2,
      totals: { distanceM: 2500, elapsedS: 600, avgPaceS: 120, avgWatts: 180, avgHr: 152, strokes: 260 },
      results: Array.from({ length: 5 }, (_, i) => ({ intervalIdx: i + 1, label: "500m", distanceM: 500, elapsedS: 120, paceS: 120, watts: 180, strokeRate: 26, heartRate: 150, restS: 60, driveLengthM: 1.4, peakForceLbs: 150 })),
      bookmarks: [{ strokeIndex: 30, distanceM: 750, elapsedS: 180 }],
      tags: ["test", "steady-state"], notes: "felt strong", rating: 8 }],
  };
  const goodJson = JSON.stringify(good);
  ok("valid import accepted", app.importSessionsFromText(goodJson) === 1);
  const ge = app.state.history[0];
  ok("valid results unchanged", ge.results.length === 5 && ge.results[2].watts === 180 && ge.results[2].label === "500m");
  ok("valid bookmarks/tags/notes/rating unchanged",
    ge.bookmarks.length === 1 && ge.bookmarks[0].strokeIndex === 30 &&
    ge.tags.join() === "test,steady-state" && ge.notes === "felt strong" && ge.rating === 8);
  ok("original import object not mutated", JSON.stringify(good) === goodJson);

  // Hostile end-to-end: markup/script payloads stay inert data.
  app.state.history = [];
  app.importSessionsFromText(JSON.stringify({ kind: "pm5-history-export", history: [{
    id: "EVIL-1", title: "<script>x</script>", totals: { distanceM: 100, elapsedS: 30 },
    results: [{ distanceM: 100, elapsedS: 30, label: "<img onerror=x>" }],
    bookmarks: [{ distanceM: 50, label: "<svg onload=x>" }],
    tags: ["<b>tag</b>"], notes: { evil: true }, rating: "11", pr: { keys: ["<x>"] },
    plan: { title: "<script>", intervals: { not: "array" } } }] }));
  const ev = app.state.history[0];
  ok("hostile strings stay plain strings", typeof ev.title === "string" && typeof ev.results[0].label === "string" &&
    typeof ev.bookmarks[0].label === "string" && typeof ev.tags[0] === "string");
  ok("hostile objects don't survive", !("notes" in ev) && !("rating" in ev) && !("pr" in ev) && ev.plan.intervals.length === 0);
  app.state.history = [];
}

// ---------------------------------------------------------------------
// 22. Curve intelligence (v1.19.0) — shape metrics, similarity, drift
// hysteresis. All fixtures are deterministic synthetic curves.
// ---------------------------------------------------------------------
group("curve intelligence");
if (app.curveShapeMetrics && app.curveSimilarity && app.applyDriftHysteresis) {
  // Deterministic fixtures: smooth bells with a controllable peak position.
  const bell = (peak, at, n) => Array.from({ length: n || 64 }, (_, i) => {
    const x = i / ((n || 64) - 1);
    const ph = x < at ? x / (2 * at) : 0.5 + (x - at) / (2 * (1 - at));
    return peak * Math.pow(Math.sin(Math.PI * ph), 1.4);
  });
  const centered = bell(150, 0.5);
  const front = bell(150, 0.33);
  const noisy = centered.map((v, i) => v + (i % 2 ? 12 : -12));

  const shC = app.curveShapeMetrics(centered);
  eqApprox("centered bell: peak position ~0.5", shC.peakPos, 0.5, 0.02);
  eqApprox("centered bell: front-load ~0.5", shC.frontLoad, 0.5, 0.04);
  ok("centered bell: smooth", shC.smoothness >= 85);
  ok("centered bell: peak preserved", Math.abs(shC.peak - 150) < 1);
  const shF = app.curveShapeMetrics(front);
  ok("front-shifted bell: earlier peak, higher front-load",
    shF.peakPos < 0.4 && shF.frontLoad > shC.frontLoad);
  ok("noisy curve scores less smooth", app.curveShapeMetrics(noisy).smoothness < shC.smoothness);
  ok("shape metrics: garbage → null",
    app.curveShapeMetrics(null) === null && app.curveShapeMetrics([1, 2, 3]) === null &&
    app.curveShapeMetrics(new Array(64).fill(0)) === null);

  ok("similarity: identical curves = 100", app.curveSimilarity(centered, centered) === 100);
  ok("similarity: scaled copy = 100 (shape, not power)",
    app.curveSimilarity(centered, centered.map(v => v * 2)) === 100);
  const simFront = app.curveSimilarity(centered, front);
  ok("similarity: shifted shape scores lower but sane", simFront > 50 && simFront < 100);
  ok("similarity: different sample counts align", app.curveSimilarity(bell(150, 0.5, 30), centered) >= 99);
  ok("similarity: unusable input → null",
    app.curveSimilarity(null, centered) === null && app.curveSimilarity([1], centered) === null);

  // Drift hysteresis: one noisy evaluation must not flip the card.
  const drifting = { has: true, drifting: true, items: [], headline: "Drive shortened" };
  const stable = { has: true, drifting: false, items: [], headline: "Technique stable" };
  let s = null;
  s = app.applyDriftHysteresis(s, drifting);
  ok("1st drifting eval does not latch", s.drifting === false);
  s = app.applyDriftHysteresis(s, drifting);
  ok("2nd drifting eval does not latch", s.drifting === false);
  s = app.applyDriftHysteresis(s, drifting);
  ok("3rd consecutive drifting eval latches", s.drifting === true);
  s = app.applyDriftHysteresis(s, stable);
  ok("one stable eval does not clear the latch", s.drifting === true);
  ok("latched headline explains the drift, not 'stable'", /shortened/i.test(s.headline));
  s = app.applyDriftHysteresis(s, stable);
  s = app.applyDriftHysteresis(s, stable);
  ok("3 consecutive stable evals clear the latch", s.drifting === false);
  let n2 = app.applyDriftHysteresis(null, drifting);
  n2 = app.applyDriftHysteresis(n2, stable);
  n2 = app.applyDriftHysteresis(n2, drifting);
  n2 = app.applyDriftHysteresis(n2, drifting);
  ok("interrupted streaks never latch", n2.drifting === false);
  ok("insufficient data resets cleanly", app.applyDriftHysteresis(s, { has: false }).has === false);

  // Efficiency transparency: unscored components are listed with a why.
  const mkStroke = i => ({ t: i * 2.5, d: i * 10, p: 105, w: 200, r: 24, hr: 150,
    dl: 1.4, dt: 0.8, rt: 1.6, pf: 150, pt: 0.38 });
  const noCurves = app.computeEfficiencyScore({ strokes: Array.from({ length: 60 }, (_, i) => mkStroke(i)) });
  ok("efficiency lists unscored components", noCurves.has &&
    noCurves.missing.some(m => m.key === "curve" && /no session curves/i.test(m.why)));

  // Reference-curve loader: newest session with curves wins; avg preferred.
  app.state.history = [
    { id: "n1", date: "2026-07-18T10:00:00Z", totals: {} },                       // no curves
    { id: "n2", date: "2026-07-17T10:00:00Z", fc: { avg: centered, best: front, peak: 150, n: 50 }, totals: {} },
    { id: "n3", date: "2026-07-10T10:00:00Z", fc: { best: front }, totals: {} },
  ];
  app.loadReferenceCurve();
  ok("reference loader picks newest session's avg curve", app.state.refCurve === app.state.history[1].fc.avg);
  app.state.history = [];
  app.loadReferenceCurve();
  ok("reference loader clears when history is empty", app.state.refCurve === null);
}

// ---------------------------------------------------------------------
// 23. Baseline engine (v1.20.0) — deterministic synthetic fixtures.
// ---------------------------------------------------------------------
group("baseline engine");
if (app.strokeStatsOf && app.resolveBaseline && app.buildRollingBaseline) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, i) => {
    const x = i / 63; const ph = x < at ? x / (2 * at) : 0.5 + (x - at) / (2 * (1 - at));
    return Math.round(peak * Math.pow(Math.sin(Math.PI * ph), 1.4) * 10) / 10;
  });
  const mkStrokes = (n, over) => Array.from({ length: n }, (_, i) => Object.assign({
    t: i * 2.5, d: i * 11, p: 118, w: 190, r: 25, hr: 148,
    dl: 1.42, dt: 0.8, rt: 1.6, pf: 145, pt: 0.38 }, over || {}));
  const mkSesh = (id, daysOld, dist, over) => Object.assign({
    id, date: new Date(Date.parse("2026-07-01T10:00:00Z") - daysOld * 86400000).toISOString(),
    title: id, totals: { distanceM: dist, elapsedS: dist / 500 * 118 },
    results: [], strokes: mkStrokes(60),
    fc: { avg: bell(140, 0.38), best: bell(155, 0.38), peak: 155, n: 60 } }, over || {});

  const stats = app.strokeStatsOf(mkStrokes(60));
  ok("stroke stats: means computed", Math.abs(stats.dl.mean - 1.42) < 0.001 && Math.abs(stats.ratio.mean - 2.0) < 0.001);
  ok("stroke stats: zero-variance cv ≈ 0", stats.dl.cv < 0.001);
  ok("stroke stats: insufficient → null", app.strokeStatsOf(mkStrokes(5)) === null && app.strokeStatsOf(null) === null);

  ok("compatible: same benchmark", app.sessionsCompatible(
    { plan: { benchKey: "2k" }, totals: {} }, { plan: { benchKey: "2k" }, totals: {} }));
  ok("incompatible: different benchmark", !app.sessionsCompatible(
    { plan: { benchKey: "2k" }, totals: {} }, { plan: { benchKey: "10k" }, totals: {} }));
  ok("compatible: distance within 20%", app.sessionsCompatible(
    { totals: { distanceM: 2000 } }, { totals: { distanceM: 2300 } }));
  ok("incompatible: distance beyond 20%", !app.sessionsCompatible(
    { totals: { distanceM: 2000 } }, { totals: { distanceM: 6000 } }));

  const b1 = app.buildBaselineFromEntry(mkSesh("A", 1, 2000));
  ok("entry baseline built with curve+stats", b1.curve.length === 64 && b1.stats.dl.mean > 1.4 && b1.n === 60);
  ok("entry baseline confidence explains itself", /strokes/.test(b1.confidence.why));

  const hist = [mkSesh("r1", 1, 2000), mkSesh("r2", 3, 2100), mkSesh("r3", 5, 1950), mkSesh("far", 7, 9000)];
  const histSnapshot = JSON.stringify(hist);
  const roll = app.buildRollingBaseline(hist, null, 5);
  ok("rolling baseline pools only compatible sessions", roll.label.includes("3 sessions"));
  ok("rolling baseline averages curves at 64 samples", roll.curve.length === 64);
  ok("rolling baseline date range spans the pool", roll.dateRange.from < roll.dateRange.to);
  ok("rolling baseline is high confidence with 3×60 strokes", roll.confidence.level === "high");
  ok("baseline building does not mutate history", JSON.stringify(hist) === histSnapshot);
  ok("rolling baseline needs ≥2 sessions", app.buildRollingBaseline([mkSesh("solo", 1, 2000)], null, 5) === null);

  const wobble = mkStrokes(80).map((s, i) => (i >= 30 && i < 50) ? s : { ...s, p: 118 + (i % 7) });
  const sect = app.bestConsistentSection(wobble, 20);
  ok("steadiest section found inside the calm window", sect.label.includes("stroke 3"));
  ok("section baseline needs enough strokes", app.bestConsistentSection(mkStrokes(20), 20) === null);

  const iv = app.baselineFromInterval({ results: [{ distanceM: 330 }, { distanceM: 330 }],
    strokes: mkStrokes(60) }, 1);
  ok("interval baseline windows by distance", iv && iv.n > 10 && iv.label === "interval 2");

  ok("resolve: off → null", app.resolveBaseline("off", { history: hist }) === null);
  const locked = app.resolveBaseline("locked", { lockedBaseline: { curve: bell(150, 0.4), stats: stats, n: 60, label: "locked 2026-06-30", date: "2026-06-30" } });
  ok("resolve: locked honoured with label", locked.source === "locked" && /locked/.test(locked.label));
  ok("resolve: locked missing → null", app.resolveBaseline("locked", {}) === null);
  const auto = app.resolveBaseline("auto", { history: hist });
  ok("resolve: auto = newest capture-bearing session", auto && auto.label === "r1");
  const autoCompat = app.resolveBaseline("auto", { history: hist, currentEntryLike: { totals: { distanceM: 9100 } } });
  ok("resolve: auto respects compatibility with current work", autoCompat && autoCompat.label === "far");
}

// ---------------------------------------------------------------------
// 24. Live cues (v1.20.0) — cue detection + governor discipline.
// ---------------------------------------------------------------------
group("live cues");
if (app.computeLiveCues && app.applyCueGovernor) {
  const mkStrokes = (n, mut) => Array.from({ length: n }, (_, i) => {
    const s = { t: i * 2.5, d: i * 11, p: 118, w: 190, r: 25, hr: 148,
      dl: 1.42, dt: 0.8, rt: 1.6, pf: 145, pt: 0.38 };
    return mut ? mut(s, i) : s;
  });
  ok("too few strokes → no cues", app.computeLiveCues(mkStrokes(30), null, {}).cues.length === 0);
  ok("steady rowing → no cues", app.computeLiveCues(mkStrokes(80), null, {}).cues.length === 0);
  const shortDl = mkStrokes(80, (s, i) => i >= 65 ? { ...s, dl: 1.30 } : s);
  const c1 = app.computeLiveCues(shortDl, null, {});
  ok("drive-length cue fires with delta + baseline", c1.cues.length &&
    c1.cues[0].id === "driveLen" && /8\.\d%/.test(c1.cues[0].text) && /early strokes|session start/.test(c1.cues[0].baselineLabel));
  const baseline = { label: "rolling · 3 sessions", curve: null,
    stats: { dl: { mean: 1.5, cv: 2 }, ratio: { mean: 2.0, cv: 3 }, pace: { mean: 118, cv: 2 }, rate: { mean: 25, cv: 2 }, n: 180 } };
  const c2 = app.computeLiveCues(mkStrokes(80), baseline, {});
  ok("baseline stats change the reference (1.42 vs 1.5 → cue)", c2.cues.some(c => c.id === "driveLen" && c.baselineLabel === baseline.label));
  // 1.42 vs 1.48 = −4.05%: over the normal 3% threshold, under the
  // relaxed 4.5% threshold — exactly what sensitivity should gate.
  const nearBaseline = { ...baseline, stats: { ...baseline.stats, dl: { mean: 1.48, cv: 2 } } };
  ok("normal sensitivity flags a −4% drive change", app.computeLiveCues(mkStrokes(80), nearBaseline, {}).cues.some(c => c.id === "driveLen"));
  ok("low sensitivity suppresses the same change", app.computeLiveCues(mkStrokes(80), nearBaseline, { sensitivity: "low" }).cues.every(c => c.id !== "driveLen"));
  const fade = mkStrokes(90, (s, i) => i >= 70 ? { ...s, p: 123, r: 27.5 } : s);
  ok("pace-fade-with-rate-rise detected", app.computeLiveCues(fade, null, {}).cues.some(c => c.id === "paceFade"));

  // Governor: latch, single cue, cooldown, recovery, quiet.
  const drift = { cues: [{ id: "driveLen", priority: 1, text: "Drive Length shortened 5.0%", confidence: "medium" },
                         { id: "ratio", priority: 2, text: "Ratio collapsed 15%", confidence: "medium" }] };
  const calm = { cues: [] };
  let g = null;
  g = app.applyCueGovernor(g, drift, {}); ok("eval 1: nothing shown yet", g.active === null);
  g = app.applyCueGovernor(g, drift, {}); ok("eval 2: still nothing", g.active === null);
  g = app.applyCueGovernor(g, drift, {});
  ok("eval 3: highest-priority cue latches alone", g.active && g.active.id === "driveLen" && g.event && g.event.startEval);
  g = app.applyCueGovernor(g, drift, {});
  ok("sustained cue persists and counts evals", g.active.persistEvals === 4 && !g.event);
  g = app.applyCueGovernor(g, calm, {});
  ok("one calm eval doesn't clear (hysteresis)", g.active !== null);
  g = app.applyCueGovernor(g, calm, {}); g = app.applyCueGovernor(g, calm, {});
  ok("3 calm evals clear + emit end event + start cooldown", g.active === null && g.event && g.event.endEval && g.cooldown.driveLen > 0);
  g = app.applyCueGovernor(g, drift, {}); g = app.applyCueGovernor(g, drift, {}); g = app.applyCueGovernor(g, drift, {});
  ok("cooldown suppresses an immediate refire of the same cue; next cue takes over",
    g.active && g.active.id === "ratio");
  let q = app.applyCueGovernor(null, drift, { quiet: true });
  q = app.applyCueGovernor(q, drift, { quiet: true }); q = app.applyCueGovernor(q, drift, { quiet: true });
  ok("quiet mode never surfaces a cue", q.active === null);
}
if (app.sanitizeDriftEvents) {
  const evs = app.sanitizeDriftEvents([
    { t: 120, d: 500, id: "driveLen", text: "<b>Drive</b> shortened", tEnd: 180, evil: {} },
    { t: NaN }, "junk", ...Array.from({ length: 80 }, (_, i) => ({ t: i, id: "x", text: "y" })),
  ]);
  // 83 candidates slice to 50, of which 2 are invalid → 48 survive.
  ok("drift events sanitized: whitelist + cap", evs.length === 48 && !("evil" in evs[0]) && evs[0].tEnd === 180);
  ok("drift events: markup stays inert string data", typeof evs[0].text === "string" && evs[0].text.includes("<b>"));
  ok("drift events: garbage → null", app.sanitizeDriftEvents("x") === null && app.sanitizeDriftEvents([{}]) === null);
}

// ---------------------------------------------------------------------
// 25. Race Lab (v1.20.0) — plan construction, live status, debrief.
// ---------------------------------------------------------------------
group("race lab");
if (app.buildRacePlan && app.computeRaceStatus && app.computeRaceDebrief) {
  const plan = app.buildRacePlan(2000, "even", 105);
  ok("plan built with the classic phases", plan.segments.map(s => s.phase).join(",") === "start,settle,base,sprint");
  ok("segments tile the full distance", plan.segments[0].fromM === 0 &&
    plan.segments.every((s, i) => i === 0 || s.fromM === plan.segments[i - 1].toM) &&
    plan.segments[plan.segments.length - 1].toM === 2000);
  ok("start and sprint are faster than base", plan.segments[0].targetPaceS < 105 &&
    plan.segments[plan.segments.length - 1].targetPaceS < 105);
  const evenT = plan.predictedFinishS;
  eqApprox("predicted finish is segment arithmetic", evenT,
    plan.segments.reduce((a, s) => a + (s.toM - s.fromM) / 500 * s.targetPaceS, 0), 0.11);
  const neg = app.buildRacePlan(2000, "negative", 105);
  ok("negative split: second half faster than first", neg.segments.some(s => s.phase === "push") &&
    neg.segments.find(s => s.phase === "push").targetPaceS < neg.segments.find(s => s.phase === "base").targetPaceS);
  ok("custom distance works", app.buildRacePlan(3500, "even", 110).segments.slice(-1)[0].toM === 3500);
  ok("invalid inputs → null", app.buildRacePlan(100, "even", 105) === null && app.buildRacePlan(2000, "even", 20) === null);
  const ivs = app.racePlanToIntervals(plan);
  ok("plan converts to plain intervals", ivs.length === plan.segments.length &&
    ivs.every(iv => iv.kind === "distance" && iv.targetPaceS > 0 && iv.restS === 0));

  eqApprox("plan time at 1000 m", app.planTimeAtDistance(plan, 1000),
    (100 / 500) * 101 + (200 / 500) * 106 + (700 / 500) * 105, 0.11);
  const behind = app.computeRaceStatus(plan, 1000, app.planTimeAtDistance(plan, 1000) + 4, 106);
  ok("behind detected with projection", behind.status === "behind" && behind.deltaS >= 3.9 &&
    behind.projectedFinishS > 0 && behind.segment.phase === "base");
  const ahead = app.computeRaceStatus(plan, 1000, app.planTimeAtDistance(plan, 1000) - 4, 104);
  ok("ahead detected", ahead.status === "ahead" && ahead.deltaS <= -3.9);
  ok("on-plan band is ±1.5s", app.computeRaceStatus(plan, 1000, app.planTimeAtDistance(plan, 1000) + 1, 105).status === "on");

  // Debrief over a synthetic race: on plan early, fades in base, sprints.
  const raceStrokes = [];
  for (let d = 5, t = 0; d < 2000; d += 10) {
    const seg = app.raceSegmentAt(plan, d).seg;
    let pace = seg.targetPaceS;
    if (seg.phase === "base" && d > 1000) pace += 3;          // mid-race fade
    if (seg.phase === "sprint") pace -= 1;
    t += 10 / 500 * pace;
    raceStrokes.push({ t: Math.round(t * 10) / 10, d, p: pace, w: 200, r: 28, hr: 165,
      dl: d > 1000 && d < 1750 ? 1.34 : 1.42, dt: 0.75, rt: 1.5, pf: 150, pt: 0.4 });
  }
  const entry = { plan: { title: "2k race", race: plan },
    totals: { distanceM: 2000, elapsedS: raceStrokes[raceStrokes.length - 1].t },
    strokes: raceStrokes, results: [] };
  const snapshot = JSON.stringify(entry);
  const rd = app.computeRaceDebrief(entry);
  ok("debrief builds per-segment actuals", rd.has && rd.segments.length === plan.segments.length &&
    rd.segments.every(s => s.actualPaceS > 0));
  ok("time lost concentrates in the faded base", rd.segments.find(s => s.phase === "base").deltaS > 1);
  ok("sprint shows a gain or near-plan", rd.segments.find(s => s.phase === "sprint").deltaS < 1);
  ok("findings are capped at three and prioritized", rd.findings.length >= 1 && rd.findings.length <= 3);
  ok("estimate methodology is attached", /estimate relative to this race plan/i.test(rd.method));
  ok("debrief does not mutate the entry", JSON.stringify(entry) === snapshot);
  ok("no race meta → has:false", app.computeRaceDebrief({ plan: {}, strokes: raceStrokes }).has === false);
  ok("too few strokes → has:false", app.computeRaceDebrief({ plan: { race: plan }, strokes: raceStrokes.slice(0, 5) }).has === false);

  const hostile = app.sanitizeRaceMeta({ distanceM: 2000, basePaceS: 105, strategy: "<evil>",
    segments: [{ fromM: 0, toM: 1000, targetPaceS: 105, phase: "<img>", junk: {} },
               { fromM: 1000, toM: 2000, targetPaceS: 9999 }, "junk",
               { fromM: 1000, toM: 2000, targetPaceS: 106 }] });
  ok("race meta sanitized: phases whitelisted, junk dropped", hostile.strategy === "even" &&
    hostile.segments.length === 2 && hostile.segments[0].phase === "base" && !("junk" in hostile.segments[0]));
  ok("race meta: too few valid segments → null", app.sanitizeRaceMeta({ distanceM: 2000, basePaceS: 105, segments: [{}] }) === null);
}

// ---------------------------------------------------------------------
// 26. Power profile (v1.20.0) — honest best-power windows + CP gate.
// ---------------------------------------------------------------------
group("power profile");
if (app.bestRollingPower && app.computePowerProfile) {
  const NOWP = Date.parse("2026-07-01T12:00:00Z");
  const steady = (n, w) => Array.from({ length: n }, (_, i) => ({ t: i * 2.5, d: i * 11, p: 118, w, r: 25 }));
  const surge = steady(300, 180).map((s, i) => (i >= 100 && i < 125) ? { ...s, w: 260 } : s);
  const b60 = app.bestRollingPower(surge, 60);
  ok("60s window finds the surge", b60 && b60.watts >= 250);
  ok("window longer than the session → null", app.bestRollingPower(steady(30, 200), 240) === null);
  ok("watts→pace equivalence", Math.abs(app.wattsToPace(200) - Math.pow(2.8 / 200, 1 / 3) * 500) < 0.01);

  const hist = [
    { id: "p1", date: "2026-06-28T10:00:00Z", title: "Steady 20:00", strokes: steady(500, 190),
      totals: { distanceM: 5000, elapsedS: 1250, avgWatts: 190 } },
    { id: "p2", date: "2025-12-01T10:00:00Z", title: "Old harder row", strokes: steady(500, 205),
      totals: { distanceM: 5000, elapsedS: 1250, avgWatts: 205 } },
  ];
  const pp = app.computePowerProfile(hist, NOWP);
  const r60 = pp.rows.find(r => r.durS === 60);
  ok("all-time vs 90-day separated", r60.best.watts === 205 && r60.recent.watts === 190);
  const r20 = pp.rows.find(r => r.durS === 1200);
  ok("20:00 window met by long sessions", r20.sufficient === true);
  ok("no CP from ordinary rows (not Tests)", pp.cp === null && /benchmark Tests/.test(pp.cpNeed));

  const tests = hist.concat([
    { id: "t2k", date: "2026-06-20T10:00:00Z", title: "2k Test", plan: { benchKey: "2k" },
      totals: { distanceM: 2000, elapsedS: 420, avgWatts: 280 }, strokes: [] },
    { id: "t30", date: "2026-06-10T10:00:00Z", title: "30:00 Test", plan: { benchKey: "30min" },
      totals: { distanceM: 7200, elapsedS: 1800, avgWatts: 210 }, strokes: [] },
  ]);
  const pp2 = app.computePowerProfile(tests, NOWP);
  ok("CP estimated only from two distinct-duration Tests", pp2.cp && pp2.cp.fromTests.length === 2 &&
    pp2.cp.watts > 150 && pp2.cp.watts < 280);
  ok("CP is labelled as an estimate from Tests", /never treated as maximal/i.test(pp2.cp.method));
  ok("insufficient data explains what's needed", app.computePowerProfile([], NOWP).rows.every(r => !r.sufficient && /captured session/.test(r.need)));
}

// ---------------------------------------------------------------------
// 27. v1.20 compatibility & security — old sessions untouched by the
// new consumers; hostile race/drift data inert end-to-end.
// ---------------------------------------------------------------------
group("v1.20 compat");
if (app.computeRaceDebrief && app.resolveBaseline && app.importSessionsFromText) {
  const legacy = { schemaVersion: 2, id: "L1", date: "2026-05-01T10:00:00Z", title: "Legacy 5k",
    totals: { distanceM: 5000, elapsedS: 1250, avgPaceS: 125, avgWatts: 170 },
    results: [{ intervalIdx: 1, label: "5000m", distanceM: 5000, elapsedS: 1250, paceS: 125, watts: 170, strokeRate: 24, heartRate: 150, restS: 0, driveLengthM: 1.4, peakForceLbs: 140 }] };
  const legacySnap = JSON.stringify(legacy);
  ok("legacy session: replay capability unchanged", app.getSessionReplayCapability(legacy) === "interval");
  ok("legacy session: no fabricated race debrief", app.computeRaceDebrief(legacy).has === false);
  ok("legacy session: no fabricated baseline", app.buildBaselineFromEntry(legacy) === null);
  ok("legacy session: power profile skips it silently", app.computePowerProfile([legacy], Date.parse("2026-07-01")).rows.every(r => !r.sufficient));
  ok("legacy session object untouched by all consumers", JSON.stringify(legacy) === legacySnap);

  app.state.history = [];
  app.importSessionsFromText(JSON.stringify({ kind: "pm5-history-export", history: [{
    id: "H-RACE", title: "hostile race", totals: { distanceM: 2000, elapsedS: 480 },
    results: [{ distanceM: 2000, elapsedS: 480 }],
    plan: { title: "p", intervals: [{ kind: "distance", value: 2000 }],
      race: { distanceM: 2000, basePaceS: 105, strategy: "<script>",
        segments: [{ fromM: 0, toM: 1000, targetPaceS: 105, phase: "<img onerror=x>" },
                   { fromM: 1000, toM: 2000, targetPaceS: { evil: 1 } },
                   { fromM: 1000, toM: 2000, targetPaceS: 107 }] } },
    driftEvents: [{ t: 60, id: "<svg>", text: "<script>alert(1)</script>", nested: { deep: true } }],
  }] }));
  const hr2 = app.state.history[0];
  ok("hostile race meta arrives whitelisted", hr2.plan.race && hr2.plan.race.strategy === "even" &&
    hr2.plan.race.segments.length === 2 && hr2.plan.race.segments.every(s => ["start","settle","base","push","sprint"].includes(s.phase)));
  ok("hostile drift events arrive bounded + inert", hr2.driftEvents.length === 1 &&
    typeof hr2.driftEvents[0].text === "string" && !("nested" in hr2.driftEvents[0]));
  ok("race status computes safely on sanitized meta", app.computeRaceStatus(hr2.plan.race, 500, 110, 106) !== null);
  app.state.history = [];
}

// ---------------------------------------------------------------------
// v1.21.0 — Stroke-Level Evidence. Deterministic fixtures only.
// ---------------------------------------------------------------------
group("curve codec");
if (app.encodeCurveDetail) {
  // Deterministic bell-shaped drive: peak `peak` lbf at fraction `at`.
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    const f = t < at ? Math.sin((t / at) * Math.PI / 2)
                     : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2);
    return peak * f;
  });
  const mkRecords = n => Array.from({ length: n }, (_, j) => ({
    i: j + 1, d: j * 10, peak: 150 + (j % 7),
    s: bell(150 + (j % 7), 0.38 + (j % 5) * 0.02),
  }));

  const recs = mkRecords(240);                       // ~2k session
  const snap = JSON.stringify(recs);
  const enc = app.encodeCurveDetail(recs, 240);
  ok("encode: source records never mutated", JSON.stringify(recs) === snap);
  ok("encode: payload size = header + n×record",
    enc && enc.length === app.CURVE_HEADER_BYTES + 240 * app.CURVE_RECORD_BYTES);
  const h = app.decodeCurveHeader(enc);
  ok("header: version/count/total round-trip",
    h && h.v === 1 && h.samples === 64 && h.count === 240 && h.totalStrokes === 240);
  ok("encode is deterministic", app.curveB64Encode(app.encodeCurveDetail(recs, 240)) === app.curveB64Encode(enc));

  // Random access + stable stroke association.
  const r5 = app.decodeCurveRecord(enc, 5);
  ok("record 5 decodes with its own identity", r5 && r5.i === 6 && r5.d === 50);
  ok("peak force exact to 0.1 lbf", Math.abs(r5.peak - recs[5].peak) < 0.051);
  ok("invalid record indexes rejected",
    app.decodeCurveRecord(enc, -1) === null && app.decodeCurveRecord(enc, 240) === null &&
    app.decodeCurveRecord(enc, 1.5) === null);

  // Fidelity: reconstruction error bounded by peak/510 (8-bit peak-scaled).
  let maxErr = 0, sumErr = 0, nErr = 0, maxPtErr = 0;
  for (let j = 0; j < 240; j++) {
    const dec = app.decodeCurveRecord(enc, j);
    const bound = recs[j].peak / 510 + 1e-9;
    for (let k = 0; k < 64; k++) {
      const e = Math.abs(dec.samples[k] - recs[j].s[k]);
      if (e > maxErr) maxErr = e;
      sumErr += e; nErr++;
    }
    const ptErr = Math.abs(app.strokePeakTiming(dec.samples) - app.strokePeakTiming(recs[j].s));
    if (ptErr > maxPtErr) maxPtErr = ptErr;
    if (maxErr > bound) break;
  }
  ok("reconstruction error ≤ peak/510 on every sample", maxErr <= (156 / 510) + 1e-9);
  ok("average reconstruction error well under the bound", (sumErr / nErr) < 0.16);
  ok("peak timing survives quantisation (≤1 sample)", maxPtErr <= 1 / 63 + 1e-9);
  const dec0 = app.decodeCurveRecord(enc, 0);
  ok("decoded curve is shape-identical (similarity 100)",
    app.curveSimilarity(dec0.samples, recs[0].s) === 100);
  const sm0 = app.curveShapeMetrics(dec0.samples), smo = app.curveShapeMetrics(recs[0].s);
  ok("shape metrics stable through codec (peak ≤1 sample, frontLoad <1%)",
    sm0 && smo && Math.abs(sm0.peakPos - smo.peakPos) <= 1 / 63 + 1e-9 &&
    Math.abs(sm0.frontLoad - smo.frontLoad) < 0.01);

  // Differently-sampled input is the caller's job (capture resamples to
  // 64) — codec rejects wrong-length curves rather than guessing.
  ok("wrong sample count rejected",
    app.encodeCurveDetail([{ i: 1, d: 0, peak: 100, s: bell(100, 0.4).slice(0, 32) }], 1) === null);
  ok("empty record list rejected", app.encodeCurveDetail([], 1) === null);
  ok("non-finite samples rejected", app.encodeCurveDetail(
    [{ i: 1, d: 0, peak: 100, s: [...bell(100, 0.4).slice(0, 63), NaN] }], 1) === null);
  const big = app.encodeCurveDetail([{ i: 1, d: 999999, peak: 2999.9, s: bell(2999.9, 0.5) }], 1);
  const bigDec = app.decodeCurveRecord(big, 1 - 1);
  ok("maximum valid values survive", bigDec && Math.abs(bigDec.peak - 2999.9) < 0.06 && bigDec.d === 999999);
  ok("duplicate ordinals deduped deterministically",
    app.decodeCurveHeader(app.encodeCurveDetail(
      [{ i: 3, d: 0, peak: 100, s: bell(100, 0.4) }, { i: 3, d: 9, peak: 120, s: bell(120, 0.4) }], 5)).count === 1);

  // base64 codec: strict round trip + strict rejection.
  const b64 = app.curveB64Encode(enc);
  const back = app.curveB64Decode(b64);
  ok("b64 round trip is byte-exact", back && back.length === enc.length &&
    back.every((v, i) => v === enc[i]));
  ok("b64 rejects bad length", app.curveB64Decode("abc") === null);
  ok("b64 rejects bad charset", app.curveB64Decode("ab!d") === null);
  ok("b64 rejects interior padding", app.curveB64Decode("ab=dabcd") === null);

  // Corruption, truncation, tampering — all fail closed.
  const flip = new Uint8Array(enc); flip[app.CURVE_HEADER_BYTES + 20] ^= 0xFF;
  ok("checksum catches a flipped byte", app.decodeCurveHeader(flip) === null);
  ok("truncated payload rejected", app.decodeCurveHeader(enc.slice(0, enc.length - 10)) === null);
  const vUp = new Uint8Array(enc); vUp[4] = 2;
  ok("unknown codec version fails closed", app.decodeCurveHeader(vUp) === null);
  const lie = new Uint8Array(enc);
  new DataView(lie.buffer).setUint16(6, 60000, true);
  ok("malicious declared count rejected (no allocation from claims)",
    app.decodeCurveHeader(lie) === null);
  ok("oversized b64 rejected before decoding",
    app.sanitizeCurveDetailB64("A".repeat(app.CURVE_B64_MAX_CHARS + 4)) === null);
  ok("non-string / junk payloads rejected",
    app.sanitizeCurveDetailB64(null) === null && app.sanitizeCurveDetailB64(12345) === null &&
    app.sanitizeCurveDetailB64("QUJD") === null);
  ok("valid payload passes full sanitisation",
    (() => { const p = app.sanitizeCurveDetailB64(b64); return p && p.count === 240 && p.totalStrokes === 240; })());
  // Tamper: swap two records in place and fix the checksum — the
  // ordinal-order scan still refuses it.
  const swap = new Uint8Array(enc);
  const R = app.CURVE_RECORD_BYTES, H = app.CURVE_HEADER_BYTES;
  const tmp = swap.slice(H, H + R);
  swap.set(swap.slice(H + R, H + 2 * R), H);
  swap.set(tmp, H + R);
  new DataView(swap.buffer).setUint32(12, app.curveChecksum(swap, H, swap.length), true);
  ok("misordered ordinals detected even with a valid checksum",
    app.curveOrdinalIndex(swap) === null);
  const oi = app.curveOrdinalIndex(enc);
  ok("ordinal index maps stroke number → record", oi && oi.get(6) === 5 && oi.get(241) === undefined);
}

group("curve retention");
if (app.retainCurveRecords) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2)
                          : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  const mk = n => Array.from({ length: n }, (_, j) => ({
    i: j + 1, d: j * 10, peak: 150, s: bell(150, 0.4),
  }));
  // Ordinary sessions keep every curve: 2k (~240), 30 min (~600 after
  // stride decimation), 6k (~700) all fit the 512 KiB ceiling.
  for (const [label, n] of [["2k", 240], ["6k", 700], ["30min", 1500], ["intervals", 900]]) {
    const r = app.retainCurveRecords(mk(n), {});
    ok(`${label} session retains all ${n} curves`, r.complete && r.retained === n && r.total === n);
  }
  // Long session: deterministic retention under a small test budget.
  const rows = mk(100);
  const budget = app.CURVE_HEADER_BYTES + 10 * app.CURVE_RECORD_BYTES;
  const opts = { budgetBytes: budget, anchorDistances: [500, 730] };
  const r1 = app.retainCurveRecords(rows, opts);
  const r2 = app.retainCurveRecords(rows, opts);
  ok("long-session retention is deterministic",
    JSON.stringify(r1.kept.map(k => k.i)) === JSON.stringify(r2.kept.map(k => k.i)));
  ok("ceiling never exceeded", r1.kept.length <= 10);
  ok("first and final curves survive",
    r1.kept[0].i === 1 && r1.kept[r1.kept.length - 1].i === 100);
  ok("anchor strokes survive (bookmark/drift/transition distances)",
    r1.kept.some(k => k.d === 500) && r1.kept.some(k => k.d === 730));
  ok("remaining slots distributed across the session",
    (() => { const is = r1.kept.map(k => k.i);
      let maxGap = 0; for (let j = 1; j < is.length; j++) maxGap = Math.max(maxGap, is[j] - is[j - 1]);
      return maxGap <= 30; })());
  ok("coverage metadata is accurate", !r1.complete && r1.retained === r1.kept.length && r1.total === 100);
  ok("retention never mutates its input", rows.length === 100 && rows[0].i === 1);
  // Full-budget path: an ultra session trims to the real ceiling and
  // the encoded result stays under 512 KiB.
  const ultra = app.retainCurveRecords(mk(7100), {});
  const encU = app.encodeCurveDetail(ultra.kept, 7100);
  ok("ultra session trims to the hard ceiling",
    !ultra.complete && ultra.retained === app.CURVE_MAX_RECORDS);
  ok("encoded ultra payload ≤ 512 KiB", encU && encU.length <= app.CURVE_SESSION_BUDGET_BYTES);

  // Coverage metadata sanitizer (rides history/exports/Drive).
  ok("curve meta: valid values pass",
    (() => { const m = app.sanitizeCurveMeta({ v: 1, coverage: "partial", retained: 500, total: 900 });
      return m && m.v === 1 && m.coverage === "partial" && m.retained === 500 && m.total === 900; })());
  ok("curve meta: unknown coverage state rejected",
    app.sanitizeCurveMeta({ v: 1, coverage: "<script>" }) === null);
  ok("curve meta: missing version rejected",
    app.sanitizeCurveMeta({ coverage: "complete" }) === null);
  ok("curve meta: hostile numbers zeroed",
    app.sanitizeCurveMeta({ v: 1, coverage: "complete", retained: -5, total: Infinity }).retained === 0);
}

group("curve import + compat");
if (app.sanitizeImportedCurveMap) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2)
                          : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  const recs = Array.from({ length: 50 }, (_, j) => ({ i: j + 1, d: j * 10, peak: 150, s: bell(150, 0.4) }));
  const b64 = app.curveB64Encode(app.encodeCurveDetail(recs, 50));

  // Export → import round trip preserves curve-to-stroke alignment.
  const got = app.sanitizeImportedCurveMap({ "S1": { v: 1, b64 } }, ["S1"]);
  ok("new-format round trip validates", got.length === 1 && got[0].id === "S1" && got[0].count === 50);
  ok("round-tripped ordinals still map to strokes",
    (() => { const m = app.curveOrdinalIndex(got[0].bytes); return m && m.get(1) === 0 && m.get(50) === 49; })());

  // Hostile input: pollution keys, unknown ids, unknown versions,
  // malformed and oversized payloads — none survive.
  const hostile = JSON.parse(`{"__proto__":{"polluted":1},"constructor":{"v":1},"S1":{"v":1,"b64":"${b64}"},"GHOST":{"v":1,"b64":"${b64}"},"S2":{"v":9,"b64":"${b64}"},"S3":{"v":1,"b64":"AAAA"},"S4":{"v":1,"b64":12}}`);
  const out = app.sanitizeImportedCurveMap(hostile, ["S1", "S2", "S3", "S4"]);
  ok("hostile curve map: only the one valid payload survives",
    out.length === 1 && out[0].id === "S1");
  ok("prototype pollution keys are inert", ({}).polluted === undefined &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"));
  ok("curve map result is an array, never a keyed object", Array.isArray(out));
  ok("non-object curve maps rejected",
    app.sanitizeImportedCurveMap(null, ["a"]).length === 0 &&
    app.sanitizeImportedCurveMap([1, 2], ["a"]).length === 0 &&
    app.sanitizeImportedCurveMap("x", ["a"]).length === 0);

  // v1.20-and-older sessions load unchanged (no curve fields at all).
  app.state.history = [];
  app.importSessionsFromText(JSON.stringify({ kind: "pm5-history-export", history: [{
    id: "OLD1", title: "v1.20 session", schemaVersion: 3,
    totals: { distanceM: 2000, elapsedS: 480 },
    strokes: Array.from({ length: 20 }, (_, j) => ({ t: j * 2, d: j * 100, p: 120, dl: 1.4, dt: 0.8, rt: 1.6 })),
    fc: { best: bell(150, 0.4), avg: bell(140, 0.42), peak: 150, n: 20 },
  }] }));
  const old1 = app.state.history[0];
  ok("v1.20 export imports unchanged (no curve meta invented)",
    old1 && old1.id === "OLD1" && !("curveMeta" in old1) && !("strokeStride" in old1));
  ok("v1.20 session still replays at stroke fidelity",
    app.getSessionReplayCapability(old1) === "stroke");

  // v1.21 entry fields: curveMeta + strokeStride sanitized on import.
  app.state.history = [];
  app.importSessionsFromText(JSON.stringify({ kind: "pm5-history-export", history: [{
    id: "NEW1", title: "v1.21 session", schemaVersion: 3,
    totals: { distanceM: 2000, elapsedS: 480 },
    strokes: Array.from({ length: 20 }, (_, j) => ({ t: j * 2, d: j * 100, p: 120 })),
    strokeStride: 2, curveMeta: { v: 1, coverage: "complete", retained: 40, total: 40 },
  }, {
    id: "NEW2", title: "hostile fields", totals: { distanceM: 100, elapsedS: 30 },
    strokes: [{ t: 0, d: 0 }, { t: 2, d: 10 }],
    strokeStride: "8; drop tables", curveMeta: { v: 1, coverage: "evil", retained: {} },
  }] }));
  const n1 = app.state.history.find(e => e.id === "NEW1");
  const n2 = app.state.history.find(e => e.id === "NEW2");
  ok("valid strokeStride survives import", n1 && n1.strokeStride === 2);
  ok("valid curveMeta survives import (coverage downgraded without payload)",
    n1 && n1.curveMeta && n1.curveMeta.v === 1 && n1.curveMeta.coverage === "unavailable");
  ok("hostile strokeStride dropped", n2 && !("strokeStride" in n2));
  ok("hostile curveMeta dropped", n2 && !("curveMeta" in n2));
  app.state.history = [];

  // Demo-session quarantine: synthetic sessions never become baselines
  // or power-profile evidence.
  const demoE = { id: "D1", demo: true, date: "2026-07-20T10:00:00Z", title: "Demo (synthetic)",
    totals: { distanceM: 2000, elapsedS: 480 },
    strokes: Array.from({ length: 60 }, (_, j) => ({ t: j * 2, d: j * 33, p: 120, w: 200, r: 24, dl: 1.4, dt: 0.8, rt: 1.6 })),
    fc: { avg: bell(150, 0.4), best: bell(160, 0.4), peak: 160, n: 60 } };
  ok("auto baseline never picks a synthetic demo session",
    app.resolveBaseline("auto", { history: [demoE] }) === null);
  ok("rolling baseline never pools synthetic demo sessions",
    app.buildRollingBaseline([demoE, demoE, demoE], null, 5) === null);
  ok("power profile ignores synthetic demo sessions",
    app.computePowerProfile([demoE], Date.parse("2026-07-21")).rows.every(r => !r.sufficient));
}

group("stroke evidence");
if (app.findEvidenceStrokes) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2)
                          : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  // 100-stroke timeline: steady 120 s/500m; one clean fastest (118 at
  // 40), a SUSTAINED slow patch (69-71), and one isolated 300 s spike
  // at 20 (a dropped-packet artifact).
  const tl = Array.from({ length: 100 }, (_, j) => ({
    index: j, split: 120, distanceM: j * 10, driveLengthM: 1.4, ratio: 2.0,
  }));
  tl[40].split = 118;
  tl[69].split = 133; tl[70].split = 136; tl[71].split = 134;
  tl[20].split = 300;
  const curves = tl.map((_, j) => bell(150, j === 90 ? 0.70 : 0.42));
  const ev = app.findEvidenceStrokes(tl, {
    curveAt: j => curves[j], baselineCurve: bell(148, 0.42),
  });
  ok("fastest valid stroke found", ev.fastest && ev.fastest.pos === 40 && ev.fastest.split === 118);
  ok("slowest is the sustained patch, not the artifact",
    ev.slowest && ev.slowest.pos === 70);
  ok("isolated split spike excluded as artifact",
    ev.artifactsExcluded >= 1 && ev.slowest.pos !== 20);
  ok("largest deviation from baseline found", ev.deviation && ev.deviation.pos === 90);
  ok("closest-to-baseline is a normal stroke", ev.closest && ev.closest.pos !== 90);
  ok("most representative matches the majority shape",
    ev.representative && ev.representative.pos !== 90);
  ok("no 'best technique' classification exists in the result",
    !("best" in ev) && !("bestTechnique" in ev));
  ok("valid count excludes the artifact", ev.validCount === 99);

  // Deterministic ties: equal splits → earliest stroke wins.
  const tie = tl.map(p => ({ ...p }));
  tie[60].split = 118;
  const evTie = app.findEvidenceStrokes(tie, { curveAt: () => null });
  ok("split ties break to the earliest stroke", evTie.fastest.pos === 40);

  // Insufficient data: too few valid strokes → nulls, never guesses.
  const thin = [{ index: 0, split: 120 }, { index: 1, split: 121 }, { index: 2 }];
  const evThin = app.findEvidenceStrokes(thin, { curveAt: () => null });
  ok("insufficient data returns nulls", evThin.fastest === null && evThin.slowest === null);
  const noCurves = app.findEvidenceStrokes(tl, { curveAt: () => null, baselineCurve: bell(148, 0.42) });
  ok("no stored curves → no curve-based picks, split picks still work",
    noCurves.representative === null && noCurves.closest === null && noCurves.fastest.pos === 40);
  ok("evidence selection never mutates the timeline", tl[40].split === 118 && tl.length === 100);
}

group("window baselines");
if (app.buildCurveWindowBaseline) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2)
                          : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  // 200 strokes: first half easy (dl 1.30), second half harder (1.40).
  const tl = Array.from({ length: 200 }, (_, j) => ({
    index: j, distanceM: j * 10, split: j < 100 ? 125 : 118,
    driveLengthM: j < 100 ? 1.30 : 1.40, ratio: j < 100 ? 2.2 : 1.9,
  }));
  const snap = JSON.stringify(tl);
  const curveAt = j => bell(150 + (j >= 100 ? 10 : 0), 0.42);
  const w1 = app.buildCurveWindowBaseline(tl, 0, 99, { curveAt, label: "first half" });
  ok("window averages only retained curves", w1.curve && w1.retained === 100 && w1.total === 100);
  ok("window DL stats reported", Math.abs(w1.stats.dl.mean - 1.30) < 1e-9 && w1.stats.dl.sd < 1e-9);
  ok("full-coverage window: high confidence, not partial",
    w1.confidence === "high" && !w1.partial && /complete coverage/.test(w1.confidenceWhy));
  ok("window source range is stated", w1.from === 0 && w1.to === 99 && w1.label === "first half");
  const w2 = app.buildCurveWindowBaseline(tl, 100, 199, { curveAt, label: "second half" });
  ok("start-vs-base style comparison sees the difference",
    w2.stats.dl.mean > w1.stats.dl.mean && w2.curve[32] > w1.curve[32]);

  // Partial coverage: only every 2nd curve retained.
  const wPart = app.buildCurveWindowBaseline(tl, 100, 199,
    { curveAt: j => (j % 2 === 0 ? bell(160, 0.42) : null), label: "partial" });
  ok("partial retained sample is disclosed",
    wPart.partial && wPart.retained === 50 && wPart.total === 100 && /partial/.test(wPart.confidenceWhy));
  ok("partial coverage lowers confidence", wPart.confidence === "medium");

  // Minimum samples + invalid ranges never fabricate.
  ok("below minimum samples → insufficient",
    !!app.buildCurveWindowBaseline(tl, 0, 5, { curveAt }).insufficient);
  ok("legacy session (no curves) → insufficient, nothing invented",
    !!app.buildCurveWindowBaseline(tl, 0, 99, { curveAt: () => null }).insufficient);
  ok("invalid range → insufficient",
    !!app.buildCurveWindowBaseline(tl, 50, 20, { curveAt }).insufficient &&
    !!app.buildCurveWindowBaseline(tl, -1, 20, { curveAt }).insufficient);
  ok("window baseline never mutates the timeline", JSON.stringify(tl) === snap);

  // Interval + race-segment ranges resolve from persisted data.
  const sess = { results: [{ distanceM: 1000, elapsedS: 240 }, { distanceM: 1000, elapsedS: 235 }],
    plan: { race: { distanceM: 2000, segments: [
      { phase: "start", fromM: 0, toM: 200 }, { phase: "base", fromM: 200, toM: 1600 },
      { phase: "sprint", fromM: 1600, toM: 2000 }] } } };
  const iv1 = app.strokeRangeForInterval(sess, tl, 1);
  ok("interval range maps to strokes", iv1 && tl[iv1.from].distanceM >= 1000 && iv1.label === "interval 2");
  const sg2 = app.strokeRangeForRaceSegment(sess, tl, 2);
  ok("race-segment range maps to strokes", sg2 && tl[sg2.from].distanceM >= 1600 && /sprint/.test(sg2.label));
  ok("out-of-range interval/segment → null",
    app.strokeRangeForInterval(sess, tl, 9) === null && app.strokeRangeForRaceSegment(sess, tl, 9) === null);
  // Same-segment comparison against a compatible prior attempt: the
  // same range builder works on the OTHER session's timeline.
  const prevTl = tl.map(p => ({ ...p, driveLengthM: 1.35 }));
  const sgPrev = app.strokeRangeForRaceSegment(sess, prevTl, 2);
  const wPrev = app.buildCurveWindowBaseline(prevTl, sgPrev.from, sgPrev.to, { curveAt, label: "prior sprint" });
  ok("compatible prior-attempt segment builds its own baseline",
    wPrev.curve && Math.abs(wPrev.stats.dl.mean - 1.35) < 1e-9);
}

group("replay curve sync");
if (app.strokePosToOrdinal) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2)
                          : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  ok("stride 1: position == ordinal-1",
    app.strokePosToOrdinal(0, 1) === 1 && app.strokePosToOrdinal(5, 1) === 6);
  ok("stride 4: decimated log maps exactly",
    app.strokePosToOrdinal(5, 4) === 21 && app.ordinalToStrokePos(21, 4, 600) === 5);
  ok("off-grid ordinals refuse to map (no nearest-neighbour lying)",
    app.ordinalToStrokePos(22, 4, 600) === null);
  ok("out-of-range positions refuse to map",
    app.ordinalToStrokePos(21, 4, 5) === null && app.strokePosToOrdinal(-1, 1) === null);

  // End-to-end: 600 strokes, stride 1 — selected stroke j must decode
  // record with ordinal j+1 (no off-by-one).
  const recs = Array.from({ length: 600 }, (_, j) => ({ i: j + 1, d: j * 5, peak: 150, s: bell(150, 0.4) }));
  const enc = app.encodeCurveDetail(recs, 600);
  const oi = app.curveOrdinalIndex(enc);
  let aligned = true;
  for (const j of [0, 1, 299, 598, 599]) {
    const rec = app.decodeCurveRecord(enc, oi.get(app.strokePosToOrdinal(j, 1)));
    if (!rec || rec.i !== j + 1 || rec.d !== j * 5) aligned = false;
  }
  ok("timeline → stroke → curve alignment exact at both ends", aligned);

  // With retention: dropped strokes report "no curve", never a neighbour.
  const kept = app.retainCurveRecords(recs, { budgetBytes: app.CURVE_HEADER_BYTES + 50 * app.CURVE_RECORD_BYTES });
  const encK = app.encodeCurveDetail(kept.kept, 600);
  const oiK = app.curveOrdinalIndex(encK);
  const missing = [];
  for (let j = 0; j < 600; j++) if (!oiK.has(j + 1)) missing.push(j);
  ok("retained subset: missing strokes are reported missing",
    missing.length === 600 - kept.retained && oiK.has(1) && oiK.has(600));
  ok("lazy decode: ordinal index touches no samples",
    (() => { const t0 = process.hrtime.bigint(); app.curveOrdinalIndex(enc);
      return Number(process.hrtime.bigint() - t0) < 50e6; })());
  // Worst-case accepted payload decodes promptly (all records).
  const worst = app.retainCurveRecords(
    Array.from({ length: app.CURVE_MAX_RECORDS }, (_, j) => ({ i: j + 1, d: j, peak: 150, s: bell(150, 0.4) })), {});
  const encW = app.encodeCurveDetail(worst.kept, app.CURVE_MAX_RECORDS);
  // Replay's real pattern: validate ONCE, then random-access via the
  // unchecked fast path (decodeCurveRecord re-checksums the whole
  // payload per call — safe for one-shot use, wrong for scrubbing).
  const t0 = process.hrtime.bigint();
  const hW = app.decodeCurveHeader(encW);
  const oiW = app.curveOrdinalIndex(encW);
  for (let j = 0; j < hW.count; j += 97) app.decodeCurveRecordUnchecked(encW, j);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok("worst-case accepted payload: validate + index + spot-decode < 250 ms", ms < 250 && oiW.size === hW.count);
}

// ---------------------------------------------------------------------
// v1.22.0 — Insights: cross-session evidence. Deterministic fixtures;
// all dates built via local-time constructors so day-boundary rules
// hold in any timezone.
// ---------------------------------------------------------------------
group("insights cohorts");
if (app.buildInsightsCohort) {
  const NOW = new Date(2026, 6, 22, 12, 0, 0).getTime();   // local 2026-07-22 noon
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const mkE = (id, daysAgo, o) => Object.assign({
    id, date: iso(daysAgo), title: "S" + id,
    totals: { distanceM: 5000, elapsedS: 1250, avgPaceS: 125, avgWatts: 180 },
    strokes: Array.from({ length: 40 }, (_, j) => ({
      t: j * 2.5, d: j * 125, p: 125, w: 180, r: 24, dl: 1.35, dt: 0.8, rt: 1.6, pt: 0.42 })),
  }, o || {});
  const hist = [
    mkE("a1", 1), mkE("a2", 3), mkE("a3", 6),
    mkE("b1", 8), mkE("b2", 10), mkE("b3", 13),
    mkE("old", 40),
    mkE("iv", 2, { results: [{ distanceM: 500, elapsedS: 110 }, { distanceM: 500, elapsedS: 112 }],
      plan: { intervals: [{ kind: "distance", value: 500 }, { kind: "distance", value: 500 }] },
      totals: { distanceM: 1000, elapsedS: 222, avgPaceS: 111 } }),
    mkE("demo1", 2, { demo: true }),
    mkE("race1", 4, { plan: { title: "2k", benchKey: "2k",
      intervals: [{ kind: "distance", value: 2000 }],
      race: { distanceM: 2000, basePaceS: 120, strategy: "even",
        segments: [{ fromM: 0, toM: 2000, targetPaceS: 120, phase: "base" }] } },
      totals: { distanceM: 2000, elapsedS: 480, avgPaceS: 120 } }),
    { id: "junk", date: iso(2), title: "no totals", totals: {} },
  ];
  const c7 = app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", compare: "prev" });
  ok("7d window includes days 0-6, excludes day 8+",
    c7.a.facts.some(f => f.id === "a3") && !c7.a.facts.some(f => f.id === "b1"));
  ok("prev equal period holds days 7-13",
    c7.b.facts.length === 3 && c7.b.facts.every(f => ["b1", "b2", "b3"].includes(f.id)));
  ok("day-boundary is local-inclusive (day 6 in, day 40 out)",
    c7.a.facts.some(f => f.id === "a3") &&
    c7.excluded.some(x => x.id === "old" && x.reason === "outside selected period"));
  ok("synthetic excluded by default with a stable reason",
    c7.excluded.some(x => x.id === "demo1" && /synthetic demo/.test(x.reason)));
  ok("synthetic included when toggled",
    app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", includeSynthetic: true })
      .a.facts.some(f => f.id === "demo1"));
  ok("unusable totals excluded with reason",
    c7.excluded.some(x => x.id === "junk" && x.reason === "no usable totals"));
  const cIv = app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", type: "interval" });
  ok("workout-type filter keeps only intervals",
    cIv.a.facts.length === 1 && cIv.a.facts[0].id === "iv" &&
    cIv.excluded.some(x => x.id === "a1" && x.reason === "workout-type filter"));
  const cD = app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", minDistM: 3000 });
  ok("distance filter excludes short sessions",
    !cD.a.facts.some(f => f.id === "iv") &&
    cD.excluded.some(x => x.id === "iv" && x.reason === "distance filter"));
  const cR = app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", racePlanOnly: true });
  ok("Race Lab filter keeps only race-plan sessions",
    cR.a.facts.length === 1 && cR.a.facts[0].id === "race1");
  const cAB = app.buildInsightsCohort(hist, { nowMs: NOW, range: "custom",
    fromMs: NOW - 6 * 86400000, toMs: NOW,
    compare: "custom", bFromMs: NOW - 45 * 86400000, bToMs: NOW - 30 * 86400000 });
  ok("custom Period A vs Period B resolves both windows",
    cAB.a.facts.length >= 3 && cAB.b.facts.length === 1 && cAB.b.facts[0].id === "old");
  const again = app.buildInsightsCohort(hist, { nowMs: NOW, range: "7d", compare: "prev" });
  ok("cohort building is deterministic",
    JSON.stringify(again.a.facts.map(f => f.id)) === JSON.stringify(c7.a.facts.map(f => f.id)) &&
    JSON.stringify(again.excluded) === JSON.stringify(c7.excluded));
  const snap = JSON.stringify(hist);
  app.buildInsightsCohort(hist, { nowMs: NOW, range: "all" });
  ok("cohort building never mutates history", JSON.stringify(hist) === snap);
  const cAll = app.buildInsightsCohort(hist, { nowMs: NOW, range: "all" });
  ok("all-history range takes every usable non-demo session",
    cAll.a.facts.length === hist.length - 2);   // minus demo1 + junk
  ok("coverage summary counts legacy sessions",
    cAll.coverage.legacy === cAll.a.facts.length);   // fixtures carry no curveMeta
}

group("insights aggregation");
if (app.sessionFacts) {
  ok("median: odd/even/deterministic",
    app.insMedian([3, 1, 2]) === 2 && app.insMedian([4, 1, 2, 3]) === 2.5 &&
    app.insMedian([]) === null);
  ok("IQR needs 4+ values", app.insIqr([1, 2, 3]) === null && app.insIqr([1, 2, 3, 100]) > 0);
  ok("spread % refuses near-zero denominators",
    app.insSpreadPct([0.0000001, -0.0000001, 0.0000002, -0.0000002]) === null);
  const e = { id: "x", date: new Date(2026, 6, 20).toISOString(), title: "t",
    totals: { distanceM: 2000, elapsedS: 480, avgWatts: 200 },
    strokes: [
      { t: 1, d: 10, p: 120, w: 200, r: 24, dl: 1.30, dt: 0.8, rt: 1.6, pt: 0.40, hr: 150 },
      { t: 2, d: 20, p: 122, w: 210, r: 26, dl: 1.40, dt: 0.8, rt: 1.6, pt: 0.44 },
      { t: 3, d: 30, p: NaN, w: { evil: 1 }, r: "26", dl: Infinity, dt: 0.8, rt: 1.6 },
      { t: 4, d: 40, p: 121, w: 205, r: 25, dl: 1.35, dt: 0.8, rt: 1.6, pt: 0.42 },
    ] };
  const f = app.sessionFacts(e);
  ok("facts: non-finite and object-valued fields rejected",
    f.dlMed === 1.35 && f.rateMed === 25 && f.paceMed === 121);
  ok("facts: power per stroke = W/(spm/60)",
    Math.abs(f.ppsMed - 205 / (25 / 60)) < 1e-9);
  ok("facts: ratio derived from dt/rt", Math.abs(f.ratioMed - 2) < 1e-9);
  ok("facts: hr coverage fraction", Math.abs(f.hrCoverage - 0.25) < 1e-9);
  ok("facts: legacy coverage without curveMeta", f.curveCoverage === "legacy");
  ok("facts: never mutates the entry", !("dlMed" in e) && e.strokes.length === 4);
  ok("facts: unusable entry → null",
    app.sessionFacts({ id: "y", date: "2026-01-01", totals: {} }) === null &&
    app.sessionFacts({ id: "z", date: "not a date", totals: { distanceM: 100 } }) === null);
  // Session-level weighting: a 10× longer session is still one point.
  const short = { id: "s", date: new Date(2026, 6, 1).toISOString(), totals: { distanceM: 2000, elapsedS: 480 },
    strokes: Array.from({ length: 20 }, (_, j) => ({ t: j, d: j * 100, dl: 1.30, dt: 0.8, rt: 1.6 })) };
  const long = { id: "l", date: new Date(2026, 6, 2).toISOString(), totals: { distanceM: 20000, elapsedS: 4800 },
    strokes: Array.from({ length: 200 }, (_, j) => ({ t: j, d: j * 100, dl: 1.50, dt: 0.8, rt: 1.6 })) };
  const pts = app.buildMetricSeries([app.sessionFacts(short), app.sessionFacts(long)], "dlMed");
  ok("long sessions do not dominate: one point per session, unweighted",
    pts.length === 2 && pts[0].v === 1.30 && pts[1].v === 1.50 &&
    app.insMedian(pts.map(q => q.v)) === 1.40);
}

group("insights findings");
if (app.generateInsightsFindings) {
  const NOW = new Date(2026, 6, 22, 12).getTime();
  const mkF = (id, daysAgo, dl, o) => {
    const strokes = Array.from({ length: 60 }, (_, j) => ({
      t: j * 2.5, d: j * 80, p: (o && o.pace) || 125, w: (o && o.w) || 180,
      r: (o && o.r) || 24, dl: dl + ((j % 3) - 1) * 0.01, dt: 0.8, rt: 1.6, pt: 0.42 }));
    return app.sessionFacts(Object.assign({
      id, date: new Date(NOW - daysAgo * 86400000).toISOString(), title: "S" + id,
      totals: { distanceM: 5000, elapsedS: 1250, avgPaceS: (o && o.pace) || 125, avgWatts: (o && o.w) || 180 },
      strokes }, (o && o.entry) || {}));
  };
  const mkCohort = (aDl, bDl, o) => ({
    a: { facts: aDl.map((v, i) => mkF("A" + i, i, v, o)), fromMs: NOW - 6 * 86400000, toMs: NOW },
    b: { facts: bDl.map((v, i) => mkF("B" + i, 8 + i, v, o)), fromMs: NOW - 13 * 86400000, toMs: NOW - 7 * 86400000 },
    coverage: {}, excluded: [],
  });
  const up = app.generateInsightsFindings(mkCohort([1.40, 1.41, 1.39, 1.40], [1.32, 1.33, 1.31, 1.32]), {});
  const dlUp = up.findings.find(f => f.metric === "dlMed");
  ok("sustained Drive Length change detected", !!dlUp && dlUp.kind === "change" && dlUp.absDelta > 0.05);
  ok("finding reports absolute before relative", /\+0\.08 m/.test(dlUp.text));
  ok("finding carries evidence session ids",
    dlUp.evidence.sessionIds.length === 4 && dlUp.evidence.comparisonIds.length === 4 &&
    dlUp.evidence.sessionIds.every(id => /^A/.test(id)));
  ok("finding states both periods", dlUp.periods.a.n === 4 && dlUp.periods.b.n === 4);
  ok("confidence has a level and documented reasons",
    ["high", "medium", "low"].includes(dlUp.confidence.level) && dlUp.confidence.why.length > 10);
  const flat = app.generateInsightsFindings(mkCohort([1.35, 1.35, 1.36, 1.35], [1.35, 1.36, 1.35, 1.35]), {});
  ok("stable result reported as a finding, capped at one",
    flat.findings.filter(f => f.kind === "stable").length === 1);
  const thin = app.generateInsightsFindings(
    { a: { facts: [mkF("A0", 0, 1.4)], fromMs: 0, toMs: 1 },
      b: { facts: [mkF("B0", 8, 1.3)], fromMs: 0, toMs: 1 }, coverage: {}, excluded: [] }, {});
  ok("insufficient data is a structured result, not a guess",
    thin.findings.length === 0 && thin.insufficient.some(r => /at least 3/.test(r.reason)));
  ok("no comparison period → explicit insufficiency",
    app.generateInsightsFindings({ a: { facts: [], fromMs: 0, toMs: 1 }, b: null, coverage: {}, excluded: [] }, {})
      .insufficient.some(r => /comparison period/.test(r.reason)));
  ok("at most three findings", up.findings.length <= 3);
  ok("one finding per metric family",
    new Set(up.findings.map(f => f.family)).size === up.findings.length);
  const banned = /perfect|optimal stroke|readiness|recovery score|injur|causes|caused by|guarantee/i;
  ok("no causal, medical, readiness, or perfect-stroke wording",
    up.findings.concat(flat.findings).every(f => !banned.test(f.text)));
  // Pace requires comparable cohorts: mixed distances suppress it.
  const mixA = [mkF("A0", 0, 1.35), mkF("A1", 1, 1.35), mkF("A2", 2, 1.35)];
  mixA[1] = Object.assign({}, mixA[1], { distanceM: 20000, benchKey: null });
  const mixed = app.generateInsightsFindings(
    { a: { facts: mixA, fromMs: 0, toMs: 1 },
      b: { facts: [mkF("B0", 8, 1.3), mkF("B1", 9, 1.3), mkF("B2", 10, 1.3)], fromMs: 0, toMs: 1 },
      coverage: {}, excluded: [] }, {});
  ok("incompatible pace cohorts never produce a pace finding",
    !mixed.findings.some(f => f.family === "pace") &&
    mixed.insufficient.some(r => /not mutually comparable/.test(r.reason)));
  const d1 = app.generateInsightsFindings(mkCohort([1.40, 1.41, 1.39, 1.40], [1.32, 1.33, 1.31, 1.32]), {});
  ok("findings are deterministic",
    JSON.stringify(d1.findings.map(f => f.metric + f.kind)) ===
    JSON.stringify(up.findings.map(f => f.metric + f.kind)));
  // Inconsistent direction fails the 70% agreement gate.
  const noisy = app.generateInsightsFindings(mkCohort([1.40, 1.25, 1.42, 1.26], [1.33, 1.32, 1.34, 1.33]), {});
  ok("inconsistent direction produces no change finding for that metric",
    !noisy.findings.some(f => f.metric === "dlMed" && f.kind === "change"));
}

group("insights curve trends");
if (app.buildCurveSimSeries) {
  const bell = (peak, at) => Array.from({ length: 64 }, (_, k) => {
    const t = k / 63;
    return peak * (t < at ? Math.sin((t / at) * Math.PI / 2) : Math.sin(((1 - t) / (1 - at)) * Math.PI / 2));
  });
  const mkFacts = ats => ats.map((at, i) => ({
    id: "c" + i, dateMs: i, dateISO: "d" + i, title: "S" + i,
    fcAvg: at == null ? null : bell(150, at), curveCoverage: at == null ? "legacy" : "complete",
  }));
  const ref = bell(148, 0.35);
  const sr = app.buildCurveSimSeries(mkFacts([0.35, 0.55, null, 0.75]), ref);
  ok("similarity series: one point per session with a curve, fixed reference",
    sr.points.length === 3 && sr.skipped === 1);
  ok("closer shapes score higher against the same reference",
    sr.points[0].v > sr.points[1].v && sr.points[1].v > sr.points[2].v);
  ok("legacy sessions are skipped, never fabricated",
    !sr.points.some(q => q.id === "c2"));
  ok("no reference → explicit reason, no points",
    app.buildCurveSimSeries(mkFacts([0.4]), null).reason.length > 5);
  ok("no curves in period → explicit reason",
    app.buildCurveSimSeries(mkFacts([null, null]), ref).reason.length > 5);
  const same = [bell(150, 0.42), bell(152, 0.42), bell(149, 0.42), bell(151, 0.42), bell(150, 0.42)];
  const varied = [bell(150, 0.35), bell(150, 0.55), bell(150, 0.42), bell(150, 0.30), bell(150, 0.60)];
  const cSame = app.curveConsistencyFromSamples(same);
  const cVar = app.curveConsistencyFromSamples(varied);
  ok("within-session consistency: identical shapes ≈ 100", cSame >= 99);
  ok("varied shapes score lower", cVar < cSame);
  ok("consistency needs ≥5 curves", app.curveConsistencyFromSamples(same.slice(0, 4)) === null);
  ok("corrupt curve inputs are ignored safely",
    app.curveConsistencyFromSamples([null, [1, 2], "x", ...same]) >= 99);
}

group("insights performance + race");
if (app.sessionRaceExec) {
  const race = { distanceM: 2000, basePaceS: 120, strategy: "even",
    segments: [{ fromM: 0, toM: 2000, targetPaceS: 120, phase: "base" }] };
  const mkRace = offS => ({
    id: "r", date: new Date(2026, 6, 20).toISOString(),
    plan: { benchKey: "2k", intervals: [{ kind: "distance", value: 2000 }], race },
    totals: { distanceM: 2000, elapsedS: 480 },
    strokes: Array.from({ length: 50 }, (_, j) => {
      const d = (j + 1) * 40;
      return { t: (d / 500) * 120 + offS, d, p: 120, w: 200, r: 26, dl: 1.35, dt: 0.8, rt: 1.6 };
    }) });
  ok("race execution: on-plan session ≈ 0 s deviation", app.sessionRaceExec(mkRace(0)) < 0.01);
  ok("race execution: constant 3 s behind reads as 3 s", Math.abs(app.sessionRaceExec(mkRace(3)) - 3) < 0.01);
  ok("race execution needs ≥10 usable strokes",
    app.sessionRaceExec({ plan: { race }, strokes: [{ t: 1, d: 40 }] }) === null);
  ok("non-race sessions return null", app.sessionRaceExec({ strokes: [] }) === null);
  ok("pace comparability: same benchmark passes",
    app.insPaceComparable([{ benchKey: "2k", distanceM: 2000 }, { benchKey: "2k", distanceM: 2010 }]));
  ok("pace comparability: mixed distances fail",
    !app.insPaceComparable([{ benchKey: null, distanceM: 2000 }, { benchKey: null, distanceM: 12000 }]));
  ok("pace comparability: near distances pass without benchmarks",
    app.insPaceComparable([{ benchKey: null, distanceM: 5000 }, { benchKey: null, distanceM: 5500 }]));
}

group("insights explorer + prefs + security");
if (app.findInsightsComparables) {
  const NOW = new Date(2026, 6, 22, 12).getTime();
  const mk = (id, daysAgo, dist, pace, o) => Object.assign({
    id, date: new Date(NOW - daysAgo * 86400000).toISOString(), title: "S" + id,
    totals: { distanceM: dist, elapsedS: (dist / 500) * pace, avgPaceS: pace },
    strokes: Array.from({ length: 20 }, (_, j) => ({ t: j, d: j * 100, p: pace, dl: 1.35, dt: 0.8, rt: 1.6 })),
  }, o || {});
  const target = mk("T", 0, 5000, 120);
  const hist = [target, mk("p1", 5, 5100, 122), mk("p2", 12, 4900, 118),
    mk("far", 3, 15000, 130), mk("dm", 4, 5000, 119, { demo: true }), mk("old", 60, 5000, 125)];
  const cmp = app.findInsightsComparables(target, hist, {});
  ok("comparables: compatible sessions found with reasons",
    cmp.rows.length === 3 && cmp.rows.every(r => /±20%|benchmark/.test(r.why)));
  ok("incompatible sessions are never substituted", !cmp.rows.some(r => r.facts.id === "far"));
  ok("synthetic excluded from real comparisons", !cmp.rows.some(r => r.facts.id === "dm"));
  ok("previous attempt is the nearest earlier compatible session", cmp.prev.facts.id === "p1");
  ok("best comparable attempt by pace", cmp.best.facts.id === "p2");
  ok("recent and historical medians reported",
    cmp.recentMedPaceS != null && cmp.historicalMedPaceS != null);
  ok("metric differences computed vs the target",
    Math.abs(cmp.rows.find(r => r.facts.id === "p1").diffs.paceS - (-2)) < 1e-9);
  // Prefs sanitizer: hostile input falls back to defaults.
  const hp = app.sanitizeInsightsPrefs(JSON.parse(
    '{"range":"<script>","compare":{"a":1},"type":"interval","includeSynthetic":"yes","minDistM":1e99,"__proto__":{"x":1}}'));
  ok("prefs: hostile values fall back, valid ones survive",
    hp.range === "28d" && hp.compare === "prev" && hp.type === "interval" &&
    hp.includeSynthetic === false && hp.minDistM === null);
  ok("prefs: prototype pollution inert", ({}).x === undefined);
  // Hostile titles stay inert strings through the engine.
  const hostile = mk("h", 1, 5000, 121, { title: "<img src=x onerror=alert(1)>" });
  const facts = app.sessionFacts(hostile);
  ok("hostile titles pass through as plain strings, unexecuted",
    facts.title === "<img src=x onerror=alert(1)>");
  const cohort = app.buildInsightsCohort([hostile], { nowMs: NOW, range: "7d" });
  ok("engine outputs are data-only (no HTML fields)",
    !JSON.stringify(cohort).includes("innerHTML"));
  // v1.21 entries with curve metadata flow through untouched.
  const v21 = mk("v21", 1, 5000, 121, {
    curveMeta: { v: 1, coverage: "complete", retained: 20, total: 20 }, strokeStride: 1 });
  const f21 = app.sessionFacts(v21);
  ok("v1.21 sessions load unchanged with curve coverage",
    f21.curveCoverage === "complete" && f21.curveRetained === 20);
  ok("training overview counts coverage classes",
    (() => { const o = app.buildTrainingOverview([f21, app.sessionFacts(mk("l", 2, 5000, 121))]);
      return o.sessions === 2 && o.curves.complete === 1 && o.curves.legacy === 1 &&
        o.weekly.length >= 1; })());
}

// ---------------------------------------------------------------------
// v1.23.0 — Hardware Confidence: transport state machine, liveness,
// continuity, packet security, diagnostics redaction. Deterministic
// clocks via injected now().
// ---------------------------------------------------------------------
group("ble state machine");
if (app.createBleMachine) {
  let t = 0; const now = () => t;
  const m = app.createBleMachine({ now });
  ok("initial state is idle, connect allowed", m.state === "idle" && m.canStart());
  ok("happy path transitions are legal",
    m.to("requesting") && m.to("connecting") && m.to("discovering") &&
    m.to("subscribing") && m.to("live"));
  ok("live only via subscribing (never straight from connecting)",
    !app.bleTransitionLegal("connecting", "live") && !app.bleTransitionLegal("requesting", "live"));
  ok("illegal transition rejected without state change",
    m.to("requesting") === false && m.state === "live");
  ok("stale ↔ live recovery is legal", m.to("stale") && m.to("live"));
  ok("rest and completion are workout-aware transport states",
    m.to("resting") && m.to("live") && m.to("completed") && m.to("live"));
  ok("disconnect → reconnecting → connecting path legal",
    m.to("disconnected") && m.to("reconnecting") && m.to("connecting"));
  ok("connect is idempotent mid-attempt (canStart false)",
    !m.canStart());
  const g1 = m.begin(), g2 = m.begin();
  ok("generations retire stale async completions",
    !m.fresh(g1) && m.fresh(g2));
  ok("chooser cancellation is a normal recoverable outcome",
    app.bleTransitionLegal("requesting", "idle"));
  const m2 = app.createBleMachine({ now });
  m2.to("unsupported");
  ok("unsupported is terminal", m2.to("requesting") === false && m2.state === "unsupported");
  ok("history is bounded", (() => {
    const m3 = app.createBleMachine({ now });
    for (let i = 0; i < 120; i++) { m3.to("requesting"); m3.to("idle"); }
    return m3.history.length <= 100; })());
  ok("every declared state has a transition entry",
    app.BLE_STATES.every(s => Array.isArray(app.BLE_TRANSITIONS[s])));
}

group("ble liveness");
if (app.createLiveness) {
  let t = 0; const now = () => t;
  const L = app.createLiveness({ now });
  const armed = ws => ({ armed: true, workoutState: ws == null ? 1 : ws });
  ok("disarmed while transport not live", L.evaluate({ armed: false }) === "disarmed");
  ok("no telemetry yet → not stale (machine still subscribing)",
    L.evaluate(armed()) === "live");
  t = 1000; L.note("gs", true);
  t = 3000;
  ok("valid packets refresh liveness", L.evaluate(armed()) === "live" && L.ageMs("gs") === 2000);
  t = 1000 + app.LIVENESS_STALE_MS + 1;
  ok("status silence past threshold → stale", L.evaluate(armed()) === "stale");
  L.note("gs", false);
  ok("malformed packets never refresh liveness",
    L.evaluate(armed()) === "stale" && L.rejected.gs === 1 && L.ageMs("gs") > app.LIVENESS_STALE_MS);
  ok("completed workout disarms staleness (state 10/11)",
    L.evaluate(armed(10)) === "disarmed" && L.evaluate(armed(11)) === "disarmed");
  ok("programmed rest does NOT mask status silence",
    L.evaluate({ armed: true, workoutState: 3 }) === "stale");
  ok("warning cooldown", L.warnAllowed() === true && L.warnAllowed() === false);
  t += app.LIVENESS_WARN_COOLDOWN_MS + 1;
  ok("cooldown expires on monotonic time", L.warnAllowed() === true);
  // Gap recording
  L.gapOpen("stale");
  L.gapOpen("stale");                          // double-open ignored
  t += 4000;
  L.gapClose(true);
  ok("gap recorded once with duration + recovery flag",
    L.gaps.length === 1 && Math.abs(L.gaps[0].d - 4) < 0.11 && L.gaps[0].r === 1);
  ok("gap events are bounded", (() => {
    for (let i = 0; i < 30; i++) { L.gapOpen("stale"); t += 100; L.gapClose(false); }
    return L.gaps.length <= app.GAP_EVENT_CAP; })());
  const genBefore = L.gen;
  L.reset();
  ok("reset clears counters and bumps generation (stale-callback isolation)",
    L.gen === genBefore + 1 && L.gaps.length === 0 && L.accepted.gs === 0 && L.lastAt.gs === 0);
}

group("ble continuity + capture meta");
if (app.pm5Continuity) {
  const before = { elapsedS: 120, distanceM: 500, strokes: 60 };
  ok("monotonic progression → same workout",
    app.pm5Continuity(before, { elapsedS: 125, distanceM: 512, strokes: 61 }) === "same");
  ok("equal counters (paused erg) → same",
    app.pm5Continuity(before, { elapsedS: 120, distanceM: 500, strokes: 60 }) === "same");
  ok("elapsed rollback → reset",
    app.pm5Continuity(before, { elapsedS: 4, distanceM: 510, strokes: 61 }) === "reset");
  ok("distance rollback → reset",
    app.pm5Continuity(before, { elapsedS: 130, distanceM: 20, strokes: 61 }) === "reset");
  ok("stroke-count rollback → reset",
    app.pm5Continuity(before, { elapsedS: 130, distanceM: 510, strokes: 3 }) === "reset");
  ok("non-finite counters → reset",
    app.pm5Continuity(before, { elapsedS: NaN, distanceM: 510 }) === "reset");
  ok("no prior snapshot → same (nothing to protect)",
    app.pm5Continuity(null, { elapsedS: 1, distanceM: 1 }) === "same");
  ok("small in-flight tolerance honored",
    app.pm5Continuity(before, { elapsedS: 118.5, distanceM: 496, strokes: 60 }) === "same");
  // capture metadata sanitizers
  ok("capture vocabulary whitelisted",
    app.sanitizeCaptureMeta("interrupted-gap") === "interrupted-gap" &&
    app.sanitizeCaptureMeta("clean") === "clean" &&
    app.sanitizeCaptureMeta("<script>") === null && app.sanitizeCaptureMeta(7) === null);
  const g = app.sanitizeGaps([{ s: 10, e: 14, d: 4, st: "stale", r: 1 },
    { s: 5, e: 2, d: 1 }, { s: "x", e: 9, d: 1 }, { s: 1, e: 2, d: 1, st: "<img>", r: "y" }]);
  ok("gaps: numeric whitelist, bad rows dropped, hostile st normalized",
    g.length === 2 && g[0].r === 1 && g[1].st === "stale" && g[1].r === 0);
  ok("gaps bounded to cap", app.sanitizeGaps(
    Array.from({ length: 40 }, (_, i) => ({ s: i, e: i + 1, d: 1 }))).length <= app.GAP_EVENT_CAP);
  ok("gaps: non-array → null", app.sanitizeGaps("x") === null && app.sanitizeGaps(null) === null);
}

group("ble packet security");
if (app.parseGeneralStatus) {
  // Structural minimums — short/truncated packets must return null.
  ok("short GS/GS1/GS2/stroke packets rejected",
    app.parseGeneralStatus(new Uint8Array(18)) === null &&
    app.parseGeneralStatus1(new Uint8Array(15)) === null &&
    app.parseGeneralStatus2(new Uint8Array(19)) === null &&
    app.parseStrokeData(new Uint8Array(19)) === null);
  ok("PKT_MIN_LEN matches parser minimums",
    app.PKT_MIN_LEN.gs === 19 && app.PKT_MIN_LEN.stroke === 20 && app.PKT_MIN_LEN.force === 2);
  // Round trip through the sim builders = real byte layouts.
  const gs = app.parseGeneralStatus(app.simPktGS({ elapsedS: 62.5, distanceM: 250.3, workoutState: 3 }));
  ok("sim GS round-trips through the real parser",
    Math.abs(gs.elapsed_time_s - 62.5) < 0.011 && Math.abs(gs.distance_m - 250.3) < 0.11 &&
    gs.workout_state === 3);
  const st = app.parseStrokeData(app.simPktStroke({ elapsedS: 30, distanceM: 120, dl: 1.42, dt: 0.82, rt: 1.61, pf: 155.5, strokeCount: 17 }));
  ok("sim stroke round-trips (DL/times/force/count)",
    Math.abs(st.drive_length_m - 1.42) < 0.011 && Math.abs(st.peak_force_lbs - 155.5) < 0.11 &&
    st.stroke_count === 17);
  const fc = app.parseForceCurve(app.simPktForce(0, 2, [10, 55.5, 120]));
  ok("sim force-curve round-trips (seq/samples)",
    fc.seq === 0 && fc.totalPackets === 2 && fc.samples.length === 3 &&
    Math.abs(fc.samples[1] - 55.5) < 0.11);
  ok("force curve: truncated sample area reads only what exists",
    app.parseForceCurve(new Uint8Array([0x2F, 0, 1, 0])).samples.length === 1);
  ok("force curve: declared count never drives allocation",
    app.parseForceCurve(new Uint8Array([0x0F, 0])).samples.length === 0);
  // Handlers: malformed input counted, not applied; no exception.
  const ctl = app.initTransportLayer();
  ctl.live.reset();
  const rej0 = ctl.live.rejected.gs;
  app.onGS(new Uint8Array(4));
  ok("handler rejects short packet and counts it",
    ctl.live.rejected.gs === rej0 + 1 && ctl.live.lastAt.gs === 0);
  // Duplicate stroke notification dropped deterministically.
  app.state.strokeCount = 0;
  const pkt = app.simPktStroke({ elapsedS: 10, distanceM: 40, strokeCount: 5 });
  app.onStroke(pkt);
  const afterFirst = app.state.strokeCount;
  app.onStroke(pkt);
  ok("exact duplicate stroke packet dropped",
    app.state.strokeCount === afterFirst && ctl.live.rejected.stroke >= 1);
  ok("oversized force packet rejected at the boundary", (() => {
    const rejF = ctl.live.rejected.force;
    app.onForce(new Uint8Array(300));
    return ctl.live.rejected.force === rejF + 1; })());
  ok("repeated malformed notifications stay bounded and non-throwing", (() => {
    for (let i = 0; i < 500; i++) app.onGS(new Uint8Array(1));
    return ctl.live.rejected.gs >= 500; })());
  ok("parsers never mutate their input", (() => {
    const p = app.simPktGS({ elapsedS: 10 });
    const snap = Array.from(p);
    app.parseGeneralStatus(p);
    return JSON.stringify(Array.from(p)) === JSON.stringify(snap); })());
}

group("ble diagnostics redaction");
if (app.createDiagnostics) {
  let t = 0;
  const D = app.createDiagnostics({ now: () => t });
  D.push("state", "live");
  t = 2500; D.push("error", "subscribe-failed:0031");
  ok("bounded buffer", (() => {
    for (let i = 0; i < 150; i++) D.push("state", "x");
    return D.events.length <= app.DIAG_EVENT_CAP; })());
  D.push("state", "PM5 Serial 430012345 <Bob's erg>");   // hostile/free-form detail
  ok("free-form details are redacted at entry",
    D.events.some(e => e.d === "redacted") && !JSON.stringify(D.events).includes("Serial 43001"));
  const exp = D.exportSafe({ state: "live" });
  const blob = JSON.stringify(exp);
  ok("export is slug-whitelisted again at export time",
    exp.events.every(e => /^[a-z0-9:._%|-]{0,48}$/i.test(e.d)));
  ok("export carries no identifiers, tokens, packets, or workout text",
    !/Serial|Bob|ya29|Bearer|deadbeef|strokes/.test(blob));
  ok("export declares its own contents", /no device identifiers/i.test(exp.note));
  ok("relative timestamps only (no wall-clock)", exp.events.every(e => typeof e.t === "number" && e.t < 1e6));
}

group("ble session integrity + regression");
if (app.sanitizeCaptureMeta && app.importSessionsFromText) {
  // Import path: capture + gaps whitelisted; hostile dropped.
  app.state.history = [];
  app.importSessionsFromText(JSON.stringify({ kind: "pm5-history-export", history: [
    { id: "INT1", date: "2026-07-20T10:00:00Z", title: "interrupted row",
      totals: { distanceM: 3000, elapsedS: 720 },
      strokes: Array.from({ length: 20 }, (_, j) => ({ t: j * 2, d: j * 150, p: 120, dl: 1.35, dt: 0.8, rt: 1.6 })),
      capture: "interrupted-gap", gaps: [{ s: 100, e: 112, d: 12, st: "disconnected", r: 0 }] },
    { id: "INT2", date: "2026-07-19T10:00:00Z", title: "hostile capture",
      totals: { distanceM: 100, elapsedS: 30 }, strokes: [{ t: 0, d: 0 }, { t: 2, d: 10 }],
      capture: "<script>alert(1)</script>", gaps: { evil: 1 } },
  ] }));
  const i1 = app.state.history.find(e => e.id === "INT1");
  const i2 = app.state.history.find(e => e.id === "INT2");
  ok("valid capture meta + gaps survive import",
    i1.capture === "interrupted-gap" && i1.gaps.length === 1 && i1.gaps[0].d === 12);
  ok("hostile capture meta + gaps dropped",
    i2 && !("capture" in i2) && !("gaps" in i2));
  // Insights treats interruption as a completeness limitation, not exclusion.
  const f1 = app.sessionFacts(i1);
  ok("interrupted sessions stay in cohorts, flagged",
    f1.interrupted === true &&
    app.buildInsightsCohort([i1], { nowMs: Date.parse(i1.date) + 3600e3, range: "7d" }).a.facts.length === 1);
  app.state.history = [];
  // Local cohort-date labels (the v1.22 fix): local constructor round-trips.
  ok("cohort date labels use LOCAL days (winter + summer + today)",
    app.insFmtDay(new Date(2026, 0, 15, 0, 5).getTime()) === "2026-01-15" &&
    app.insFmtDay(new Date(2026, 6, 15, 23, 55).getTime()) === "2026-07-15" &&
    app.insFmtDay(new Date(2026, 2, 8, 12).getTime()) === "2026-03-08");   // US DST boundary day
  ok("capture-quality summary for a clean session", (() => {
    const q = app.bleCaptureQuality();
    return q.capture === "clean" || q.capture === null || q.capture === "simulated"; })());
}

group("rowtrace brand");
{
  const html = fs.readFileSync(INDEX, "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(INDEX), "manifest.json"), "utf8"));
  const sw = fs.readFileSync(path.join(path.dirname(INDEX), "sw.js"), "utf8");
  const svg = fs.readFileSync(path.join(path.dirname(INDEX), "icon.svg"), "utf8");
  const tjs = fs.readFileSync(path.join(path.dirname(INDEX), "transport.js"), "utf8");
  ok("document title is RowTrace", html.includes("<title>RowTrace"));
  ok("header wordmark + tagline", html.includes(">ROWTRACE<") && html.includes("Every stroke, explained."));
  ok("metadata + Open Graph branded",
    html.includes('name="description" content="RowTrace') && html.includes('og:title" content="RowTrace"'));
  ok("manifest name + short_name are RowTrace", manifest.name === "RowTrace" && manifest.short_name === "RowTrace");
  ok("manifest keeps PNG icons and adds SVG",
    manifest.icons.some(i => i.src === "icon.svg") && manifest.icons.some(i => i.src === "icon-512.png"));
  ok("app version 1.24.0", html.includes('APP_VERSION = "1.24.0"'));
  ok("sw cache is rowtrace-v51 with icon.svg in shell",
    sw.includes('"rowtrace-v51"') && sw.includes("./icon.svg"));
  ok("sw deletes only our own obsolete caches", sw.includes("pm5-v|rowtrace-v"));
  ok("icon.svg is script-free and original",
    !/script|onload|onerror|href/i.test(svg) && svg.includes("RowTrace"));
  ok("exports carry RowTrace producer, legacy kinds retained",
    html.includes('kind: "pm5-history-export", producer: "RowTrace"') &&
    html.includes('kind: "pm5-session-export", producer: "RowTrace"'));
  ok("diagnostics export carries producer",
    tjs.includes('pm5-connection-diagnostics", producer: "RowTrace"'));
  ok("export filenames are RowTrace-branded",
    html.includes("rowtrace-history-") && !html.includes("`pm5-history-${"));
  const oldName = (html.match(/PM5 Dashboard/g) || []).length;
  ok("old product name only in the allowlisted migration message",
    oldName === 3 && html.includes("PM5 Dashboard is now RowTrace"));
  ok("no mixed product names anywhere", ["RowTrace Dashboard", "PM5 RowTrace", "RowTrace PM5"]
    .every(x => !html.includes(x) && !sw.includes(x)));
  ok("device term PM5 retained where accurate", tjs.includes("PM5 live") && html.includes("PM5"));
  ok("legacy import signature untouched for compatibility",
    html.includes('"pm5-history-export"') && html.includes("pm5_history_"));
}
// ---------------------------------------------------------------------
// 8. App-size guard (#25) — keep the whole offline app under budget.
// Budget history: 600 KB (index.html only) through v1.17.0; 660 KB in
// v1.18.0; v1.20.0 split the pure analysis layer into analysis.js and
// the guard now measures the TOTAL offline application (index.html +
// analysis.js + sw.js) so the modular split cannot be used to evade
// the discipline. 768 KB total, and index.html alone must stay under
// the old 660 KB ceiling.
// ---------------------------------------------------------------------
group("app size");
// Budget history: 600 KB (index only) → 660 KB (v1.18) → total-app
// guard 768 KB (v1.20, three files). v1.22.0 adds insights.js (~55 KB
// of cross-session engine + page) after measured cleanup freed ~3 KB
// of stale comments/markup; a responsible implementation could not fit
// under 768, so the TOTAL limit moved once to 832 KB — documented in
// CHANGELOG.md and docs/architecture.md. index.html keeps its 660 KB
// cap, every offline asset is measured here, and no code ships in
// unmeasured assets.
const html = fs.readFileSync(INDEX, "utf8");
const analysisSrc = fs.readFileSync(ANALYSIS, "utf8");
const curvesSrc = fs.readFileSync(path.join(path.dirname(INDEX), "curves.js"), "utf8");
const insightsSrc = fs.readFileSync(path.join(path.dirname(INDEX), "insights.js"), "utf8");
const transportSrc = fs.readFileSync(path.join(path.dirname(INDEX), "transport.js"), "utf8");
const swSrc = fs.readFileSync(path.join(path.dirname(INDEX), "sw.js"), "utf8");
const idxKb = Buffer.byteLength(html, "utf8") / 1024;
const anaKb = Buffer.byteLength(analysisSrc, "utf8") / 1024;
const curKb = Buffer.byteLength(curvesSrc, "utf8") / 1024;
const insKb = Buffer.byteLength(insightsSrc, "utf8") / 1024;
const traKb = Buffer.byteLength(transportSrc, "utf8") / 1024;
const swKb = Buffer.byteLength(swSrc, "utf8") / 1024;
const totalKb = idxKb + anaKb + curKb + insKb + traKb + swKb;
console.log(`  index.html = ${idxKb.toFixed(0)} KB · analysis.js = ${anaKb.toFixed(0)} KB · curves.js = ${curKb.toFixed(0)} KB · insights.js = ${insKb.toFixed(0)} KB · transport.js = ${traKb.toFixed(0)} KB · sw.js = ${swKb.toFixed(0)} KB · total = ${totalKb.toFixed(0)} KB`);
ok("index.html under 660 KB", idxKb < 660);
// v1.23.0: transport.js (~20 KB BLE state machine + watchdog +
// diagnostics + simulator) could not fit under 832 KB after measured
// cleanup (~2.8 KB of dead branches/comments/stale release notes
// removed first); the limit moved to the smallest sufficient enforced
// value — 860 KB, actual ~857 KB — documented in CHANGELOG.md and
// docs/architecture.md. Ceiling permitted by the release plan: 864 KB.
ok("total offline app under 860 KB", totalKb < 860);

// ---------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
