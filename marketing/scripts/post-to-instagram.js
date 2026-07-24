#!/usr/bin/env node
/* RowTracer — Instagram publish script (Graph API, owner-token model).
 *
 * SECURITY MODEL: the access token and IG user id live ONLY in
 * environment variables set by the owner. This script never logs,
 * stores, or echoes them; API errors are printed with the token
 * redacted. Nothing here creates accounts or stores credentials.
 *
 * Owner setup (one time): see marketing/README.md. Required env:
 *   ROWTRACER_IG_TOKEN    — long-lived Page access token with
 *                           instagram_content_publish
 *   ROWTRACER_IG_USER_ID  — the Instagram Business account id
 *
 * Usage:
 *   node marketing/scripts/post-to-instagram.js \
 *     --image marketing/instagram/rowtracer-launch.png \
 *     --caption marketing/instagram/rowtracer-launch-caption.md \
 *     [--dry-run] [--yes]
 *
 * Approval gate: refuses to publish unless --yes is passed OR a file
 * named <image>.APPROVED exists next to the image. Claude can generate
 * and queue posts autonomously; a human creates the approval.
 *
 * Image hosting: the Graph API needs a PUBLIC image URL. Repo-relative
 * paths are resolved to raw.githubusercontent.com on main — the script
 * verifies the file is committed and pushed first.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);

const imageArg = opt("--image");
const captionFile = opt("--caption");
if (!imageArg || !captionFile) {
  console.error("usage: --image <path|url> --caption <file> [--dry-run] [--yes]");
  process.exit(1);
}

// Caption: first section of the caption file up to the "## Alt text"
// heading (so the queued .md can hold caption + alt + notes together).
let caption = fs.readFileSync(captionFile, "utf8");
caption = caption.split(/^## /m)[0].replace(/^# .*\n/, "").trim();
if (!caption || caption.length > 2200) {
  console.error("caption missing or over Instagram's 2200-char limit");
  process.exit(1);
}

// Resolve the image to a public URL.
let imageUrl = imageArg;
if (!/^https?:\/\//.test(imageArg)) {
  const abs = path.resolve(imageArg);
  if (!fs.existsSync(abs)) { console.error("image not found:", imageArg); process.exit(1); }
  const rel = path.relative(execSync("git rev-parse --show-toplevel").toString().trim(), abs)
    .replace(/\\/g, "/");
  // Must be committed AND pushed so the raw URL actually serves it.
  const inHead = execSync(`git ls-tree -r origin/main --name-only`).toString().split("\n").includes(rel);
  if (!inHead) { console.error("image is not pushed to origin/main yet:", rel); process.exit(1); }
  imageUrl = `https://raw.githubusercontent.com/cbikkula/pm5-dashboard/main/${rel}`;
}

// Approval gate.
const approved = has("--yes") ||
  (!/^https?:\/\//.test(imageArg) && fs.existsSync(path.resolve(imageArg) + ".APPROVED"));
if (!approved && !has("--dry-run")) {
  console.error("not approved: pass --yes or create " + imageArg + ".APPROVED");
  process.exit(1);
}

const token = process.env.ROWTRACER_IG_TOKEN;
const igUser = process.env.ROWTRACER_IG_USER_ID;
if (has("--dry-run")) {
  console.log("[dry-run] would publish:");
  console.log("  image_url:", imageUrl);
  console.log("  caption:", caption.slice(0, 120).replace(/\n/g, " ") + (caption.length > 120 ? "…" : ""));
  console.log("  token present:", !!token, "· ig user present:", !!igUser);
  process.exit(0);
}
if (!token || !igUser) {
  console.error("ROWTRACER_IG_TOKEN / ROWTRACER_IG_USER_ID not set (owner setup — see marketing/README.md)");
  process.exit(1);
}

const redact = (s) => String(s).split(token).join("[REDACTED]");
(async () => {
  try {
    const mk = await fetch(`https://graph.facebook.com/v21.0/${igUser}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
    });
    const mkJ = await mk.json();
    if (!mkJ.id) throw new Error("container failed: " + redact(JSON.stringify(mkJ)));
    const pub = await fetch(`https://graph.facebook.com/v21.0/${igUser}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: mkJ.id, access_token: token }),
    });
    const pubJ = await pub.json();
    if (!pubJ.id) throw new Error("publish failed: " + redact(JSON.stringify(pubJ)));
    console.log("published: media id", pubJ.id);
  } catch (e) {
    console.error(redact(e.message || e));
    process.exit(1);
  }
})();
