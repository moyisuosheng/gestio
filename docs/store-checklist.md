# Publishing checklist

Two independent tracks. The GitHub one can be done first — the store listing needs a support URL and
a privacy-policy URL anyway.

## A. GitHub

1. **Clean history.** The repository already has its extension files at the root. If you are starting
   from a fresh directory:
   ```bash
   git init
   git add -A
   git commit -m "Gestio 1.0.23"
   ```
   `.gitignore` already excludes `node_modules/`, `dist/`, `key.pem`, `*.crx`, `*.zip`.
2. **Never commit `key.pem`.** It defines the extension ID. Keep a backup outside the repository.
3. **Create the remote** and push:
   ```bash
   git remote add origin https://github.com/moyisuosheng/gestio.git
   git branch -M main
   git push -u origin main
   ```
4. **Enable GitHub Pages** (Settings → Pages → Deploy from branch → `main` / `/docs`).
   The privacy policy then lives at
   `https://moyisuosheng.github.io/gestio/privacy-policy.html` (a project site keeps the `/gestio`
   sub-path). The page has no external assets — the logo is inline SVG — so nothing breaks at that
   sub-path. Pages sites are public even when the repository is private, and **publishing from a
   private repository needs GitHub Pro**; on the Free plan make the repository public first (which
   is the plan anyway once it is open sourced).
5. **Tag the release** so the built package is downloadable without a toolchain:
   ```bash
   pnpm run pack
   git tag v1.0.23 && git push --tags
   ```
   Attach `dist/gestio-1.0.23.zip` to the GitHub release.
6. Contact and repository URLs are already filled in: the public contact channel is GitHub Issues
   (`github.com/moyisuosheng/gestio/issues`), which is also the Support URL. No personal email is
   committed to the repository — supply one only in the Partner Center "Support contact details"
   field if you want it shown publicly on the listing. Only the store links in the README still say
   "_link goes here_" until the listing is approved.

## B. Microsoft Edge Add-ons

1. **Account**: sign in to [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
   with a Microsoft account and register as an Edge extension developer. Registration for the Edge
   program is free (the paid registration is Chrome Web Store, not Edge).
2. **Build the package**: `pnpm run pack` → `dist/gestio-<version>.zip`.
   `manifest.json` must be at the archive root — `scripts/pack.mjs` guarantees that.
3. **Create a new submission**, then work through the wizard:

   | Step | What to provide |
   | --- | --- |
   | Package | the ZIP from step 2 |
   | Availability | Public; all markets (or your subset) |
   | Properties | Category `Productivity`; privacy policy URL; support URL (GitHub issues); website optional |
   | Store listing | Name, short description, full description, 300×300 logo, screenshots, optional promo tiles — all in `docs/store-listing.md` |
   | Search terms | up to 7 |

4. **Assets** — all generated, nothing to design by hand:

   ```bash
   pnpm run shots
   ```

   | File | Size | Required |
   | --- | --- | --- |
   | `docs/screenshots/logo-300.png` | 300×300 | yes |
   | `docs/screenshots/speed-tiers.png` | 1280×800 | yes (at least one screenshot) |
   | `docs/screenshots/seek-preview.png` | 1280×800 | recommended |
   | `docs/screenshots/options.png` | 1280×800 | recommended |
   | `docs/screenshots/guide.png` | 1280×800 | recommended |
   | `docs/screenshots/quick-panel.png` | 1280×800 | recommended |
   | `docs/screenshots/promo-440x280.png` | 440×280 | optional |
   | `docs/screenshots/promo-1400x560.png` | 1400×560 | optional |

5. **Review notes**: paste the test instructions from `docs/store-listing.md`. Reviewers test on a
   desktop browser where a video page is required; without instructions they may open a
   `chrome://` page, see nothing happen, and reject for “not working”.
6. **Submit**. First reviews typically take a few business days.

## Why extensions get rejected (and how this repo avoids it)

| Reason | Avoided by |
| --- | --- |
| Unclear single purpose | Stated in the listing and in the permission answers |
| Missing or vague permission justification | Every permission has a one-line reason in `docs/store-listing.md` |
| Remote code | No `fetch`, no `eval` of network content; everything is bundled |
| Privacy policy missing / not matching behaviour | Policy describes exactly the local-storage-only behaviour |
| “Does nothing” during review | Test instructions with a public video page |
| Screenshots that are mock-ups | `pnpm run shots` renders the shipped pages in a real browser |
| Broken install (manifest not at root) | `scripts/pack.mjs` builds the archive from an allowlist |

## Updating after release

1. Bump `version` in `manifest.json` **and** `package.json`, add a `CHANGELOG.md` entry.
2. `pnpm test && pnpm run pack`.
3. Upload the new ZIP to the same submission; the store rejects an unchanged or lower version.
4. The extension ID stays the same because `key.pem` is reused — existing users get an update, and
   their settings survive.

## Verify before you click publish

```bash
pnpm test       # 252 assertions
pnpm run pack   # 20 files, manifest.json at root
pnpm run preflight  # package, copy, artwork, live policy URL — must say READY
```

Then load the unpacked extension once, open a real video page, and confirm a long press shows the
speed tiers. Screenshots are cheap to regenerate — if the UI changes, run `pnpm run shots` again so the
listing never shows an outdated interface.
