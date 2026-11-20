/*
 * jsdom-based unit test for the Gestio gesture state machine.
 * Loads the real content/gesture.js into a jsdom window with mocked Chrome
 * APIs, then fires synthetic PointerEvents at a fake <video> and asserts
 * seek / speed / volume / double-tap behavior.
 *
 * Usage: node tests/gesture-unit-test.js
 * Requires jsdom (dev-only; `pnpm install` first).
 */
const fs = require('fs');
const path = require('path');

const { JSDOM } = require('jsdom');

const GESTURE_JS = path.resolve(__dirname, '..', 'content', 'gesture.js');
const SETTINGS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'settings.json'), 'utf8'));

const results = [];
const check = (name, pass, detail) => { results.push({name,pass}); console.log(`${pass?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

function makeEnv(overrides, opts) {
  // Read through to SETTINGS so a test that mutates it and re-sends
  // "settings_changed" still sees the new value; `overrides` is a per-env patch.
  const settings = () => Object.assign({}, SETTINGS, overrides || {});
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="player" style="position:absolute;left:0;top:0;width:1280px;height:720px">
      <video id="v" style="width:1280px;height:720px"></video>
      <div class="controls" style="position:absolute;bottom:0;left:0;width:1280px;height:60px"></div>
    </div></body></html>`, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://test.local/' });
  const { window } = dom;
  const v = window.document.getElementById('v');
  // jsdom lacks layout: stub geometry + media props
  v.getBoundingClientRect = () => ({left:0,top:0,right:1280,bottom:720,width:1280,height:720,x:0,y:0});
  Object.defineProperty(v, 'duration', { get: () => 600, configurable: true });
  let ct = 100;
  Object.defineProperty(v, 'currentTime', { get: () => ct, set: x => { ct = x; env.seeks.push(x); }, configurable: true });
  let rate = 1;
  Object.defineProperty(v, 'playbackRate', { get: () => rate, set: x => { rate = x; env.rates.push(x); }, configurable: true });
  v.volume = 1;
  // jsdom's readyState is a getter that always reports 0, and a plain
  // assignment is silently dropped — which would make every "has metadata"
  // branch unreachable in tests while the real element reports 4.
  Object.defineProperty(v, 'readyState', { get: () => 4, configurable: true });
  // jsdom makes HTMLMediaElement.paused read-only; redefine it so tests can
  // control playback state (real browsers also pause on native controls).
  let paused = false;
  Object.defineProperty(v, 'paused', { get: () => paused, set: x => { paused = !!x; }, configurable: true });
  let playCalls = 0;
  v.play = () => { playCalls++; paused = false; return Promise.resolve(); };
  v.pause = () => { paused = true; };
  v.mediaKeys = undefined;
  // geometry for controls overlay
  const c = window.document.querySelector('.controls');
  c.getBoundingClientRect = () => ({left:0,top:660,right:1280,bottom:720,width:1280,height:60,x:0,y:0});
  window.getComputedStyle = () => ({ display:'block', visibility:'visible', opacity:'1' });

  const env = { window, dom, v, seeks: [], rates: [], sent: [], playCalls: () => playCalls };
  // Chrome mock
  const listeners = {};
  env.chrome = {
    i18n: { getMessage: () => '' },
    runtime: {
      sendMessage: (msg) => {
        if (msg && msg.action) env.sent.push(msg);
        if (msg.action === 'get_settings') return Promise.resolve({ ok:true, settings: settings() });
        if (msg.action === 'get_config') return Promise.resolve({ ok:true, value: (opts && opts.config) || null });
        return Promise.resolve({ ok:true });
      },
      onMessage: { addListener: (fn) => { env.contentMsg = fn; } },
      getURL: (p) => 'chrome-extension://test/' + p,
    },
    storage: { local: { get:()=>Promise.resolve({}), set:()=>Promise.resolve(), remove:()=>Promise.resolve() } },
  };
  window.chrome = env.chrome;
  window.performance = window.performance || { now: () => Date.now() };
  window.navigator.vibrate = () => true;
  window.matchMedia = window.matchMedia || (() => ({ matches:false }));
  window.screen = window.screen || {};
  window.HTMLElement.prototype.attachShadow = window.HTMLElement.prototype.attachShadow || function(){
    if (!this.__shadow) { const d = window.document.createDocumentFragment(); d.elementFromPoint = () => null; this.__shadow = d; }
    return this.__shadow;
  };
  window.document.elementFromPoint = (x,y) => v; // point always hits video
  // `mobile: true` makes the env behave like a phone: the vertical-scope
  // policy (nonFullscreenVertical) only applies to touch input, and the
  // content script snapshots `isMobile` when it loads, so this has to be
  // patched before eval().
  if (opts && opts.mobile) {
    window.ontouchstart = null;
    window.matchMedia = () => ({ matches: true });
    try { Object.defineProperty(window.navigator, "maxTouchPoints", { value: 1, configurable: true }); } catch (_) {}
  }
  return env;
}

// Dispatch a real touch-stream event. jsdom has no TouchEvent, and the
// content script only reads touches[0] + clientX/clientY + cancelable, so a
// plain Event with those shapes is enough — including `defaultPrevented`,
// which is what decides whether the browser pans the page.
function touch(env, type, x, y) {
  const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
  const t = { clientX: x, clientY: y, target: env.v };
  Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [t] });
  Object.defineProperty(ev, "changedTouches", { value: [t] });
  Object.defineProperty(ev, "clientX", { value: x });
  Object.defineProperty(ev, "clientY", { value: y });
  env.window.document.dispatchEvent(ev);
  return ev;
}

