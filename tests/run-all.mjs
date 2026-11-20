/**
 * Runs every Node-level test file in its own process and aggregates the exit
 * codes. Each test file prints its own PASS/FAIL lines, so this runner only
 * summarises.
 *
 * `pnpm test` runs this. Browser tests (tests/browser/*) need a real Chromium
 * and are opt-in: `pnpm run test:browser`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  "gesture-unit-test.js",
  "options-unit-test.js",
  "popup-status-test.js",
  "guide-lang-test.js",
];

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, file)], { stdio: "inherit" });
    child.on("close", (code) => resolve({ file, code: code ?? 1, ms: Date.now() - started }));
  });

const results = [];
for (const file of FILES) results.push(await run(file));

console.log("");
let failed = 0;
for (const r of results) {
  if (r.code !== 0) failed++;
  console.log(`  ${r.code === 0 ? "[ ok ]" : "[FAIL]"}  ${r.file}  (${(r.ms / 1000).toFixed(1)}s)`);
}
console.log("");
if (failed) {
  console.error(`${failed} of ${results.length} test files failed.`);
  process.exit(1);
}
console.log(`All ${results.length} test files passed.`);
