/*
 * Gestio — background service worker
 * Plain, local-only storage. No accounts, no remote config, no encryption.
 */
"use strict";

export const DEFAULT_SETTINGS = {
  enabled: true,
  language: "auto",                  // "auto" | "zh_CN" | "en" — UI + on-video messages
  // long press → temporary speed boost
  longPressEnabled: true,
  longPressSpeed: 2,
  longPressDelay: 300,
  longPressDelayMobile: 450,
  longPressLockEnabled: true,        // long-press + swipe up to lock speed
  longPressLockSwipeDistance: 40,
  longPressDragEnabled: true,        // long-press + drag left/right to fine-tune speed
  longPressDragWhileLocked: true,    // keep re-tuning a rate that is already locked
  longPressDragSensitivity: 45,          // px the finger travels per speedStep (higher = finer)
  longPressMoveDeadzone: 20,
  longPressDirectionRatio: 1.5,
  // horizontal swipe → seek
  swipeSeekEnabled: true,
  swipeSeekSensitivity: 30,
  maxSeekRatio: 1,
  seekCancelSwipeDistance: 40,
  // double tap
  doubleTapEnabled: true,
  doubleTapInterval: 300,
  doubleTapSeekDuration: 10,
  doubleTapAccumulateEnabled: false,
  doubleTapFullscreenEnabled: true,
  // one-handed grid layout (unlocked locally)
  oneHandedMode: "right",            // "right" | "left" | "custom"
  gridLayout: "3x1",                 // "3x1" | "3x2"
  gestureAreaRatio: 0.8,             // vertical share of the video treated as gesture area
  leftDoubleTap: "seekBackward",
  centerDoubleTap: "playPause",
  rightDoubleTap: "seekForward",
  // vertical swipe
  leftVerticalSwipe: "brightness",
  centerVerticalSwipe: "none",
  rightVerticalSwipe: "volume",
  // extended feature set (all available locally, no paywall)
  autoRotateFullscreen: false,       // request landscape orientation in fullscreen
  gestureLockEnabled: false,         // lock overlay to block accidental touches
  lockQuickMenuEnabled: true,        // show play/pause & skip controls while locked
  lockButtonPosition: "auto",        // "left" | "right"
  // wheel
  wheelSeekEnabled: true,
  wheelSeekDuration: 5,
  wheelDebounce: 200,
  // volume boost (Web Audio) — off by default: it reroutes the <video> through
  // an AudioContext, which some players react badly to (and it is irreversible
  // for the session). Opt-in only.
  volumeBoostEnabled: false,
  volumeBoostMax: 300,
  // brightness
  brightnessMin: 5,
  brightnessMax: 100,
  // preview / feedback
  thumbnailPreviewEnabled: true,     // on-screen time preview while seeking
  hapticFeedbackEnabled: true,
  hintOpacity: 1,                    // solid the small message pills are (0.3–1)
  gestureShield: true,               // block page touch events to avoid player conflicts
  // brightness/volume-only lock (toggled by a two-finger tap on the video)
  lockVerticalSwipe: false,          // true = vertical swipes ignored
  lockVerticalTarget: "both",        // both | volume | brightness
  twoFingerLockEnabled: true,        // enable the two-finger tap chord
  // where vertical volume/brightness swipes work while windowed:
  // "fullscreen" (default, page keeps scrolling) | "edge" | "always"
  nonFullscreenVertical: "fullscreen",
  gesturePlayWhenPaused: false,      // a gesture on a paused video stays paused
  // Suppress the site's native double-click seek: many players jump ±10s on
  // dblclick, which doubled up with Gestio's own double-tap action. Gestio's
  // double tap is driven by the touch/pointer stream, not DOM dblclick, so
  // blocking it is independent and safe.
  blockNativeDoubleClick: true,
  // A-B loop
  abLoopEnabled: false,
  abShortcutsEnabled: true,
  // Stop-after-N-passes: the count must live here too — readSettings() merges
  // these defaults over stored blobs, so a key missing here can never be
  // restored for a device whose storage predates the field (the options page
  // then renders an empty "Loop count" box).
  abMaxLoopsOn: false,
  abMaxLoopsCount: 3,
  // On-screen A-B bar: faded while the loop is running (it is a status
  // read-out then), clear while it is idle (it is a control then).
  abPanelOpacityOn: 0.55,
  abPanelOpacityOff: 0.95,
  // Whether the A-B bar is currently tucked away is NOT a setting: it is a
  // per-page choice (see gesture.js readAbHidden), so one page's Hide button
  // cannot silence the bar on every other site.
  // video detection
  minVideoSize: 100,
  minVideoArea: 40000,               // ignore tiny players
  // advanced tuning
  moveThreshold: 10,
  directionThreshold: 15,
  velocityThreshold: 0.3,            // flick-to-seek sensitivity
  velocitySmoothing: 0.3,
  speedStep: 0.25,
  clickBlockTimeout: 200,
  sideBarWidth: 4,
  sideBarHeightRatio: 0.6,
  sideBarMargin: 16,
  sideBarHideDelay: 800,
  thumbDisplayWidth: 160,
  thumbDisplayHeight: 90,
  longPressIndicatorOpacity: 0.55,
  lockBtnSize: 44,
  nativeEventBlocking: false,        // block page touch events on player
  siteEventBlocking: {},             // { "example.com": true }
  gestureBlacklist: [],              // domains where gestures are disabled
  siteRules: [],                     // { match, enabled, actions }
  swipeSeekFreeAllowed: true,
  abShortcuts: {
    toggle: "Alt+L", setA: "[", setB: "]", clear: "\\", togglePause: "P",
    adjustABack: "Shift+[", adjustAForward: "Shift+]",
    adjustBBack: "Ctrl+[", adjustBForward: "Ctrl+]"
  },
  // misc
};