function fire(env, type, x, y, opts={}) {
  const P = env.window.PointerEvent || env.window.MouseEvent;
  const ev = new P(type, {
    bubbles:true, cancelable:true, clientX:x, clientY:y,
    pointerId:1, pointerType: opts.pointerType || 'touch', button:0, buttons: type==='pointerup'?0:1,
    isPrimary:true, altKey: !!opts.altKey, deltaY: opts.deltaY || 0,
  });
  (opts.target || env.window.document).dispatchEvent(ev);
  return ev;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A real tap, not `element.click()`: jsdom's click() bails out silently when a
// previous call on that element left its `_clickInProgress` guard set, which
// made one of the panel tests fail at random.
const tap = (env, el) => el.dispatchEvent(new env.window.MouseEvent("click", {
  bubbles: true, cancelable: true, composed: true
}));
// The tucked-away flag lives in one sessionStorage entry holding the pages of
// this tab that hid the card (see AB_HIDDEN_STORE in gesture.js).
const AB_STORE = "gestio:abpanel";
const abHiddenMap = (w) => {
  try { return JSON.parse(w.sessionStorage.getItem(AB_STORE) || "{}") || {}; }
  catch (_) { return {}; }
};

// Mirrors content/main-world.js: while `data-gestio-rate` is set, EVERY
// write to playbackRate is coerced to the pinned value. Real browsers run this
// patch, so a test without it cannot see the "the drag did nothing" class of
// bug (code that writes the rate before moving the pin loses the write).
function installPin(env) {
  const v = env.v, doc = env.window.document;
  let rate = Number(v.playbackRate) || 1;
  Object.defineProperty(v, 'playbackRate', {
    configurable: true,
    get() { return rate; },
    set(x) {
      const raw = doc.documentElement.dataset.gestioRate;
      const pin = raw == null ? null : parseFloat(raw);
      rate = (pin !== null && Number.isFinite(pin) && pin > 0) ? pin : Number(x);
      env.rates.push(rate);
    },
  });
  // ratechange guard: a page write that slipped through is forced back.
  v.addEventListener('ratechange', () => {
    const raw = doc.documentElement.dataset.gestioRate;
    const pin = raw == null ? null : parseFloat(raw);
    if (pin !== null && Number.isFinite(pin) && pin > 0 && Math.abs(rate - pin) > 0.01) rate = pin;
  });
  return { get: () => rate };
}

// Stub Web Audio so the volume-boost branch is testable at all. Records every
// context, node and edge, which lets a test assert the actual routing:
//   plain volume  -> no graph at all
//   boost > 100%  -> source -> gain -> comp -> destination
//   back to <=1   -> source -> gain -> destination, gain 1
function installAudio(env) {
  const log = { ctxs: 0, nodes: [] };
  class Param {
    constructor(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class Node {
    constructor(kind) { this.kind = kind; this.out = []; log.nodes.push(this); }
    connect(n) { this.out.push(n); return n; }
    disconnect() { this.out.length = 0; }
  }
  class Ctx {
    constructor() {
      log.ctxs++;
      this.sampleRate = 48000; this.currentTime = 0; this.state = 'running';
      this.destination = { kind: 'destination' };
    }
    createMediaElementSource() { return new Node('source'); }
    createGain() { const n = new Node('gain'); n.gain = new Param(1); return n; }
    createDynamicsCompressor() {
      const n = new Node('comp');
      n.threshold = new Param(-24); n.ratio = new Param(12); n.knee = new Param(30);
      n.attack = new Param(0.003); n.release = new Param(0.25);
      return n;
    }
    resume() { return Promise.resolve(); }
  }
  env.window.AudioContext = Ctx;
  env.audio = log;
  return log;
}

// Walk the graph from the media source: ['gain','comp','destination'] etc.
const audioPath = (log) => {
  const src = log.nodes.find(n => n.kind === 'source');
  if (!src) return [];
  const seen = [];
  let cur = src;
  while (cur && cur.out && cur.out.length && seen.length < 8) {
    cur = cur.out[0];
    if (!cur) break;
    seen.push(cur.kind);
  }
  return seen;
};
const lastGain = (log) => {
  const g = log.nodes.filter(n => n.kind === 'gain').pop();
  return g ? g.gain.value : null;
};
const lastComp = (log) => log.nodes.filter(n => n.kind === 'comp').pop();


async function main() {
  const src = fs.readFileSync(GESTURE_JS, 'utf8');
  // A-B loop now ships disabled; the panel-based tests below still need it, so
  // the shipped default is asserted first and then switched on for this run.
  const RAWSETTINGS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'settings.json'), 'utf8'));
  check('[defaults] A-B loop ships disabled', RAWSETTINGS.abLoopEnabled === false, 'abLoopEnabled=' + RAWSETTINGS.abLoopEnabled);
  check('[defaults] volume boost ships disabled', RAWSETTINGS.volumeBoostEnabled === false, 'volumeBoostEnabled=' + RAWSETTINGS.volumeBoostEnabled);
  SETTINGS.abLoopEnabled = true;
  // The boost tests below assert the routing when the feature IS enabled, so
  // opt in for this run; the shipped default is asserted just above, and the
  // "disabled" branch has its own case further down.
  SETTINGS.volumeBoostEnabled = true;
  // These scenarios exercise the volume/brightness maths, not the windowed
  // placement policy, so vertical swipes are allowed everywhere here. The
  // shipped default ("only in fullscreen") has its own section further down.
  for (const scenario of [
    { name:'desktop', touch:false },
    { name:'mobile', touch:true },
  ]) {
    const env = makeEnv({ nonFullscreenVertical: 'always' });
    if (scenario.touch) {
      env.window.navigator.maxTouchPoints = 5;
      env.window.matchMedia = () => ({ matches:true });
    }
    env.window.eval(src);
    await sleep(50); // async boot

    const tag = scenario.name;

    // 1. content script booted (AB panel created)
    check(`[${tag}] content script boots`, !!env.window.document.querySelector('[data-gestio="abpanel"]'));

    // 2. double-tap right zone -> forward seek (+10s)
    env.seeks.length = 0; env.v.currentTime = 100;
    fire(env,'pointerdown',1000,360); fire(env,'pointerup',1000,360);
    await sleep(60);
    fire(env,'pointerdown',1000,360); fire(env,'pointerup',1000,360);
    await sleep(60);
    check(`[${tag}] double-tap right seeks forward`, env.seeks.some(s=>s>100), 'seeks='+JSON.stringify(env.seeks));

    // 3. horizontal swipe left in center -> seek backward
    env.seeks.length = 0; env.v.currentTime = 300;
    fire(env,'pointerdown',700,360);
    for (let x=700;x>=400;x-=30){ fire(env,'pointermove',x,360); await sleep(5); }
    fire(env,'pointerup',400,360);
    await sleep(60);
    check(`[${tag}] horizontal swipe seeks`, env.seeks.some(s=>s<300), 'seeks='+JSON.stringify(env.seeks));

    // 4. long-press -> speed boost
    env.rates.length = 0; env.v.playbackRate = 1;
    fire(env,'pointerdown',640,360);
    await sleep(520);
    check(`[${tag}] long-press boosts speed`, env.rates.some(r=>r>1), 'rates='+JSON.stringify(env.rates));
    fire(env,'pointerup',640,360);
    await sleep(60);

    // 5. vertical swipe on right zone -> volume change
    env.v.volume = 1;
    const before = env.v.volume;
    fire(env,'pointerdown',1000,350);
    for (let y=350;y<=600;y+=25){ fire(env,'pointermove',1000,y); await sleep(5); }
    fire(env,'pointerup',1000,600);
    await sleep(60);
    check(`[${tag}] vertical swipe changes volume`, Math.abs(env.v.volume-before)>0.01, `${before} -> ${env.v.volume}`);

    // 5b. ...and it must scale with TOTAL travel. `dy` is measured from the
    //     press, so re-anchoring on the live value every frame added the whole
    //     offset again on each move: a 250px swipe used to slam the slider to
    //     0 (clamped) instead of moving it by 250/720 ≈ 35%.
    env.v.volume = 0.5;
    fire(env,'pointerdown',1000,300);
    for (let y=300;y<=500;y+=50){ fire(env,'pointermove',1000,y); await sleep(8); }
    fire(env,'pointerup',1000,500);
    await sleep(60);
    const expectVol = 0.5 - 200/720;
    check(`[${tag}] volume scales with travel, not per frame`,
      Math.abs(env.v.volume-expectVol) < 0.08, `volume=${env.v.volume.toFixed(3)} expected≈${expectVol.toFixed(3)}`);

    // same rule for brightness (left zone), which also drives the CSS filter
    fire(env,'pointerdown',200,300);
    for (let y=300;y<=500;y+=50){ fire(env,'pointermove',200,y); await sleep(8); }
    fire(env,'pointerup',200,500);
    await sleep(60);
    const bright = Number((/(\d+(?:\.\d+)?)/.exec(env.v.style.filter)||[0,1])[1]);
    const expectBright = 1 - 200/720;
    check(`[${tag}] brightness scales with travel, not per frame`,
      Math.abs(bright-expectBright) < 0.1, `filter=${env.v.style.filter}`);

    // 6. A-B loop keyboard shortcuts (configurable, shifted punctuation)
    const K = env.window.document;
    const kd = (key, mods={}) => K.dispatchEvent(new env.window.KeyboardEvent('keydown', {
      bubbles:true, cancelable:true, key, ...mods }));
    env.v.currentTime = 120; kd('['); await sleep(10);     // set A
    env.v.currentTime = 130; kd(']'); await sleep(10);     // set B
    const abLabel = K.querySelector('[data-gestio="abpanel"]').shadowRoot.getElementById('label');
    // The read-out is always hh:mm:ss so it never changes width.
    check(`[${tag}] A-B shortcuts set A/B`, /A 0:02:00/.test(abLabel.textContent) && /B 0:02:10/.test(abLabel.textContent), abLabel.textContent);
    kd('{', {shiftKey:true}); await sleep(10);             // Shift+{ == Shift+[ -> A -0.5
    check(`[${tag}] Shift+[ adjusts A by -0.5s`, /A 0:01:59/.test(abLabel.textContent), abLabel.textContent);
    kd('\\'); await sleep(10);                              // clear
    check(`[${tag}] clear shortcut resets A/B`, /A --:--:--/.test(abLabel.textContent), abLabel.textContent);
  }

  // 6.4 Volume boost must be lazy and must not colour the sound at 100%.
  //     `createMediaElementSource` is irreversible, so building the graph for a
  //     plain volume change reroutes that element through Web Audio for the rest
  //     of the session; the old chain also put a -24 dB / 12:1 compressor in the
  //     path at unity gain (measured: 18 dB of dynamics removed). That is what
  //     made "the sound different" after touching the volume.
  {
    const env = makeEnv();
    const audio = installAudio(env);
    env.window.eval(src);
    await sleep(50);

    // (a) 100% -> ~70%: no graph may be created at all
    env.v.volume = 1;
    fire(env,'pointerdown',1000,300);
    for (let y=300;y<=520;y+=20){ fire(env,'pointermove',1000,y); await sleep(6); }
    fire(env,'pointerup',1000,520);
    await sleep(60);
    check('[audio] a plain volume change never builds the Web Audio graph',
      audio.ctxs === 0 && env.v.volume < 0.95,
      `contexts=${audio.ctxs} volume=${env.v.volume.toFixed(2)}`);

    // (b) push above 100%: one graph, limiter in the path, gain = requested level
    env.v.volume = 1;
    fire(env,'pointerdown',1000,600);
    for (let y=600;y>=260;y-=20){ fire(env,'pointermove',1000,y); await sleep(6); }
    fire(env,'pointerup',1000,260);
    await sleep(80);
    const pathBoost = audioPath(audio);
    check('[audio] boosting above 100% routes source -> gain -> limiter -> out',
      audio.ctxs === 1 && pathBoost.join('>') === 'gain>comp>destination',
      `contexts=${audio.ctxs} path=${pathBoost.join('>')}`);
    check('[audio] the boost gain follows the requested level',
      lastGain(audio) > 1.3 && lastGain(audio) <= SETTINGS.volumeBoostMax / 100,
      `gain=${lastGain(audio).toFixed(2)} max=${SETTINGS.volumeBoostMax / 100}`);
    check('[audio] the boost compressor keeps the documented curve',
      lastComp(audio).threshold.value === -24 && lastComp(audio).ratio.value === 12,
      `threshold=${lastComp(audio).threshold.value} ratio=${lastComp(audio).ratio.value}`);

    // (c) back under 100%: limiter leaves the path, gain returns to 1
    fire(env,'pointerdown',1000,200);
    for (let y=200;y<=700;y+=25){ fire(env,'pointermove',1000,y); await sleep(6); }
    fire(env,'pointerup',1000,700);
    await sleep(80);
    const pathDown = audioPath(audio);
    check('[audio] dropping back under 100% takes the limiter out of the path',
      pathDown.join('>') === 'gain>destination' && Math.abs(lastGain(audio) - 1) < 0.001 && audio.ctxs === 1,
      `path=${pathDown.join('>')} gain=${lastGain(audio)} contexts=${audio.ctxs}`);
  }

  // 6.4b Volume boost OFF (the shipped default): a swipe up has to stop at
  //      100% and must not build the Web Audio graph at all. The opt-in is a
  //      real gate, not just a smaller maximum.
  {
    SETTINGS.volumeBoostEnabled = false;
    const env = makeEnv();
    const audio = installAudio(env);
    env.window.eval(src);
    await sleep(50);
    env.v.volume = 0.6;
    fire(env,'pointerdown',1000,650);
    for (let y=650;y>=200;y-=20){ fire(env,'pointermove',1000,y); await sleep(6); }
    fire(env,'pointerup',1000,200);
    await sleep(80);
    check('[audio] boost off: swiping up stops at 100% and builds no graph',
      audio.ctxs === 0 && Math.abs(env.v.volume - 1) < 0.01,
      `contexts=${audio.ctxs} volume=${env.v.volume.toFixed(2)}`);
    SETTINGS.volumeBoostEnabled = true;
  }

  // 6.5 a single tap must reach the player: the native click IS the play/pause
  // toggle, so swallowing it for a 2px finger wobble made taps feel dead.
  {
    const env = makeEnv();
    env.window.eval(src);
    await sleep(400); // past the boot-time click gate
    const clickAt = (x = 640, y = 360) => {
      const e = new env.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
      env.window.document.dispatchEvent(e);
      return e;
    };

    // clean tap
    fire(env, 'pointerdown', 640, 360);
    fire(env, 'pointerup', 640, 360);
    check('[tap] a clean tap lets the player click through', !clickAt().defaultPrevented);

    // the same tap with the few pixels of drift every real finger has
    await sleep(380); // > doubleTapInterval: these are separate taps
    fire(env, 'pointerdown', 640, 360);
    await sleep(16);
    fire(env, 'pointermove', 644, 362);
    await sleep(16);
    fire(env, 'pointerup', 644, 362);
    check('[tap] a slightly jittery tap still lets the click through', !clickAt().defaultPrevented);

    // ...and a wider wobble that never becomes a swipe
    await sleep(380); // > doubleTapInterval: these are separate taps
    fire(env, 'pointerdown', 640, 360);
    await sleep(16);
    fire(env, 'pointermove', 649, 366);
    await sleep(16);
    fire(env, 'pointerup', 649, 366);
    check('[tap] a 9px wobble is still a tap', !clickAt().defaultPrevented);

    // a real swipe must still swallow the click (otherwise the player toggles
    // play/pause every time you swipe to seek)
    await sleep(380); // > doubleTapInterval: these are separate taps
    fire(env, 'pointerdown', 700, 360);
    for (let x = 700; x >= 420; x -= 40) { fire(env, 'pointermove', x, 360); await sleep(4); }
    fire(env, 'pointerup', 420, 360);
    check('[tap] a horizontal swipe still blocks the trailing click', clickAt().defaultPrevented);

    // tapping a paused video must not "stealth play" it: the extension force-
    // plays during gestures, so it has to hand the pause back before the click.
    await sleep(380); // > doubleTapInterval: these are separate taps
    env.v.pause();
    fire(env, 'pointerdown', 640, 360);
    fire(env, 'pointerup', 640, 360);
    check('[tap] tapping a paused video leaves it paused for the player to toggle',
      env.v.paused === true, 'paused=' + env.v.paused);
  }

  // 6.6 desktop: a tap in a seek zone holds its click for a possible double tap.
  // On phones the tap must go straight through, because there a tap is how you
  // reveal the native control bar.
  {
    const mk = async (mobile) => {
      const env = makeEnv();
      if (mobile) {
        env.window.navigator.maxTouchPoints = 5;
        env.window.matchMedia = () => ({ matches: true });
      }
      env.window.eval(src);
      await sleep(400); // past the boot-time click gate
      const clicks = [];
      env.window.document.addEventListener("click", (e) => clicks.push(!!e.__gestioReplay), true);
      const nativeClick = (x = 300, y = 360) => {
        const e = new env.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y });
        env.window.document.dispatchEvent(e);
        return e;
      };
      return { env, clicks, nativeClick };
    };

    // desktop, single tap on the left third (double-tap zone = seek backward)
    {
      const { env, clicks, nativeClick } = await mk(false);
      fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360);
      const native = nativeClick();
      check("[tap] desktop holds the tap click so a double tap cannot pause", native.defaultPrevented);
      await sleep(520);
      check("[tap] desktop replays that click once no second tap follows",
        clicks.filter(Boolean).length === 1, "replayed=" + clicks.filter(Boolean).length);
    }

    // desktop, double tap: the held click must be dropped, not fired late
    {
      const { env, clicks } = await mk(false);
      fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360);
      await sleep(60);
      fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360);
      await sleep(520);
      check("[tap] a double tap drops the held click", clicks.filter(Boolean).length === 0,
        "replayed=" + clicks.filter(Boolean).length);
    }

    // phone: no hold at all — the tap has to reach the player immediately
    {
      const { env, nativeClick } = await mk(true);
      fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360);
      check("[tap] phone taps reach the player immediately (control bar)",
        !nativeClick().defaultPrevented);
    }
  }

  // 6.7 accumulating double taps: the burst is committed once, when it ends.
  // Firing the seek on every tap both landed on the wrong target (3 taps =
  // +10 then +20 = +30) and made a burst impossible to grow: it jumped on the
  // second tap, so extra taps only ever repeated the first pair's distance.
  {
    const hintText = (env) => {
      const hud = env.window.document.querySelector('[data-gestio="hud"]');
      const h = hud && hud.shadowRoot && hud.shadowRoot.querySelector(".hint");
      return (h && h.textContent || "").trim();
    };

    {
      const env = makeEnv({ doubleTapAccumulateEnabled: true });
      env.window.eval(src);
      await sleep(60);
      const tap = () => { fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360); };
      tap(); await sleep(80); tap();
      check("[accum] a double tap waits while the burst may continue",
        env.seeks.length === 0, "seeks=" + JSON.stringify(env.seeks));
      check("[accum] the hint shows one step", hintText(env) === "−10s", hintText(env));
      await sleep(420);
      check("[accum] the burst lands once, by one step",
        env.seeks.length === 1 && Math.abs(env.seeks[0] - 90) < 0.01, JSON.stringify(env.seeks));
    }

    {
      const env = makeEnv({ doubleTapAccumulateEnabled: true });
      env.window.eval(src);
      await sleep(60);
      const tap = () => { fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360); };
      tap(); await sleep(70); tap(); await sleep(70); tap();
      check("[accum] three taps still wait for the burst to end",
        env.seeks.length === 0, "seeks=" + JSON.stringify(env.seeks));
      check("[accum] three taps read as 20s", hintText(env) === "−20s", hintText(env));
      await sleep(460);
      check("[accum] three taps jump 20s once (not 10 then 20)",
        env.seeks.length === 1 && Math.abs(env.seeks[0] - 80) < 0.01, JSON.stringify(env.seeks));
    }

    {
      const env = makeEnv({ doubleTapAccumulateEnabled: true });
      env.window.eval(src);
      await sleep(60);
      const tap = () => { fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360); };
      tap(); await sleep(70); tap(); await sleep(70); tap(); await sleep(70); tap();
      check("[accum] four taps read as 30s", hintText(env) === "−30s", hintText(env));
      await sleep(460);
      check("[accum] four taps jump 30s once",
        env.seeks.length === 1 && Math.abs(env.seeks[0] - 70) < 0.01, JSON.stringify(env.seeks));
    }

    // Default (accumulate off) is untouched: every pair seeks immediately.
    {
      const env = makeEnv();
      env.window.eval(src);
      await sleep(60);
      const tap = () => { fire(env, "pointerdown", 300, 360); fire(env, "pointerup", 300, 360); };
      tap(); await sleep(80); tap();
      check("[accum] off: a double tap seeks straight away",
        env.seeks.length === 1 && Math.abs(env.seeks[0] - 90) < 0.01, JSON.stringify(env.seeks));
    }
  }


  // 7. MV3 service-worker asleep -> content script still boots with fallback
  {
    const env = makeEnv();
    env.chrome.runtime.sendMessage = () => Promise.reject(new Error('worker asleep'));
    env.window.eval(src);
    await sleep(50);
    check('[fallback] boots when background messaging fails', typeof env.contentMsg === 'function');
  }

  // 8. on-video hint language: zh_CN setting produces Chinese hint text
  {
    const env = makeEnv();
    const zhSettings = { ...SETTINGS, language: 'zh_CN' };
    env.chrome.i18n.getUILanguage = () => 'en-US'; // browser English; explicit zh must still win
    env.chrome.runtime.sendMessage = (msg) => {
      if (msg.action === 'get_settings') return Promise.resolve({ ok:true, settings: zhSettings });
      if (msg.action === 'get_config') return Promise.resolve({ ok:true, value:null });
      return Promise.resolve({ ok:true });
    };
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;
    // setting A always shows the "Mark loop start" hint
    env.v.currentTime = 100;
    doc.dispatchEvent(new env.window.KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:'[' }));
    await sleep(20);
    const hud = doc.querySelector('[data-gestio="hud"]');
    const hint = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
    check('[i18n] zh_CN setting yields Chinese HUD hint', hint && /起点/.test(hint.textContent), hint && hint.textContent);
  }

  // 9. on-video hint language: explicit en forces English even if browser is Chinese
  {
    const env = makeEnv();
    const enSettings = { ...SETTINGS, language: 'en' };
    env.chrome.i18n.getUILanguage = () => 'zh-CN'; // browser Chinese; explicit en must win
    env.chrome.i18n.getMessage = (key) => '中文提示'; // pretend locale returns Chinese
    env.chrome.runtime.sendMessage = (msg) => {
      if (msg.action === 'get_settings') return Promise.resolve({ ok:true, settings: enSettings });
      if (msg.action === 'get_config') return Promise.resolve({ ok:true, value:null });
      return Promise.resolve({ ok:true });
    };
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;
    env.v.currentTime = 100;
    doc.dispatchEvent(new env.window.KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:'[' }));
    await sleep(20);
    const hud = doc.querySelector('[data-gestio="hud"]');
    const hint = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
    check('[i18n] explicit en forces English HUD hint', hint && /Mark loop start/i.test(hint.textContent), hint && hint.textContent);
  }

  // 9b. Reloading/updating the extension invalidates the extension context of
  //     every content script already running: chrome.i18n.getUILanguage() then
  //     throws "Extension context invalidated". That used to be caught and
  //     answered with "en", so EVERY on-video hint flipped to English until the
  //     page was reloaded by hand — reported as "装完新版提示变英文了，刷新又好".
  {
    const env = makeEnv();
    env.chrome.i18n.getUILanguage = () => 'zh-CN'; // settings language stays "auto"
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;
    const hintOf = () => {
      const hud = doc.querySelector('[data-gestio="hud"]');
      return hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
    };
    const key = (k) => doc.dispatchEvent(new env.window.KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:k }));

    env.v.currentTime = 100; key('['); await sleep(20);
    check('[i18n] auto follows the browser UI language (zh)', /起点/.test(hintOf() && hintOf().textContent || ''), hintOf() && hintOf().textContent);

    // the extension gets reloaded under a live page
    env.chrome.i18n.getUILanguage = () => { throw new Error('Extension context invalidated'); };
    env.v.currentTime = 140; key(']'); await sleep(20);
    check('[i18n] a dead extension context keeps the HUD language',
      /终点/.test(hintOf() && hintOf().textContent || ''), hintOf() && hintOf().textContent);
  }

  // 9c. Dead context before the first hint ever appears: the browser locale is
  //     still readable, so the guess must not default to English.
  {
    const env = makeEnv();
    Object.defineProperty(env.window.navigator, 'language', { value: 'zh-CN', configurable: true });
    env.chrome.i18n.getUILanguage = () => { throw new Error('Extension context invalidated'); };
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;
    env.v.currentTime = 100;
    doc.dispatchEvent(new env.window.KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:'[' }));
    await sleep(20);
    const hud = doc.querySelector('[data-gestio="hud"]');
    const hint = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
    check('[i18n] falls back to navigator.language, not English', hint && /起点/.test(hint.textContent), hint && hint.textContent);
  }

  // 10. Fullscreen: UI hosts relocate so overlays stay visible on mobile native fullscreen
  {
    const env = makeEnv();
    // emulate popover top-layer API (jsdom lacks it)
    env.window.HTMLElement.prototype.showPopover = function(){ this.__shown = true; };
    env.window.HTMLElement.prototype.hidePopover = function(){ this.__shown = false; };
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;
    const player = doc.getElementById('player');
    const v = env.v;
    // HUD is lazy — trigger a hint so ensureHud() mounts it
    env.v.currentTime = 100;
    doc.dispatchEvent(new env.window.KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:'[' }));
    await sleep(20);
    const hud = doc.querySelector('[data-gestio="hud"]');
    const ab = doc.querySelector('[data-gestio="abpanel"]');
    check('[fs] UI mounted in body before fullscreen', hud && hud.parentElement === doc.body && !!ab);

    // (a) standard container fullscreen -> UI moves into that container
    Object.defineProperty(doc, 'fullscreenElement', { configurable:true, get: () => player });
    doc.dispatchEvent(new env.window.Event('webkitfullscreenchange'));
    await sleep(20);
    check('[fs] container fullscreen re-homes HUD into fullscreen element', hud.parentElement === player, hud.parentElement && hud.parentElement.id);
    check('[fs] container fullscreen re-homes AB panel', ab.parentElement === player);

    // (b) native VIDEO fullscreen -> UI moves into a promoted top-layer popover
    Object.defineProperty(doc, 'fullscreenElement', { configurable:true, get: () => v });
    doc.dispatchEvent(new env.window.Event('webkitfullscreenchange'));
    await sleep(20);
    const top = doc.querySelector('[data-gestio="toplayer"]');
    check('[fs] native video fullscreen creates top-layer host', !!top);
    check('[fs] top-layer host is promoted via popover', top && top.__shown === true);
    check('[fs] HUD relocated into top-layer host', hud.parentElement === top, hud.parentElement && hud.parentElement.getAttribute && hud.parentElement.getAttribute('data-gestio'));
    check('[fs] AB panel relocated into top-layer host', ab.parentElement === top);
    check('[fs] top-layer host has full-viewport fixed style', top && /position:\s*fixed/.test(top.style.cssText) && /100vw/.test(top.style.cssText));

    // (c) exiting fullscreen -> UI returns to body, popover hidden
    Object.defineProperty(doc, 'fullscreenElement', { configurable:true, get: () => null });
    doc.dispatchEvent(new env.window.Event('webkitfullscreenchange'));
    await sleep(20);
    check('[fs] exiting fullscreen returns HUD to body', hud.parentElement === doc.body);
    check('[fs] exiting fullscreen hides top-layer popover', top && top.__shown === false);
  }

  // 11. Interaction details: touch-action, source de-dup, pause guard,
  //     multi-touch rejection, and click gating after a gesture.
  {
    const env = makeEnv();
    env.window.navigator.maxTouchPoints = 5;
    env.window.matchMedia = () => ({ matches:true }); // force isMobile
    const v = env.v;
    const origPlay = v.play;
    v.play = () => { const r = origPlay(); env.__plays = (env.__plays||0)+1; return r; };
    env.window.eval(src);
    await sleep(50);
    const doc = env.window.document;

    // (a) gesture start applies the touch-action the policy asks for. Windowed
    //     mobile playback defaults to "the page keeps scrolling", which is only
    //     true if we do NOT claim every touch with touch-action:none — but a
    //     horizontal drag must still reach us, hence pan-y.
    fire(env,'pointerdown',500,300); fire(env,'pointerup',500,300);
    await sleep(20);
    check('[ix] windowed touch-action keeps the page scrollable', v.style.touchAction === 'pan-y',
      'touchAction=' + v.style.touchAction);

    // (b) stream de-dup: pointer + touch for one stroke must not double the seek.
    // During a real Android stroke both pointermove AND touchmove fire. A pointer
    // gesture accepts only pointer-stream moves. Fire an x-swipe via pointer,
    // then an extra touchmove with a huge delta — seek target must ignore it.
    env.seeks.length = 0; v.currentTime = 100;
    fire(env,'pointerdown',600,360);
    fire(env,'pointermove',900,360);
    // a spurious touch stream event from the same physical stroke
    const TM = env.window.Event;
    const te = new TM('touchmove', { bubbles:true, cancelable:true });
    Object.defineProperty(te, 'touches', { value: [{ clientX:1270, clientY:360, target:v }] });
    doc.dispatchEvent(te);
    fire(env,'pointerup',900,360);
    await sleep(40);
    const seekedTo = env.seeks.length ? env.seeks[env.seeks.length-1] : null;
    check('[ix] cross-stream touchmove ignored (no seek jump)', seekedTo !== null && seekedTo < 400, 'seekedTo=' + seekedTo);

    // (c) pause guard: once the stroke becomes a real gesture, a pause from the
    // site's native control bar is undone (the guard is installed when the
    // stroke is claimed, not on pointerdown — a plain tap must stay untouched).
    v.paused = false; env.__plays = 0; v.currentTime = 100;
    fire(env,'pointerdown',600,360);
    fire(env,'pointermove',640,360); // lock the axis -> claim the stroke
    await sleep(20);
    v.pause(); // simulate the site's native control bar pausing on touch
    v.dispatchEvent(new env.window.Event('pause'));
    await sleep(20);
    check('[ix] pause guard resumes video during gesture', v.paused === false && env.__plays > 0, 'plays=' + env.__plays);
    fire(env,'pointerup',640,360);
    await sleep(20);
    // after gesture ends, a pause event must NOT force play
    env.__plays = 0; v.paused = true;
    v.dispatchEvent(new env.window.Event('pause'));
    await sleep(20);
    check('[ix] pause guard removed after gesture', env.__plays === 0, 'plays=' + env.__plays);

    // (d) multi-touch (pinch) must not start a gesture
    v.currentTime = 100; env.seeks.length = 0; // clear AFTER currentTime setter
    const TS = env.window.Event;
    const ts = new TS('touchstart', { bubbles:true, cancelable:true });
    Object.defineProperty(ts, 'touches', { value: [{clientX:400,clientY:360,target:v},{clientX:800,clientY:360,target:v}] });
    doc.dispatchEvent(ts);
    const tmv = new TS('touchmove', { bubbles:true, cancelable:true });
    Object.defineProperty(tmv, 'touches', { value: [{clientX:300,clientY:360,target:v},{clientX:900,clientY:360,target:v}] });
    doc.dispatchEvent(tmv);
    const tend = new TS('touchend', { bubbles:true, cancelable:true });
    Object.defineProperty(tend, 'changedTouches', { value: [{clientX:300,clientY:360,target:v}] });
    doc.dispatchEvent(tend);
    await sleep(20);
    check('[ix] two-finger touch ignored (no gesture)', env.seeks.length === 0, 'seeks=' + env.seeks.length);

    // (e) trailing synthetic click after a real swipe is suppressed
    v.currentTime = 100; env.seeks.length = 0;
    fire(env,'pointerdown',600,360);
    fire(env,'pointermove',780,360);
    fire(env,'pointerup',780,360);
    await sleep(20);
    const probe = new env.window.MouseEvent('click', { bubbles:true, cancelable:true, clientX:780, clientY:360 });
    doc.dispatchEvent(probe);
    check('[ix] trailing click after gesture suppressed', probe.defaultPrevented, 'defaultPrevented=' + probe.defaultPrevented);
  }

  // 12. Mobile native fullscreen: touch gesture works, pointer stream ignored,
  //     and touch-action:none is forced on the fullscreen video.
  {
    const env = makeEnv();
    env.window.navigator.maxTouchPoints = 5;
    env.window.matchMedia = () => ({ matches:true });
    const v = env.v, doc = env.window.document;
    env.window.eval(src);
    await sleep(50);
    // enter native video fullscreen
    Object.defineProperty(doc, 'fullscreenElement', { configurable:true, get: () => v });

    const touch = (type, x, y) => {
      const e = new env.window.Event(type, { bubbles:true, cancelable:true });
      const t = { clientX:x, clientY:y, target:v };
      Object.defineProperty(e, type === 'touchend' ? 'changedTouches' : 'touches', { value:[t] });
      doc.dispatchEvent(e);
    };

    // pointer stream must be ignored in mobile fullscreen
    v.currentTime = 100; env.seeks.length = 0;
    fire(env,'pointerdown',600,360); fire(env,'pointermove',900,360); fire(env,'pointerup',900,360);
    await sleep(30);
    check('[fs-ix] pointer stream ignored in mobile fullscreen', env.seeks.length === 0, 'seeks=' + env.seeks.length);

    // touch stream drives the gesture
    v.currentTime = 100; env.seeks.length = 0;
    touch('touchstart',600,360); touch('touchmove',900,360); touch('touchend',900,360);
    await sleep(30);
    check('[fs-ix] touch swipe seeks in mobile fullscreen', env.seeks.length > 0, 'seeks=' + env.seeks.length);
    check('[fs-ix] touch-action:none on fullscreen video', v.style.touchAction === 'none', 'touchAction=' + v.style.touchAction);
  }

  // 13. Long-press drag speed: tier quantisation (one tier per
  //     60px), tier row hidden the instant the finger lifts, and the inline
  //     opacity regression that used to pin the row on screen.
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    env.window.eval(src);
    await sleep(50);
    // the HUD is created lazily on first use, so look it up on every call
    const tiersEl = () => {
      const hud = doc.querySelector('[data-gestio="hud"]');
      return (hud && hud.shadowRoot) ? hud.shadowRoot.querySelector('.tiers') : null;
    };

    fire(env, 'pointerdown', 600, 360);
    await sleep(360); // longPressDelay = 300ms
    check('[lp] long press applies the anchor speed', Math.abs(v.playbackRate - 2) < 0.01, 'rate=' + v.playbackRate);

    // one tier (PX px) up: 2x -> 3x
    const PX = SETTINGS.longPressDragSensitivity;
    fire(env, 'pointermove', 600 + PX, 360);
    await sleep(10);
    check('[lp] one tier per ' + PX + 'px drag', Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);

    // two tiers up: 3x -> 4x, clamped at the top of the ladder
    fire(env, 'pointermove', 600 + PX * 2, 360);
    await sleep(10);
    check('[lp] two tiers reach the top', Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);

    // dragging back to the anchor must come back down (old code only ran away)
    fire(env, 'pointermove', 600, 360);
    await sleep(10);
    check('[lp] dragging back returns to the anchor', Math.abs(v.playbackRate - 2) < 0.01, 'rate=' + v.playbackRate);

    // vertical drift must not freeze the mapping: the axis is latched once, and
    // every later frame keeps reading dx. Requiring
    // adx >= ady on each frame used to make a slightly diagonal drag feel stuck.
    fire(env, 'pointermove', 600 + PX, 370);       // adx=45, ady=10 -> drag latched
    await sleep(10);
    check('[lp] diagonal start still latches the drag', Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointermove', 600 + PX * 2, 500);   // adx=90, ady=140 -> drift down
    await sleep(10);
    check('[lp] vertical drift does not freeze the rate', Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointermove', 600, 360);
    await sleep(10);

    // one tier down, then two tiers down
    fire(env, 'pointermove', 600 - PX, 360);
    await sleep(10);
    check('[lp] one tier left steps down', Math.abs(v.playbackRate - 1.5) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointermove', 600 - PX * 2, 360);
    await sleep(10);
    check('[lp] two tiers left steps down twice', Math.abs(v.playbackRate - 1.25) < 0.01, 'rate=' + v.playbackRate);

    // a sub-half-tier nudge must not change anything
    fire(env, 'pointermove', 600, 360);
    await sleep(10);
    fire(env, 'pointermove', 600 + Math.floor(PX * 0.4), 360);
    await sleep(10);
    check('[lp] sub-tier nudge keeps the rate', Math.abs(v.playbackRate - 2) < 0.01, 'rate=' + v.playbackRate);

    // the active tier is rendered with the two chevrons the HUD draws
    fire(env, 'pointermove', 600 + PX, 360);
    await sleep(10);
    const tEl = tiersEl();
    check('[lp] tier HUD highlights the current tier',
      !!tEl && tEl.classList.contains('show') && /class="t active"/.test(tEl.innerHTML) && /3x/.test(tEl.innerHTML),
      tEl && tEl.innerHTML.replace(/\s+/g, ' ').slice(0, 160));
    check('[lp] active tier carries the chevrons',
      !!tEl && (tEl.innerHTML.match(/class="chev"/g) || []).length === 2,
      String(!!tEl && (tEl.innerHTML.match(/class="chev"/g) || []).length));
    check('[lp] tier row is not pinned by an inline opacity',
      !!tEl && !tEl.style.opacity, 'inline opacity=' + (tEl && tEl.style.opacity));

    fire(env, 'pointerup', 660, 360);
    await sleep(80);
    check('[lp] tier HUD hides immediately on release',
      !!tEl && !tEl.classList.contains('show'), 'class=' + (tEl && tEl.className));
    // ...and the row is taken out of the render tree entirely, so no CSS
    // override or late touchmove can bring it back
    await sleep(220);
    check('[lp] tier row is display:none after release',
      !!tEl && tEl.style.display === 'none', 'display=' + (tEl && tEl.style.display));
    fire(env, 'pointermove', 660, 360); // stray move after the lift
    await sleep(20);
    check('[lp] stray move cannot resurrect the tier row',
      !!tEl && tEl.style.display === 'none' && !tEl.classList.contains('show'),
      'display=' + (tEl && tEl.style.display) + ' class=' + (tEl && tEl.className));

    // safety net: an auto-hide fires even if the end event is swallowed
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 700, 360);
    await sleep(10);
    check('[lp] HUD visible during a stuck drag', !!tiersEl() && tiersEl().classList.contains('show'));
    await sleep(3200); // no pointerup at all
    check('[lp] HUD auto-hides when the end event is lost',
      !!tiersEl() && !tiersEl().classList.contains('show'), 'class=' + (tiersEl() && tiersEl().className));
    fire(env, 'pointerup', 600, 360);
    await sleep(20);

    // a cancel from the other input stream still ends the gesture (Android
    // cancels the touch stream while the gesture was claimed by pointer)
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 700, 360);
    await sleep(10);
    doc.dispatchEvent(new env.window.Event('touchcancel', { bubbles:true, cancelable:true }));
    await sleep(80);
    check('[lp] cross-stream cancel ends the gesture and hides the HUD',
      !!tiersEl() && !tiersEl().classList.contains('show'), 'class=' + (tiersEl() && tiersEl().className));
    // ...and the next gesture starts cleanly instead of being ignored
    const before2 = v.playbackRate;
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    check('[lp] gesture works again after a cancel', Math.abs(v.playbackRate - 2) < 0.01,
      before2 + ' -> ' + v.playbackRate);
    fire(env, 'pointerup', 600, 360);
  }

  // 14. Seek preview card + vertical lock.
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    // Watch what the page writes back: the two-finger tap must change this
    // page only, never the stored "starting state" a new page reads.
    const configWrites = [];
    const sendMessage = env.chrome.runtime.sendMessage;
    env.chrome.runtime.sendMessage = (m) => {
      if (m && m.action === 'set_config') configWrites.push(m.key);
      return sendMessage(m);
    };
    env.window.eval(src);
    await sleep(50);

    const card = () => {
      const hud = doc.querySelector('[data-gestio="hud"]');
      return (hud && hud.shadowRoot) ? hud.shadowRoot.querySelector('.seekcard') : null;
    };
    const parseClock = (s) => {
      const p = String(s).split(':').map(Number);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    };
    // duration 600s, video width 1280px -> 20% of the width is |0.2|^1.5 * 600
    const expectDelta = Math.pow(0.2, 1.5) * 600;

    env.v.currentTime = 100;
    env.seeks.length = 0;
    fire(env, 'pointerdown', 640, 360);
    fire(env, 'pointermove', 660, 360);   // 20px, below the 30px deadzone
    await sleep(10);
    check('[seek] deadzone: a 20px swipe shows no preview',
      !card() || !card().classList.contains('show'), 'class=' + (card() && card().className));

    fire(env, 'pointermove', 896, 360);   // 256px = 20% of the video width
    await sleep(10);
    const c1 = card();
    const shown = !!c1 && c1.classList.contains('show');
    const head = shown ? c1.querySelector('.stime').textContent : '';
    const shownTarget = shown ? parseClock(head.split('/')[0].trim()) : -1;
    check('[seek] preview card appears past the deadzone', shown, 'class=' + (c1 && c1.className));
    check('[seek] card header reads "target / duration"',
      shown && /\/\s*10:00$/.test(head.trim()), 'head=' + head);
    check('[seek] target matches |dx/W|^1.5 * duration',
      Math.abs(shownTarget - (100 + expectDelta)) < 2,
      shownTarget + ' vs ' + (100 + expectDelta).toFixed(1));
    check('[seek] target dot sits at the previewed position',
      shown && Math.abs(parseFloat(c1.querySelector('.pdot.tgt').style.left) - ((100 + expectDelta) / 600 * 100)) < 1,
      shown ? c1.querySelector('.pdot.tgt').style.left : 'no card');

    // The gesture keeps the video playing. The white dot must mark the anchor
    // (where the finger went down) and stay put — a live playhead used to make
    // both dots crawl together, which is exactly what the user reported.
    const curLeft1 = parseFloat(c1.querySelector('.pdot.cur').style.left);
    const leftText1 = c1.querySelector('.ptime.left').textContent;
    const tgtLeft1 = parseFloat(c1.querySelector('.pdot.tgt').style.left);
    env.v.currentTime = 130;          // playback advanced 30s while holding
    await sleep(300);                 // let the 250ms repaint tick run
    const curLeft2 = parseFloat(card().querySelector('.pdot.cur').style.left);
    check('[seek] white dot stays on the anchor while the video plays',
      Math.abs(curLeft2 - curLeft1) < 0.01, curLeft1 + ' -> ' + curLeft2);
    check('[seek] anchor time label does not drift',
      card().querySelector('.ptime.left').textContent === leftText1,
      leftText1 + ' -> ' + card().querySelector('.ptime.left').textContent);
    fire(env, 'pointermove', 960, 360);   // 320px = 25% of the width
    await sleep(10);
    const tgtLeft2 = parseFloat(card().querySelector('.pdot.tgt').style.left);
    check('[seek] blue dot keeps following the finger', tgtLeft2 > tgtLeft1,
      tgtLeft1.toFixed(1) + '% -> ' + tgtLeft2.toFixed(1) + '%');
    check('[seek] target is still measured from the anchor, not from playback',
      Math.abs(parseClock(card().querySelector('.stime').textContent.split('/')[0].trim()) - (100 + Math.pow(0.25, 1.5) * 600)) < 2,
      card().querySelector('.stime').textContent);
    env.seeks.length = 0;
    env.v.currentTime = 100;

    // dragging back to the gesture origin must return to the start time
    fire(env, 'pointermove', 640, 360);
    await sleep(10);
    const back = parseClock(card().querySelector('.stime').textContent.split('/')[0].trim());
    check('[seek] dragging back returns to the anchor time', Math.abs(back - 100) < 2, 'target=' + back);

    fire(env, 'pointerup', 640, 360);
    await sleep(60);
    check('[seek] release commits exactly the previewed target',
      env.seeks.length === 0 || Math.abs(env.seeks[env.seeks.length - 1] - 100) < 2,
      'seeks=' + JSON.stringify(env.seeks));
    check('[seek] card hides on release', !card().classList.contains('show'), 'class=' + card().className);

    // swipe down past the cancel distance: preview dims and nothing is applied
    env.v.currentTime = 100; env.seeks.length = 0;
    fire(env, 'pointerdown', 640, 360);
    fire(env, 'pointermove', 896, 360);
    await sleep(10);
    fire(env, 'pointermove', 896, 380);   // 20px down = half distance -> warning only
    await sleep(10);
    check('[seek] half-distance downward drift only warns',
      !!card() && !card().classList.contains('cancelled'), 'class=' + (card() && card().className));
    fire(env, 'pointermove', 896, 420);   // 60px down -> cancelled
    await sleep(10);
    check('[seek] swiping down cancels the preview',
      !!card() && card().classList.contains('cancelled'), 'class=' + (card() && card().className));
    fire(env, 'pointerup', 896, 420);
    await sleep(60);
    check('[seek] a cancelled seek leaves the playhead alone', env.seeks.length === 0,
      'seeks=' + JSON.stringify(env.seeks));

    // ---- vertical lock -----------------------------------------------------
    const touchEv = (type, pts) => {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: pts.map(([x, y]) => ({ clientX: x, clientY: y, target: v })) });
      Object.defineProperty(ev, 'changedTouches', { value: [] });
      return ev;
    };
    // Which slider gets locked is decided by the half of the video the two
    // fingers land on: left = brightness, right = volume.
    // The chord has a 280ms cooldown after it commits, so two taps closer than
    // that would silently swallow the second one — which made the last
    // assertion in this block fail about one run in five.
    let lastTapAt = 0;
    const twoFingerTap = async (x1, x2) => {
      const wait = 320 - (Date.now() - lastTapAt);
      if (wait > 0) await sleep(wait);
      lastTapAt = Date.now();
      doc.dispatchEvent(touchEv('touchstart', [[x1, 340], [x2, 380]]));
      await sleep(20);
      doc.dispatchEvent(touchEv('touchend', []));
      await sleep(30);
    };
    const rightHalfTap = () => twoFingerTap(900, 1000);   // midpoint 950
    const leftHalfTap = () => twoFingerTap(300, 400);     // midpoint 350
    const swipeUp = async (x) => {
      fire(env, 'pointerdown', x, 300);
      for (let y = 300; y >= 180; y -= 30) { fire(env, 'pointermove', x, y); await sleep(5); }
      fire(env, 'pointerup', x, 180);
      await sleep(40);
    };
    // brightness starts at 100% and caps there, so a downward swipe is what
    // actually moves it
    const swipeDown = async (x) => {
      fire(env, 'pointerdown', x, 180);
      for (let y = 180; y <= 300; y += 30) { fire(env, 'pointermove', x, y); await sleep(5); }
      fire(env, 'pointerup', x, 300);
      await sleep(40);
    };

    env.v.volume = 0.5;
    await swipeUp(1000);
    const volFree = env.v.volume;
    check('[lock] volume swipe works while unlocked', volFree > 0.5, 'volume=' + volFree);

    // right half → volume only; brightness keeps working on the left half
    await rightHalfTap();
    env.v.volume = 0.5;
    await swipeUp(1000);
    check('[lock] two-finger tap on the right half locks volume',
      Math.abs(env.v.volume - 0.5) < 0.001, 'volume=' + env.v.volume);

    env.v.style.filter = "";
    await swipeDown(200);
    check('[lock] brightness still works while only volume is locked',
      /brightness\(0\./.test(env.v.style.filter), 'filter=' + env.v.style.filter);

    // ...while horizontal seek keeps working in the same locked state
    env.v.currentTime = 200; env.seeks.length = 0;
    fire(env, 'pointerdown', 400, 360);
    for (let x = 400; x <= 656; x += 32) { fire(env, 'pointermove', x, 360); await sleep(5); }
    fire(env, 'pointerup', 656, 360);
    await sleep(60);
    check('[lock] seek still works while locked',
      env.seeks.some(s => s > 200), 'seeks=' + JSON.stringify(env.seeks));

    // the two halves are independent: tapping the other half adds it instead of
    // stealing the slot, so both sliders can end up locked
    await leftHalfTap();
    env.v.volume = 0.5;
    await swipeUp(1000);
    check('[lock] tapping the left half locks brightness too',
      Math.abs(env.v.volume - 0.5) < 0.001, 'volume=' + env.v.volume);
    const filterBefore = env.v.style.filter;
    await swipeDown(200);
    check('[lock] brightness is blocked once it is locked as well',
      env.v.style.filter === filterBefore, 'filter=' + env.v.style.filter);

    // a locked half releases on its own, leaving the other half locked
    await leftHalfTap();
    await swipeDown(200);
    check('[lock] tapping a locked half releases only that slider',
      env.v.style.filter !== filterBefore, 'filter=' + env.v.style.filter);
    env.v.volume = 0.5;
    await swipeUp(1000);
    check('[lock] the other half stays locked in the meantime',
      Math.abs(env.v.volume - 0.5) < 0.001, 'volume=' + env.v.volume);

    // releasing the last locked half turns the lock off altogether
    await rightHalfTap();
    env.v.volume = 0.5;
    await swipeUp(1000);
    check('[lock] releasing the last half clears the lock',
      env.v.volume > 0.5, 'volume=' + env.v.volume);

    // ...and none of those taps reached the settings
    check('[lock] a two-finger tap never rewrites the stored starting state',
      !configWrites.some(k => /^lock/i.test(k)), 'writes=' + JSON.stringify(configWrites));
  }

  // 14a2. The switches in the settings are the STARTING state: a page snapshots
  // them when it loads, then owns its lock. Saving on every tap used to leak one
  // tab's lock into every page opened afterwards (while tabs already open kept
  // their old state), which is neither global nor per page.
  {
    const env = makeEnv({ lockVerticalSwipe: true, lockVerticalTarget: "brightness" });
    env.window.eval(src);
    await sleep(60);

    env.v.style.filter = "";
    fire(env, 'pointerdown', 200, 180);
    for (let y = 180; y <= 300; y += 30) { fire(env, 'pointermove', 200, y); await sleep(5); }
    fire(env, 'pointerup', 200, 300);
    await sleep(40);
    check('[lock] a new page starts from the stored state (brightness locked)',
      env.v.style.filter === "", 'filter=' + env.v.style.filter);

    env.v.volume = 0.5;
    fire(env, 'pointerdown', 1000, 300);
    for (let y = 300; y >= 180; y -= 30) { fire(env, 'pointermove', 1000, y); await sleep(5); }
    fire(env, 'pointerup', 1000, 180);
    await sleep(40);
    check('[lock] ...and the other slider starts free', env.v.volume > 0.5, 'volume=' + env.v.volume);
  }

  // 14b. The two-finger chord has to survive how fingers actually land and
  //      lift on a phone: a beat apart, held for a moment, or cancelled when
  //      the native player changes its top layer mid-touch. It used to require
  //      both fingers to lift together inside 450ms, which made it feel dead.
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    env.window.eval(src);
    await sleep(50);
    const badge = () => {
      const h = doc.querySelector('[data-gestio="hud"]');
      const b = h && h.shadowRoot && h.shadowRoot.querySelector('.lockbadge');
      return b ? b.textContent.trim() : '';
    };
    const touchEv = (type, pts) => {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: pts.map(([x, y]) => ({ clientX: x, clientY: y, target: v })) });
      Object.defineProperty(ev, 'changedTouches', { value: [] });
      return ev;
    };

    // fingers lifted one after the other: the first lift commits the tap
    doc.dispatchEvent(touchEv('touchstart', [[300, 340], [400, 380]]));
    await sleep(20);
    doc.dispatchEvent(touchEv('touchend', [[400, 380]])); // one finger still down
    await sleep(40);
    check('[chord] a tap where one finger lifts first still registers',
      badge() === 'Brightness locked', JSON.stringify(badge()));
    const once = badge();
    doc.dispatchEvent(touchEv('touchend', [])); // the trailing finger
    await sleep(40);
    check('[chord] the trailing finger does not toggle a second time',
      badge() === once, JSON.stringify(badge()));

    // a slightly slower tap (people hold a moment on a phone) still counts
    await sleep(420); // past the double-toggle + chord cooldown guard
    doc.dispatchEvent(touchEv('touchstart', [[900, 340], [1000, 380]]));
    await sleep(600);
    doc.dispatchEvent(touchEv('touchend', []));
    await sleep(40);
    check('[chord] a 600ms press still counts as a tap',
      badge() === 'Volume locked', JSON.stringify(badge()));

    // ...but a real hold is not a tap
    await sleep(420); // chord cooldown is 280ms; leave margin on a loaded machine
    const held = badge();
    doc.dispatchEvent(touchEv('touchstart', [[900, 340], [1000, 380]]));
    await sleep(1100);
    doc.dispatchEvent(touchEv('touchend', []));
    await sleep(40);
    check('[chord] holding for over a second is not a tap', badge() === held, JSON.stringify(badge()));

    // three fingers are not our chord
    await sleep(420); // chord cooldown is 280ms; leave margin on a loaded machine
    const three = badge();
    doc.dispatchEvent(touchEv('touchstart', [[300, 340], [400, 380], [500, 360]]));
    await sleep(20);
    doc.dispatchEvent(touchEv('touchend', []));
    await sleep(40);
    check('[chord] three fingers are ignored', badge() === three, JSON.stringify(badge()));

    // a native-fullscreen cancel with both fingers gone still counts
    await sleep(420); // chord cooldown is 280ms; leave margin on a loaded machine
    doc.dispatchEvent(touchEv('touchstart', [[300, 340], [400, 380]]));
    await sleep(160);
    doc.dispatchEvent(touchEv('touchcancel', []));
    await sleep(40);
    check('[chord] a cancelled stream still commits the tap',
      badge() === 'Brightness unlocked', JSON.stringify(badge()));
  }

  // 15. Re-tuning a rate that is already locked. Blocking the drag branch while
  //     locked meant a locked 4x ignored every later long press, and the release
  //     path dropped the guard instead of re-targeting it. Ours used to unlock
  //     silently. Now the drag re-tunes and the new value stays locked
  //     (option "Keep tuning a locked speed").
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    env.window.eval(src);
    await sleep(50);
    const PX = SETTINGS.longPressDragSensitivity;
    const pin = () => doc.documentElement.dataset.gestioRate;
    const isLocked = () => pin() != null;
    const hintText = () => {
      const hud = doc.querySelector('[data-gestio="hud"]');
      const h = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
      return h ? h.textContent : '';
    };

    // lock at 4x: two tiers up, then swipe up and release
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 600 + PX * 2, 360);
    await sleep(10);
    check('[lock2] drag reaches 4x before locking', Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointermove', 600 + PX * 2, 200); // ady=160 > max(40, adx) -> lock intent
    await sleep(10);
    fire(env, 'pointerup', 600 + PX * 2, 200);
    await sleep(60);
    check('[lock2] 4x is locked after release', isLocked() && Math.abs(v.playbackRate - 4) < 0.01,
      'pin=' + pin() + ' rate=' + v.playbackRate);

    // second long press while locked: anchor stays 4x and the hint says how out
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    check('[lock2] locked rate is the anchor, not the default 2x',
      Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);
    check('[lock2] hint offers exit and re-tune', /^↓/.test(hintText()),
      JSON.stringify(hintText().slice(0, 90)));

    // dragging left one tier re-tunes while staying locked
    fire(env, 'pointermove', 600 - PX, 360);
    await sleep(10);
    check('[lock2] drag re-tunes a locked rate', Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);
    check('[lock2] the pin follows the drag', pin() === '3', 'pin=' + pin());
    fire(env, 'pointerup', 600 - PX, 360);
    await sleep(60);
    check('[lock2] release keeps the new rate locked',
      isLocked() && Math.abs(v.playbackRate - 3) < 0.01, 'pin=' + pin() + ' rate=' + v.playbackRate);

    // a plain long press without dragging must not silently unlock
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointerup', 600, 360);
    await sleep(60);
    check('[lock2] plain long press keeps the lock',
      isLocked() && Math.abs(v.playbackRate - 3) < 0.01, 'pin=' + pin() + ' rate=' + v.playbackRate);

    // swipe down still exits the speed entirely
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 600, 420);
    await sleep(10);
    fire(env, 'pointerup', 600, 420);
    await sleep(60);
    check('[lock2] swipe down exits the locked speed',
      !isLocked() && Math.abs(v.playbackRate - 1) < 0.01, 'rate=' + v.playbackRate);

    // strict behaviour when the option is off
    const saved = SETTINGS.longPressDragWhileLocked;
    SETTINGS.longPressDragWhileLocked = false;
    env.contentMsg({ action: 'settings_changed' }, {}, () => {});
    await sleep(60);
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 600 + PX, 360);
    await sleep(10);
    fire(env, 'pointermove', 600 + PX, 200);
    await sleep(10);
    fire(env, 'pointerup', 600 + PX, 200);
    await sleep(60);
    check('[lock2] option off: locks at 3x', isLocked() && Math.abs(v.playbackRate - 3) < 0.01,
      'pin=' + pin() + ' rate=' + v.playbackRate);
    fire(env, 'pointerdown', 600, 360);
    await sleep(360);
    fire(env, 'pointermove', 600 + PX * 2, 360);
    await sleep(10);
    check('[lock2] option off: drag ignored while locked', Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointerup', 600 + PX * 2, 360);
    await sleep(60);
    check('[lock2] option off: lock survives the press', isLocked(), 'pin=' + pin());
    SETTINGS.longPressDragWhileLocked = saved;
    env.contentMsg({ action: 'settings_changed' }, {}, () => {});
    await sleep(40);
  }

  // 15b. The same contract, but with main-world.js's playbackRate pin in place.
  //      jsdom previously could not see this: main-world overrides the setter so
  //      that while a pin is active EVERY write is coerced to the pinned value.
  //      Any code that sets the rate before moving the pin therefore loses the
  //      write — the drag looks dead and the release restores the old speed.
  //      This group asserts the three moves the gesture must keep working:
  //      long press again → same locked speed, drag → retune, swipe down → exit.
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    installPin(env);
    env.window.eval(src);
    await sleep(60);
    const PX = SETTINGS.longPressDragSensitivity;
    const pin = () => doc.documentElement.dataset.gestioRate;
    const hintText = () => {
      const hud = doc.querySelector('[data-gestio="hud"]');
      const h = hud && hud.shadowRoot && hud.shadowRoot.querySelector('.hint');
      return h ? h.textContent : '';
    };
    const holdAt = async (x, y) => { fire(env, 'pointerdown', x, y); await sleep(360); };

    // A site that already plays at 1.5x: exiting the speed must come back to
    // 1.5x, not silently force 1x.
    v.playbackRate = 1.5;

    // hold → drag two tiers → swipe up → release = locked 4x
    await holdAt(600, 360);
    fire(env, 'pointermove', 600 + PX * 2, 360);
    await sleep(10);
    check('[pin] drag reaches 4x while the attribute pins 1.5x',
      Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointermove', 600 + PX * 2, 200);
    await sleep(10);
    fire(env, 'pointerup', 600 + PX * 2, 200);
    await sleep(80);
    check('[pin] 4x is pinned', pin() === '4' && Math.abs(v.playbackRate - 4) < 0.01,
      'pin=' + pin() + ' rate=' + v.playbackRate);

    // long press again → must stay on the locked 4x (not fall back to 2x)
    await holdAt(600, 360);
    check('[pin] a second long press keeps the locked speed',
      Math.abs(v.playbackRate - 4) < 0.01, 'rate=' + v.playbackRate);
    check('[pin] the second hold offers exit + retune', /^↓/.test(hintText()),
      JSON.stringify(hintText().slice(0, 90)));

    // drag one tier down → the effective playbackRate must actually change
    fire(env, 'pointermove', 600 - PX, 360);
    await sleep(20);
    check('[pin] dragging a locked speed really changes playback',
      Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);
    check('[pin] the pin follows the drag', pin() === '3', 'pin=' + pin());
    fire(env, 'pointerup', 600 - PX, 360);
    await sleep(80);
    check('[pin] the retuned speed stays locked after release',
      pin() === '3' && Math.abs(v.playbackRate - 3) < 0.01, 'pin=' + pin() + ' rate=' + v.playbackRate);

    // yet another long press → still 3x
    await holdAt(600, 360);
    check('[pin] the lock memory survives repeated holds',
      Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);

    // swipe down → exit: pin gone and the pre-lock 1.5x is restored
    fire(env, 'pointermove', 600, 420);
    await sleep(20);
    fire(env, 'pointerup', 600, 420);
    await sleep(80);
    check('[pin] swipe down exits the speed', pin() == null, 'pin=' + pin());
    check('[pin] exiting restores the site rate, not a hard 1x',
      Math.abs(v.playbackRate - 1.5) < 0.01, 'rate=' + v.playbackRate);

    // after exiting, a fresh hold starts from the boost default again
    await holdAt(600, 360);
    check('[pin] after exiting, a hold uses the boost default',
      Math.abs(v.playbackRate - 2) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointerup', 600, 360);
    await sleep(80);
    check('[pin] a cancelled hold leaves no pin', pin() == null, 'pin=' + pin());

    // a page that wipes the attribute must not lose the lock
    await holdAt(600, 360);
    fire(env, 'pointermove', 600 + PX, 360);
    await sleep(10);
    fire(env, 'pointermove', 600 + PX, 200);
    await sleep(10);
    fire(env, 'pointerup', 600 + PX, 200);
    await sleep(80);
    const lockedAt = pin();
    check('[pin] setup: locked at one tier above the boost default',
      lockedAt === '3' && Math.abs(v.playbackRate - 3) < 0.01, 'pin=' + lockedAt);
    doc.documentElement.removeAttribute('data-gestio-rate');
    await holdAt(600, 360);
    check('[pin] the lock value survives a page dropping the attribute',
      Math.abs(v.playbackRate - 3) < 0.01, 'rate=' + v.playbackRate);
    fire(env, 'pointerup', 600, 360);
    await sleep(80);
    check('[pin] the release re-arms the pin',
      pin() === '3' && Math.abs(v.playbackRate - 3) < 0.01, 'pin=' + pin());

    // up-then-down inside one stroke is reversible
    await holdAt(600, 360);
    fire(env, 'pointermove', 600, 200);
    await sleep(10);
    fire(env, 'pointermove', 600, 460);
    await sleep(10);
    fire(env, 'pointerup', 600, 460);
    await sleep(80);
    check('[pin] up-then-down in one stroke exits speed',
      pin() == null && Math.abs(v.playbackRate - 1.5) < 0.01,
      'pin=' + pin() + ' rate=' + v.playbackRate);
  }

  // 16. The on-video wording must follow the stored language even when the
  //     service worker is unreachable — that is the normal state on Android,
  //     where the worker is killed between gestures. A failed get_settings used
  //     to drop the whole set back to "auto" (browser UI = English), so picking
  //     中文 in the options page flipped the HUD back to English.
  {
    const env = makeEnv();
    const v = env.v, doc = env.window.document;
    env.chrome.runtime.sendMessage = (msg) => {
      if (msg.action === 'get_settings') return Promise.reject(new Error('service worker asleep'));
      return Promise.resolve({ ok: true });
    };
    env.chrome.storage.local.get = () => Promise.resolve({
      gestio_settings_v1: Object.assign({}, SETTINGS, { language: 'zh_CN' }),
    });
    env.chrome.storage.onChanged = { addListener: (fn) => { env.onStorage = fn; } };
    env.window.eval(src);
    await sleep(60);
    const badge = () => {
      const h = doc.querySelector('[data-gestio="hud"]');
      const b = h && h.shadowRoot && h.shadowRoot.querySelector('.lockbadge');
      return b ? b.textContent.trim() : '';
    };
    const touchEv = (type, pts) => {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: pts.map(([x, y]) => ({ clientX: x, clientY: y, target: v })) });
      Object.defineProperty(ev, 'changedTouches', { value: [] });
      return ev;
    };
    doc.dispatchEvent(touchEv('touchstart', [[300, 340], [400, 380]]));
    await sleep(30);
    doc.dispatchEvent(touchEv('touchend', []));
    await sleep(40);
    check('[lang] the HUD speaks Chinese from storage when the worker is asleep',
      badge() === '已锁定亮度', JSON.stringify(badge()));

    // a storage change reaches the HUD without a broadcast
    await sleep(420); // chord cooldown is 280ms; leave margin on a loaded machine
    if (env.onStorage) env.onStorage({ gestio_settings_v1: { newValue: { language: 'en' } } }, 'local');
    await sleep(20);
    doc.dispatchEvent(touchEv('touchstart', [[300, 340], [400, 380]]));
    await sleep(30);
    doc.dispatchEvent(touchEv('touchend', []));
    await sleep(40);
    check('[lang] a later language change is picked up live',
      badge() === 'Brightness unlocked', JSON.stringify(badge()));
  }

  // 20. Windowed playback. Three separate promises the old build broke:
  //     a) the on-video UI must stay inside the video, not the viewport;
  //     b) a vertical swipe must not steal the page scroll (and, by default,
  //        must not touch volume/brightness at all while windowed);
  //     c) moving a slider must never start a paused video.
  {
    const mk = (opts) => {
      const env = makeEnv(opts);
      env.window.navigator.maxTouchPoints = 5;
      env.window.matchMedia = () => ({ matches: true }); // isMobile
      env.v.play = () => { env.plays = (env.plays || 0) + 1; return Promise.resolve(); };
      return env;
    };
    const touch = (env, type, x, y) => {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      const list = type === 'touchend' ? [] : [{ clientX: x, clientY: y, target: env.v }];
      Object.defineProperty(ev, 'touches', { value: list });
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y, target: env.v }] });
      env.window.document.dispatchEvent(ev);
      return ev;
    };
    // Fire a whole vertical stroke and report whether the page was blocked.
    const stroke = async (env, x, y0, y1) => {
      const blocked = [];
      blocked.push(touch(env, 'touchstart', x, y0).defaultPrevented);
      const step = y1 > y0 ? 20 : -20;
      for (let y = y0; (step > 0 ? y <= y1 : y >= y1); y += step) {
        blocked.push(touch(env, 'touchmove', x, y).defaultPrevented);
        await sleep(3);
      }
      touch(env, 'touchend', x, y1);
      await sleep(40);
      return blocked.some(Boolean);
    };
    const meter = (env, kind) => {
      const hud = env.window.document.querySelector('[data-gestio="hud"]');
      return hud && hud.shadowRoot
        ? hud.shadowRoot.querySelector('[data-gestio-meter="' + kind + '"]') : null;
    };

    // (a) the HUD is sized to the video, not to the window
    {
      // Boost off: the bar then spans 0..100%, so the number and the fill agree
      // and the arithmetic below is exact (the boost scale has its own case).
      const env = mk({ nonFullscreenVertical: 'always', volumeBoostEnabled: false });
      const v = env.v;
      v.getBoundingClientRect = () => ({ left: 120, top: 200, right: 760, bottom: 560, width: 640, height: 360, x: 120, y: 200 });
      env.window.eval(src);
      await sleep(50);
      const blocked = await stroke(env, 700, 300, 480);
      const hud = env.window.document.querySelector('[data-gestio="hud"]');
      check('[win] the HUD is confined to the video box',
        hud && hud.style.left === '120px' && hud.style.top === '200px' &&
        hud.style.width === '640px' && hud.style.height === '360px',
        hud ? [hud.style.left, hud.style.top, hud.style.width, hud.style.height].join(' ') : 'no hud');
      check('[win] an owned vertical swipe is consumed', blocked);

      // (b) two separate meters, each with its own number. The brightness bar
      //     is created by a left-zone swipe, which is also where it lives.
      await stroke(env, 200, 480, 300);
      const vol = meter(env, 'volume');
      const bright = meter(env, 'brightness');
      check('[mtr] volume and brightness have their own bar',
        !!vol && !!bright && vol !== bright);
      check('[mtr] brightness sits on the left, volume on the right',
        bright.classList.contains('bright') && vol.classList.contains('vol'),
        (bright.className + ' | ' + vol.className));
      const pctText = vol.querySelector('.mp').textContent;
      check('[mtr] the volume bar shows a percentage', /^\d+%$/.test(pctText), pctText);
      // 1.0 -> 180px down over a 360px tall video = half
      check('[mtr] the percentage follows the swipe', pctText === '50%', pctText);
      check('[mtr] the bar fills to the same value',
        Math.abs(parseFloat(vol.querySelector('.mf').style.height) - 50) < 1, vol.querySelector('.mf').style.height);
      check('[mtr] no 100% notch without a boost',
        vol.querySelector('.m100').style.display === 'none', vol.querySelector('.m100').style.display);
      const bText = bright.querySelector('.mp').textContent;
      check('[mtr] a left-zone swipe drives the brightness bar', /^\d+%$/.test(bText), bText);
    }

    // (b2) with a boost the scale runs 0..max: the number stays the real value,
    //      the bar fills towards the maximum and a notch marks plain 100%.
    {
      const env = mk({ nonFullscreenVertical: 'always', volumeBoostEnabled: true, volumeBoostMax: 300 });
      const v = env.v;
      v.volume = 1;
      env.window.eval(src);
      await sleep(50);
      await stroke(env, 1000, 700, 160); // swipe up: 100% -> 250%
      const vol = meter(env, 'volume');
      const pct = vol.querySelector('.mp').textContent;
      const fill = parseFloat(vol.querySelector('.mf').style.height);
      const mark = vol.querySelector('.m100');
      check('[mtr] a boosted value is shown as its real percentage',
        parseInt(pct, 10) > 100, pct);
      check('[mtr] the bar still fills towards the boosted maximum',
        Math.abs(fill - parseInt(pct, 10) / 3) < 1.5, fill + '% of ' + pct);
      check('[mtr] a 100% notch marks the normal maximum',
        mark.style.display === 'block' && Math.abs(parseFloat(mark.style.bottom) - 33.3) < 1,
        mark.style.display + ' @' + mark.style.bottom);
    }

    // (c) default policy: windowed vertical swipes belong to the page, and a
    //     paused video must not start playing because a slider moved.
    {
      const env = mk(); // settings.json default: nonFullscreenVertical = fullscreen
      const v = env.v;
      // A genuinely windowed player: the default rect (1280x720 on a 1024x768
      // viewport) counts as fullscreen, which is the whole point of the escape
      // hatch that keeps native Android fullscreen working.
      v.getBoundingClientRect = () => ({ left: 100, top: 180, right: 740, bottom: 540, width: 640, height: 360, x: 100, y: 180 });
      v.volume = 1;
      v.pause();
      env.window.eval(src);
      await sleep(50);
      const blocked = await stroke(env, 680, 220, 440);
      check('[win] windowed vertical swipe does not touch the volume', v.volume === 1, 'volume=' + v.volume);
      check('[win] windowed vertical swipe leaves the page scrollable', !blocked);
      check('[win] a slider swipe never starts a paused video', !env.plays, 'plays=' + env.plays);
      check('[win] nothing is drawn for a swipe we do not own', !meter(env, 'volume'));
    }

    // (d) "edge" policy: only the side lanes belong to us
    {
      const env = mk({ nonFullscreenVertical: 'edge' });
      const v = env.v;
      v.getBoundingClientRect = () => ({ left: 100, top: 180, right: 740, bottom: 540, width: 640, height: 360, x: 100, y: 180 });
      v.volume = 1;
      v.pause();
      env.window.eval(src);
      await sleep(50);
      // right zone (x > 34..66%) but 180px away from the edge: still the page's
      const midBlocked = await stroke(env, 560, 220, 440);
      check('[win] edge policy: the middle still scrolls the page',
        !midBlocked && v.volume === 1, 'blocked=' + midBlocked + ' volume=' + v.volume);
      const laneBlocked = await stroke(env, 728, 220, 440);
      check('[win] edge policy: the side lane adjusts the volume',
        laneBlocked && v.volume < 0.95, 'blocked=' + laneBlocked + ' volume=' + v.volume.toFixed(2));
    }

    // (f) native Android video fullscreen often exposes no fullscreenElement at
    //     all: a video that fills the viewport has to count as fullscreen, or
    //     "only in fullscreen" would disable volume swipes exactly where they
    //     are most useful.
    {
      const env = mk(); // default rect fills the jsdom viewport
      const v = env.v;
      v.volume = 1;
      env.window.eval(src);
      await sleep(50);
      const blocked = await stroke(env, 1000, 300, 520);
      check('[win] a viewport-filling video still owns vertical swipes',
        blocked && v.volume < 0.95, 'blocked=' + blocked + ' volume=' + v.volume.toFixed(2));
    }

    // (e) fullscreen still uses the whole viewport for both zones
    {
      const env = mk();
      const player = env.window.document.getElementById('player');
      Object.defineProperty(env.window.document, 'fullscreenElement', { configurable: true, get: () => player });
      env.v.volume = 1;
      env.window.eval(src);
      await sleep(50);
      const blocked = await stroke(env, 700, 300, 480);
      check('[win] fullscreen vertical swipe still changes the volume',
        blocked && env.v.volume < 0.95, 'blocked=' + blocked + ' volume=' + env.v.volume.toFixed(2));
    }
  }

  // -------------------------------------------------------------------------
  // A gesture on a PAUSED video must not start playback. Forcing it ("so the
  // speed change is visible") reads as a glitch on a paused element: the
  // picture starts moving under the finger and stops on release.
  // The value still changes, so it applies the moment the user resumes.
  {
    const env = makeEnv({ nonFullscreenVertical: 'always' });
    env.window.eval(src);
    await sleep(50);
    const v = env.v;
    v.pause();
    const plays0 = env.playCalls();
    check('[paused] the element starts paused', v.paused === true);

    env.rates.length = 0;
    fire(env,'pointerdown',640,360);
    await sleep(520);
    check('[paused] long press still changes the rate',
      env.rates.some(r => r > 1), 'rates=' + JSON.stringify(env.rates));
    check('[paused] long press does not start playback',
      env.playCalls() === plays0 && v.paused, 'plays=' + env.playCalls() + ' paused=' + v.paused);
    fire(env,'pointerup',640,360);
    await sleep(80);
    check('[paused] release leaves it paused', v.paused === true && env.playCalls() === plays0);

    v.currentTime = 100;
    env.seeks.length = 0;
    fire(env,'pointerdown',700,360);
    for (let x = 700; x >= 460; x -= 30) { fire(env,'pointermove',x,360); await sleep(5); }
    fire(env,'pointerup',460,360);
    await sleep(80);
    check('[paused] swipe-seek does not start playback',
      env.playCalls() === plays0 && v.paused, 'plays=' + env.playCalls());
    check('[paused] swipe-seek still moves the position',
      env.seeks.length > 0, 'seeks=' + JSON.stringify(env.seeks));
  }

  // ...and with the switch on it previews the stroke, then hands the pause back.
  {
    const env = makeEnv({ nonFullscreenVertical: 'always', gesturePlayWhenPaused: true });
    env.window.eval(src);
    await sleep(50);
    const v = env.v;
    v.pause();
    const plays0 = env.playCalls();
    fire(env,'pointerdown',640,360);
    await sleep(520);
    check('[paused+] the switch plays the video for the stroke',
      env.playCalls() > plays0 && v.paused === false, 'plays=' + env.playCalls() + ' paused=' + v.paused);
    fire(env,'pointerup',640,360);
    await sleep(140);
    check('[paused+] release hands the pause back', v.paused === true, 'paused=' + v.paused);
  }

  // 21. Windowed player + "vertical swipes: edges only". A speed hold must keep
  //     the page still even there: windowed players carry `touch-action: pan-y`
  //     (so a non-gesture swipe can still scroll), and preventDefault on
  //     `pointermove` does NOT stop a touch scroll — only `touchmove` does. It
  //     used to be left to the browser, which panicked the page, fired
  //     pointercancel and killed the stroke, so the up/down lock swipe never
  //     reached its distance threshold and lock/release did nothing.
  {
    const env = makeEnv({ nonFullscreenVertical: 'edge' }, { mobile: true });
    const v = env.v, doc = env.window.document;
    // Windowed player: 640x360 inside 1024x768, so it is not "looks fullscreen"
    // and the edge-lane policy is actually applied.
    v.getBoundingClientRect = () => ({ left:0, top:0, right:640, bottom:360, width:640, height:360, x:0, y:0 });
    env.window.eval(src);
    await sleep(60);
    const pin = () => doc.documentElement.dataset.gestioRate;
    const HOLD = SETTINGS.longPressSpeed || 2;

    // (a) a plain middle swipe is not ours: the page keeps its scroll.
    touch(env, 'touchstart', 320, 180);
    const plainMove = touch(env, 'touchmove', 320, 120);
    await sleep(10);
    check('[edge] a plain middle swipe is left to the page',
      plainMove.defaultPrevented === false, 'prevented=' + plainMove.defaultPrevented);
    touch(env, 'touchend', 320, 120);
    await sleep(80);

    // (b) hold, then swipe up: the hold owns the stroke and cancels the scroll
    //     from the FIRST move — waiting for the 40px lock distance is exactly
    //     what let the browser pan the page first on a real device.
    touch(env, 'touchstart', 320, 180);
    await sleep(SETTINGS.longPressDelayMobile + 140);
    check('[edge] holding raises the rate', Math.abs(v.playbackRate - HOLD) < 0.01,
      'rate=' + v.playbackRate);
    const firstMove = touch(env, 'touchmove', 320, 160); // 20px: below the lock distance
    await sleep(10);
    check('[edge] the hold cancels the touch default on the first move',
      firstMove.defaultPrevented === true, 'prevented=' + firstMove.defaultPrevented);
    touch(env, 'touchmove', 320, 120);
    await sleep(10);
    touch(env, 'touchend', 320, 120);
    await sleep(80);
    check('[edge] swiping up locks the speed', pin() === String(HOLD), 'pin=' + pin());

    // (c) same stroke, then swipe down: the release gesture still works.
    touch(env, 'touchstart', 320, 180);
    await sleep(SETTINGS.longPressDelayMobile + 140);
    touch(env, 'touchmove', 320, 250);
    await sleep(10);
    touch(env, 'touchend', 320, 250);
    await sleep(80);
    check('[edge] swiping down releases the locked speed',
      pin() == null && Math.abs(v.playbackRate - 1) < 0.01,
      'pin=' + pin() + ' rate=' + v.playbackRate);

    // (d) the device fires pointerdown first, so every touchmove is a duplicate
    //     stream. Those deltas are ignored, but the scroll must still be
    //     cancelled — this is the exact order that broke on the phone.
    const env2 = makeEnv({ nonFullscreenVertical: 'edge' }, { mobile: true });
    const v2 = env2.v, doc2 = env2.window.document;
    v2.getBoundingClientRect = () => ({ left:0, top:0, right:640, bottom:360, width:640, height:360, x:0, y:0 });
    env2.window.eval(src);
    await sleep(60);
    fire(env2, 'pointerdown', 320, 180);
    touch(env2, 'touchstart', 320, 180);
    await sleep(SETTINGS.longPressDelayMobile + 140);
    fire(env2, 'pointermove', 320, 160);
    const dupMove = touch(env2, 'touchmove', 320, 160);
    await sleep(10);
    check('[edge] a duplicate touchmove is cancelled while holding',
      dupMove.defaultPrevented === true, 'prevented=' + dupMove.defaultPrevented);
    fire(env2, 'pointermove', 320, 120);
    fire(env2, 'pointerup', 320, 120);
    await sleep(80);
    check('[edge] pointer-first stroke still locks',
      doc2.documentElement.dataset.gestioRate === String(HOLD),
      'pin=' + doc2.documentElement.dataset.gestioRate);
  }

  // --- always-on lock button + position resolution (1.0.28) -----------------
  // "gestureLockEnabled" used to build nothing until the popup locked the page,
  // and the position key was overwritten by the hand mode, so the two options
  // together produced a button that did not exist in a place you could not pick.
  {
    const mk = async (over) => {
      const env = makeEnv(over);
      env.window.eval(src);
      await sleep(80);
      return env.window.document.querySelector('[data-gestio="lockpin"]');
    };
    const left = await mk({ gestureLockEnabled: true, lockButtonPosition: 'auto', oneHandedMode: 'left' });
    check('[lockpin] a button exists once the feature is on', !!left);
    check('[lockpin] it is visible over the player', !!left && left.style.display === 'block',
      left && left.style.display);
    check('[lockpin] auto follows a left hand', !!left && left.style.left !== 'auto' && left.style.right === 'auto',
      left && ('left=' + left.style.left + ' right=' + left.style.right));

    const right = await mk({ gestureLockEnabled: true, lockButtonPosition: 'right', oneHandedMode: 'left' });
    check('[lockpin] an explicit right wins over the hand',
      !!right && right.style.right !== 'auto' && right.style.left === 'auto',
      right && ('left=' + right.style.left + ' right=' + right.style.right));

    const custom = await mk({ gestureLockEnabled: true, lockButtonPosition: 'auto', oneHandedMode: 'custom' });
    check('[lockpin] auto + custom falls back to the left',
      !!custom && custom.style.left !== 'auto' && custom.style.right === 'auto');

    const off = await mk({ gestureLockEnabled: false });
    check('[lockpin] no button when the feature is off', !off);
  }

  // --- A-B bar placement + drag (1.0.28, reworked in 1.0.29) -----------------
  // The bar used to be positioned from a hard-coded 292px width (its real width
  // was nearer 380px), never scaled, and its position was stored as a centre
  // fraction of the player — which a narrow windowed player clamped and a
  // fullscreen one did not, so every fullscreen toggle slid it sideways. It now
  // measures itself, scales with the player down to 80%, and stores an inset
  // from the nearest edges.
  {
    const env = makeEnv({ abLoopEnabled: true });
    env.window.eval(src);
    await sleep(120);
    const panel = env.window.document.querySelector('[data-gestio="abpanel"]');
    check('[ab] the bar is placed by the layout pass', !!panel && panel.style.left !== '' && panel.style.top !== '',
      panel && (panel.style.left + ' / ' + panel.style.top));
    check('[ab] the bar scales with the player', !!panel && /scale\(/.test(panel.style.transform || ''),
      panel && panel.style.transform);
    const boxRoot = panel && (panel.shadowRoot || panel.__shadow);
    const box = boxRoot && boxRoot.querySelector('.box');
    check('[ab] the bar can be grabbed', !!box);
    if (box) {
      const P = env.window.PointerEvent || env.window.MouseEvent;
      const mk = (t, x, y, id) => new P(t, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id || 1, button: 0
      });
      // The press lands on the card, the moves/up land on the document: that is
      // what a real finger produces one frame after it starts moving, because
      // the card is smaller than the finger's travel. A handler bound to the
      // card itself therefore never sees the stroke — the regression that made
      // the bar undraggable.
      const dragTo = (fx, fy, tx, ty) => {
        box.dispatchEvent(mk('pointerdown', fx, fy));
        env.window.document.dispatchEvent(mk('pointermove', tx, ty));
        env.window.document.dispatchEvent(mk('pointerup', tx, ty));
      };
      const before = panel.style.left;
      dragTo(900, 100, 300, 400);
      const saved = env.window.localStorage.getItem('gestio_ab_pos');
      let parsed = null;
      try { parsed = JSON.parse(saved); } catch (_) {}
      check('[ab] a drag is stored as an edge inset', !!parsed && parsed.ax === 'l' && parsed.dx > 0, saved);
      check('[ab] the bar follows the finger before release', panel.style.left !== before,
        before + ' -> ' + panel.style.left);

      // The regression this guards: a fullscreen-sized player must not move the
      // bar. The gap to the anchored edge has to be identical at both sizes.
      dragTo(400, 300, 1200, 300); // park it against the right edge
      const gap1 = 1024 - parseFloat(panel.style.left);
      Object.defineProperty(env.window, 'innerWidth', { value: 1280, configurable: true });
      Object.defineProperty(env.window, 'innerHeight', { value: 720, configurable: true });
      env.window.dispatchEvent(new env.window.Event('resize'));
      await sleep(180);
      const gap2 = 1280 - parseFloat(panel.style.left);
      check('[ab] a wider (fullscreen) player does not shift the bar',
        Number.isFinite(gap2) && Math.abs(gap1 - gap2) < 2, gap1 + ' vs ' + gap2 + ' (' + panel.style.left + ')');
    }
  }

  // --- A-B bar presence + look (1.0.30) ------------------------------------
  // The bar used to be built from the setting alone, so every page with A-B
  // enabled got one — including pages with no player at all.
  {
    const env = makeEnv({ abLoopEnabled: true });
    env.v.remove();
    env.window.eval(src);
    await sleep(200);
    check('[ab] no player means no bar',
      !env.window.document.querySelector('[data-gestio="abpanel"]'));
    // A player swapped in later (SPA route change) has to bring it back.
    env.window.document.getElementById('player').appendChild(env.v);
    await sleep(1100);
    check('[ab] the bar comes back when a player does',
      !!env.window.document.querySelector('[data-gestio="abpanel"]'));
  }

  // Opacity follows the two settings: faded while looping, clear when idle.
  {
    const env = makeEnv({ abLoopEnabled: true, abPanelOpacityOn: 0.4, abPanelOpacityOff: 0.9 });
    env.window.eval(src);
    await sleep(150);
    const panel = env.window.document.querySelector('[data-gestio="abpanel"]');
    const root = panel && (panel.shadowRoot || panel.__shadow);
    const box = root && root.querySelector('.box');
    check('[ab] the idle bar uses the idle opacity',
      !!box && Math.abs(parseFloat(box.style.opacity) - 0.9) < 0.02, box && box.style.opacity);
    const kd = (key) => env.window.document.dispatchEvent(new env.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key }));
    env.v.currentTime = 100; kd('['); await sleep(10);
    env.v.currentTime = 140; kd(']'); await sleep(30);
    check('[ab] a running loop uses the looping opacity',
      Math.abs(parseFloat(box.style.opacity) - 0.4) < 0.02, box.style.opacity);

    // One control, not two, and exactly two states: looping or not. There used
    // to be a third (paused, an amber play-in-circle) that read as a
    // half-selected button.
    const loop = root.getElementById('loop');
    check('[ab] the start and pause buttons are one control',
      !!loop && !root.getElementById('pause') && !root.getElementById('toggle'));
    check('[ab] a running loop is the "on" state',
      loop.getAttribute('data-state') === 'on' && loop.className.indexOf('on') >= 0,
      loop.getAttribute('data-state') + ' / ' + loop.className);
    loop.click(); await sleep(10);
    check('[ab] pressing it stops the loop outright',
      loop.getAttribute('data-state') === 'off' && loop.className.indexOf('on') < 0 &&
      Math.abs(parseFloat(box.style.opacity) - 0.9) < 0.02,
      loop.getAttribute('data-state') + ' / ' + box.style.opacity);
    const ringOff = loop.innerHTML;
    check('[ab] no other loop state exists',
      !loop.classList.contains('paused') && loop.getAttribute('data-state') === 'off' &&
      !/loopPlay|paused/.test(loop.className), loop.className + ' / ' + loop.getAttribute('data-state'));
    loop.click(); await sleep(10);
    check('[ab] pressing it again resumes the same segment',
      loop.getAttribute('data-state') === 'on' && Math.abs(parseFloat(box.style.opacity) - 0.4) < 0.02,
      loop.getAttribute('data-state') + ' / ' + box.style.opacity);
    // Same glyph in both states: only the chip changes (filled vs outlined), so
    // the button never looks like a different control or a third half-state.
    check('[ab] the button keeps one glyph across both states',
      loop.innerHTML === ringOff && ringOff.length > 0,
      loop.innerHTML === ringOff ? 'same' : 'changed');
  }

  // --- A-B lap seek: exact, single-shot, no fastSeek (1.0.29) ---------------
  // The lap used to go through doSeek() -> fastSeek(), which snaps to the
  // nearest keyframe (often BEFORE A). The watch loop then saw a time behind A
  // and sought again, lap after lap; on Android that burst of `seeking` events
  // is what pops the browser's own control bar on every restart.
  {
    const env = makeEnv({ abLoopEnabled: true });
    let fastSeeks = 0;
    env.v.fastSeek = () => { fastSeeks++; };
    env.window.eval(src);
    await sleep(120);
    const kd = (key) => env.window.document.dispatchEvent(new env.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key }));
    env.v.currentTime = 100; kd('['); await sleep(10);
    env.v.currentTime = 120; kd(']'); await sleep(30);
    const sr = env.window.document.querySelector('[data-gestio="abpanel"]').shadowRoot;
    check('[ab] the bar reads out both points',
      /A 0:01:40/.test(sr.getElementById('ta').textContent) && /B 0:02:00/.test(sr.getElementById('tb').textContent),
      sr.getElementById('ta').textContent + ' / ' + sr.getElementById('tb').textContent);
    const spanEl = sr.getElementById('span');
    check('[ab] the bar draws the loop window between the pins',
      !!spanEl && parseFloat(spanEl.style.width) > 1 && parseFloat(spanEl.style.width) <= 100,
      spanEl && spanEl.style.width);
    check('[ab] both pins are placed',
      sr.getElementById('pina').style.display === 'block' && sr.getElementById('pinb').style.display === 'block');

    env.v.currentTime = 120; // reached B
    env.seeks.length = 0;    // ignore the assignment above; only the lap counts
    await sleep(420);       // many animation frames
    check('[ab] the lap jumps to exactly A', env.seeks.length >= 1 && env.seeks[0] === 100, JSON.stringify(env.seeks));
    check('[ab] the lap never uses fastSeek', fastSeeks === 0, 'fastSeeks=' + fastSeeks);
    check('[ab] the lap seek fires once, not once per frame', env.seeks.length === 1, JSON.stringify(env.seeks));

    // A press on a control must stay a tap; holding it turns into a drag.
    const btn = sr.getElementById('am');
    const panel = env.window.document.querySelector('[data-gestio="abpanel"]');
    const P = env.window.PointerEvent || env.window.MouseEvent;
    const pev = (el, t, x, y) => el.dispatchEvent(new P(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, button: 0 }));
    const doc = env.window.document;
    const dmove = (x, y) => doc.dispatchEvent(new P('pointermove', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, button: 0 }));
    const left0 = panel.style.left;
    pev(btn, 'pointerdown', 600, 200);
    dmove(560, 200);                     // drift off the button, still a tap
    const movedEarly = panel.style.left !== left0;
    await sleep(320);                    // the hold arms the drag
    dmove(520, 200);
    const movedAfterHold = panel.style.left !== left0;
    doc.dispatchEvent(new P('pointerup', { bubbles: true, clientX: 520, clientY: 200, pointerId: 9, button: 0 }));
    check('[ab] a swipe on a control stays a tap, a hold drags the bar',
      !movedEarly && movedAfterHold, `early=${movedEarly} held=${movedAfterHold}`);
    check('[ab] the hold-drag updates the stored inset',
      !!JSON.parse(env.window.localStorage.getItem('gestio_ab_pos') || '{}').ax,
      env.window.localStorage.getItem('gestio_ab_pos'));
  }

  // --- broom / hide controls + the fullscreen input fallback (1.0.31) ------
  {
    const env = makeEnv({ abLoopEnabled: true });
    env.window.eval(src);
    await sleep(150);
    const panel = env.window.document.querySelector('[data-gestio="abpanel"]');
    const sr = panel.shadowRoot;
    const clear = sr.getElementById("clear");
    const hide = sr.getElementById("hide");
    check("[ab] Clear is drawn as a broom", !!clear && /<rect/.test(clear.innerHTML) &&
      clear.innerHTML.indexOf("M4.9 7.3h14.2") < 0, clear && clear.innerHTML.slice(0, 40));
    check("[ab] a Hide control sits right after Clear", !!hide && hide.previousElementSibling === clear);
    check("[ab] Hide is the broken ring", !!hide && hide.innerHTML.indexOf("A8.2 8.2") > 0);

    // Fullscreen failure mode: the card is painted, but the press is delivered
    // to whatever sits above it (the player's own promoted overlay). The stroke
    // has to be taken over and resolved by geometry instead of being dropped.
    panel.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 160, width: 300, height: 60, x: 100, y: 100 });
    hide.getBoundingClientRect = () => ({ left: 362, top: 128, right: 388, bottom: 154, width: 26, height: 26, x: 362, y: 128 });
    const P = env.window.PointerEvent || env.window.MouseEvent;
    const mk = (t, x, y) => new P(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0 });
    env.sent.length = 0;
    env.v.dispatchEvent(mk("pointerdown", 375, 141));
    env.v.dispatchEvent(mk("pointerup", 375, 141));
    await sleep(60);
    check("[ab] a press the player swallowed still drives the card",
      !env.window.document.querySelector('[data-gestio="abpanel"]') &&
      abHiddenMap(env.window)["test.local/"] === 1,
      JSON.stringify(abHiddenMap(env.window)));

    // Hiding the card must not stop the loop: the lap watcher seeks back to A.
    const env3 = makeEnv({ abLoopEnabled: true });
    env3.window.eval(src);
    await sleep(160);
    const p3 = env3.window.document.querySelector('[data-gestio="abpanel"]');
    const kd3 = (key) => env3.window.document.dispatchEvent(new env3.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    env3.v.currentTime = 100; kd3("["); await sleep(20);
    env3.v.currentTime = 130; kd3("]"); await sleep(60);
    tap(env3, p3.shadowRoot.getElementById("hide"));
    await sleep(80);
    env3.seeks.length = 0;
    env3.v.currentTime = 130.4;
    await sleep(400);
    check("[ab] hiding the card leaves the loop running",
      env3.seeks.some((x) => Math.abs(x - 100) < 0.3), JSON.stringify(env3.seeks.slice(-2)));

    // Hide writes the preference the popup switch reads, and the broadcast the
    // popup sends brings the card back where it was.
    const env4 = makeEnv({ abLoopEnabled: true, abPanelVisible: true });
    env4.window.eval(src);
    await sleep(160);
    const p4 = env4.window.document.querySelector('[data-gestio="abpanel"]');
    check("[ab] a visible setting builds the card", !!p4);
    await sleep(300);
    const live4 = env4.window.document.querySelector('[data-gestio="abpanel"]');
    env4.sent.length = 0;
    tap(env4, live4.shadowRoot.getElementById("hide"));
    await sleep(80);
    check("[ab] Hide takes the card off the page",
      !env4.window.document.querySelector('[data-gestio="abpanel"]'));
    // ...and it is remembered for THIS tab, on THIS page. It is no longer a
    // browser-wide setting: that is what made one page's Hide silence every
    // other site.
    check("[ab] Hide remembers the page it was used on",
      abHiddenMap(env4.window)["test.local/"] === 1,
      JSON.stringify(abHiddenMap(env4.window)));
    // The flag is transient view state, so it must not be left on disk: that
    // is exactly the per-page key growth this storage moved away from.
    check("[ab] ...without leaving anything in localStorage",
      env4.window.localStorage.length === 0, JSON.stringify(
        Object.keys(env4.window.localStorage)));
    check("[ab] Hide sends no global preference",
      !env4.sent.some((m) => m.action === "set_settings" && m.settings && "abPanelVisible" in m.settings),
      JSON.stringify(env4.sent));
    env4.contentMsg({ action: "ab_panel_set", visible: true }, {}, () => {});
    await sleep(200);
    check("[ab] the popup switch brings it back",
      !!env4.window.document.querySelector('[data-gestio="abpanel"]'));
    check("[ab] and forgets that it was hidden",
      abHiddenMap(env4.window)["test.local/"] === undefined &&
      env4.window.sessionStorage.getItem("gestio:abpanel") === null,
      JSON.stringify(abHiddenMap(env4.window)));

    // The choice is stored per page: it survives a reload of the same page...
    const env5 = makeEnv({ abLoopEnabled: true });
    env5.window.sessionStorage.setItem("gestio:abpanel", JSON.stringify({ "test.local/": 1 }));
    env5.window.eval(src);
    await sleep(220);
    check("[ab] a hidden panel stays hidden after a reload",
      !env5.window.document.querySelector('[data-gestio="abpanel"]'));
    // ...and a Hide on some OTHER page leaves this one alone.
    const env6 = makeEnv({ abLoopEnabled: true });
    env6.window.sessionStorage.setItem("gestio:abpanel", JSON.stringify({ "other.test/": 1 }));
    env6.window.eval(src);
    await sleep(220);
    check("[ab] another page's Hide does not silence this one",
      !!env6.window.document.querySelector('[data-gestio="abpanel"]'));

    // No cap: every page the user tucked the card away on is kept. The store
    // belongs to this tab, so it cannot outlive the browsing it describes.
    const env7 = makeEnv({ abLoopEnabled: true });
    const seed = {};
    for (let i = 0; i < 40; i++) seed["old.test/v" + i] = 1;
    env7.window.sessionStorage.setItem("gestio:abpanel", JSON.stringify(seed));
    env7.window.eval(src);
    await sleep(170);
    const p7 = env7.window.document.querySelector('[data-gestio="abpanel"]');
    tap(env7, p7.shadowRoot.getElementById("hide"));
    await sleep(100);
    const map7 = abHiddenMap(env7.window);
    const ids7 = Object.keys(map7);
    check("[ab] every hidden page is remembered", ids7.length === 41 && map7["test.local/"] === 1,
      ids7.length + " keys");
    check("[ab] ...including the ones tucked away before",
      map7["old.test/v0"] === 1 && map7["old.test/v39"] === 1, ids7.slice(0, 3).join(","));
  }

  // --- a page always opens NOT looping (1.0.33) ---------------------------
  // The segment is remembered; the running state is not. Restoring it "on" made
  // a reload (or a new tab on the same video) start repeating a stretch of the
  // file while the user was watching normally.
  {
    const env = makeEnv({ abLoopEnabled: true }, { config: { a: 100, b: 130 } });
    env.window.eval(src);
    await sleep(260);
    const p = env.window.document.querySelector('[data-gestio="abpanel"]');
    const sr = p && p.shadowRoot;
    check("[ab] a reload brings the marks back",
      !!sr && /A 0:01:40/.test(sr.getElementById("ta").textContent) &&
      /B 0:02:10/.test(sr.getElementById("tb").textContent),
      sr && (sr.getElementById("ta").textContent + " / " + sr.getElementById("tb").textContent));
    check("[ab] ...but the loop comes back off",
      !!sr && sr.getElementById("loop").getAttribute("data-state") === "off",
      sr && sr.getElementById("loop").getAttribute("data-state"));

    env.v.currentTime = 130.4;
    env.seeks.length = 0; // ignore the assignment above; only a lap counts
    await sleep(340);
    check("[ab] ...and nothing repeats until the button is pressed",
      env.seeks.length === 0, JSON.stringify(env.seeks));

    // The button starts the remembered segment straight away: the playhead is
    // parked past B, so the very first frame after the press has to lap. Only
    // the count from here on matters — the lap can land before or after the
    // sleeps above depending on how busy the machine is.
    const live = env.window.document.querySelector('[data-gestio="abpanel"]');
    env.seeks.length = 0;
    tap(env, live.shadowRoot.getElementById("loop"));
    await sleep(60);
    const sr2 = env.window.document.querySelector('[data-gestio="abpanel"]').shadowRoot;
    check("[ab] pressing the button starts that segment",
      sr2.getElementById("loop").getAttribute("data-state") === "on",
      sr2.getElementById("loop").getAttribute("data-state"));
    // Poll instead of a single sleep: the frame that laps is a rAF callback,
    // and a loaded machine can take a while to deliver it.
    const lapped = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        if (env.seeks.some((x) => Math.abs(x - 100) < 0.3)) return true;
        await sleep(40);
      }
      return false;
    })();
    check("[ab] ...and it returns to A", lapped, JSON.stringify(env.seeks.slice(0, 4)));
  }
  {
    // A page with no stored segment at all: the button is off, so there is no
    // green ring that loops nothing.
    const env = makeEnv({ abLoopEnabled: true });
    env.window.eval(src);
    await sleep(200);
    const sr = env.window.document.querySelector('[data-gestio="abpanel"]').shadowRoot;
    check("[ab] a fresh page opens with the loop off",
      sr.getElementById("loop").getAttribute("data-state") === "off",
      sr.getElementById("loop").getAttribute("data-state"));
    check("[ab] ...and with empty marks", /A --:--:--/.test(sr.getElementById("ta").textContent),
      sr.getElementById("ta").textContent);
  }

  // --- "stop after N loops" (1.0.34) --------------------------------------
  // Off by default. An A-B loop is a repeat, so one that gave up after a few
  // passes without being asked for a limit would be a bug, not a feature.
  {
    const env = makeEnv({ abLoopEnabled: true, abMaxLoopsOn: true, abMaxLoopsCount: 2 },
      { config: { a: 100, b: 130 } });
    env.window.eval(src);
    await sleep(240);
    const panel = () => env.window.document.querySelector('[data-gestio="abpanel"]');
    tap(env, panel().shadowRoot.getElementById("loop"));
    await sleep(80);
    // A lap is the playhead being parked past B — jsdom never advances time, so
    // the test plays the video itself. Counting seeks to A is the honest check:
    // the seek is what "it repeated" means.
    const laps = () => env.seeks.filter((x) => Math.abs(x - 100) < 0.3).length;
    const lap = async () => {
      const before = laps();
      env.v.currentTime = 130.4;
      const t0 = Date.now();
      while (Date.now() - t0 < 1200) {
        if (laps() > before) return true;
        await sleep(40);
      }
      return false;
    };
    check("[ab] pass 1 repeats the segment", await lap(), JSON.stringify(env.seeks.slice(-2)));
    // Pass 2 is the limit, so it must stop instead of seeking back to A.
    env.v.currentTime = 130.4;
    await sleep(420);
    const sr = panel().shadowRoot;
    check("[ab] the last allowed pass stops the loop",
      sr.getElementById("loop").getAttribute("data-state") === "off",
      sr.getElementById("loop").getAttribute("data-state"));
    check("[ab] ...pauses the video", env.v.paused === true, String(env.v.paused));
    check("[ab] ...and does not seek again", laps() === 1, JSON.stringify(env.seeks));
    check("[ab] the marks survive the stop", /A 0:01:40/.test(sr.getElementById("ta").textContent),
      sr.getElementById("ta").textContent);
  }
  {
    // The switch is what turns the limit on: with it off the same count means
    // nothing and the segment keeps repeating, which is the 1.0.33 behaviour.
    const env = makeEnv({ abLoopEnabled: true, abMaxLoopsCount: 1 },
      { config: { a: 100, b: 130 } });
    env.window.eval(src);
    await sleep(240);
    tap(env, env.window.document.querySelector('[data-gestio="abpanel"]').shadowRoot.getElementById("loop"));
    await sleep(80);
    const laps = () => env.seeks.filter((x) => Math.abs(x - 100) < 0.3).length;
    const lap = async () => {
      const before = laps();
      env.v.currentTime = 130.4;
      const t0 = Date.now();
      while (Date.now() - t0 < 1200) {
        if (laps() > before) return true;
        await sleep(40);
      }
      return false;
    };
    check("[ab] limit off: pass 1 repeats", await lap(), JSON.stringify(env.seeks.slice(-2)));
    check("[ab] limit off: pass 2 repeats too", await lap(), JSON.stringify(env.seeks.slice(-2)));
    const sr = env.window.document.querySelector('[data-gestio="abpanel"]').shadowRoot;
    check("[ab] limit off: the loop is still running",
      sr.getElementById("loop").getAttribute("data-state") === "on",
      sr.getElementById("loop").getAttribute("data-state"));
  }

  // --- a card drag must not drive the player behind it (1.0.32) -----------
  // On Android/Edge in fullscreen a drag on the card also ran the player's own
  // gesture: the picture jumped to the finger (seek), the volume/brightness
  // meters appeared and the native control bar popped up. The stroke now stops
  // at the window, in the capture phase, before anything below sees it.
  {
    const env = makeEnv({ abLoopEnabled: true });
    env.window.eval(src);
    await sleep(160);
    const panel = env.window.document.querySelector('[data-gestio="abpanel"]');
    const box = panel && panel.shadowRoot && panel.shadowRoot.querySelector(".box");
    // Stand-ins for the player: a <video> handler and the page's own gesture
    // layer both live below the window on document / the element.
    const doc = env.window.document;
    const seen = { down: 0, move: 0, up: 0, touch: 0 };
    doc.addEventListener("pointerdown", () => seen.down++, true);
    doc.addEventListener("pointermove", () => seen.move++, true);
    doc.addEventListener("pointerup", () => seen.up++, true);
    doc.addEventListener("touchstart", () => seen.touch++, true);
    doc.addEventListener("touchmove", () => seen.touch++, true);
    env.v.addEventListener("pointermove", () => seen.move++, true);
    const P = env.window.PointerEvent || env.window.MouseEvent;
    const mk = (t, x, y) => new P(t, {
      bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0 });
    box.dispatchEvent(mk("pointerdown", 900, 100));
    doc.dispatchEvent(mk("pointermove", 700, 200));
    // The touch stream of the very same finger: page players commonly listen
    // to touch only, so it has to be swallowed as well.
    const tm = new env.window.Event("touchmove", { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(tm, "touches", { value: [{ clientX: 700, clientY: 200, target: env.v }] });
    doc.dispatchEvent(tm);
    doc.dispatchEvent(mk("pointerup", 700, 200));
    await sleep(40);
    check("[ab] a card drag is invisible to the page",
      seen.down === 0 && seen.move === 0 && seen.up === 0 && seen.touch === 0, JSON.stringify(seen));
    check("[ab] the drag really happened", panel.style.left !== "" && panel.style.left !== "0px", panel.style.left);

    // With no stroke open the page keeps its own gestures untouched.
    const tm2 = new env.window.Event("touchmove", { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(tm2, "touches", { value: [{ clientX: 640, clientY: 300, target: env.v }] });
    const ev2 = doc.dispatchEvent(tm2);
    check("[ab] touches outside a stroke still reach the page",
      seen.touch === 1 && ev2 === true, JSON.stringify(seen));
  }

  // --- the tucked-away flag follows the page, not the tab (1.0.32) --------
  // An SPA swaps the video without a reload. The card was hidden on the first
  // video and stayed hidden on the next one, which is the cross-page leak this
  // whole change is about, just inside one tab.
  {
    const env = makeEnv({ abLoopEnabled: true });
    env.window.eval(src);
    await sleep(160);
    const first = env.window.document.querySelector('[data-gestio="abpanel"]');
    tap(env, first.shadowRoot.getElementById("hide"));
    await sleep(90);
    check("[ab] the card is hidden on this page",
      !env.window.document.querySelector('[data-gestio="abpanel"]'));

    env.window.history.pushState({}, "", "/another-video");
    await sleep(420);
    check("[ab] a card hidden on one page comes back on the next",
      !!env.window.document.querySelector('[data-gestio="abpanel"]'));

    // ...and the reverse: a page that had hidden it keeps it away.
    env.window.sessionStorage.setItem("gestio:abpanel", JSON.stringify({ "test.local/quiet-video": 1 }));
    env.window.history.pushState({}, "", "/quiet-video");
    await sleep(420);
    check("[ab] a page that hid the card keeps it hidden",
      !env.window.document.querySelector('[data-gestio="abpanel"]'));
  }

  // --- turning the feature off stops the loop but keeps A/B (1.0.32) ------
  {
    const ov = { abLoopEnabled: true };
    const env = makeEnv(ov);
    env.window.eval(src);
    await sleep(170);
    const p = env.window.document.querySelector('[data-gestio="abpanel"]');
    const kd = (key) => env.window.document.dispatchEvent(new env.window.KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, key }));
    env.v.currentTime = 100; kd("["); await sleep(20);
    env.v.currentTime = 130; kd("]"); await sleep(80);
    check("[ab] the loop is running before the switch is turned off",
      p.shadowRoot.getElementById("loop").getAttribute("data-state") === "on",
      p.shadowRoot.getElementById("loop").getAttribute("data-state"));

    // The popup turns "A-B loop" off and broadcasts the change.
    ov.abLoopEnabled = false;
    env.contentMsg({ action: "settings_changed" }, {}, () => {});
    await sleep(140);
    env.v.currentTime = 130.4;
    env.seeks.length = 0;   // ignore the assignment above; only a lap counts
    await sleep(320);
    check("[ab] turning the feature off stops the loop at once",
      env.seeks.length === 0, JSON.stringify(env.seeks));

    // Turning it back on must not resurrect a running loop: the marks survive,
    // the button comes back as "not playing".
    ov.abLoopEnabled = true;
    env.contentMsg({ action: "settings_changed" }, {}, () => {});
    await sleep(260);
    const p2 = env.window.document.querySelector('[data-gestio="abpanel"]');
    const sr2 = p2 && p2.shadowRoot;
    check("[ab] the marks survive the switch",
      !!sr2 && /A 0:01:40/.test(sr2.getElementById("ta").textContent) &&
      /B 0:02:10/.test(sr2.getElementById("tb").textContent),
      sr2 && (sr2.getElementById("ta").textContent + " / " + sr2.getElementById("tb").textContent));
    check("[ab] the button comes back as not playing",
      !!sr2 && sr2.getElementById("loop").getAttribute("data-state") === "off",
      sr2 && sr2.getElementById("loop").getAttribute("data-state"));
    env.v.currentTime = 130.4;
    env.seeks.length = 0;   // ignore the assignment above; only a lap counts
    await sleep(320);
    check("[ab] and nothing loops until it is asked to",
      env.seeks.length === 0, JSON.stringify(env.seeks));
  }

  const passed = results.filter(r=>r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed===results.length?0:1);
}
main().catch(e=>{ console.error('FATAL', e); process.exit(3); });
