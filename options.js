"use strict";
/*
 * Gestio options page.
 * Every control saves instantly: a click always takes effect.
 * Switches are real <label>-wrapped checkboxes so the whole track is clickable.
 *
 * All visible strings are translated at render time through VW_I18N.T(text,
 * LANG). Changing the language re-applies translations in place (no rebuild).
 *
 * Field spec: [key, label, type, group, desc, extra]
 *   type: bool | num | range | select | seg | json
 *   extra for num/range: [min, max, step]; for select/seg: [value,label][]
 */
const SCHEMA = [
  // ---- basics ----
  ["enabled", "Gesture control", "bool", "g-basic", "Master switch — enable gesture control on videos."],
  ["language", "Interface language", "seg", "g-basic", "Language for this page and the on-video messages.", [["auto", "Auto"], ["zh_CN", "中文"], ["en", "English"]]],

  // ---- brightness / volume lock ----
  // The lock is per slider and the gesture decides it: two fingers on the left
  // half toggle brightness, on the right half volume. So the UI is two
  // independent switches instead of a "which one" picker.
  ["twoFingerLockEnabled", "Two-finger lock", "bool", "g-lock", "Two fingers tapped on the video turn the lock for that half on and off."],
  // These two are a STARTING state, not the live state: each page snapshots
  // them when it loads and then keeps its own copy, so a two-finger tap in one
  // tab never shows up in another (and never rewrites what the next page gets).
  ["lockBrightness", "Brightness locked by default", "lockpart", "g-lock", "A newly opened page starts with brightness swipes locked. After that each page keeps its own state — the two-finger tap changes only the page you are on.", "brightness"],
  ["lockVolume", "Volume locked by default", "lockpart", "g-lock", "A newly opened page starts with volume swipes locked. After that each page keeps its own state — the two-finger tap changes only the page you are on.", "volume"],

  // ---- feedback & compatibility ----
  ["hapticFeedbackEnabled", "Haptic feedback", "bool", "g-compat", "Subtle vibration when a gesture triggers (mobile)."],
  ["hintOpacity", "Hint toast opacity", "range", "g-compat", "How solid the small message pills are — speed changes, lock states, A-B marks. Lower it so they stand out less.", [0.3, 1, 0.05]],
  ["gestureShield", "Gesture shield", "bool", "g-compat", "Block the page's own touch events on the player to avoid conflicts."],
  ["nativeEventBlocking", "Native event blocking", "bool", "g-compat", "Stronger blocking for stubborn players (global; per-site in Advanced)."],

  // ---- long press & speed ----
  ["longPressEnabled", "Long press for speed", "bool", "g-speed", "Hold on the video to temporarily raise the playback speed (it does not start a paused video)."],
  // Lives here because a long press is where the difference is felt most:
  // off, holding a paused video shows the meter but the picture stays frozen.
  ["gesturePlayWhenPaused", "Play while paused (gesture preview)", "bool", "g-speed", "Off (default): a gesture on a paused video only changes the value — nothing starts playing. On: the video runs during the stroke so a speed / seek change is visible, then pauses again on release."],
  ["longPressSpeed", "Long-press speed", "range", "g-speed", "Playback speed while holding.", [1.25, 16, 0.25], true],
  ["longPressDelay", "Long-press delay (ms)", "num", "g-speed", "Hold time before speed kicks in (desktop).", [100, 800, 25]],
  ["longPressDelayMobile", "Long-press delay on mobile (ms)", "num", "g-speed", "Hold time on touch devices.", [150, 1000, 25]],
  ["longPressLockEnabled", "Swipe up to lock speed", "bool", "g-speed", "After a long press, swipe up to pin the current speed.", true],
  ["longPressLockSwipeDistance", "Lock swipe distance (px)", "num", "g-speed", "Vertical travel needed for the lock gesture.", [20, 120, 5], true],
  ["longPressDragEnabled", "Drag to adjust speed", "bool", "g-speed", "Long-press then drag left/right to fine-tune speed.", true],
  ["longPressDragWhileLocked", "Keep tuning a locked speed", "bool", "g-speed", "Long-press again while the speed is locked to re-tune it; the new value stays locked.", true],
  ["longPressDragSensitivity", "Drag sensitivity (px per tier)", "num", "g-speed", "Higher = finer control: how far the finger travels to move one speed tier.", [30, 400, 10], true],
  ["longPressMoveDeadzone", "Drag deadzone (px)", "num", "g-speed", "Ignore small movements while dragging speed.", [5, 60, 1], true],

  // ---- swipe seek ----
  ["swipeSeekEnabled", "Swipe to seek", "bool", "g-seek", "Swipe horizontally to seek backward / forward."],
  ["swipeSeekSensitivity", "Swipe sensitivity (px)", "num", "g-seek", "Lower = seeks faster for the same travel.", [10, 100, 5]],
  ["maxSeekRatio", "Max seek per swipe", "range", "g-seek", "Maximum fraction of the video one swipe can jump.", [0.05, 1, 0.05], true],
  ["swipeSeekFreeAllowed", "Unlimited swipe range", "bool", "g-seek", "One swipe can span the whole video. Turn off to cap each swipe at ±10s.", true],
  ["seekCancelSwipeDistance", "Cancel swipe distance (px)", "num", "g-seek", "Swipe down this far to cancel a seek.", [20, 100, 5]],
  ["thumbnailPreviewEnabled", "Time preview", "bool", "g-seek", "Show the target time and position while seeking.", true],

  // ---- double tap & wheel ----
  ["doubleTapEnabled", "Double tap", "bool", "g-tap", "Enable zone-based double-tap actions."],
  ["blockNativeDoubleClick", "Block native double-click seek", "bool", "g-tap", "Most players jump ±10s on a double-click of their own. Block that so only Gestio's double tap seeks — Gestio's tap logic does not use the browser's dblclick event."],
  ["doubleTapInterval", "Double-tap interval (ms)", "num", "g-tap", "Max gap between the two taps.", [150, 600, 25]],
  ["doubleTapSeekDuration", "Seek duration", "num", "g-tap", "Seconds jumped per double tap.", [2, 60, 1], true],
  ["doubleTapAccumulateEnabled", "Accumulate taps", "bool", "g-tap", "Repeated taps in the same zone add up, and the jump is applied once the burst ends (3rd tap = 20s, 4th = 30s…).", true],
  ["doubleTapFullscreenEnabled", "Double tap to fullscreen", "bool", "g-tap", "Double-tapping the center toggles fullscreen."],
  ["wheelSeekEnabled", "Alt + scroll to seek", "bool", "g-tap", "Hold Alt and scroll to seek."],
  ["wheelSeekDuration", "Seconds per wheel step", "num", "g-tap", "Seek amount per wheel notch.", [1, 30, 1]],
  ["wheelDebounce", "Wheel debounce (ms)", "num", "g-tap", "Delay before applying accumulated wheel seek.", [50, 800, 25]],

  // ---- one-handed ----
  ["oneHandedMode", "Preferred hand", "seg", "g-hand", "Right: the default mapping. Left: the same thumb motion, mirrored. Custom: you decide what each zone does.", [["right", "Right"], ["left", "Left"], ["custom", "Custom"]]],
  ["gridLayout", "Grid layout", "seg", "g-hand", "3×1: three columns — left / center / right. 3×2: the side columns split top and bottom, so one thumb reaches six actions.", [["3x1", "3×1"], ["3x2", "3×2"]]],
  ["gestureAreaRatio", "Gesture area height", "range", "g-hand", "How much of the video height responds to gestures. 100% = the whole player; higher means less accidental swiping near the controls.", [0.5, 1, 0.05]],

  // ---- zone actions (custom mode) ----
  ["leftDoubleTap", "Left · double tap", "select", "g-zones", "", "doubleTap"],
  ["centerDoubleTap", "Center · double tap", "select", "g-zones", "", "doubleTap"],
  ["rightDoubleTap", "Right · double tap", "select", "g-zones", "", "doubleTap"],
  ["leftVerticalSwipe", "Left · vertical swipe", "select", "g-zones", "", "vSwipe"],
  ["centerVerticalSwipe", "Center · vertical swipe", "select", "g-zones", "", "vSwipe"],
  ["rightVerticalSwipe", "Right · vertical swipe", "select", "g-zones", "", "vSwipe"],

  // ---- windowed playback ----
  // A windowed player usually sits in a scrolling page, where "swipe up for
  // volume" and "swipe up to scroll" are the same finger movement. This is the
  // one place that decides which of the two wins.
  ["nonFullscreenVertical", "Vertical swipes", "select", "g-win", "Where volume / brightness swipes work when the video is not fullscreen. The rest of the page keeps scrolling either way.", [["fullscreen", "Fullscreen only"], ["edge", "Edges only"], ["always", "Everywhere"]]],

  // ---- volume ----
  ["volumeBoostEnabled", "Volume boost", "bool", "g-vol", "Boost beyond 100% via Web Audio (up to 600%)."],
  ["volumeBoostMax", "Max volume (%)", "range", "g-vol", "Upper limit for volume boost.", [100, 600, 25], true],

  // ---- brightness & indicators ----
  ["brightnessMin", "Brightness min (%)", "num", "g-bright", "Lowest brightness the swipe can reach.", [0, 50, 5]],
  ["brightnessMax", "Brightness max (%)", "num", "g-bright", "Highest brightness the swipe can reach.", [80, 150, 5]],
  ["sideBarWidth", "Side bar width (px)", "num", "g-bright", "Track width of the two meters.", [2, 14, 1], true],
  ["sideBarHeightRatio", "Side bar height", "range", "g-bright", "Height of each meter, as a fraction of the video.", [0.2, 1, 0.05], true],
  ["sideBarMargin", "Side bar margin (px)", "num", "g-bright", "Distance from the video edge.", [0, 60, 4], true],
  ["sideBarHideDelay", "Indicator fade delay (ms)", "num", "g-bright", "How long the bar stays visible.", [200, 3000, 100], true],

  // ---- A-B loop ----
  ["abLoopEnabled", "A-B loop", "bool", "g-ab", "Repeat a chosen segment; adds an on-screen control panel."],
  // Repeating forever is the default and stays the default: a loop that quietly
  // gives up after a few passes would confuse anyone who never asked for a
  // limit. The two controls read as one pair — the count is disabled, not
  // hidden, while the switch is off, so flipping it does not move the page.
  ["abMaxLoopsOn", "Stop after a set number of loops", "bool", "g-ab", "Off: the segment repeats until you stop it. On: the loop stops itself after the number of passes set below, and A/B stay where they are."],
  ["abMaxLoopsCount", "Loop count", "num", "g-ab", "Passes before the loop stops itself. Pressing the loop button again starts a fresh count.", [1, 99, 1]],
  ["abShortcutsEnabled", "A-B keyboard shortcuts", "bool", "g-ab", "Enable the keyboard shortcuts (editable in Advanced)."],
  ["abPanelOpacityOn", "Panel opacity while looping", "range", "g-ab", "The bar fades while the loop runs, so it stays out of the picture.", [0.2, 1, 0.05]],
  ["abPanelOpacityOff", "Panel opacity when idle", "range", "g-ab", "When the loop is paused or off the bar is drawn more clearly, because then it is a control.", [0.2, 1, 0.05]],

  // ---- playback lock ----
  ["gestureLockEnabled", "Lock button", "bool", "g-lock2", "Pin a lock button to the corner of the video. Tap it to freeze the screen against accidental touches; the same button unlocks."],
  // "Auto" / "Left" are already taken by the language and hand pickers, and the
  // dictionary is flat, so these labels stay unique to avoid the wrong Chinese
  // ("跟随浏览器" once appeared on this control).
  ["lockButtonPosition", "Lock button position", "seg", "g-lock2", "Which corner the button sits in. Match hand keeps it on the side of your preferred hand.", [["auto", "Match hand"], ["left", "Left side"], ["right", "Right side"]]],
  ["lockQuickMenuEnabled", "Quick menu on lock", "bool", "g-lock2", "Keep play / skip controls available while locked."],
  ["lockBtnSize", "Lock button size (px)", "num", "g-lock2", "Size of the lock / unlock button.", [32, 80, 2], true],

  // ---- detection & tuning ----
  ["minVideoSize", "Min video size (px)", "num", "g-detect", "Ignore videos smaller than this.", [40, 400, 10]],
  ["minVideoArea", "Min video area (px²)", "num", "g-detect", "Ignore very small players.", [0, 200000, 1000], true],
  ["moveThreshold", "Move threshold (px)", "num", "g-detect", "Movement before a gesture is recognized.", [2, 40, 1], true],
  ["directionThreshold", "Axis lock threshold (px)", "num", "g-detect", "Movement before horizontal/vertical is locked.", [5, 60, 1], true],
  ["clickBlockTimeout", "Click suppression (ms)", "num", "g-detect", "Suppress the next click after a gesture.", [0, 800, 25], true],

  // ---- JSON / site rules ----
  ["abShortcuts", "A-B shortcuts (JSON)", "json", "g-json", "e.g. {\"setA\":\"[\",\"setB\":\"]\",\"clear\":\"\\\\\",\"toggle\":\"Alt+L\"}"],
  ["gestureBlacklist", "Disabled domains (JSON array)", "json", "g-json", "e.g. [\"example.com\", \"foo.net\"] — gestures off on these sites."],
  ["siteRules", "Per-site rules (JSON array)", "json", "g-json", "e.g. [{\"match\":\"youtube.com\",\"enabled\":true}]"],
  ["siteEventBlocking", "Per-site event blocking (JSON)", "json", "g-json", "e.g. {\"example.com\":true}"]
];

