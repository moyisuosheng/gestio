# Building and packaging

Two different artefacts come out of this repository. Pick by destination:

| Destination | Artefact | Command |
| --- | --- | --- |
| Edge Add-ons / Chrome Web Store | `.zip` | `pnpm run pack` |
| Sideloading into your own browser | `.crx` | `pnpm run pack:crx` |

Both are built from the same file list (`scripts/files.mjs`), so the store package and the local
build can never drift apart.

## 1. The store ZIP

```bash
pnpm run pack
# packed 20 files (92.3 KB) -> dist/gestio-1.0.23.zip
```

The archive contains only files the browser loads, with `manifest.json` **at the root** — that is
what both stores require. Tests, `node_modules`, docs, the private key and `.git` are excluded by
construction (allowlist, not a deny list).

## 2. The CRX

### Option A — the script (recommended)

```bash
pnpm run pack:crx
# browser: C:/Program Files/Google/Chrome/Application/chrome.exe
# key:     .../key.pem
# packed CRX3, 20 files, 94.0 KB -> dist/gestio-1.0.23.crx
```

It stages a clean copy of the extension in the system temp directory, asks Chrome/Edge to sign it
(`--pack-extension`), verifies the CRX3 header, and copies the result to `dist/`.

### Option B — the browser UI

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**; the **Pack extension** button appears.
3. *Extension root directory*: the repository root (the folder holding `manifest.json`).
4. *Private key file*: `key.pem` if you have one. **Leave it empty the first time** — the browser
   then generates `gestio.pem` next to the folder and prints the extension ID.
5. Pack. You get `gestio.crx` (and `.pem` if it generated one).

### Option C — the command line directly

```bash
chrome --pack-extension=/path/to/gestio --pack-extension-key=/path/to/key.pem
```

Chrome writes `<folder>.crx` next to the folder. It refuses to run if a `<folder>.pem` already
exists and no key was passed, so delete stale files first.

## Why the private key matters

The key **is** the extension identity: the ID is the first 16 bytes of SHA-256 over the public key,
mapped onto `a`–`p`. Consequences:

- Same key + higher `version` → browsers treat the package as an **update**.
- Different key → a **second, separate extension**; user settings do not carry over.
- Lose the key → you can never update that listing again (you must publish a new extension ID).

`key.pem` is gitignored. Back it up somewhere safe; it cannot be regenerated.

To print the ID from a key:

```bash
openssl rsa -in key.pem -pubout -outform DER \
  | openssl dgst -sha256 -binary \
  | xxd -p -c 32 | cut -c1-32
```

Take each hex digit `0–f` and map it to `a–p` (0→a, 1→b, … f→p) to get the extension ID.

## Verifying a build

```bash
pnpm test                # 252 assertions, jsdom
pnpm run test:browser    # real Chrome/Edge, real pointer events
pnpm run preflight       # package, store copy, artwork, live policy URL
```

`preflight` exits non-zero on anything a reviewer would reject: wrong files in the archive,
`manifest.json` not at the root, a description under 250 characters, a screenshot that is not
1280×800, or a privacy policy URL that does not answer 200. Add `--offline` to skip the network step.

Then load it once by hand:

1. `edge://extensions` → Developer mode → **Load unpacked** → repository root.
2. Open any page with an HTML5 video (an `http(s)` page — not a local file).
3. Long-press the video: the speed tiers should appear; drag left/right and the rate changes.
4. Open the popup: the status line should say *Active on this page*.

For a CRX, drag it onto the extensions page. Recent Chromium versions may refuse self-signed CRX
unless the policy `ExtensionInstallAllowlist` / developer mode allows it — that is expected and is
why developer mode is the reliable path.

## Common errors

| Symptom | Cause |
| --- | --- |
| `CRX_SIGNATURE_VERIFICATION_FAILED` | The CRX was hand-assembled or signed with a different key than the one the browser knows for that ID. Pack with the browser instead. |
| `Package is invalid: 'manifest.json' is missing or unreadable` | The ZIP has a top-level folder instead of `manifest.json` at the root. |
| Store rejects with “version must be greater” | `manifest.json` version was not bumped. |
| Chrome does not produce the CRX | A `<folder>.pem` already exists; delete it, or pass `--pack-extension-key`. |
| Extension loads but gestures do nothing | The page is `content://` / `file://` / a browser-internal page, or the video is inside a cross-origin iframe (content scripts run in the top frame only). |
