/**
 * Pre-upload self-check for the Edge Add-ons submission.
 *
 *   pnpm run preflight              full check, including the published privacy policy
 *   pnpm run preflight --offline    skip the network step (used by CI)
 *
 * Everything it looks at is something a store reviewer can reject you for:
 * the wrong files in the package, manifest.json not at the archive root, a
 * description that is too short, a screenshot in the wrong size, or a privacy
 * policy URL that 404s because the repository is still private. It never
 * writes anything — it only reads the tree, rebuilds the ZIP in memory and
 * compares it with the one in dist/.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, extensionFiles, assertLoadable } from "./files.mjs";
import { createZip } from "./zip.mjs";

const PRIVACY_URL = "https://moyisuosheng.github.io/gestio/privacy-policy.html";
const SHOT_SIZES = ["1280x800", "640x480"];
const MAX_SHORT_DESC = 132;
const MIN_LONG_DESC = 250;

const offline = process.argv.slice(2).includes("--offline");

let failures = 0;
let warnings = 0;

const group = (title) => console.log(`\n${title}`);
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
const bad = (label, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
};
const warn = (label, detail = "") => {
  warnings += 1;
  console.log(`  WARN  ${label}${detail ? `  (${detail})` : ""}`);
};

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const chars = (s) => [...s].length;

/* ------------------------------------------------------------------ helpers */

/** Width/height from a PNG's IHDR chunk. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Entry names from a ZIP central directory, or null if the file is not a ZIP. */
function zipEntryNames(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.toString("utf8", offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** The fenced block that follows a `## heading` in docs/store-listing.md. */
function fencedBlock(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const open = text.indexOf("```", start);
  if (open < 0) return null;
  const from = text.indexOf("\n", open) + 1;
  const close = text.indexOf("```", from);
  if (close < 0) return null;
  return text.slice(from, close).trim();
}

/** Backtick-quoted values in the `| Search terms | ... |` row of the metadata table. */
function backtickValues(text, rowLabel) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`| ${rowLabel}`));
  if (!line) return null;
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/* --------------------------------------------------------- 1. the package */

group("Package");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const { manifest, files } = assertLoadable();

if (manifest.version === pkg.version) ok(`version is ${manifest.version} in manifest.json and package.json`);
else bad("version mismatch", `manifest ${manifest.version} vs package.json ${pkg.version}`);

const zipFile = path.join(ROOT, "dist", `gestio-${manifest.version}.zip`);
if (!fs.existsSync(zipFile)) {
  bad("store package exists", `run "pnpm run pack" — expected dist/gestio-${manifest.version}.zip`);
} else {
  const onDisk = fs.readFileSync(zipFile);
  const names = zipEntryNames(onDisk);

  if (!names) {
    bad("package is a readable ZIP");
  } else {
    const expected = extensionFiles();
    const fresh = createZip(files.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(ROOT, rel)) })));

    if (names[0] === "manifest.json") ok("manifest.json sits at the archive root, as the first entry");
    else if (names.includes("manifest.json")) {
      ok("manifest.json sits at the archive root", `entry ${names.indexOf("manifest.json") + 1} of ${names.length}`);
    } else if (names.some((n) => n.endsWith("/manifest.json"))) {
      bad("manifest.json is nested in a folder", names.find((n) => n.endsWith("/manifest.json")));
    } else {
      bad("manifest.json is in the package");
    }

    const missing = expected.filter((f) => !names.includes(f));
    const extra = names.filter((f) => !expected.includes(f));
    if (missing.length) bad("package holds every extension file", `missing ${missing.join(", ")}`);
    else if (extra.length) bad("package holds nothing else", `unexpected ${extra.join(", ")}`);
    else ok(`package holds exactly the ${names.length} extension files`);

    if (onDisk.equals(fresh)) ok(`dist/gestio-${manifest.version}.zip is up to date`, kb(onDisk.length));
    else bad("package matches the current sources", 'rebuild it: "pnpm run pack"');

    const forbidden = names.filter((n) =>
      /(^|\/)(key\.pem|package\.json|pnpm-lock\.yaml|tests|docs|node_modules|\.git)(\/|$)/.test(n) || n.endsWith(".pem"),
    );
    if (forbidden.length) bad("no private key, tests or docs inside", forbidden.join(", "));
    else ok("no private key, tests or docs inside");
  }
}

/* ------------------------------------------------------- 2. store listing */

group("Store listing copy");
const listing = readIfExists(path.join(ROOT, "docs", "store-listing.md"));

if (!listing) {
  bad("docs/store-listing.md exists");
} else {
  for (const [locale, label] of [
    ["en", "en"],
    ["zh_CN", "zh_CN"],
  ]) {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales", locale, "messages.json"), "utf8"));
    const short = messages.appDescription?.message ?? "";
    const len = chars(short);
    if (len === 0) bad(`${label} short description present`);
    else if (len > MAX_SHORT_DESC) bad(`${label} short description is under ${MAX_SHORT_DESC} chars`, `${len} chars`);
    else ok(`${label} short description fits the manifest limit`, `${len}/${MAX_SHORT_DESC} chars`);
  }

  for (const [heading, label] of [
    ["## English description", "English long description"],
    ["## 中文描述", "Chinese long description"],
  ]) {
    const block = fencedBlock(listing, heading);
    if (!block) bad(`${label} present in store-listing.md`);
    else if (chars(block) < MIN_LONG_DESC) bad(`${label} is at least ${MIN_LONG_DESC} chars`, `${chars(block)} chars`);
    else ok(`${label} is long enough`, `${chars(block)} chars`);
  }

  const terms = backtickValues(listing, "Search terms");
  if (!terms || terms.length === 0) bad("search terms listed in store-listing.md");
  else if (terms.length > 7) bad("no more than 7 search terms", `${terms.length} found`);
  else {
    const tooLong = terms.filter((t) => chars(t) > 30);
    if (tooLong.length) bad("each search term is under 30 chars", tooLong.join(", "));
    else ok(`search terms fit the form`, `${terms.length}/7, longest ${Math.max(...terms.map(chars))} chars`);
  }

  const urls = [...listing.matchAll(/https:\/\/\S+/g)].map((m) => m[0].replace(/[).,]+$/, ""));
  if (urls.some((u) => u.includes("/issues"))) ok("support URL is filled in");
  else warn("no support URL found", "Partner Center asks for one");

  if (/privacy-policy\.html/.test(listing)) ok("privacy policy URL is filled in");
  else warn("no privacy policy URL found");
}