const DOUBLE_TAP_ACTIONS = [["none", "None"], ["seekBackward", "Seek backward"], ["seekForward", "Seek forward"], ["playPause", "Play / Pause"], ["fullscreen", "Fullscreen"]];
const V_SWIPE_ACTIONS = [["none", "None"], ["volume", "Volume"], ["brightness", "Brightness"]];

/* Numeric fields carry a unit so a bare number never has to be guessed.
 * Ratio keys are stored as 0..1 but shown as percentages — "45%" reads far
 * better on a phone than "0.45", and the slider then has round steps. */
const UNITS = {
  longPressSpeed: "×", longPressDelay: "ms", longPressDelayMobile: "ms",
  longPressLockSwipeDistance: "px", longPressDragSensitivity: "px",
  longPressMoveDeadzone: "px",
  swipeSeekSensitivity: "px", maxSeekRatio: "%", seekCancelSwipeDistance: "px",
  doubleTapInterval: "ms", doubleTapSeekDuration: "s",
  wheelSeekDuration: "s", wheelDebounce: "ms",
  gestureAreaRatio: "%", volumeBoostMax: "%",
  brightnessMin: "%", brightnessMax: "%",
  sideBarWidth: "px", sideBarHeightRatio: "%", sideBarMargin: "px", sideBarHideDelay: "ms",
  lockBtnSize: "px",
  abPanelOpacityOn: "%", abPanelOpacityOff: "%", abMaxLoopsCount: "×",
  hintOpacity: "%",
  minVideoSize: "px", minVideoArea: "px²", moveThreshold: "px",
  directionThreshold: "px", clickBlockTimeout: "ms"
};
const PCT = new Set(["maxSeekRatio", "gestureAreaRatio", "sideBarHeightRatio",
  "abPanelOpacityOn", "abPanelOpacityOff", "hintOpacity"]);
