/**
 * The single list of files that make up the extension.
 *
 * Both pack scripts use it, so the store package can never accidentally contain
 * tests, node_modules, the private key or the git metadata — only what the
 * browser actually loads.
 *
 * Keep this list in sync with manifest.json when adding a new top-level file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TOP_LEVEL = [
  "manifest.json",
  "background.js",
  "i18n.js",
  "settings.json",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "guide.html",
  "guide.js",
];

const DIRECTORIES = ["_locales", "icons", "content"];

const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
};

/** Every file the browser needs, as POSIX-style paths relative to `root`. */
export function extensionFiles(root = ROOT) {
  const files = TOP_LEVEL.filter((rel) => fs.existsSync(path.join(root, rel)));
  for (const dir of DIRECTORIES) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walk(abs, root)) files.push(rel);
  }
  return files.sort();
}

/** Throws if the file list does not look like a loadable extension. */
export function assertLoadable(root = ROOT) {
  const manifestPath = path.join(root, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json missing in ${root}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const list = extensionFiles(root);
  const files = new Set(list);

  const referenced = [];
  if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
  if (manifest.options_page) referenced.push(manifest.options_page);
  if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);
  for (const cs of manifest.content_scripts || []) {
    referenced.push(...(cs.js || []), ...(cs.css || []));
  }
  for (const icon of Object.values(manifest.icons || {})) referenced.push(icon);
  for (const icon of Object.values(manifest.action?.default_icon || {})) referenced.push(icon);

  const missing = referenced.filter((rel) => !files.has(rel));
  if (missing.length) throw new Error(`files referenced by manifest.json are missing: ${missing.join(", ")}`);

  return { manifest, files: list };
}
