/**
 * Builds a CRX3 package you can drag into a Chromium-based browser.
 *
 *   pnpm run pack:crx                        -> dist/gestio-<version>.crx
 *   CRX_KEY=./key.pem pnpm run pack:crx      -> sign with an existing key
 *
 * The signing itself is delegated to Chrome/Edge (--pack-extension). Hand-rolling
 * the CRX3 protobuf is easy to get subtly wrong and the result fails with
 * CRX_SIGNATURE_VERIFICATION_FAILED, so we let the browser do it and only stage
 * a clean copy of the extension first (no node_modules, no tests).
 *
 * A CRX is only needed for sideloading / self-distribution. Store uploads take
 * the ZIP from `pnpm run pack`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, extensionFiles, assertLoadable } from "./files.mjs";

const { manifest, files } = assertLoadable();

const CANDIDATES = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];

const findBrowser = () => {
  for (const candidate of CANDIDATES) if (candidate && fs.existsSync(candidate)) return candidate;
  throw new Error("Chrome/Edge not found. Set CHROME_BIN to the browser executable.");
};

const browser = findBrowser();
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "gestio-crx-"));
const staged = path.join(staging, "extension");

for (const rel of files) {
  const dest = path.join(staged, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
}

// The key decides the extension ID. Keep it next to the project (gitignored) so
// rebuilds keep the same identity and installs behave as updates, not as a
// second copy of the extension.
const keyPath = process.env.CRX_KEY || path.join(ROOT, "key.pem");
const args = [
  `--pack-extension=${staged}`,
  `--user-data-dir=${path.join(staging, "profile")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--headless=new",
];
if (fs.existsSync(keyPath)) args.push(`--pack-extension-key=${keyPath}`);

console.log(`browser: ${browser}`);
console.log(`key:     ${fs.existsSync(keyPath) ? keyPath : "(new key will be created)"}`);

const proc = spawnSync(browser, args, { encoding: "utf8", timeout: 120_000 });
const producedCrx = `${staged}.crx`;
const producedPem = `${staged}.pem`;

if (!fs.existsSync(producedCrx)) {
  console.error("Chrome did not produce a CRX.");
  if (proc.stderr) console.error(proc.stderr.trim().slice(0, 800));
  process.exit(1);
}

if (!fs.existsSync(keyPath)) {
  if (!fs.existsSync(producedPem)) {
    console.error("No key was produced; cannot keep a stable extension ID.");
    process.exit(1);
  }
  fs.copyFileSync(producedPem, keyPath);
  console.log(`new key saved to ${path.relative(ROOT, keyPath)} — keep it, it defines the extension ID`);
}

const data = fs.readFileSync(producedCrx);
const okMagic = data.subarray(0, 4).toString("latin1") === "Cr24";
const version = okMagic ? data.readUInt32LE(4) : 0;
const headerLength = version === 3 ? data.readUInt32LE(8) : 0;
const zipStart = 12 + headerLength;
const okZip = data.subarray(zipStart, zipStart + 4).toString("latin1") === "PK\u0003\u0004";

if (!okMagic || version !== 3 || !okZip) {
  console.error(`CRX looks invalid (magic=${okMagic}, version=${version}, zip=${okZip})`);
  process.exit(1);
}

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `gestio-${manifest.version}.crx`);
fs.writeFileSync(outFile, data);

console.log(`packed CRX3, ${files.length} files, ${(data.length / 1024).toFixed(1)} KB -> ${path.relative(ROOT, outFile)}`);

fs.rmSync(staging, { recursive: true, force: true });