const isPct = (k) => PCT.has(k);
// 0..1 -> 0..100 for display; rounded so the field never shows 45.000000001
const toPct = (x) => Math.round(x * 100 * 1000) / 1000;
const toStore = (x) => Math.round(x * 10) / 1000;

// Brightness/volume lock halves. Both switches are backed by the single
// lockVerticalSwipe/lockVerticalTarget pair the content script reads.
const LOCK_PARTS = { lockBrightness: "brightness", lockVolume: "volume" };
const isLockPart = (k) => Object.prototype.hasOwnProperty.call(LOCK_PARTS, k);
function lockHas(s, part) {
  if (!s || !s.lockVerticalSwipe) return false;
  const t = s.lockVerticalTarget || "both";
  return t === "both" || t === part;
}

let settings = {};
let saveTimer = 0;
let booted = false;
let LANG = "auto";
const I18N = globalThis.VW_I18N || { T: (s) => s, apply: () => {}, resolve: () => "en" };
const T = (s) => I18N.T(s, LANG);
const $ = (s) => document.querySelector(s);
const byId = (id) => document.getElementById(id);

function toast(msg) {
  const el = byId("toast");
  el.textContent = T(msg);
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1400);
}
function flashSaved() {
  const dot = byId("savedot");
  dot.classList.add("show");
  clearTimeout(dot._t);
  dot._t = setTimeout(() => dot.classList.remove("show"), 1000);
}

