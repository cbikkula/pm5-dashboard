// Standalone syntax check for the app's scripts (v1.20.0: two classic
// scripts — pm5web/analysis.js and the inline main script). Used by CI
// so a broken edit fails the build before tests run.
const fs = require("fs");
const path = require("path");

const idxFile = path.join(__dirname, "..", "pm5web", "index.html");
const anaFile = path.join(__dirname, "..", "pm5web", "analysis.js");

const analysis = fs.readFileSync(anaFile, "utf8");
try {
  new Function(analysis);
} catch (e) {
  console.error("Syntax error in analysis.js:", e.message);
  process.exit(1);
}

const html = fs.readFileSync(idxFile, "utf8");
const blocks = [...html.matchAll(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/g)];
if (blocks.length < 2) {
  console.error("Expected a module + main script block in index.html");
  process.exit(1);
}
// Largest block is the main classic script.
let main = blocks[0][1];
for (const b of blocks) if (b[1].length > main.length) main = b[1];

try {
  // Parse without executing.
  new Function(main);
  console.log(`Syntax OK (${(analysis.length / 1024).toFixed(0)} KB analysis + ${(main.length / 1024).toFixed(0)} KB main script)`);
  process.exit(0);
} catch (e) {
  console.error("Syntax error in main script:", e.message);
  process.exit(1);
}