const SETTINGS_KEY = "gestio_settings_v1";
const CONFIG_PREFIX = "gestio_cfg:";

async function readSettings() {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = obj[SETTINGS_KEY] || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function writeSettings(partial) {
  const current = await readSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

async function resetSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = obj[SETTINGS_KEY];
  if (!stored) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } });
    return;
  }
  if (!details || details.reason !== "update") return;

  // Defaults that changed after release need a migration, otherwise the stored
  // old value wins (readSettings merges defaults, it does not override). Both
  // are gated on `previousVersion` so they run exactly once for a given jump:
  // without the gate every later update would resurrect the new default and
  // silently undo a user who switched the option back.
  const prev = String(details.previousVersion || "0");
  const older = (v) => {
    const a = prev.split(".").map(Number), b = v.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
    }
    return false;
  };

  const patch = {};
  // 1.0.11: gesture shield ON by default (was off).
  if (older("1.0.11") && stored.gestureShield === false) patch.gestureShield = true;
  // 1.0.19: volume boost OFF by default (was on).
  if (older("1.0.19") && stored.volumeBoostEnabled === true) patch.volumeBoostEnabled = false;

  if (Object.keys(patch).length) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...stored, ...patch } });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const run = async () => {
    if (!msg || typeof msg.action !== "string") return { ok: false };
    switch (msg.action) {
      case "ping":
        return { pong: true };
      case "get_default_settings":
        return { ok: true, settings: { ...DEFAULT_SETTINGS } };
      case "get_settings":
        return { ok: true, settings: await readSettings() };
      case "set_settings":
        return { ok: true, settings: await writeSettings(msg.settings || {}) };
      case "reset_settings":
        return { ok: true, settings: await resetSettings() };
      case "get_config": {
        const key = CONFIG_PREFIX + (msg.key || "");
        const obj = await chrome.storage.local.get(key);
        return { ok: true, value: obj[key] ?? null };
      }
      case "set_config": {
        const key = CONFIG_PREFIX + (msg.key || "");
        await chrome.storage.local.set({ [key]: msg.value });
        return { ok: true };
      }
      case "delete_config": {
        const key = CONFIG_PREFIX + (msg.key || "");
        await chrome.storage.local.remove(key);
        return { ok: true };
      }
      case "open_options":
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        return { ok: false, error: "unknown action" };
    }
  };
  run().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