/* ---------- rendering ---------- */
// Every text node created here stores its English source in data-i18n so a
// language switch can re-translate it in place without rebuilding the DOM.
function setText(el, en) {
  el.dataset.i18n = en;
  el.textContent = T(en);
  return el;
}

// Paint the filled portion of a range input. The track is a CSS gradient driven
// by --p, which keeps the thumb style identical on every player/OS.
function paintRange(el) {
  if (!el || el.type !== "range") return;
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const v = parseFloat(el.value);
  const p = max > min && Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--p", Math.max(0, Math.min(100, p)).toFixed(2) + "%");
}

function makeSwitch(key) {
  const label = document.createElement("label");
  label.className = "sw";
  label.title = key;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.k = key;
  const slider = document.createElement("span");
  slider.className = "slider";
  label.appendChild(input);
  label.appendChild(slider);
  return label;
}

function makeSeg(key, opts) {
  const wrap = document.createElement("div");
  wrap.className = "seg";
  for (const [value, text] of (opts || [])) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = key;
    input.value = value;
    input.dataset.k = key;
    const span = document.createElement("span");
    setText(span, text);
    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);
  }
  return wrap;
}

function makeSelect(key, kind) {
  const sel = document.createElement("select");
  sel.dataset.k = key;
  // `kind` is either one of the shared action lists or an explicit
  // [value,label] array (a plain enum lives in the SCHEMA next to its field).
  const opts = Array.isArray(kind)
    ? kind
    : (kind === "vSwipe" ? V_SWIPE_ACTIONS : DOUBLE_TAP_ACTIONS);
  for (const [value, text] of opts) {
    const o = document.createElement("option");
    o.value = value;
    setText(o, text);
    sel.appendChild(o);
  }
  return sel;
}