/* ------------------------------------------------------------ 3. artwork */

group("Artwork");
const shotsDir = path.join(ROOT, "docs", "screenshots");
const logo = path.join(shotsDir, "logo-300.png");
if (!fs.existsSync(logo)) bad("docs/screenshots/logo-300.png exists");
else {
  const s = pngSize(logo);
  if (s && s.width === 300 && s.height === 300) ok("store logo is 300x300");
  else bad("store logo is 300x300", s ? `${s.width}x${s.height}` : "unreadable PNG");
}

const shots = fs.existsSync(shotsDir)
  ? fs
      .readdirSync(shotsDir)
      .filter((f) => f.endsWith(".png") && !f.startsWith("logo") && !f.startsWith("promo"))
  : [];
if (shots.length === 0) bad("at least one screenshot in docs/screenshots");
else {
  const wrong = shots.filter((f) => {
    const s = pngSize(path.join(shotsDir, f));
    return !s || !SHOT_SIZES.includes(`${s.width}x${s.height}`);
  });
  if (wrong.length) bad(`every screenshot is ${SHOT_SIZES.join(" or ")}`, wrong.join(", "));
  else ok(`all ${shots.length} screenshots use ${SHOT_SIZES.join(" / ")}`);
}

for (const [file, size] of [
  ["promo-440x280.png", "440x280"],
  ["promo-1400x560.png", "1400x560"],
]) {
  const p = path.join(shotsDir, file);
  if (!fs.existsSync(p)) continue;
  const s = pngSize(p);
  if (s && `${s.width}x${s.height}` === size) ok(`${file} is ${size}`);
  else bad(`${file} is ${size}`, s ? `${s.width}x${s.height}` : "unreadable PNG");
}

/* ------------------------------------------------- 4. privacy policy page */

group("Privacy policy");
const policyFile = path.join(ROOT, "docs", "privacy-policy.html");
const policy = readIfExists(policyFile);

if (!policy) bad("docs/privacy-policy.html exists");
else {
  if (/Questions about this policy/i.test(policy) && /issues/.test(policy)) ok("policy has a reachable contact route");
  else warn("policy has no contact route", "add a GitHub Issues link");
  if (/mailto:/i.test(policy)) warn("policy still uses a mailto: link", "personal address in a public page");
  else ok("no personal email on the policy page");
}

if (offline) {
  warn("skipped the live URL check", "--offline");
} else if (!policy) {
  warn("skipped the live URL check", "no local page to compare against");
} else {
  const local = policy.replace(/\r\n/g, "\n").trim();
  try {
    const res = await fetch(PRIVACY_URL, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      bad(`privacy policy URL answers 200`, `${res.status} ${res.statusText} — repository still private, or Pages not enabled`);
    } else {
      const remote = (await res.text()).replace(/\r\n/g, "\n").trim();
      if (remote === local) ok("published policy matches docs/privacy-policy.html");
      else if (remote.includes("Gestio")) warn("published policy differs from the local file", "Pages may not have rebuilt yet");
      else bad("published page looks like the policy", "unexpected content");
    }
  } catch (err) {
    bad("privacy policy URL is reachable", err.name === "TimeoutError" ? "timed out" : err.message);
  }
}

/* ------------------------------------------------------------ 5. hygiene */

group("Hygiene");
const emailish = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const leaks = files
  .map((rel) => [rel, (fs.readFileSync(path.join(ROOT, rel), "utf8").match(emailish) || []).join(" ")])
  .filter(([, hit]) => hit);
if (leaks.length) bad("no email address ships inside the extension", leaks.map(([f]) => f).join(", "));
else ok("no email address ships inside the extension");

const publicDocs = ["README.md", "README.zh-CN.md", ...["docs"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`))];
const docLeaks = publicDocs.filter((rel) => {
  const text = readIfExists(path.join(ROOT, rel));
  if (!text) return false;
  return (text.match(emailish) || []).some((e) => !e.endsWith("users.noreply.github.com"));
});
if (docLeaks.length) warn("personal email in public docs", docLeaks.join(", "));
else ok("public docs carry no personal email");

const gitignore = readIfExists(path.join(ROOT, ".gitignore")) || "";
if (/key\.pem/.test(gitignore) && /\*\.pem/.test(gitignore)) ok("key.pem is gitignored");
else warn("key.pem is not gitignored", "the signing key must never be committed");

/* ------------------------------------------------------------- 6. verdict */

console.log("");
if (failures === 0) {
  console.log(`READY  ${failures} failures, ${warnings} warnings — the package, the copy and the policy page check out.`);
  process.exit(0);
}
console.log(`NOT READY  ${failures} failure(s), ${warnings} warning(s). Fix the FAIL lines above before uploading.`);
process.exit(1);
