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
  ok("report has a title", /# PM5 Dashboard — Training report/.test(rep));
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
// 8. Bundle-size guard (#25) — keep the single file under budget.
// Budget history: 600 KB through v1.17.0; raised to 660 KB in v1.18.0
// to fund stroke capture + stroke replay + session compare + the
// efficiency/drift analytics (first raise since the v1.15.1 dead-code
// reset — the discipline stands, the ceiling moved once for a major
// feature release).
// ---------------------------------------------------------------------
group("bundle size");
const html = fs.readFileSync(INDEX, "utf8");
const kb = Buffer.byteLength(html, "utf8") / 1024;
console.log(`  index.html = ${kb.toFixed(0)} KB`);
ok("index.html under 660 KB", kb < 660);

// ---------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