function makeNum(key, min, max, step, range) {
  const pct = isPct(key);
  const lo = pct ? toPct(min) : min;
  const hi = pct ? toPct(max) : max;
  const st = pct ? toPct(step) : step;
  const ctl = document.createElement("div");
  ctl.className = range ? "rng" : "numonly";
  if (range) {
    const r = document.createElement("input");
    r.type = "range";
    r.min = lo; r.max = hi; r.step = st;
    r.dataset.k = key;
    r.dataset.mirror = "1";
    ctl.appendChild(r);
  }
  // The value sits in a bordered chip together with its unit, so the slider can
  // stretch on narrow screens without the number drifting away from it.
  const chip = document.createElement("div");
  chip.className = "vchip";
  const n = document.createElement("input");
  n.type = "number";
  n.min = lo; n.max = hi; n.step = st;
  n.dataset.k = key;
  if (range) n.dataset.mirror = "1";
  chip.appendChild(n);
  const unit = UNITS[key];
  if (unit) {
    const u = document.createElement("span");
    u.className = "unit";
    u.textContent = unit;
    chip.appendChild(u);
  }
  ctl.appendChild(chip);
  return ctl;
}

function build() {
  if (byId("g-basic") && byId("g-basic").childElementCount) return; // idempotent
  // show the running build so it is obvious whether the new package is loaded
  try {
    const ver = byId("ver");
    if (ver) ver.textContent = "v" + chrome.runtime.getManifest().version;
  } catch (_) {}
  for (const [key, label, type, group, desc, extra] of SCHEMA) {
    const host = byId(group);
    if (!host) continue;

    if (type === "json") {
      const block = document.createElement("div");
      block.className = "jsonrow";
      const info = document.createElement("div");
      info.className = "info";
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      setText(lbl, label);
      info.appendChild(lbl);
      if (desc) {
        const d = document.createElement("div");
        d.className = "desc";
        setText(d, desc);
        info.appendChild(d);
      }
      const ta = document.createElement("textarea");
      ta.dataset.k = key;
      ta.spellcheck = false;
      block.appendChild(info);
      block.appendChild(ta);
      host.appendChild(block);
      continue;
    }

    const row = document.createElement("div");
    row.className = "row";
    // Wide controls (segmented radios, selects, sliders) need room to breathe:
    // they get their own line instead of squeezing the label on a phone.
    if (type === "seg" || type === "select") row.className = "row segrow";
    else if (type === "range") row.className = "row wide";

    const info = document.createElement("div");
    info.className = "info";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    setText(lbl, label);
    info.appendChild(lbl);
    if (desc) {
      const d = document.createElement("div");
      d.className = "desc";
      setText(d, desc);
      info.appendChild(d);
    }
    row.appendChild(info);

    let ctl;
    if (type === "bool" || type === "lockpart") ctl = makeSwitch(key);
    else if (type === "seg") ctl = makeSeg(key, extra);
    else if (type === "select") ctl = makeSelect(key, extra);
    else if (type === "num" || type === "range") ctl = makeNum(key, extra[0], extra[1], extra[2], type === "range");
    row.appendChild(ctl);
    host.appendChild(row);
  }
}

function fill(s) {
  settings = s || {};
  document.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    const v = settings[k];
    if (isLockPart(k)) {
      el.checked = lockHas(settings, LOCK_PARTS[k]);
    } else if (el.type === "checkbox") {
      el.checked = !!v;
    } else if (el.type === "radio") {
      // Segmented controls need one cell lit even if the key is missing from an
      // older stored blob, so fall back to the same default the worker uses.
      const val = (v === undefined || v === null) && k === "lockButtonPosition" ? "auto" : v;
      el.checked = String(val) === el.value;
    } else if (el.type === "range" || el.type === "number") {
      if (v !== undefined && v !== null && v !== "") el.value = isPct(k) ? toPct(v) : v;
      if (el.type === "range") paintRange(el);
    } else if (el.tagName === "TEXTAREA") {
      const fallback = (k === "gestureBlacklist" || k === "siteRules") ? [] : {};
      el.value = JSON.stringify(v ?? fallback, null, 2);
    } else if (el.tagName === "SELECT") {
      if (v !== undefined) el.value = String(v);
    }
  });
  updateGridPreview();
  updateZoneHint();
  updateAbLoopLimit();
}

