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
