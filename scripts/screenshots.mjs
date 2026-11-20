/**
 * Renders the store assets (screenshots, logo, promo tiles) with a real browser.
 *
 *   pnpm run shots       -> docs/screenshots/*.png
 *
 * Extension pages are loaded over a local HTTP server with a small `chrome.*`
 * stub injected before the page scripts run, so the exact shipped HTML/CSS is
 * what gets captured — no mock-ups. The two on-video shots inject the real
 * content scripts and dispatch real pointer events, so the HUD is the same code
 * path users see.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./files.mjs";

const OUT = path.join(ROOT, "docs", "screenshots");
const PORT = 9477;
const CDP_PORT = 9478;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const settings = JSON.parse(fs.readFileSync(path.join(ROOT, "settings.json"), "utf8"));
const mainWorld = fs.readFileSync(path.join(ROOT, "content", "main-world.js"), "utf8");
const gesture = fs.readFileSync(path.join(ROOT, "content", "gesture.js"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ server */

const composePage = (body, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%}
  body{display:flex;align-items:center;justify-content:center;
       font-family:Inter,"Segoe UI",system-ui,sans-serif;
       background:#f4f5fb}
  ${extraCss}
</style></head><body>${body}</body></html>`;

const POPUP_PAGE = composePage(
  `<div class="frame"><iframe src="/popup.html" width="300" height="536" scrolling="no"></iframe></div>`,
  `body{background:radial-gradient(1200px 700px at 20% 10%,#e6e8ff 0%,#f7f8fc 45%,#eef1f8 100%)}
   .frame{border-radius:18px;overflow:hidden;box-shadow:0 30px 60px -12px rgba(38,42,80,.35),0 0 0 1px rgba(0,0,0,.06);background:#fff;padding:0}
   iframe{border:0;display:block}`
);

const DEMO_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Gestio demo</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b0d17}
  #v{display:block;width:100vw;height:100vh;object-fit:cover;
     background:
       radial-gradient(900px 520px at 22% 18%, rgba(99,102,241,.55), transparent 60%),
       radial-gradient(760px 480px at 82% 78%, rgba(56,189,248,.35), transparent 62%),
       linear-gradient(160deg,#101427 0%,#161a33 42%,#0b0d17 100%)}
  #badge{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
         width:96px;height:96px;border-radius:50%;background:rgba(255,255,255,.12);
         border:1px solid rgba(255,255,255,.25);backdrop-filter:blur(2px);
         display:flex;align-items:center;justify-content:center}
  #badge svg{width:38px;height:38px;fill:#fff;opacity:.9;margin-left:6px}
</style></head><body>
<video id="v" muted playsinline></video>
<div id="badge"><svg viewBox="0 0 24 24"><path d="M8 4.8 19 12 8 19.2z"/></svg></div>
<script>
  const v = document.getElementById('v');
  window.__video = v;
  Object.defineProperty(v, 'duration', { get: () => 642 });
  Object.defineProperty(v, 'videoWidth', { get: () => 1280 });
  Object.defineProperty(v, 'videoHeight', { get: () => 720 });
  Object.defineProperty(v, 'currentTime', { get: () => 268, set: () => {}, configurable: true });
  Object.defineProperty(v, 'playbackRate', { get: () => 1, set: () => {}, configurable: true });
  v.readyState = 4; v.paused = false;
  v.play = () => Promise.resolve(); v.pause = () => {};
</script></body></html>`;

const LOGO_PAGE = composePage(
  `<div class="wrap">
     <div class="tile"><img src="/icons/icon.svg" alt=""></div>
   </div>`,
  `body{background:transparent}
   .tile{width:300px;height:300px;border-radius:64px;display:flex;align-items:center;justify-content:center;
         background:linear-gradient(140deg,#6366f1,#8b5cf6);
         box-shadow:0 24px 48px -18px rgba(99,102,241,.7)}
   .tile img{width:196px;height:196px}`
);

const promoPage = (w, h) => composePage(
  `<div class="card">
     <div class="logo"><img src="/icons/icon.svg" alt=""></div>
     <div class="txt"><div class="name">Gestio</div><div class="tag">Swipe, hold, tap — control any web video</div></div>
   </div>`,
  `body{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
   .card{display:flex;align-items:center;gap:${Math.round(h * 0.11)}px;padding:0 ${Math.round(h * 0.13)}px}
   .logo{width:${Math.round(h * 0.42)}px;height:${Math.round(h * 0.42)}px;border-radius:${Math.round(h * 0.13)}px;
         background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center}
   .logo img{width:72%;height:72%}
   .name{color:#fff;font-size:${Math.round(h * 0.26)}px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
   .tag{color:rgba(255,255,255,.85);font-size:${Math.round(h * 0.075)}px;margin-top:${Math.round(h * 0.03)}px}`
);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const routes = {
    "/__popup": POPUP_PAGE,
    "/__demo": DEMO_PAGE,
    "/__logo": LOGO_PAGE,
    "/__promo-440": promoPage(440, 280),
    "/__promo-1400": promoPage(1400, 560),
  };
  if (routes[url]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(routes[url]);
    return;
  }
  const file = path.join(ROOT, url.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

/* --------------------------------------------------------------- CDP client */

class CDP {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((res) => this.ws.addEventListener("open", res));
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg.result || {});
        this.pending.delete(msg.id);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r.result?.value;
  }
}

const getJSON = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const chromePath = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!chromePath) {
  console.error("Chrome/Edge not found; set CHROME_BIN.");
  process.exit(2);
}

const CHROME_STUB = `(() => {
  const settings = ${JSON.stringify(settings)};
  const read = () => Promise.resolve({ gestio_settings_v1: settings });
  window.chrome = {
    i18n: { getMessage: () => "", getUILanguage: () => "en" },
    runtime: {
      getURL: (p) => location.origin + "/" + p,
      getManifest: () => ({ version: "${JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version}" }),
      sendMessage: (m) => Promise.resolve(
        m && m.action === "ping" ? { pong: true }
        : m && m.action === "get_settings" ? { ok: true, settings }
        : m && m.action === "get_default_settings" ? { ok: true, settings }
        : { ok: true, settings }),
      onMessage: { addListener: () => {} },
      lastError: null,
    },
    storage: {
      local: {
        get: (keys, cb) => { const p = read(); if (cb) p.then(cb); return p; },
        set: (obj, cb) => { if (cb) cb(); return Promise.resolve(); },
        remove: (k, cb) => { if (cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener: () => {} },
    },
    tabs: {
      query: (q, cb) => { const r = [{ id: 1, active: true, url: "https://example.com/watch" }]; if (cb) cb(r); return Promise.resolve(r); },
      sendMessage: (id, m, cb) => { const r = m && m.action === "ping" ? { pong: true } : { ok: true }; if (cb) cb(r); return Promise.resolve(r); },
      create: () => Promise.resolve(),
    },
  };
})();`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gestio-shots-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    `--window-size=1280,800`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await getJSON(`http://127.0.0.1:${CDP_PORT}/json`);
      if (targets.some((t) => t.type === "page")) break;
    } catch (_) {}
    await sleep(250);
  }
  const page = targets && targets.find((t) => t.type === "page");
  if (!page) {
    console.error("no page target");
    chrome.kill();
    process.exit(2);
  }

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: CHROME_STUB });

  const setViewport = (width, height, mobile = false) =>
    cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });

  const shoot = async (name, width, height, url, { wait = 900, before, mobile = false } = {}) => {
    await setViewport(width, height, mobile);
    await cdp.send("Page.navigate", { url });
    await sleep(wait);
    if (before) await before();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${name}  ${width}x${height}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  };

  console.log("rendering:");

  await shoot("options.png", 1280, 800, `${BASE}/options.html`, { wait: 1400 });
  await shoot("guide.png", 1280, 800, `${BASE}/guide.html`, { wait: 900 });
  await shoot("quick-panel.png", 1280, 800, `${BASE}/__popup`, { wait: 1200 });

  // On-video shots: inject the real content scripts, then drive the HUD with the
  // same pointer events the browser test uses.
  const inject = `(() => {
    try { (0, eval)(${JSON.stringify(mainWorld)}); } catch (e) { return "main-world: " + e.message; }
    try { (0, eval)(${JSON.stringify(gesture)}); } catch (e) { return "gesture: " + e.message; }
    return "ok";
  })()`;

  const caption = (text) => cdp.eval(`(() => {
    const old = document.getElementById("__shotcap"); if (old) old.remove();
    const d = document.createElement("div");
    d.id = "__shotcap";
    d.textContent = ${JSON.stringify("__CAP__")}.replace("__CAP__", ${JSON.stringify(text)});
    d.style.cssText = "position:fixed;left:36px;top:32px;padding:11px 20px;border-radius:999px;"
      + "background:rgba(12,14,26,.62);color:#fff;font:600 17px/1.35 Inter,'Segoe UI',system-ui;"
      + "letter-spacing:.01em;border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px)";
    document.body.appendChild(d);
    return true;
  })()`);

  const fire = (type, x, y) => cdp.eval(`(() => {
    const t = document.elementFromPoint(${x},${y}) || window.__video;
    t.dispatchEvent(new PointerEvent("${type}", { bubbles:true, cancelable:true, clientX:${x}, clientY:${y},
      pointerId:1, pointerType:"touch", button:0, buttons:${type === "pointerup" ? 0 : 1}, isPrimary:true }));
    return true;
  })()`);

  await shoot("speed-tiers.png", 1280, 800, `${BASE}/__demo`, {
    wait: 900,
    before: async () => {
      const r = await cdp.eval(inject);
      if (r !== "ok") console.log("    inject:", r);
      await sleep(700);
      await fire("pointerdown", 900, 420);
      await sleep(700);            // past the long-press delay
      for (let x = 900; x <= 1010; x += 11) { await fire("pointermove", x, 420); await sleep(35); }
      await caption("Hold to boost · drag to tune · swipe up to lock");
      await sleep(120);
    },
  });

  await shoot("seek-preview.png", 1280, 800, `${BASE}/__demo`, {
    wait: 900,
    before: async () => {
      const r = await cdp.eval(inject);
      if (r !== "ok") console.log("    inject:", r);
      await sleep(700);
      await fire("pointerdown", 640, 400);
      for (let x = 640; x <= 860; x += 22) { await fire("pointermove", x, 400); await sleep(25); }
      await cdp.eval('(() => { const b = document.getElementById("badge"); if (b) b.style.display = "none"; return true; })()');
      await caption("Swipe to seek · preview shows the landing time · swipe down to cancel");
      await sleep(250);
    },
  });

  await shoot("logo-300.png", 300, 300, `${BASE}/__logo`, { wait: 500 });
  await shoot("promo-440x280.png", 440, 280, `${BASE}/__promo-440`, { wait: 500 });
  await shoot("promo-1400x560.png", 1400, 560, `${BASE}/__promo-1400`, { wait: 500 });

  chrome.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`done -> ${path.relative(ROOT, OUT)}`);
  process.exit(0);
})();