/* ---------- language ---------- */
// Write the choice straight to storage as well as through the background
// worker. On Android the worker can be asleep; the message then fails and the
// setting would only exist in this tab, while the cheat sheet and the on-video
// messages keep reading the old value.
function mirrorLanguage(lang) {
  const KEY = "gestio_settings_v1";
  // Same-origin cache the cheat sheet can read synchronously, so it paints in
  // the right language before any async storage/message call comes back.
  try { localStorage.setItem("gestio_lang", lang); } catch (_) {}
  try {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(KEY, (obj) => {
      const cur = (obj && obj[KEY]) || {};
      const next = { ...cur, ...collectAll(), language: lang };
      try { chrome.storage.local.set({ [KEY]: next }); } catch (_) {}
    });
  } catch (_) {}
}

function applyLanguage(lang) {
  LANG = lang || settings.language || "auto";
  // re-translate all dynamic labels created by build()
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = T(el.dataset.i18n);
  });
  // static HTML text (header, nav, cards, buttons, legend built below)
  I18N.apply(document, LANG);
  byId("savedot") && setText(byId("savedot"), "✓ Saved");
  updateGridPreview();
  updateZoneHint();
}

/* ---------- grid diagram ---------- */
// Icons in the diagram are drawn (SVG sprite in options.html), never emoji, so
// they stay sharp and pick up the theme colour.
function svgIcon(id, size) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("class", "sic");
  if (size) { s.style.width = size + "px"; s.style.height = size + "px"; }
  const u = document.createElementNS(NS, "use");
  u.setAttribute("href", "#" + id);
  s.appendChild(u);
  return s;
}
const ACTION_ICON = { seekBackward: "i-back", seekForward: "i-fwd", playPause: "i-play", fullscreen: "i-expand", none: "" };
function actionLabel(zone, y, s) {
  const mode = (s && s.oneHandedMode) || "right";
  const grid = (s && s.gridLayout) || "3x1";
  if (grid === "3x2" && mode !== "custom" && zone !== "center") {
    return y === "top" ? "Forward" : "Back";
  }
  const key = zone + "DoubleTap";
  let a = mode === "custom" ? (s[key]) : ({
    right: { leftDoubleTap: "seekBackward", centerDoubleTap: "playPause", rightDoubleTap: "seekForward" },
    left: { leftDoubleTap: "seekForward", centerDoubleTap: "playPause", rightDoubleTap: "seekBackward" }
  }[mode] || {})[key];
  const map = { seekBackward: "Back", seekForward: "Forward", playPause: "Play", fullscreen: "Full", none: "—" };
  return map[a] || "—";
}
function actionIcon(zone, y, s) {
  const mode = (s && s.oneHandedMode) || "right";
  const grid = (s && s.gridLayout) || "3x1";
  if (grid === "3x2" && mode !== "custom" && zone !== "center") return y === "top" ? "i-fwd" : "i-back";
  const key = zone + "DoubleTap";
  const a = mode === "custom" ? s[key] : ({
    right: { leftDoubleTap: "seekBackward", centerDoubleTap: "playPause", rightDoubleTap: "seekForward" },
    left: { leftDoubleTap: "seekForward", centerDoubleTap: "playPause", rightDoubleTap: "seekBackward" }
  }[mode] || {})[key];
  return ACTION_ICON[a] || "";
}
function zoneLabel(zone, y) {
  if (y === "top") return T({ left: "L·TOP", center: "C·TOP", right: "R·TOP" }[zone]);
  if (y === "bot") return T({ left: "L·BOT", center: "C·BOT", right: "R·BOT" }[zone]);
  return T({ left: "LEFT", center: "CENTER", right: "RIGHT" }[zone]);
}
function updateGridPreview() {
  const grid = byId("gridPreview");
  const legend = byId("gridLegend");
  if (!grid) return;
  const layout = settings.gridLayout || "3x1";
  const mode = settings.oneHandedMode || "right";
  grid.className = "grid " + (layout === "3x2" ? "g3x2" : "g3x1");
  grid.innerHTML = "";
  const zones = ["left", "center", "right"];
  const rows = layout === "3x2" ? ["top", "bot"] : ["mid"];
  for (const y of rows) {
    for (const zone of zones) {
      const cell = document.createElement("div");
      cell.className = "cell" + (layout === "3x2" ? (y === "top" ? " g3x2-top" : " g3x2-bot") : "");
      const zt = document.createElement("div");
      zt.className = "zt";
      zt.textContent = zoneLabel(zone, y);
      const ic = document.createElement("div");
      ic.className = "ic";
      const iconId = actionIcon(zone, y, settings);
      if (iconId) ic.appendChild(svgIcon(iconId, 17));
      const tap = document.createElement("div");
      tap.className = "tap";
      tap.textContent = T(actionLabel(zone, y, settings));
      const swp = document.createElement("div");
      swp.className = "swp";
      let vIcon = "";
      if (zone === "center") swp.textContent = "";
      else {
        const vkey = zone + "VerticalSwipe";
        const va = mode === "custom" ? settings[vkey] : (mode === "left"
          ? (zone === "left" ? "volume" : "brightness")
          : (zone === "right" ? "volume" : "brightness"));
        vIcon = va === "volume" ? "i-volume" : va === "brightness" ? "i-sun" : "";
        swp.textContent = T({ volume: "Volume", brightness: "Brightness", none: "—" }[va] || "—");
      }
      cell.appendChild(zt);
      if (iconId) cell.appendChild(ic);
      cell.appendChild(tap);
      if (vIcon) {
        const line = document.createElement("div");
        line.className = "ic swline";
        line.appendChild(svgIcon(vIcon, 13));
        const txt = document.createElement("span");
        txt.textContent = swp.textContent;
        line.appendChild(txt);
        cell.appendChild(line);
      } else if (swp.textContent) cell.appendChild(swp);
      grid.appendChild(cell);
    }
  }
  if (legend) {
    const handName = T({ right: "Right", left: "Left", custom: "Custom" }[mode] || "Right");
    legend.innerHTML =
      "<b>" + T("Layout:") + "</b> " + T(layout === "3x2" ? "3×2 — side columns split top / bottom" : "3×1 — three vertical columns") +
      "<br><b>" + T("Hand:") + "</b> " + handName +
      "<br><b>" + T("Tap = double-tap action \u00a0 ↕ = vertical swipe") + "</b>" +
      "<br><span style='color:#9aa0b0'>" + T("Mirrored automatically in Right / Left presets. Choose Custom to edit zone actions.") + "</span>";
  }
}

