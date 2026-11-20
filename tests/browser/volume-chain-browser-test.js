/*
 * Browser-level volume-chain test for Gestio (v1.0.13).
 *
 * Why this exists: jsdom has no AudioContext, so tests/gesture-unit-test.js
 * stubs the graph and can only prove the intent. This harness runs the REAL
 * gesture.js in a real Chrome page with a real video element, and instruments
 * the real Web Audio API to observe what the engine actually builds:
 *
 *   plain volume change (<= 100%)  -> no AudioContext may be constructed
 *   boost above 100%               -> source -> gain -> compressor -> out
 *   drop back under 100%           -> source -> gain -> out, gain 1
 *
 * The first rule is the important one: createMediaElementSource is
 * irreversible, so building the graph for an ordinary volume change reroutes
 * that element through Web Audio (and its limiter) for the rest of the
 * session — audible as "the sound changed" even though the pitch is identical.
 *
 * Usage: node tests/browser/volume-chain-browser-test.js
 * Requires: Chrome/Edge + Node 22+ (built-in WebSocket).
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GESTURE = fs.readFileSync(path.join(ROOT, 'content', 'gesture.js'), 'utf8');
const SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
const HTML = fs.readFileSync(path.join(__dirname, 'lockpage.html'));
const SRV_PORT = 9348;
const PAGE = `http://127.0.0.1:${SRV_PORT}/volpage.html`;
const PORT = 9352;
const PROFILE = path.join(require('os').tmpdir(), 'gestio-browser-volume');

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
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
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
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(1500);

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };

  // Instrument the real Web Audio API, THEN boot the real content script.
  // The boost has to be switched on for this harness: settings.json ships
  // `volumeBoostEnabled: false` (an always-on chain would reroute the audio of
  // every player), and with the boost off the swipe path clamps at 100%, so
  // there is no graph to observe.
  const BOOST_ON = Object.assign({}, SETTINGS, { volumeBoostEnabled: true, volumeBoostMax: 300 });
  const injected = await cdp.eval(`(function(){
    const settings = ${JSON.stringify(BOOST_ON)};
    window.__g = { ctxs: 0, edges: [], targets: [], comps: [] };
    const kinds = new WeakMap();
    const kindOf = (n) => kinds.get(n) || (window.AudioDestinationNode && n instanceof AudioDestinationNode ? 'destination' : (n && n.constructor && n.constructor.name) || 'unknown');

    const oConnect = AudioNode.prototype.connect;
    const oDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(to, ...rest) {
      try { window.__g.edges.push(kindOf(this) + '>' + kindOf(to)); } catch (_) {}
      return oConnect.call(this, to, ...rest);
    };
    AudioNode.prototype.disconnect = function(...a) {
      try {
        if (!a.length) {
          const k = kindOf(this);
          window.__g.edges = window.__g.edges.filter(e => !e.startsWith(k + '>'));
        }
      } catch (_) {}
      return oDisconnect.apply(this, a);
    };
    const oTarget = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function(v, t, c) {
      window.__g.targets.push(v);
      return oTarget.call(this, v, t, c);
    };

    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...a) {
        super(...a);
        window.__g.ctxs++;
        window.__g.rate = this.sampleRate;
        const g = this.createGain.bind(this), c = this.createDynamicsCompressor.bind(this), s = this.createMediaElementSource.bind(this);
        this.createGain = () => { const n = g(); kinds.set(n, 'gain'); return n; };
        this.createDynamicsCompressor = () => {
          const n = c(); kinds.set(n, 'comp');
          window.__g.comps.push(n);   // read params at query time: they are set after creation
          return n;
        };
        this.createMediaElementSource = (el) => { const n = s(el); kinds.set(n, 'source'); return n; };
      }
    };

    window.__path = () => {
      let k = 'source';
      const seen = [];
      for (let i = 0; i < 8; i++) {
        const e = window.__g.edges.find(x => x.startsWith(k + '>'));
        if (!e) break;
        k = e.split('>')[1];
        seen.push(k);
        if (k === 'destination') break;
      }
      return seen.join('>');
    };

    window.chrome = window.chrome || {};
    window.chrome.i18n = { getMessage: () => '', getUILanguage: () => 'en' };
    window.chrome.runtime = {
      sendMessage: (m) => Promise.resolve(m && m.action === 'get_settings' ? { ok: true, settings } : { ok: true }),
      onMessage: { addListener: () => {} },
      getManifest: () => ({ version: 'test' }),
    };
    window.chrome.storage = {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      onChanged: { addListener: () => {} },
    };
    try { (0, eval)(${JSON.stringify(GESTURE)}); } catch (e) { return 'gesture: ' + e.message; }
    return 'ok';
  })()`);
  check('real gesture.js boots with the real Web Audio API', injected === 'ok', injected);
  await sleep(900);

  const snap = () => cdp.eval(`JSON.stringify({
    ctxs: window.__g.ctxs, path: window.__path(), lastTarget: window.__g.targets[window.__g.targets.length-1],
    comp: (function(){ const c = window.__g.comps[window.__g.comps.length-1];
      return c ? { threshold: c.threshold.value, ratio: c.ratio.value } : null; })(),
    volume: window.__video.volume, rate: window.__g.rate
  })`);
  const st = async () => JSON.parse(await snap());

  const down = (x, y) => cdp.eval(`(function(){const t=document.elementFromPoint(${x},${y})||window.__video;t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:1,isPrimary:true}));return true})()`);
  const move = (x, y) => cdp.eval(`(function(){const t=document.elementFromPoint(${x},${y})||window.__video;t.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:1,isPrimary:true}));return true})()`);
  const up = (x, y) => cdp.eval(`(function(){const t=document.elementFromPoint(${x},${y})||window.__video;t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',button:0,buttons:0,isPrimary:true}));return true})()`);
  const swipe = async (x, y0, y1, step = 25) => {
    await down(x, y0);
    const dir = y1 > y0 ? 1 : -1;
    for (let y = y0; dir > 0 ? y <= y1 : y >= y1; y += dir * step) {
      await move(x, y);
      await sleep(8);
    }
    await up(x, y1);
    await sleep(120);
  };

  // 1. Ordinary volume change on the right half: must stay on the native path.
  await swipe(1000, 250, 500);
  let s = await st();
  check('plain volume change builds no AudioContext',
    s.ctxs === 0, `contexts=${s.ctxs} volume=${Number(s.volume).toFixed(2)}`);
  check('plain volume change still lowers the volume',
    s.volume < 0.95, 'volume=' + Number(s.volume).toFixed(2));

  // 2. Push above 100%: exactly one graph, limiter in the path.
  await cdp.eval(`window.__video.volume = 1`);
  await swipe(1000, 650, 180);
  s = await st();
  check('boosting above 100% builds one graph with the limiter in the path',
    s.ctxs === 1 && s.path === 'gain>comp>destination', `contexts=${s.ctxs} path=${s.path}`);
  check('the requested boost gain is above 1',
    s.lastTarget > 1.3, 'gain target=' + (s.lastTarget && s.lastTarget.toFixed(2)));
  check('the boost compressor keeps the documented curve',
    !!s.comp && s.comp.threshold === -24 && s.comp.ratio === 12,
    s.comp ? `threshold=${s.comp.threshold} ratio=${s.comp.ratio}` : 'no compressor');

  // 3. Back under 100%: compressor leaves the path, gain returns to unity.
  await swipe(1000, 120, 660);
  s = await st();
  check('dropping back under 100% removes the limiter from the path',
    s.path === 'gain>destination' && Math.abs(s.lastTarget - 1) < 0.001 && s.ctxs === 1,
    `path=${s.path} gain target=${s.lastTarget} contexts=${s.ctxs}`);

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
