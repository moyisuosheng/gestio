/**
 * Builds the store-ready ZIP.
 *
 *   pnpm run pack          -> dist/gestio-<version>.zip
 *
 * The archive contains exactly the files the browser loads (see scripts/files.mjs),
 * with manifest.json at the root — that is what Edge Add-ons and the Chrome Web
 * Store expect for an upload.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, extensionFiles, assertLoadable } from "./files.mjs";
import { createZip } from "./zip.mjs";

const { manifest, files } = assertLoadable();

const entries = files.map((rel) => ({
  name: rel,
  data: fs.readFileSync(path.join(ROOT, rel)),
}));

const zip = createZip(entries);
const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `gestio-${manifest.version}.zip`);
fs.writeFileSync(outFile, zip);

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`packed ${files.length} files  (${kb(zip.length)})  ->  ${path.relative(ROOT, outFile)}`);
console.log(`version ${manifest.version}, min Chromium ${manifest.minimum_chrome_version || "n/a"}`);