/* ---------- zone actions: locked in Right / Left presets ---------- */
// The three presets mirror the zones themselves, so the six selects are only
// read in Custom mode. Leaving them editable made the page look broken: you
// changed a value, went back to the video, and nothing happened.
function updateZoneHint() {
  const host = byId("g-zones");
  const hint = byId("zoneHint");
  if (!host) return;
  const custom = (settings.oneHandedMode || "right") === "custom";
  host.classList.toggle("is-preset", !custom);
  host.querySelectorAll("[data-k]").forEach((el) => { el.disabled = !custom; });
  if (!hint) return;
  hint.textContent = custom
    ? T("Custom mode: each zone below is used exactly as set here.")
    : T("Right / Left presets mirror the zones automatically — switch Preferred hand to Custom to edit them.");
  hint.classList.toggle("warn", !custom);
}

/* ---------- A-B loop limit: the count follows its switch ---------- */
// Disabled rather than hidden: a row that disappears and reappears makes the
// rest of the card jump while you are reading it.
function updateAbLoopLimit() {
  const sw = document.querySelector('input[data-k="abMaxLoopsOn"]');
  const on = !!(sw && sw.checked);
  document.querySelectorAll('input[data-k="abMaxLoopsCount"]').forEach((el) => {
    el.disabled = !on;
    const row = el.closest ? el.closest(".row") : null;
    if (row) row.classList.toggle("is-dim", !on);
  });
}

/* ---------- collect & save ---------- */
function collectAll() {
  const out = {};
  document.querySelectorAll("[data-k]").forEach((el) => {
    if (el.dataset.mirror && el.type === "range") return; // skip mirrored range; number field wins
    const k = el.dataset.k;
    if (isLockPart(k)) return; // folded into lockVerticalSwipe / lockVerticalTarget below
    if (el.type === "checkbox") out[k] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[k] = el.value; }
    else if (el.type === "number" || el.type === "range") {
      const n = parseFloat(el.value);
      if (!Number.isNaN(n)) out[k] = isPct(k) ? toStore(n) : n;
    } else if (el.tagName === "TEXTAREA") {
      try {
        const fallback = (k === "gestureBlacklist" || k === "siteRules") ? "[]" : "{}";
        out[k] = JSON.parse(el.value || fallback);
      } catch (_) { /* invalid JSON: leave this key unchanged */ }
    } else if (el.tagName === "SELECT") out[k] = el.value;
  });
  // Rebuild the single lock pair from the two per-slider switches.
  const bs = document.querySelector('input[data-k="lockBrightness"]');
  const vs = document.querySelector('input[data-k="lockVolume"]');
  if (bs && vs) {
    out.lockVerticalSwipe = !!(bs.checked || vs.checked);
    out.lockVerticalTarget = bs.checked && vs.checked ? "both"
      : bs.checked ? "brightness"
        : vs.checked ? "volume"
          : (settings.lockVerticalTarget || "both");
  }
  return out;
}

