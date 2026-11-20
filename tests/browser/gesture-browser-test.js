/*
 * Browser-level gesture test for Gestio.
 *
 * Loads the two REAL content scripts into a real page (Chrome no longer honours
 * --load-extension, so the packed extension cannot be loaded from the command
 * line) and dispatches pointer gestures over a fake <video>, asserting the
 * element was actually seeked / volume-changed / rate-changed.
 *
 * Usage: node tests/browser/gesture-browser-test.js
 * Requires: Chrome installed (auto-detected), Node 22+ (built-in WebSocket).
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN_WORLD = fs.readFileSync(path.join(ROOT, 'content', 'main-world.js'), 'utf8');
const GESTURE = fs.readFileSync(path.join(ROOT, 'content', 'gesture.js'), 'utf8');
const SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
const TEST_HTML = fs.readFileSync(path.join(__dirname, 'testpage.html'));
const SRV_PORT = 9344;
const PAGE = `http://127.0.0.1:${SRV_PORT}/testpage.html`;
const PORT = 9333;
const PROFILE = path.join(require('os').tmpdir(), 'gestio-browser-gesture');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  if (!CHROME) { console.error('Chrome not found'); process.exit(2); }
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(TEST_HTML);
  });
  await new Promise(r => server.listen(SRV_PORT, '127.0.0.1', r));

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json`); if (targets.some(t => t.type === 'page')) break; } catch (_) {}
    await sleep(250);
  }
  const page = targets && targets.find(t => t.type === 'page');
  if (!page) { console.error('test page target not found'); chrome.kill(); process.exit(2); }

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
      if (!/MEDIA_ELEMENT|NotSupportedError|no supported source|navigator\.vibrate/i.test(t)) pageErrors.push(t);
    }
  });
  await sleep(600);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(1200);

  const injected = await cdp.eval(`(function(){
    const settings = Object.assign({}, ${JSON.stringify(SETTINGS)}, { abLoopEnabled: true });
    window.chrome = {
      i18n: { getMessage: () => '', getUILanguage: () => 'en' },
      runtime: {
        sendMessage: (m) => Promise.resolve(m && m.action === 'get_settings' ? { ok: true, settings } : { ok: true }),
        onMessage: { addListener: () => {} },
        getManifest: () => ({ version: 'test' }),
      },
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
      },
    };
    try { (0, eval)(${JSON.stringify(MAIN_WORLD)}); } catch (e) { return 'main-world: ' + e.message; }
    try { (0, eval)(${JSON.stringify(GESTURE)}); } catch (e) { return 'gesture: ' + e.message; }
    return 'ok';
  })()`);
  await sleep(900);

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
  check('scripts injected', injected === 'ok', injected);

  const fire = (type, x, y) => cdp.eval(`(function(){
    const v = window.__video; const target = document.elementFromPoint(${x},${y}) || v;
    target.dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:${type === 'pointerup' ? 0 : 1},isPrimary:true}));
    return true;
  })()`);
  const snap = () => cdp.eval(`JSON.parse(JSON.stringify(window.__test))`);

  // 1. double-tap forward in the right zone
  await cdp.eval(`window.__test.seeks.length=0; window.__video.currentTime=100;`);
  await fire('pointerdown', 1000, 400); await fire('pointerup', 1000, 400);
  await sleep(60);
  await fire('pointerdown', 1000, 400); await fire('pointerup', 1000, 400);
  await sleep(120);
  let t = await snap();
  check('double-tap forward seeks', t.seeks.some(s => s > 100), 'seeks=' + JSON.stringify(t.seeks));

  // 2. horizontal swipe seek (drag left => backward)
  await cdp.eval(`window.__test.seeks.length=0; window.__video.currentTime=300;`);
  await fire('pointerdown', 640, 400);
  for (let x = 640; x >= 340; x -= 30) { await fire('pointermove', x, 400); await sleep(10); }
  await fire('pointerup', 340, 400);
  await sleep(120);
  t = await snap();
  check('horizontal swipe seeks', t.seeks.some(s => s < 300), 'seeks=' + JSON.stringify(t.seeks));

  // 3. long press → speed boost
  await cdp.eval(`window.__test.rates.length=0; window.__video.playbackRate=1;`);
  await fire('pointerdown', 640, 400);
  await sleep(500);
  t = await snap();
  check('long-press sets speed', t.rates.some(r => r > 1), 'rates=' + JSON.stringify(t.rates));

  // 3b. The tier row must still be drawn while the element is paused: the
  //     "play a paused video" switch governs playback only, never the row.
  //     This page's <video> has no source, so it is paused for the whole test.
  const tiers = await cdp.eval(`(function(){
    const hud = document.querySelector('[data-gestio="hud"]');
    const row = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.tiers');
    return row ? { show: row.classList.contains('show'), display: row.style.display, text: row.textContent.slice(0,40) } : null;
  })()`);
  check('the speed-tier row shows while paused',
    !!tiers && tiers.show && tiers.text.length > 0, JSON.stringify(tiers));

  await fire('pointerup', 640, 400);
  await sleep(120);

  // 4. vertical swipe → volume (right zone). Swipe DOWN from 100%: swiping up
  //    from an already full slider only engages Web Audio boost, which leaves
  //    element.volume at 1 and would make the assertion meaningless.
  const volBefore = await cdp.eval(`window.__video.volume`);
  await fire('pointerdown', 1000, 300);
  for (let y = 300; y <= 600; y += 30) { await fire('pointermove', 1000, y); await sleep(10); }
  await fire('pointerup', 1000, 600);
  await sleep(150);
  const volAfter = await cdp.eval(`window.__video.volume`);
  check('vertical swipe changes volume', Math.abs(volAfter - volBefore) > 0.01, `${volBefore} -> ${volAfter}`);

  // 5. the meter card must not resize when its label gains a digit: the card is
  //    content-sized, so "99%" -> "100%" used to widen it by ~1.4px and nudge
  //    the whole meter sideways at that one step.
  const mw = await cdp.eval(`(function(){
    const hud = document.querySelector('[data-gestio="hud"]');
    const root = hud && hud.shadowRoot;
    const meter = root && root.querySelector('[data-gestio-meter="volume"]');
    if (!meter) return null;
    const pct = meter.querySelector('.mp');
    const out = {};
    for (const t of ['9%', '99%', '100%', '600%']) {
      pct.textContent = t;
      out[t] = +meter.getBoundingClientRect().width.toFixed(2);
    }
    out.overflow = pct.scrollWidth - pct.clientWidth;
    return out;
  })()`);
  const widths = mw ? ['9%', '99%', '100%', '600%'].map(k => mw[k]) : [];
  check('meter width is stable from 99% to 100%',
    widths.length === 4 && new Set(widths).size === 1, JSON.stringify(mw));
  check('the widest label (600%) still fits its box',
    !!mw && mw.overflow <= 2, mw ? 'overflow=' + mw.overflow + 'px' : 'no meter');

  // 6. A drag on the A-B card must stay inside the card. It sits over the
  //    video, so the same press used to be read by the player as "seek" (and,
  //    on a phone, as volume / brightness + "show the control bar"). The stroke
  //    now stops at the window in the capture phase.
  const card = await cdp.eval(`(function(){
    const host = document.querySelector('[data-gestio="abpanel"]');
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const box = host.shadowRoot && host.shadowRoot.querySelector('.box');
    window.__leak = { down: 0, move: 0, up: 0, touch: 0 };
    ['pointerdown','pointermove','pointerup'].forEach(t =>
      document.addEventListener(t, () => { window.__leak[t.replace('pointer','')]++; }, true));
    ['touchstart','touchmove'].forEach(t =>
      document.addEventListener(t, () => { window.__leak.touch++; }, true));
    return { left: r.left, top: r.top, w: r.width, h: r.height, hasBox: !!box };
  })()`);
  check('the A-B card is on the page', !!card && card.hasBox && card.w > 0, JSON.stringify(card));
  if (card) {
    const cx = Math.round(card.left + card.w / 2), cy = Math.round(card.top + card.h / 2);
    const moves = [];
    for (let i = 1; i <= 6; i++) moves.push([Math.round(cx - i * 25), Math.round(cy + i * 12)]);
    await cdp.eval(`(function(){
      const host = document.querySelector('[data-gestio="abpanel"]');
      const box = host.shadowRoot.querySelector('.box');
      const P = (t, x, y) => new PointerEvent(t, {
        bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 11, pointerType: 'touch', button: 0, isPrimary: true,
        buttons: t === 'pointerup' ? 0 : 1 });
      window.__test.seeks.length = 0;
      window.__volBefore = window.__video.volume;
      window.__beforeLeft = host.style.left;
      box.dispatchEvent(P('pointerdown', ${cx}, ${cy}));
      for (const [mx, my] of ${JSON.stringify(moves)}) document.dispatchEvent(P('pointermove', mx, my));
      document.dispatchEvent(P('pointerup', ${Math.round(cx - 150)}, ${Math.round(cy + 72)}));
      return true;
    })()`);
    await sleep(150);
    const res = await cdp.eval(`(function(){
      const host = document.querySelector('[data-gestio="abpanel"]');
      return {
        leak: window.__leak,
        left: host && host.style.left === window.__beforeLeft ? 'same' : host && host.style.left,
        seeks: window.__test.seeks.slice(0, 3),
        vol: window.__video.volume - window.__volBefore
      };
    })()`);
    check('a drag on the card never reaches the page',
      res.leak.down === 0 && res.leak.move === 0 && res.leak.up === 0 && res.leak.touch === 0,
      JSON.stringify(res.leak));
    check('the drag still moves the card', res.left !== 'same', 'left=' + res.left);
    check('the drag does not seek or change volume',
      res.seeks.length === 0 && Math.abs(res.vol) < 0.001, JSON.stringify(res));
  }

  // 6b. A genuine click must still work. The card now takes its presses at the
  //     window in the capture phase, so this is the regression to watch: a
  //     button that looks alive but never fires.
  {
    await sleep(320); // let the drag's click-suppression window expire
    const a = await cdp.eval(`(function(){
      const host = document.querySelector('[data-gestio="abpanel"]');
      const b = host.shadowRoot.getElementById('a').getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button: 'left', clickCount: 1 });
    await sleep(220);
    const ta = await cdp.eval(`document.querySelector('[data-gestio="abpanel"]').shadowRoot.getElementById('ta').textContent`);
    check('a real click still reaches the card buttons', /A \d/.test(ta || ''), ta);
  }

  // 7. The same drag driven as a real TOUCH sequence — the stream an Android
  //    player actually listens to. Both streams exist for one finger, so both
  //    have to be kept away from the page.
  {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const now = await cdp.eval(`(function(){
      const host = document.querySelector('[data-gestio="abpanel"]');
      if (!host) return null;
      const r = host.getBoundingClientRect();
      window.__leak = { down: 0, move: 0, up: 0, touch: 0 };
      window.__win = { touch: 0, down: 0 };
      ['touchstart','touchmove','touchend'].forEach(t => window.addEventListener(t, () => window.__win.touch++, true));
      window.addEventListener('pointerdown', () => window.__win.down++, true);
      window.__test.seeks.length = 0;
      window.__volBefore = window.__video.volume;
      window.__beforeLeft = host.style.left;
      window.__beforeTop = host.style.top;
      // Grab the card by its grip: a press on a button needs a hold first, so
      // the middle of the second row is not a drag handle.
      return { cx: Math.round(r.left + 22), cy: Math.round(r.top + 14) };
    })()`);
    if (now) {
      const pt = (x, y) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(now.cx, now.cy) });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(now.cx - i * 22, now.cy + i * 10) });
        await sleep(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(180);
      const res = await cdp.eval(`(function(){
        const host = document.querySelector('[data-gestio="abpanel"]');
        return { leak: window.__leak, win: window.__win,
          moved: !!host && (host.style.left !== window.__beforeLeft || host.style.top !== window.__beforeTop),
          left: host && host.style.left, top: host && host.style.top,
          seeks: window.__test.seeks.slice(0, 3), vol: window.__video.volume - window.__volBefore };
      })()`);
      check('a touch drag on the card never reaches the page',
        res.leak.touch === 0 && res.leak.down === 0 && res.leak.move === 0 && res.leak.up === 0,
        JSON.stringify(res.leak));
      check('the touch drag moves the card', res.moved === true, JSON.stringify(res));
      check('the touch drag does not seek or change volume',
        res.seeks.length === 0 && Math.abs(res.vol) < 0.001, JSON.stringify(res));
    }
  }

  // 7b. ...and a touch TAP on a button still ends up as a click. Cancelling
  //     touchstart is what would break it, so the card must not do that for a
  //     press that lands on itself.
  {
    const b = await cdp.eval(`(function(){
      const host = document.querySelector('[data-gestio="abpanel"]');
      const el = host.shadowRoot.getElementById('b').getBoundingClientRect();
      return { x: Math.round(el.left + el.width / 2), y: Math.round(el.top + el.height / 2) };
    })()`);
    const pt = [{ x: b.x, y: b.y, radiusX: 6, radiusY: 6, force: 1, id: 1 }];
    await sleep(400); // let the preceding drag's click suppression expire
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(260);
    const tb = await cdp.eval(`document.querySelector('[data-gestio="abpanel"]').shadowRoot.getElementById('tb').textContent`);
    check('a touch tap still reaches the card buttons', /B \d/.test(tb || ''), tb);
  }

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  chrome.kill();
  server.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(3); });
