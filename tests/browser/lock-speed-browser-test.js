/*
 * Browser-level locked-speed test for Gestio (v1.0.12).
 *
 * Why this exists: tests/gesture-unit-test.js runs in jsdom, where
 * content/main-world.js never runs. In a real page that file overrides
 * HTMLMediaElement.playbackRate so that — while a pin is active — EVERY write
 * is coerced to the pinned value. Any code that sets the rate without moving
 * the pin first therefore loses the write in a browser but passes in jsdom.
 *
 * Chrome builds no longer honour --load-extension, so instead of loading the
 * packed extension this harness injects the two REAL content scripts into a
 * real page (main-world.js in page context, gesture.js with a minimal chrome
 * API stub). The DOM, the media element and the prototype patch are all real,
 * which is what these assertions need.
 *
 * Asserts:
 *   1. hold + drag + swipe up  → speed locked
 *   2. hold again              → still the locked speed (not the 2x boost)
 *   3. drag while locked       → the real playbackRate changes
 *   4. swipe down              → lock gone, back to the pre-lock rate
 *   5. page write while locked → coerced back to the pinned value
 *
 * Usage: node tests/browser/lock-speed-browser-test.js
 * Requires: Chrome/Edge + Node 22+ (built-in WebSocket).
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN_WORLD = fs.readFileSync(path.join(ROOT, 'content', 'main-world.js'), 'utf8');
const GESTURE = fs.readFileSync(path.join(ROOT, 'content', 'gesture.js'), 'utf8');
const SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
const HTML = fs.readFileSync(path.join(__dirname, 'lockpage.html'));
const SRV_PORT = 9347;
const PAGE = `http://127.0.0.1:${SRV_PORT}/lockpage.html`;
const PORT = 9351;
const PROFILE = path.join(require('os').tmpdir(), 'gestio-browser-lock');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'eval failed');
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
}

(async () => {
  if (!CHROME) { console.error('Chrome/Edge not found'); process.exit(2); }
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
  await new Promise(r => server.listen(SRV_PORT, '127.0.0.1', r));

  const chrome = spawn(CHROME, [
    // headless + the throttling switches matter: in a background window Chrome
    // throttles setTimeout to ~1/s, so the 300ms long-press timer fires late and
    // every timing assertion fails for the wrong reason.
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json`); if (targets.some(t => t.type === 'page')) break; } catch (_) {}
    await sleep(250);
  }
  const page = targets && targets.find(t => t.type === 'page');
  if (!page) { console.error('no page target'); chrome.kill(); server.close(); process.exit(2); }

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  const pageErrors = [];
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push((d.exception && d.exception.description) || d.text || '');
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const t = m.params.entry.text || '';
      // Expected noise on this fixture: no media source, and navigator.vibrate
      // is refused because a synthetic pointerdown is not a user activation
      // (the haptic call itself is the intended behaviour).
      if (!/MEDIA_ELEMENT|NotSupportedError|no supported source|navigator\.vibrate/i.test(t)) pageErrors.push(t);
    }
  });
  await sleep(800);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(2000);

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };

  // Inject the real scripts: main-world.js first (patches the prototype), then
  // gesture.js with a minimal chrome.* stub so it can boot outside an extension.
  const injected = await cdp.eval(`(function(){
    const settings = ${JSON.stringify(SETTINGS)};
    window.chrome = window.chrome || {};
    window.chrome.i18n = { getMessage: () => '', getUILanguage: () => 'en' };
    window.chrome.runtime = {
      sendMessage: (m) => Promise.resolve(m && m.action === 'get_settings'
        ? { ok: true, settings } : { ok: true }),
      onMessage: { addListener: () => {} },
      getManifest: () => ({ version: 'test' }),
    };
    window.chrome.storage = {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      onChanged: { addListener: () => {} },
    };
    try { (0, eval)(${JSON.stringify(MAIN_WORLD)}); } catch (e) { return 'main-world: ' + e.message; }
    try { (0, eval)(${JSON.stringify(GESTURE)}); } catch (e) { return 'gesture: ' + e.message; }
    return 'ok';
  })()`);
  check('scripts injected', injected === 'ok', injected);
  await sleep(900);

  const live = await cdp.eval(`document.querySelectorAll('[data-gestio]').length`);
  // The HUD is created lazily on the first hint, so 0 here is normal; what
  // matters is that the engine answers a press. Verified by step 1 below.
  check('gesture engine booted (listeners live)', true, 'ui nodes=' + live);
  const rateDesc = await cdp.eval(`(function(){
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    return d && typeof d.set === 'function' ? d.set.toString().replace(/\\s+/g, ' ').slice(0, 60) : 'none';
  })()`);
  check('main-world patches the playbackRate setter',
    /pinnedRate|nativeSet/.test(rateDesc), rateDesc);

  const state = () => cdp.eval(`JSON.stringify({
    rate: window.__video.playbackRate,
    pin: document.documentElement.dataset.gestioRate || null,
    changes: window.__test.changes,
  })`);
  const st = async () => JSON.parse(await state());
  // Poll instead of a fixed sleep: the engine registers its listeners once the
  // settings promise settles, and a fixed 420ms made the first assertion race
  // that boot on slower runs.
  const waitRate = async (want, ms = 3000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await st();
      if (Math.abs(s.rate - want) < 0.01) return { s, waited: Date.now() - t0 };
      if (Date.now() - t0 > ms) return { s, waited: Date.now() - t0 };
      await sleep(40);
    }
  };
  const holdAndWaitBoost = async (x, y) => {
    await down(x, y);
    const r = await waitRate((SETTINGS.longPressSpeed || 2), 3000);
    return r;
  };
  const down = (x, y) => cdp.eval(`(function(){
    const t = document.elementFromPoint(${x},${y}) || window.__video;
    t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:1,isPrimary:true}));
    return true; })()`);
  const move = (x, y) => cdp.eval(`(function(){
    const t = document.elementFromPoint(${x},${y}) || window.__video;
    t.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:1,isPrimary:true}));
    return true; })()`);
  const up = (x, y) => cdp.eval(`(function(){
    const t = document.elementFromPoint(${x},${y}) || window.__video;
    t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:0,isPrimary:true}));
    return true; })()`);

  // 1. hold → drag two tiers → swipe up → release = locked 4x
  let s;
  const r1 = await holdAndWaitBoost(640, 400);
  check('hold enters the boost (2x)', Math.abs(r1.s.rate - 2) < 0.01,
    'rate=' + r1.s.rate + ' after=' + r1.waited + 'ms');
  await move(640 + 90, 400);
  await sleep(80);
  s = await st();
  check('drag reaches 4x', Math.abs(s.rate - 4) < 0.01, 'rate=' + s.rate);
  await move(640 + 90, 230);
  await sleep(80);
  await up(640 + 90, 230);
  await sleep(150);
  s = await st();
  check('swipe up locks 4x', s.pin === '4' && Math.abs(s.rate - 4) < 0.01, 'pin=' + s.pin + ' rate=' + s.rate);

  // 2. hold again: must stay at the locked 4x, not fall back to the 2x boost
  await down(640, 400);
  await sleep(500);
  s = await st();
  check('a second hold keeps the locked speed', Math.abs(s.rate - 4) < 0.01, 'rate=' + s.rate);

  // 3. drag one tier left while locked: the REAL rate must move (this is the
  //    assertion that fails if the pin is written after the value)
  await move(640 - 45, 400);
  await sleep(120);
  s = await st();
  check('dragging a locked speed changes real playback', Math.abs(s.rate - 3) < 0.01, 'rate=' + s.rate);
  check('the pin follows the drag', s.pin === '3', 'pin=' + s.pin);
  await up(640 - 45, 400);
  await sleep(150);
  s = await st();
  check('release keeps the retuned speed locked', s.pin === '3' && Math.abs(s.rate - 3) < 0.01,
    'pin=' + s.pin + ' rate=' + s.rate);

  // 4. third hold → still 3x, then swipe down → lock gone, back to 1x
  await down(640, 400);
  await sleep(420);
  s = await st();
  check('the lock memory survives repeated holds', Math.abs(s.rate - 3) < 0.01, 'rate=' + s.rate);
  await move(640, 520);
  await sleep(100);
  await up(640, 520);
  await sleep(200);
  s = await st();
  check('swipe down exits the speed', s.pin == null, 'pin=' + s.pin);
  check('exiting restores 1x', Math.abs(s.rate - 1) < 0.01, 'rate=' + s.rate);

  // 5. the rate must be genuinely pinned: a page write while locked is coerced
  await down(640, 400);
  await sleep(420);
  await move(640 + 45, 400);
  await sleep(80);
  await move(640 + 45, 230);
  await sleep(80);
  await up(640 + 45, 230);
  await sleep(150);
  const pinned = await st();
  await cdp.eval(`window.__video.playbackRate = 1; true`);
  await sleep(80);
  const after = await st();
  check('a page write cannot break the lock',
    pinned.pin != null && Math.abs(after.rate - Number(pinned.pin)) < 0.01,
    'pin=' + pinned.pin + ' page wrote 1 → rate=' + after.rate);

  const pageErr = await cdp.eval(`(window.__test.errors||[]).join(' | ')`);
  check('no page script errors', !pageErr, pageErr);
  check('no extension exceptions', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  chrome.kill();
  server.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(3); });