async function saveAll(quiet) {
  try {
    const r = await chrome.runtime.sendMessage({ action: "set_settings", settings: collectAll() });
    if (r && r.settings) settings = r.settings;
    if (!quiet) { toast("Saved"); }
    flashSaved();
    broadcast();
    return true;
  } catch (e) {
    toast("Save failed: " + String(e));
    return false;
  }
}
function broadcast() {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        try { chrome.tabs.sendMessage(tab.id, { action: "settings_changed" }).catch(() => {}); } catch (_) {}
      }
    });
  } catch (_) {}
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAll(true), 250);
}

/* ---------- wiring ---------- */
function wire() {
  if (booted) return;
  booted = true;
  // tab navigation
  document.querySelectorAll("#nav .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#nav .tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = byId(tab.dataset.panel);
      if (panel) panel.classList.add("active");
      // phones show the nav as a horizontal scroller: keep the chosen tab in view
      try { tab.scrollIntoView({ block: "nearest", inline: "center" }); } catch (_) {}
    });
  });

  // all inputs: instant save
  function handleChange(el) {
    if (!el || !el.dataset || !el.dataset.k) return;
    if (el.type === "range" || el.type === "number") {
      document.querySelectorAll(`input[type=range][data-k="${el.dataset.k}"],input[type=number][data-k="${el.dataset.k}"]`).forEach((other) => {
        if (other !== el) other.value = el.value;
      });
      if (el.type === "range") paintRange(el);
      else document.querySelectorAll(`input[type=range][data-k="${el.dataset.k}"]`).forEach(paintRange);
    }
    if (["oneHandedMode", "gridLayout"].includes(el.dataset.k)) {
      settings[el.dataset.k] = el.value;
      updateGridPreview();
      updateZoneHint();
    }
    if (el.dataset.k === "abMaxLoopsOn") updateAbLoopLimit();
    if (el.dataset.k === "language") {
      // Keep `settings` in step with the DOM right away: the guide link and the
      // write-through below read from it, and the debounced save is 250ms away.
      settings.language = el.value;
      applyLanguage(el.value); // re-translate the whole page immediately
      mirrorLanguage(el.value); // land the value even if the worker is asleep
    }
    scheduleSave();
  }

  document.addEventListener("change", (e) => handleChange(e.target));
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.k) return;
    if (el.type === "range") {
      paintRange(el);
      document.querySelectorAll(`input[type=number][data-k="${el.dataset.k}"]`).forEach((n) => { n.value = el.value; });
    }
    if (el.type === "checkbox" || el.type === "radio" || el.type === "range") handleChange(el);
  });

  // The video gesture can flip either lock half while this page is open, so
  // mirror storage changes back onto the two switches.
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      const rec = ch["gestio_settings_v1"];
      if (!rec || !rec.newValue) return;
      settings.lockVerticalSwipe = rec.newValue.lockVerticalSwipe;
      settings.lockVerticalTarget = rec.newValue.lockVerticalTarget;
      document.querySelectorAll('input[data-k="lockBrightness"],input[data-k="lockVolume"]').forEach((el) => {
        el.checked = lockHas(settings, LOCK_PARTS[el.dataset.k]);
      });
    });
  } catch (_) { /* storage permission missing (tests) — not fatal */ }

  byId("reset").addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ action: "reset_settings" });
    if (r && r.settings) { fill(r.settings); applyLanguage(r.settings.language || "auto"); toast("Restored defaults"); broadcast(); }
  });
  byId("openGuide").addEventListener("click", () => {
    // Hand the current language over so the sheet is correct on first paint,
    // even before it has read storage. Read the checked radio rather than the
    // cached object: it is always the value the user just picked.
    const picked = document.querySelector('input[data-k="language"]:checked');
    const lang = encodeURIComponent((picked && picked.value) || settings.language || "auto");
    window.open(chrome.runtime.getURL("guide.html") + "?lang=" + lang, "_blank", "width=560,height=720");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  build();
  wire();
  try {
    const d = await chrome.runtime.sendMessage({ action: "get_default_settings" });
    const r = await chrome.runtime.sendMessage({ action: "get_settings" });
    fill({ ...(d && d.settings ? d.settings : {}), ...(r && r.settings ? r.settings : {}) });
    applyLanguage(settings.language || "auto");
  } catch (e) {
    toast("Could not load settings: " + String(e));
  }
});
