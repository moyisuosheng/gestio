"use strict";
const $ = (s) => document.querySelector(s);
const BOOLS = ["enabled", "longPressEnabled", "swipeSeekEnabled", "doubleTapEnabled", "volumeBoostEnabled", "abLoopEnabled", "gestureShield"];
const NUMS = ["longPressSpeed"];
const I18N = globalThis.VW_I18N || { T: (s) => s, apply: () => {} };
let LANG = "auto";
const T = (s) => I18N.T(s, LANG);

async function load() {
  let s = {};
  try {
    const r = await chrome.runtime.sendMessage({ action: "get_settings" });
    s = (r && r.settings) || {};
  } catch (_) { /* worker asleep (Android) */ }
  // Same fallback the cheat sheet uses: read storage directly so the popup is
  // not stuck in English when the service worker has been reclaimed.
  if (!s || !s.language) {
    try {
      const obj = await chrome.storage.local.get("gestio_settings_v1");
      const stored = (obj && obj["gestio_settings_v1"]) || null;
      if (stored) s = { ...stored, ...s };
    } catch (_) {}
  }
  LANG = s.language || "auto";
  I18N.apply(document, LANG);
  for (const k of BOOLS) { const el = document.getElementById(k); if (el) el.checked = !!s[k]; }
  for (const k of NUMS) { const el = document.getElementById(k); if (el) el.value = s[k]; }
}
async function save(k, v) {
  // MV3 workers are reclaimed aggressively on Android. A failed message used
  // to reject here and leave the switch visually flipped but unsaved. Fall
  // back to a direct storage write, the same route checkStatus/load() use.
  let ok = false;
  try {
    const r = await chrome.runtime.sendMessage({ action: "set_settings", settings: { [k]: v } });
    ok = !!(r && r.ok !== false);
  } catch (_) {}
  if (!ok) {
    try {
      const obj = await chrome.storage.local.get("gestio_settings_v1");
      const stored = (obj && obj["gestio_settings_v1"]) || {};
      await chrome.storage.local.set({ gestio_settings_v1: { ...stored, [k]: v } });
      // The worker missed the message; make pages re-read storage on their own
      // (content scripts also read storage directly on next gesture/settings).
      ok = true;
    } catch (_) {}
  }
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { action: "settings_changed" }).catch(() => {});
  });
  if (!ok) console.warn("gestio: could not save", k);
  return { ok };
}
// --- A-B card visibility ----------------------------------------------------
// This one is not a setting: the card is tucked away per PAGE, so the switch
// has to read from and write to the tab it is showing. Saving it globally (as
// it used to) hid the bar on every other site as well.
async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (_) { return null; }
}
async function loadAbPanel() {
  const el = document.getElementById("abPanelVisible");
  if (!el) return;
  const tab = await activeTab();
  try {
    const r = tab && await chrome.tabs.sendMessage(tab.id, { action: "ab_panel_get" });
    if (!r || typeof r.visible !== "boolean") throw new Error("no reply");
    el.checked = r.visible;
  } catch (_) {
    // Nothing answers here (a browser page, a local file, a page that has not
    // been reloaded since the extension was installed): there is no page to
    // toggle, so say so instead of offering a switch that cannot work.
    el.dataset.blocked = "1";
    syncAbGroup();
  }
}
async function setAbPanel(el) {
  const want = !!el.checked;
  const tab = await activeTab();
  let ok = false;
  try {
    const r = tab && await chrome.tabs.sendMessage(tab.id, { action: "ab_panel_set", visible: want });
    ok = !!(r && r.visible === want);
  } catch (_) {}
  // Nothing to talk to: put the switch back rather than pretend it worked.
  if (!ok) el.checked = !want;
}
// The child switch only means something while the loop above it is on, and
// only on a page that can be scripted at all.
function syncAbGroup() {
  const parent = document.getElementById("abLoopEnabled");
  const child = document.getElementById("abPanelVisible");
  if (!parent || !child) return;
  const blocked = child.dataset && child.dataset.blocked === "1";
  const off = !parent.checked || blocked;
  child.disabled = off;
  if (child.closest) {
    const row = child.closest(".row");
    if (row) row.classList.toggle("is-off", off);
  }
}
// Android opens an already-downloaded video in the browser's own player, whose
// URL is `content://media/...`. That is not a web page: it never appears in the
// tabs API, no content script can be injected, and no host permission matches
// the scheme. Same story for `file://` (the file-access toggle does not exist on
// Android). Both therefore look identical to the user — "the gestures stopped
// working" — so the popup has to say which one it is.
const ANDROID = /Android/i.test(navigator.userAgent || "");
const schemeOf = (url) => { try { return new URL(url).protocol; } catch (_) { return ""; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolves once the stored language is known (see DOMContentLoaded). The status
// line must not be written before that: it used to race with load(), so the very
// first message was rendered from the fallback language instead of the user's
// choice — on Android the service worker is usually asleep, which made the race
// land on the wrong side.
let settingsReady = Promise.resolve();
function markUnsupported(el, msg) {
  el.className = 'status bad';
  el.textContent = msg;
  const btn = document.getElementById('lockBtn');
  if (btn) { btn.disabled = true; btn.title = msg; }
}
async function checkStatus() {
  const el = document.getElementById("status");
  if (!el) return;
  // Language first, tab second (bounded: a sleeping worker must not leave the
  // line stuck on "Checking this tab…").
  await Promise.race([settingsReady, sleep(1200)]);
  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) { lockBtn.disabled = false; lockBtn.title = ''; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const proto = schemeOf((tab && tab.url) || '');
    if (!tab || !proto) {
      // No tab at all is exactly what Android reports while its media player is
      // on screen, so this branch doubles as the local-player explanation.
      markUnsupported(el, ANDROID
        ? T('This is the browser’s own player for local files (content://). Extensions can’t run here — play the video from an http(s) link instead.')
        : T('Open a normal web page (http/https) with a video to use gestures.'));
      return;
    }
    if (proto === 'content:') {
      markUnsupported(el, T('This is the browser’s own player for local files (content://). Extensions can’t run here — play the video from an http(s) link instead.'));
      return;
    }
    if (proto === 'file:') {
      markUnsupported(el, ANDROID
        ? T('Android browsers do not let extensions read local files. Play the video from an http(s) link instead.')
        : T('Local files: enable “Allow access to file URLs” for this extension, then reload the page.'));
      return;
    }
    if (!/^https?:$/.test(proto)) {
      markUnsupported(el, T('Browser-internal pages (edge://, chrome://…) can’t be scripted. Open the video in a normal tab.'));
      return;
    }
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    if (r && r.pong) {
      const s = await chrome.runtime.sendMessage({ action: 'get_settings' });
      el.className = 'status';
      el.textContent = (s && s.settings && s.settings.enabled)
        ? T('Active on this page ✓ — make a gesture over the video.')
        : T('Loaded, but gestures are disabled. Turn on “Enable gestures”.');
      if (s && s.settings && !s.settings.enabled) el.className = 'status bad';
    } else {
      el.className = 'status bad';
      el.textContent = T('Not responding. Reload the page after enabling the extension.');
    }
  } catch (_) {
    el.className = 'status bad';
    el.textContent = T('Not active here. Reload the page, then try again.');
  }
}
document.addEventListener("DOMContentLoaded", () => {
  settingsReady = load().then(async () => { syncAbGroup(); await loadAbPanel(); }).catch(() => {});
  checkStatus();
  for (const k of BOOLS) {
    const el = document.getElementById(k);
    el && el.addEventListener("change", () => {
      save(k, el.checked);
      if (k === "abLoopEnabled") syncAbGroup();
    });
  }
  const abPanel = document.getElementById("abPanelVisible");
  if (abPanel) abPanel.addEventListener("change", () => setAbPanel(abPanel));
  for (const k of NUMS) {
    const el = document.getElementById(k);
    el && el.addEventListener("change", () => save(k, parseFloat(el.value)));
  }
  $("#lockBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const r = await chrome.tabs.sendMessage(tab.id, { action: "lock_toggle" });
    const btn = document.getElementById("lockBtn");
    const on = !!(r && r.locked);
    // Swap the drawn icon and the label instead of overwriting the button.
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", on ? "#i-unlock" : "#i-lock");
    const lbl = btn.querySelector(".lbl");
    if (lbl) {
      const key = on ? "Unlock video" : "Lock video";
      lbl.dataset.i18n = key;
      lbl.textContent = T(key);
    }
  });
  // On Android the action popup is shown as a bottom sheet and does not close
  // by itself when the options tab opens behind it — it would stay on screen
  // covering the page. Close it once the tab has been requested. The timeout is
  // a guard: openOptionsPage() can stay pending while the tab is created.
  $("#openOpts").addEventListener("click", async () => {
    const done = new Promise((r) => setTimeout(r, 400));
    try { await Promise.race([chrome.runtime.openOptionsPage(), done]); } catch (_) {}
    window.close();
  });
  $("#reset").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "reset_settings" });
    await load();
    chrome.tabs.query({}, (tabs) => { for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { action: "settings_changed" }).catch(() => {}); });
  });
});
