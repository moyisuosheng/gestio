/*
 * Gestio — content script (ISOLATED world)
 * Clean-room implementation of touch/pointer video gestures.
 * Features: long-press speed boost + lock, swipe seek w/ preview, vertical
 * swipe volume/brightness, double-tap zones, Alt+wheel seek, A-B loop.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // 0. helpers / i18n
  // ---------------------------------------------------------------------------
  const I18N_FALLBACK = {
    gestureSpeedLocked: "Locked $SPEED$x",
    gestureSpeedRestored: "Restored $SPEED$x speed",
    gestureSpeedExited: "Speed off · $SPEED$x",
    gestureSpeedForwarding: "$SPEED$x Fast Forward",
    gestureSeekHint: "Release to seek",
    gestureSeekCancel: "Swipe down to cancel",
    gestureSeekCancelHint: "Release to cancel seek",
    gestureSeekCancelled: "Seek cancelled",
    gestureLockOn: "Brightness & volume locked",
    gestureLockOff: "Brightness & volume unlocked",
    gestureLockVolume: "Volume locked",
    gestureLockBrightness: "Brightness locked",
    gestureLockVolumeOff: "Volume unlocked",
    gestureLockBrightnessOff: "Brightness unlocked",
    gestureVolumeBoostHint: "Boost to $MAX$%",
    gestureUnlockHint: "Swipe down to exit speed",
    gestureLockHint: "Swipe up to lock speed",
    lockBtnOn: "Playback locked · tap the padlock to release",
    lockBtnOff: "Playback unlocked",
    lockBtnPin: "Lock playback",
    lockBtnRelease: "Unlock playback",
    gestureDragHint: "drag to re-tune",
    gestureReleaseLock: "Release to lock speed",
    gestureReleaseUnlock: "Release to exit speed",
    abLoopEnabled: "A-B Loop enabled",
    abLoopDisabled: "A-B Loop disabled",
    abLoopCleared: "Loop cleared",
    abLoopTooShort: "Too short (min 0.5s)",
    abLoopMaxReached: "Loop stopped · count reached",
    abMarksReady: "tap ⟳ or press P to loop",
    abGuideSetA: "Mark loop start",
    abGuideSetB: "Mark loop end",
    abStart: "Start A-B loop",
    abStopLoop: "Stop the A-B loop",
    abNoVideo: "No video on this page",
    abClearTitle: "Clear A and B",
    abHideTitle: "Hide the panel on this page (bring it back from the extension popup)",
    abPanelShown: "A-B panel shown",
    abPanelHiddenHint: "Panel hidden on this page · bring it back from the extension popup",
    abDragTitle: "Drag to move · tap A / B to set the points"
  };
  // Built-in Chinese table for on-video hints. Used when the user explicitly
  // selects Chinese; "auto" keeps relying on chrome.i18n (browser UI language).
  const I18N_ZH = {
    gestureSpeedLocked: "已锁定 $SPEED$x 倍速",
    gestureSpeedRestored: "已恢复 $SPEED$x 倍速",
    gestureSpeedExited: "已退出倍速 · $SPEED$x",
    gestureSpeedForwarding: "$SPEED$x 倍速快进中",
    gestureSeekHint: "松手跳转",
    gestureSeekCancel: "下滑取消",
    gestureSeekCancelHint: "松手取消跳转",
    gestureSeekCancelled: "已取消跳转",
    gestureLockOn: "已锁定亮度与音量",
    gestureLockOff: "已解除亮度与音量锁定",
    gestureLockVolume: "已锁定音量",
    gestureLockBrightness: "已锁定亮度",
    gestureLockVolumeOff: "已解锁音量",
    gestureLockBrightnessOff: "已解锁亮度",
    gestureVolumeBoostHint: "增强至 $MAX$%",
    gestureUnlockHint: "下滑退出倍速",
    gestureLockHint: "上滑锁定倍速",
    lockBtnOn: "已锁定播放 · 点锁形按钮解除",
    lockBtnOff: "已解除播放锁定",
    lockBtnPin: "锁定播放",
    lockBtnRelease: "解除播放锁定",
    gestureDragHint: "左右拖动调速",
    gestureReleaseLock: "松开以锁定当前倍速",
    gestureReleaseUnlock: "松开以解除倍速锁定",
    abLoopEnabled: "A-B 循环已启用",
    abLoopDisabled: "A-B 循环已关闭",
    abLoopCleared: "循环已清除",
    abLoopTooShort: "区间太短（最小 0.5 秒）",
    abLoopMaxReached: "已达设定次数 · 循环停止",
    abMarksReady: "点 ⟳ 或按 P 开始循环",
    abGuideSetA: "标记循环起点",
    abGuideSetB: "标记循环终点",
    abStart: "开始 A-B 循环",
    abStopLoop: "停止 A-B 循环",
    abNoVideo: "这一页没有视频",
    abClearTitle: "清除 A、B 标记",
    abHideTitle: "在本页隐藏面板（可从扩展弹窗里恢复）",
    abPanelShown: "A-B 面板已显示",
    abPanelHiddenHint: "面板已在本页隐藏 · 可从扩展弹窗里恢复",
    abDragTitle: "长按拖动可移位置 · 点 A / B 标记起止"
  };
  // Effective language: an explicit zh_CN / en always wins; "auto" follows the
  // browser UI and is resolved ONCE, then cached for the life of the script.
  //
  // Why the cache is not optional: reloading (or updating) the extension tears
  // down the extension context of every content script that is already running.
  // From that moment `chrome.i18n.getUILanguage()` throws "Extension context
  // invalidated"; the old code caught that and returned "en", so every on-video
  // hint silently switched to English until the page itself was reloaded — the
  // exact symptom of "装了新版，提示变英文了，刷新一下又好了". The page keeps its
  // `navigator.language` in that state, and whatever we resolved before the
  // teardown is still the right answer, so remember it and never downgrade.
  let autoLang = null;
  const autoLangNow = () => {
    if (autoLang) return autoLang;
    // Last resort = navigator.language: it survives an invalidated extension
    // context, and it is the user's own locale rather than the page's.
    const sources = [];
    try { if (chrome.i18n && chrome.i18n.getUILanguage) sources.push(chrome.i18n.getUILanguage()); } catch (_) {}
    try { sources.push(navigator.language); } catch (_) {}
    try { if (navigator.languages) sources.push(navigator.languages[0]); } catch (_) {}
    const hit = sources.find((s) => typeof s === "string" && s);
    if (!hit) return null; // every source is dead: don't cache a guess
    autoLang = /^zh/i.test(hit) ? "zh_CN" : "en";
    return autoLang;
  };
  const effectiveLang = () => {
    const lang = (typeof S !== "undefined" && S && S.language) || "auto";
    if (lang === "zh_CN" || lang === "en") return lang;
    return autoLangNow() || "en";
  };
  const t = (key, vars) => {
    let s;
    const lang = effectiveLang();
    if (lang === "zh_CN") {
      s = I18N_ZH[key];
    } else if (lang === "en") {
      // Force English even when the browser UI is Chinese: never use getMessage.
      s = I18N_FALLBACK[key];
    } else {
      try { s = chrome.i18n.getMessage(key); } catch (_) {}
      if (!s) s = I18N_FALLBACK[key];
    }
    if (!s) s = I18N_FALLBACK[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("$" + k + "$").join(String(v));
    return s;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isMobile = (() => {
    try {
      return ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
        (matchMedia("(pointer:coarse)").matches || /android|iphone|ipad|mobile/i.test(navigator.userAgent));
    } catch (_) { return false; }
  })();

  // ---------------------------------------------------------------------------
  // 1. settings (loaded from background, with offline fallback)
  // ---------------------------------------------------------------------------
  // MV3 service workers are ephemeral: a message can fail while the worker is
  // asleep/restarting. We keep a complete fallback here so the extension
  // ALWAYS works with sane defaults even if messaging hiccups.
  const FALLBACK_SETTINGS = {
    enabled: true,
    language: "auto", longPressEnabled: true, longPressSpeed: 2, longPressDelay: 300, longPressDelayMobile: 450,
    longPressLockEnabled: true, longPressLockSwipeDistance: 40, longPressDragEnabled: true,
    longPressDragWhileLocked: true,
    longPressDragSensitivity: 45, longPressMoveDeadzone: 20, longPressDirectionRatio: 1.5,
    swipeSeekEnabled: true, swipeSeekSensitivity: 30, maxSeekRatio: 1, seekCancelSwipeDistance: 40,
    swipeSeekFreeAllowed: true,
    // Brightness/volume-only lock: vertical swipes are ignored while seek and
    // long-press speed keep working. Toggled by a two-finger tap.
    lockVerticalSwipe: false, lockVerticalTarget: "both", twoFingerLockEnabled: true,
    // Where vertical volume/brightness swipes are allowed: "fullscreen" (only
    // in real fullscreen; a windowed player keeps page scrolling), "edge"
    // (windowed, but only from the video's side lanes) or "always".
    nonFullscreenVertical: "fullscreen",
    // Do gestures start playback on a paused video? Off by default: the value
    // changes either way, and a paused picture should stay still.
    gesturePlayWhenPaused: false,
    doubleTapEnabled: true, doubleTapInterval: 300, doubleTapSeekDuration: 10,
    doubleTapAccumulateEnabled: false, doubleTapFullscreenEnabled: true,
    oneHandedMode: "right", gridLayout: "3x1", gestureAreaRatio: 0.8,
    leftDoubleTap: "seekBackward", centerDoubleTap: "playPause", rightDoubleTap: "seekForward",
    leftVerticalSwipe: "brightness", centerVerticalSwipe: "none", rightVerticalSwipe: "volume",
    autoRotateFullscreen: false, gestureLockEnabled: false, lockQuickMenuEnabled: true,
    lockButtonPosition: "auto",
    wheelSeekEnabled: true, wheelSeekDuration: 5, wheelDebounce: 200,
    volumeBoostEnabled: false, volumeBoostMax: 300, brightnessMin: 5, brightnessMax: 100,
    thumbnailPreviewEnabled: true, hapticFeedbackEnabled: true, gestureShield: true,
    abLoopEnabled: false, abShortcutsEnabled: true, abMaxLoopsOn: false, abMaxLoopsCount: 3, minVideoSize: 100,
    hintOpacity: 1,
    minVideoArea: 40000, moveThreshold: 10, directionThreshold: 15,
    velocityThreshold: 0.3, velocitySmoothing: 0.3, speedStep: 0.25,
    clickBlockTimeout: 200, sideBarWidth: 4, sideBarHeightRatio: 0.6,
    sideBarMargin: 16, sideBarHideDelay: 800, thumbDisplayWidth: 160,
    thumbDisplayHeight: 90, longPressIndicatorOpacity: 0.55, lockBtnSize: 44,
    nativeEventBlocking: false, siteEventBlocking: {}, gestureBlacklist: [],
    siteRules: [],
    abShortcuts: { toggle:"Alt+L", setA:"[", setB:"]", clear:"\\", togglePause:"P",
      adjustABack:"Shift+[", adjustAForward:"Shift+]", adjustBBack:"Ctrl+[", adjustBForward:"Ctrl+]" }
  };
  let S = null;
  const SETTINGS_KEY = "gestio_settings_v1";
  // Direct storage read, bypassing the service worker. On Android the worker is
  // killed aggressively; a failed message used to drop us back to the fallback
  // set (language "auto" → English HUD) even though the user had picked 中文.
  const readStoredSettings = async () => {
    try {
      if (!chrome.storage || !chrome.storage.local) return null;
      const obj = await chrome.storage.local.get(SETTINGS_KEY);
      return (obj && obj[SETTINGS_KEY]) || null;
    } catch (_) { return null; }
  };
  const getSettings = async () => {
    const prev = S;
    try {
      const r = await chrome.runtime.sendMessage({ action: "get_settings" });
      if (!r || !r.settings) throw new Error("no settings");
      S = { ...FALLBACK_SETTINGS, ...r.settings };
    } catch (_) {
      const stored = await readStoredSettings();
      const keep = stored || (prev && prev.language ? { language: prev.language } : null) || {};
      S = { ...FALLBACK_SETTINGS, ...keep };
    }
    return S;
  };
  const loadConfig = async (key) => {
    try {
      const r = await chrome.runtime.sendMessage({ action: "get_config", key });
      return r && r.ok ? r.value : null;
    } catch (_) { return null; }
  };
  const saveConfig = (key, value) =>
    chrome.runtime.sendMessage({ action: "set_config", key, value }).catch(() => {});

  // --- one-handed presets & grid layout (settings resolver) ------------------
  // Right-handed preset = original mapping. Left-handed mirrors the zones so
  // the same physical thumb motion keeps the same meaning. "custom" uses the
  // per-zone values chosen in the options page.
  const PRESETS = {
    right: {
      leftDoubleTap: "seekBackward", centerDoubleTap: "playPause", rightDoubleTap: "seekForward",
      leftVerticalSwipe: "brightness", centerVerticalSwipe: "none", rightVerticalSwipe: "volume"
    },
    left: {
      leftDoubleTap: "seekForward", centerDoubleTap: "playPause", rightDoubleTap: "seekBackward",
      leftVerticalSwipe: "volume", centerVerticalSwipe: "none", rightVerticalSwipe: "brightness"
    }
  };
  const ZONE_KEYS = /^(left|center|right)(DoubleTap|VerticalSwipe)$/;
  // Resolve a setting, applying one-handed presets for zone-action keys.
  const gset = (key) => {
    if (!S) return undefined;
    const mode = S.oneHandedMode || "right";
    if (mode !== "custom" && ZONE_KEYS.test(key) && PRESETS[mode] && PRESETS[mode][key] !== undefined) {
      return PRESETS[mode][key];
    }
    // "auto" (default) follows the preferred hand; an explicit left/right wins.
    // The old code returned the hand mode unconditionally, which made the
    // selector in the options page dead unless "Custom" was chosen.
    if (key === "lockButtonPosition") {
      const v = S[key];
      if (!v || v === "auto") return mode === "custom" ? "left" : mode;
      return v;
    }
    return S[key];
  };

  // ---------------------------------------------------------------------------
  // 2. video detection
  // ---------------------------------------------------------------------------
  const validVideo = (v) => {
    if (!v || v.tagName !== "VIDEO") return false;
    const min = S ? S.minVideoSize : 100;
    const r = v.getBoundingClientRect();
    if (r.width < min || r.height < min) return false;
    const minArea = S ? (S.minVideoArea || 0) : 0;
    if (minArea > 0 && r.width * r.height < minArea) return false;
    // Live streams and not-yet-loaded videos can report Infinity / NaN.
    // Only reject a *definitely* short finite clip; otherwise accept.
    if (Number.isFinite(v.duration) && v.duration > 0 && v.duration <= 1) return false;
    try {
      const st = getComputedStyle(v);
      if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) return false;
    } catch (_) {}
    return true;
  };

  // Return the video element for a gesture at (x, y). We deliberately do NOT
  // require the point to land on the <video> node itself: real players cover
  // it with control bars / click-capturing layers. Snapping to the nearest
  // enclosing video (or the largest visible one) is what makes gestures work.
  const findVideo = (x, y, strict = false) => {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) {
      if (fs.tagName === "VIDEO" && validVideo(fs)) return fs;
      const inner = fs.querySelector ? fs.querySelector("video") : null;
      if (validVideo(inner)) return inner;
    }
    // 1) exact video under the point (incl. shadow roots)
    const el = deepElementFromPoint(x, y);
    if (el) {
      if (el.tagName === "VIDEO" && validVideo(el)) return el;
      let node = el, guard = 0;
      while (node && guard++ < 8) {
        const vids = node.querySelectorAll ? node.querySelectorAll("video") : [];
        for (const v of vids) {
          if (!validVideo(v)) continue;
          const r = v.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
        }
        node = node.parentElement || (node.getRootNode && node.getRootNode().host);
      }
    }
    if (strict) return null;
    // 2) any video whose rectangle contains the point
    const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
    const vids = collectVideos().filter(validVideo).filter((v) => {
      const r = v.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (vids.length) {
      const playing = vids.filter((v) => !v.paused && !v.ended);
      const pool = playing.length ? playing : vids;
      return pool.reduce((a, b) => (area(b) > area(a) ? b : a), pool[0]);
    }
    return null;
  };

  const isUI = (el) => {
    if (!el || !el.closest) return false;
    // Only our own overlays are always ignored. We intentionally do NOT block
    // on generic [role=button]/<button> here: many players wrap the ENTIRE
    // video in such an element, which would disable every gesture. The video
    // finder already snaps clicks on player controls to the underlying video.
    return !!el.closest('[class*="gestio"],[data-gestio]');
  };

  // find video under a point, including shadow roots
  const deepElementFromPoint = (x, y) => {
    let el = document.elementFromPoint(x, y);
    let last = null;
    let depth = 0;
    while (el && depth++ < 6) {
      last = el;
      if (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (inner && inner !== el) { el = inner; continue; }
      }
      break;
    }
    return last || el;
  };

  const collectVideos = () => {
    const out = [];
    const walk = (root) => {
      try { root.querySelectorAll("video").forEach((v) => out.push(v)); } catch (_) {}
      let all = [];
      try { all = root.querySelectorAll("*"); } catch (_) {}
      for (const el of all) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  };

  // ---------------------------------------------------------------------------
  // 2b. fullscreen-aware UI host
  // ---------------------------------------------------------------------------
  // On mobile browsers (Android Edge / Chrome), <video> fullscreen uses the
  // native "video fullscreen" top layer. Normal DOM with z-index:2147483647
  // still renders BELOW that top layer, so overlays appended to <body> vanish.
  // The fix is to promote a transparent <div popover="manual"> into the SAME
  // top layer via showPopover() and mount all UI inside it. When fullscreen is
  // a normal element (desktop) we mount into that element directly; otherwise
  // we fall back to document.body.
  const FS_EVENT = (typeof document !== "undefined" && "onfullscreenchange" in document)
    ? "fullscreenchange" : "webkitfullscreenchange";
  const supportsPopover = (typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.showPopover === "function");
  let topLayerHost = null;
  const uiHosts = []; // every top-level UI element that must live in the active host

  const fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function ensureTopLayerHost() {
    if (!supportsPopover) return null;
    if (topLayerHost && topLayerHost.isConnected) return topLayerHost;
    topLayerHost = document.createElement("div");
    topLayerHost.setAttribute("popover", "manual");
    topLayerHost.setAttribute("data-gestio", "toplayer");
    topLayerHost.style.cssText = [
      "position:fixed", "inset:0", "margin:0", "padding:0", "border:none",
      "background:transparent", "overflow:visible", "width:100vw", "height:100vh",
      "pointer-events:none"
    ].join(";");
    (document.body || document.documentElement).appendChild(topLayerHost);
    return topLayerHost;
  }

  // What the popover was last promoted for. Re-showing is what moves us above
  // the fullscreen element (last one into the top layer wins), but a
  // hide/show pair cancels any pointer sequence in flight inside the popover —
  // so it only happens when the fullscreen element actually changed, or when a
  // caller explicitly asks for it.
  let topLayerFor = null;
  function promoteTopLayer(force) {
    if (!topLayerHost || !supportsPopover) return;
    const fs = fullscreenEl();
    let open = false;
    try { open = !!(topLayerHost.matches && topLayerHost.matches(":popover-open")); } catch (_) {}
    if (!force && open && topLayerFor === fs) return;
    topLayerFor = fs;
    try { topLayerHost.hidePopover(); } catch (_) {}
    try { topLayerHost.showPopover(); } catch (_) {}
  }

  // Returns the element that all Gestio UI should be mounted into right now.
  function activeUiHost() {
    const fs = fullscreenEl();
    if (!fs) { hideTopLayer(); return document.body || document.documentElement; }
    // Native video fullscreen on mobile: the video itself is the fullscreen
    // element (or webkitDisplayingFullscreen). Use the top-layer popover.
    if (fs.tagName === "VIDEO" || fs.webkitDisplayingFullscreen) {
      const h = ensureTopLayerHost();
      if (h) { promoteTopLayer(); return h; }
      // No popover support (old WebView): best-effort mount into the video's
      // parent container so the UI at least stays within the fullscreen subtree.
      return fs.parentElement || document.body || document.documentElement;
    }
    // Standard container fullscreen: mount inside the fullscreen element.
    hideTopLayer();
    return fs;
  }

  function hideTopLayer() {
    if (!topLayerHost || !supportsPopover) return;
    topLayerFor = null;
    try { topLayerHost.hidePopover(); } catch (_) {}
  }

  // Mount a top-level UI element into the active host (re-parent if needed).
  function mountUi(el) {
    if (!el) return;
    if (uiHosts.indexOf(el) < 0) uiHosts.push(el);
    const host = activeUiHost();
    if (el.parentElement !== host) {
      try { host.appendChild(el); } catch (_) {}
    }
  }

  // Re-home all UI whenever fullscreen state changes. This is the critical
  // piece that keeps the HUD/AB-panel/lock visible when entering Android video
  // fullscreen (they get moved from <body> into the top-layer popover).
  function relocateUiForFullscreen() {
    // Re-parenting (or a hide/show of the popover) kills an open pointer
    // sequence, which is how a hold started just before a fullscreen toggle
    // used to leave the bar permanently unreachable. Close it first.
    try { if (AB && AB.cancelStroke) AB.cancelStroke(); } catch (_) {}
    const host = activeUiHost();
    for (const el of uiHosts) {
      if (el && el.parentElement !== host) {
        try { host.appendChild(el); } catch (_) {}
      }
    }
  }

  // Guard: some sites remove unknown children of the fullscreen host. Re-attach
  // our UI if it gets detached (bounded retry with a MutationObserver).
  let uiGuard = null, uiGuardRetries = 0, uiGuardTimer = 0;
  function ensureUiGuard() {
    if (uiGuard || typeof MutationObserver === "undefined") return;
    uiGuard = new MutationObserver(() => {
      let detached = uiHosts.some((el) => el && !el.isConnected);
      if (!detached) return;
      if (uiGuardRetries >= 10) return;
      uiGuardRetries++;
      clearTimeout(uiGuardTimer);
      uiGuardTimer = setTimeout(() => { uiGuardRetries = 0; }, 5000);
      relocateUiForFullscreen();
    });
    try {
      uiGuard.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
  }
  // ---------------------------------------------------------------------------
  // 2c. touch-action management (mobile fullscreen interaction)
  // ---------------------------------------------------------------------------
  // On Android, a <video> in native fullscreen keeps its default touch-action,
  // so the browser claims drags for scrolling / native seek / pull-to-refresh
  // and fires touchcancel — killing our gesture mid-stroke. Forcing
  // `touch-action:none` on the video + fullscreenElement keeps the stream ours.
  // We mirror that, re-applying after fullscreen transitions with bounded delays
  // because some sites reset the style asynchronously.
  let touchActionTargets = [];
  function applyTouchAction() {
    if (!isMobile) return;
    const fs = fullscreenEl();
    let activeVideo = null;
    try {
      for (const v of collectVideos()) {
        if (!validVideo(v)) continue;
        activeVideo = v;
        break;
      }
    } catch (_) {}
    const targets = [];
    const add = (el) => {
      if (!el || !el.style || targets.indexOf(el) >= 0) return;
      targets.push(el);
    };
    // The fullscreen element and any <video> inside it matter most.
    add(fs);
    if (fs && fs.querySelectorAll) {
      try { fs.querySelectorAll("video").forEach(add); } catch (_) {}
    }
    add(activeVideo);
    // Windowed playback: "none" would kill page scrolling over the whole
    // player. `pan-y` keeps vertical swipes for the page while horizontal
    // drags (swipe-to-seek) still arrive as pointer/touch moves.
    const mode = (S && S.nonFullscreenVertical) || "fullscreen";
    const videoAction = (!fs && mode !== "always") ? "pan-y" : "none";
    // Only touch elements whose current value isn't already the wanted one.
    for (const el of targets) {
      const insideFs = !!(fs && (el === fs || (fs.contains && fs.contains(el))));
      const want = insideFs ? "none" : videoAction;
      const prev = el.style.touchAction;
      if (prev === want) continue;
      const known = touchActionTargets.find((t) => t.el === el);
      el.style.touchAction = want;
      const rec = { el, prev: known ? known.prev : (prev || "") };
      const existing = touchActionTargets.indexOf(known);
      if (existing >= 0) touchActionTargets[existing] = rec;
      else touchActionTargets.push(rec);
    }
  }
  // `touch-action` is read by the browser when a touch STARTS, so setting it
  // inside touchstart is too late for that stroke: the first gesture on a page
  // used to run under the page's own value and Chrome could claim a horizontal
  // drag as a pan. Applying it at boot and whenever a media element shows up
  // means every stroke is evaluated against the value we want.
  let touchActionTimer = 0;
  function scheduleTouchAction(ms = 120) {
    if (!isMobile) return;
    clearTimeout(touchActionTimer);
    touchActionTimer = setTimeout(applyTouchAction, ms);
  }

  function restoreTouchAction() {
    if (!isMobile || !touchActionTargets.length) return;
    for (const { el, prev } of touchActionTargets) {
      try { el.style.touchAction = prev; } catch (_) {}
    }
    touchActionTargets = [];
  }
  let fsTouchTimerIds = [];
  const fsInteractionHandler = () => {
    relocateUiForFullscreen();
    // Fullscreen changes the box the UI lives in: viewport while fullscreen,
    // the video's own rect while windowed.
    layoutHud();
    // The player's own resize animation lands after this event (and some
    // players only settle the video rect a few frames later), so re-place the
    // A-B bar a few times instead of trusting the first measurement.
    [0, 80, 260, 600].forEach((ms) => setTimeout(placeABPanel, ms));
    // The card can be painted but unreachable after the player re-promotes its
    // own overlay (or, on Android, the media surface). Check hit-testing once
    // the transition has settled, then repair it.
    abFixTries = 0;
    [160, 560, 1200].forEach((ms) => setTimeout(verifyABPlacement, ms));
    // clear any pending re-assert timers from a previous transition
    fsTouchTimerIds.forEach(clearTimeout); fsTouchTimerIds = [];
    if (fullscreenEl()) {
      applyTouchAction();
      // Sites sometimes reset touch-action after entering fullscreen; re-assert.
      fsTouchTimerIds = [200, 500, 1000, 1500].map((ms) => setTimeout(applyTouchAction, ms));
    } else {
      // Leaving fullscreen: restore the styles we changed so we don't leave the
      // page permanently altered.
      restoreTouchAction();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener(FS_EVENT, fsInteractionHandler, true);
    // vendor-prefixed event also fires on some Android WebViews
    if (FS_EVENT !== "webkitfullscreenchange") {
      document.addEventListener("webkitfullscreenchange", fsInteractionHandler, true);
    }
    // iOS/Android native <video> fullscreen can fire these on the video itself.
    // Listen in capture phase on document so we catch them without per-video wiring.
    ["webkitbeginfullscreen", "webkitendfullscreen"].forEach((evt) => {
      document.addEventListener(evt, fsInteractionHandler, true);
    });
  }

  // ---------------------------------------------------------------------------
  // 3. HUD (overlay created with Shadow DOM to avoid page CSS conflicts)
  // ---------------------------------------------------------------------------
  let hud, hudRoot, hintEl, centerEl, tiersEl = null;
  // The dim layer for the brightness gesture. Lives inside the HUD shadow root
  // as its first child, so it paints under every other HUD element but above
  // the page (and above the video — see setBrightness for why a filter on the
  // <video> itself is not enough).
  let brightVeil = null;
  // Geometry of the box every on-video element is laid out in. Fullscreen:
  // the viewport. Windowed: the video's own rect, clamped to the viewport —
  // a fixed, viewport-sized overlay put the side indicator at right:3vw, which
  // is simply outside a 640px-wide player embedded mid-page.
  let uiRect = { left: 0, top: 0, width: 0, height: 0 };
  let hudVideo = null;
  const videoUiRect = (v) => {
    const vw = (typeof innerWidth === "number" && innerWidth) || 360;
    const vh = (typeof innerHeight === "number" && innerHeight) || 640;
    const full = { left: 0, top: 0, width: vw, height: vh };
    if (!v || fullscreenEl()) return full;
    let r = null;
    try { r = v.getBoundingClientRect(); } catch (_) { return full; }
    if (!r || !(r.width > 16) || !(r.height > 16)) return full;
    const left = clamp(r.left, 0, vw - 16);
    const top = clamp(r.top, 0, vh - 16);
    const right = clamp(r.right, left + 16, vw);
    const bottom = clamp(r.bottom, top + 16, vh);
    return { left, top, width: right - left, height: bottom - top };
  };
  // --- A-B bar placement -----------------------------------------------------
  // The position is stored as an inset (CSS px) from the two nearest player
  // edges. It used to be a fraction of the player width with the bar centred on
  // it, which is not stable across a resize: a bar parked at x=0.82 needs
  // 0.82*640 - w/2 on a 640px windowed player, which overflows and gets
  // clamped, while the same fraction fits easily at 1280px — so every trip to
  // fullscreen (and back) slid the bar sideways. An inset anchored to the right
  // / top edge is identical in both modes, so toggling fullscreen no longer
  // moves it at all. Old fraction values are migrated on read.
  const AB_POS_KEY = "gestio_ab_pos";
  const AB_PAD = 8;
  const AB_DEFAULT = { ax: "r", ay: "t", dx: 14, dy: 12 };
  const abPos = () => {
    let p = null;
    try {
      const raw = localStorage.getItem(AB_POS_KEY);
      if (raw) p = JSON.parse(raw);
    } catch (_) {}
    if (!p || typeof p !== "object") return { ...AB_DEFAULT };
    if (p.ax === "l" || p.ax === "r") {
      return {
        ax: p.ax, ay: p.ay === "b" ? "b" : "t",
        dx: Number.isFinite(p.dx) ? p.dx : AB_DEFAULT.dx,
        dy: Number.isFinite(p.dy) ? p.dy : AB_DEFAULT.dy
      };
    }
    // Stores written before 1.0.29 hold {x,y} as a centre fraction.
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { ax: p.x > 0.5 ? "r" : "l", ay: p.y > 0.5 ? "b" : "t",
        dx: AB_DEFAULT.dx, dy: AB_DEFAULT.dy };
    }
    return { ...AB_DEFAULT };
  };
  const saveAbPos = (p) => {
    try { localStorage.setItem(AB_POS_KEY, JSON.stringify(p)); } catch (_) {}
  };
  // Design size of the card (CSS px, unscaled). It shrank from ~380px: over a
  // 640px windowed player that bar covered half the picture. Scaling is capped
  // at 1 so the card is the same size in fullscreen and only shrinks for small
  // players — with a 0.8 floor so the labels stay legible.
  const AB_W = 276, AB_H = 66;
  const abScale = (rect) =>
    clamp(Math.min((rect.width || 640) / 780, (rect.height || 480) / 300), 0.8, 1);
  // Which video the bar belongs to. A page can have none at all (an article, a
  // listing, a route that has not swapped its player in yet) and the bar must
  // not appear there, so this is re-evaluated on a timer instead of trusting
  // "abLoopEnabled is on, therefore show the panel".
  // Scanning the page for <video> (including shadow roots) is a full DOM walk,
  // and this runs on scroll and on a 240ms tick — so the result is cached for a
  // moment. A removed element is still caught: it stops being connected and its
  // rect collapses, so validVideo() rejects it on the next read.
  let abScanAt = 0, abScanHit = [];
  const abScanVideos = () => {
    const now = Date.now();
    if (now - abScanAt < 700) return abScanHit;
    abScanAt = now;
    try { abScanHit = collectVideos().filter(validVideo); } catch (_) { abScanHit = []; }
    return abScanHit;
  };
  const abPickVideo = () => {
    if (AB.video && AB.video.isConnected && validVideo(AB.video)) return AB.video;
    let pool = abScanVideos();
    if (pool.length === 1 && pool[0].isConnected) return pool[0];
    pool = pool.filter((v) => v.isConnected && validVideo(v));
    if (!pool.length) return null;
    const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
    const playing = pool.filter((v) => !v.paused && !v.ended);
    const pick = playing.length ? playing : pool;
    return pick.reduce((a, b) => (area(b) > area(a) ? b : a), pick[0]);
  };
  // The bar has to measure the player itself instead of reading `uiRect`: that
  // value is only filled in when a gesture starts (or the HUD is laid out), so
  // a page that merely has abLoopEnabled kept the viewport rect and parked the
  // bar outside a small embedded player.
  const abRect = () => videoUiRect(abPickVideo());

  // offsetWidth is the unscaled layout box, which is what the scaled card must
  // be positioned against. It reads 0 while the panel sits in a hidden popover,
  // so the last good measurement is kept instead of falling back to a guess
  // (guessing 380px against a 276px card is what shifted the clamp sideways).
  const abSize = (p, s) => {
    const w = p.offsetWidth, h = p.offsetHeight;
    if (w > 0 && h > 0) AB.measured = { w, h };
    const base = AB.measured || { w: AB_W, h: AB_H };
    return { w: base.w * s, h: base.h * s };
  };

  // Screen bounds the bar may live in. It is deliberately the viewport, not the
  // player: a windowed player is usually surrounded by page, and the bar was
  // pinned inside the picture so it could never be moved out of the way (or
  // onto a black bar). In fullscreen the two are the same box.
  const viewBounds = () => {
    const vw = (typeof innerWidth === "number" && innerWidth) || 360;
    const vh = (typeof innerHeight === "number" && innerHeight) || 640;
    return { left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh };
  };

  function placeABPanel() {
    const p = AB.panel;
    if (!p) return;
    // No player on this page: keep the bar out of the picture entirely instead
    // of parking it in a corner of the viewport.
    const vid = abPickVideo();
    if (!vid && !fullscreenEl()) {
      if (p.style.display !== "none") p.style.display = "none";
      return;
    }
    if (p.style.display === "none") p.style.display = "";
    const rect = videoUiRect(vid);
    const s = abScale(rect);
    p.style.transformOrigin = "top left";
    p.style.transform = "scale(" + s.toFixed(3) + ")";
    AB.scale = s;
    const size = abSize(p, s);
    const pos = AB.pos || abPos();
    const vb = viewBounds();
    const maxL = Math.max(AB_PAD, vb.width - size.w - AB_PAD);
    const maxT = Math.max(AB_PAD, vb.height - size.h - AB_PAD);
    // Default anchoring stays relative to the player (so it sits on the
    // picture when nothing has been dragged yet); the clamp is the viewport.
    const wantL = pos.ax === "r" ? rect.left + rect.width - pos.dx - size.w : rect.left + pos.dx;
    const wantT = pos.ay === "b" ? rect.top + rect.height - pos.dy - size.h : rect.top + pos.dy;
    const left = Math.round(clamp(wantL, AB_PAD, maxL));
    const top = Math.round(clamp(wantT, AB_PAD, maxT));
    p.style.left = left + "px";
    p.style.top = top + "px";
    p.style.right = "auto";
    p.style.bottom = "auto";
    AB.lastPlaced = { left, top, w: size.w, h: size.h };
    // A transformed ancestor (some players run their fullscreen container with
    // `transform`) makes `position:fixed` resolve against that box rather than
    // the viewport, which is another way the bar drifted right on fullscreen.
    // Measure the result once and cancel the difference.
    let got = null;
    try { got = p.getBoundingClientRect(); } catch (_) {}
    if (got && got.width > 0) {
      const dx = got.left - left, dy = got.top - top;
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
        p.style.left = Math.round(left - dx) + "px";
        p.style.top = Math.round(top - dy) + "px";
        AB.lastPlaced.left = left - dx;
        AB.lastPlaced.top = top - dy;
      }
    }
  }

  // Is the card actually reachable, or merely painted? `elementFromPoint`
  // reports the topmost hit-testable box, so anything but us coming back while
  // the card is on screen means something above it is eating the input.
  function abReachable() {
    const p = AB.panel;
    if (!p || !p.isConnected || p.style.display === "none") return true;
    let r = null;
    try { r = p.getBoundingClientRect(); } catch (_) {}
    if (!r || r.width < 8 || r.height < 8) return true;
    const x = Math.round(r.left + Math.min(48, r.width / 2));
    const y = Math.round(r.top + r.height / 2);
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;
    let el = null;
    try { el = document.elementFromPoint(x, y); } catch (_) {}
    return !el || el === p || p.contains(el);
  }

  // Runs a few times after a fullscreen transition, when the player is most
  // likely to have pushed its own overlay over the card. Re-promoting moves the
  // whole popover to the end of the top layer, which puts us back on top.
  let abFixTries = 0;
  function verifyABPlacement() {
    if (abReachable()) { abFixTries = 0; return; }
    const p = AB.panel;
    if (!p || abFixTries >= 2) return;
    abFixTries++;
    promoteTopLayer(true);
    placeABPanel();
    // One retry: on Android the player promotes its overlay asynchronously, so
    // the first re-promote can still land under it. (The card is deliberately
    // NOT moved out of the top layer here — under the media surface it would
    // simply stop being painted, which is a worse failure than a dead tap.)
    setTimeout(() => {
      if (abReachable()) { abFixTries = 0; return; }
      promoteTopLayer(true);
      placeABPanel();
    }, 130);
  }

  // Re-size the HUD to the video. Called on press, on scroll/resize and on
  // fullscreen transitions; cheap enough to run per frame if needed.
  function layoutHud(v) {
    if (v) hudVideo = v;
    uiRect = videoUiRect(hudVideo);
    // The A-B bar is a separate host, so it must be placed even before the HUD
    // exists — returning early here left it on its initial CSS offsets, which
    // is why it drifted sideways (and never scaled) on a fullscreen toggle.
    placeABPanel();
    if (!hud) return;
    hud.style.left = uiRect.left + "px";
    hud.style.top = uiRect.top + "px";
    hud.style.width = uiRect.width + "px";
    hud.style.height = uiRect.height + "px";
    hud.style.right = "auto";
    hud.style.bottom = "auto";
    // The playback lock is a click-veil, not a page overlay: over a windowed
    // player it used to block the whole page.
    if (lockHost) {
      lockHost.style.left = uiRect.left + "px";
      lockHost.style.top = uiRect.top + "px";
      lockHost.style.width = uiRect.width + "px";
      lockHost.style.height = uiRect.height + "px";
      lockHost.style.right = "auto";
      lockHost.style.bottom = "auto";
    }
  }
  let layoutRaf = 0;
  const scheduleLayout = () => {
    if (layoutRaf) return;
    if (typeof requestAnimationFrame !== "function") { layoutHud(); return; }
    layoutRaf = requestAnimationFrame(() => { layoutRaf = 0; layoutHud(); });
  };
  function ensureHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.setAttribute("data-gestio", "hud");
    Object.assign(hud.style, {
      position: "fixed", inset: "0", zIndex: "2147483647",
      pointerEvents: "none", fontFamily: "system-ui, sans-serif"
    });
    hudRoot = hud.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .hint{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);
        background:rgba(0,0,0,.78);color:#fff;padding:8px 16px;border-radius:22px;
        font-size:15px;letter-spacing:.3px;white-space:nowrap;transition:opacity .18s;opacity:0}
      /* configured solidity beats the generic .show{opacity:1}: a settings
         value of .5 must still fade out to 0 through the same transition. */
      .hint.show{opacity:var(--hint-o,1)}
      .center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:rgba(0,0,0,.7);color:#fff;padding:14px 24px;border-radius:14px;
        font-size:34px;font-weight:600;text-align:center;min-width:120px;transition:opacity .18s;opacity:0}
      .show{opacity:1}
      /* Speed tiers — a transparent row at
         the top of the video, only the active tier gets a pill + chevrons.
         Visibility is driven ONLY by .show; the configured opacity is applied
         to the inactive labels through a variable, never to the container
         (an inline container opacity used to override .show and pin the row
         on screen forever). */
      .tiers{position:absolute;top:8%;left:50%;transform:translateX(-50%) scale(.9);
        display:flex;align-items:center;gap:clamp(6px,2.2vw,18px);background:transparent;
        padding:4px 0;opacity:0;transition:opacity .3s ease,transform .3s ease;white-space:nowrap;
        max-width:96vw;pointer-events:none}
      .tiers.show{opacity:1;transform:translateX(-50%) scale(1)}
      .tiers .t{color:rgba(255,255,255,.85);opacity:var(--vw-tier-op,.55);font-size:13px;font-weight:500;
        padding:3px 7px;border-radius:20px;transition:color .2s,background .2s,opacity .2s;
        display:inline-flex;align-items:center}
      .tiers .t.active{background:rgba(255,255,255,.2);color:#fff;font-weight:600;font-size:15px;
        padding:6px 13px;opacity:1}
      .tiers .chev{display:inline-flex;align-items:center}
      .tiers .chev svg{width:10px;height:10px;display:block}
      .tiers .chev+.chev{margin-left:-3px}
      .tiers .chev:nth-child(1){animation:vw-c1 .9s ease-out infinite}
      .tiers .chev:nth-child(2){animation:vw-c2 .9s ease-out infinite}
      @keyframes vw-c1{0%,100%{opacity:.15}5%,78%{opacity:1}}
      @keyframes vw-c2{0%,20%{opacity:.15}25%,78%{opacity:1}}
      /* Volume / brightness meters — two independent cards, one per edge, so
         the finger never covers the one being changed and the pair never
         fights over a single position. Each carries its own number: the old
         shared bar only had an icon, which made "how loud is it now" a guess. */
      .meter{position:absolute;top:50%;transform:translateY(-50%) scale(.94);
        display:flex;flex-direction:column;align-items:center;gap:7px;
        padding:9px 7px;border-radius:14px;background:rgba(0,0,0,.55);color:#fff;
        font:11px/1 system-ui,sans-serif;letter-spacing:.2px;opacity:0;
        pointer-events:none;transition:opacity .18s ease,transform .18s ease;
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
      .meter.show{opacity:1;transform:translateY(-50%) scale(1)}
      .meter.bright{left:var(--m-margin,16px)}
      .meter.vol{right:var(--m-margin,16px)}
      .meter .mi{display:flex;opacity:.92}
      .meter .mi svg{width:15px;height:15px;display:block}
      .meter .mt{position:relative;border-radius:999px;background:rgba(255,255,255,.22);min-height:20px}
      .meter .mf{position:absolute;left:0;right:0;bottom:0;border-radius:999px;
        background:#fff;transition:height .05s linear}
      /* 100% mark: only drawn while a boost makes the bar longer than "loud". */
      .meter .m100{position:absolute;left:-5px;right:-5px;height:2px;border-radius:2px;
        background:rgba(255,255,255,.85);display:none}
      /* Fixed width, not min-width: the card is content-sized, so a label that
         grew from "99%" to "100%" made it 1.4px wider and the whole meter
         jittered sideways at that exact step. 34px clears the widest label a
         boost can produce ("600%") with room for a different system font;
         tabular-nums keeps every digit the same width in between. */
      .meter .mp{font-size:11px;font-weight:600;width:34px;text-align:center;
        font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.95}
      /* Seek preview — a big clock card over a thin track with two dots:
         a big "target / duration" clock over a thin track carrying the current
         (white) and target (blue) dots. This replaces the old plain "+12s"
         line, which gave no sense of where the jump actually lands. */
      .seekcard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);
        background:rgba(0,0,0,.45);border-radius:8px;padding:10px 12px;color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;text-align:center;
        min-width:212px;max-width:86vw;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
        opacity:0;transition:opacity .16s ease,transform .16s ease;pointer-events:none;user-select:none}
      .seekcard.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
      .seekcard.cancelled{opacity:.5}
      .seekcard .stime{font-weight:600;font-size:16px;letter-spacing:.5px;margin-bottom:6px;
        font-variant-numeric:tabular-nums;
        text-shadow:0 1px 4px rgba(0,0,0,.8),0 0 8px rgba(0,0,0,.5)}
      .seekcard .prow{display:flex;align-items:center;gap:6px;padding:0 2px}
      .seekcard .ptime{font-size:10px;color:rgba(255,255,255,.6);white-space:nowrap;
        font-variant-numeric:tabular-nums;min-width:32px}
      .seekcard .ptime.left{text-align:right}
      .seekcard .ptime.right{text-align:left}
      .seekcard .ptrack{flex:1;position:relative;height:3px;
        background:rgba(255,255,255,.2);border-radius:1.5px;min-width:112px}
      .seekcard .pfill{position:absolute;top:0;left:0;height:100%;background:rgba(255,255,255,.5);
        border-radius:1.5px;transition:width .1s linear}
      .seekcard .pdot{position:absolute;top:50%;width:7px;height:7px;border-radius:50%;
        transform:translate(-50%,-50%);transition:left .1s linear}
      .seekcard .pdot.cur{background:#fff;box-shadow:0 0 2px rgba(0,0,0,.5);z-index:2}
      .seekcard .pdot.tgt{background:#4fc3f7;box-shadow:0 0 4px rgba(79,195,247,.6);
        width:9px;height:9px;z-index:3}
      .seekcard.cancelled .pdot.tgt{background:#ff8a80;box-shadow:0 0 4px rgba(255,138,128,.6)}
      /* Lock badge — shown when the brightness/volume lock is toggled */
      .lockbadge{position:absolute;top:14%;left:50%;transform:translateX(-50%) scale(.94);
        display:flex;align-items:center;gap:6px;
        background:rgba(0,0,0,.72);color:#fff;padding:7px 15px;border-radius:20px;
        font-size:13px;letter-spacing:.2px;white-space:nowrap;opacity:0;
        transition:opacity .18s ease,transform .18s ease}
      .lockbadge svg{flex:none;opacity:.92}
      .lockbadge.show{opacity:1;transform:translateX(-50%) scale(1)}
      /* Brightness veil. Dimming with a CSS filter on the <video> is invisible
         in Android native fullscreen: the frames are handed straight to a
         hardware surface the CSS pipeline never touches, so the meter moved
         while the picture stayed exactly as bright. This black veil sits in
         the HUD, which does render above that surface, so dimming is always
         visible; the filter on the element is kept only for the >100% side,
         where a black overlay has nothing to offer. */
      .bright-veil{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
    `;
    hudRoot.appendChild(style);
    brightVeil = document.createElement("div");
    brightVeil.className = "bright-veil";
    hudRoot.insertBefore(brightVeil, hudRoot.firstChild);
    hintEl = document.createElement("div"); hintEl.className = "hint";
    centerEl = document.createElement("div"); centerEl.className = "center";
    tiersEl = document.createElement("div"); tiersEl.className = "tiers";
    hudRoot.appendChild(hintEl); hudRoot.appendChild(centerEl);
    hudRoot.appendChild(tiersEl);
    mountUi(hud);
    ensureUiGuard();
    layoutHud();
  }
  let hintTimer, centerTimer;
  const showHint = (msg, ms = 900) => {
    ensureHud();
    hintEl.textContent = msg;
    // Solidity comes from settings (hintOpacity, stored 0.3–1); a missing or
    // junk value falls back to fully solid.
    hintEl.style.setProperty("--hint-o",
      String(clamp(Number(S && S.hintOpacity) || 1, 0.15, 1)));
    hintEl.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove("show"), ms);
  };
  const hideHint = () => { clearTimeout(hintTimer); if (hintEl) hintEl.classList.remove("show"); };

  // ---------------------------------------------------------------------------
  // 3b. seek preview card
  // ---------------------------------------------------------------------------
  // Values refresh on a 250ms tick while the card is up, so the elapsed clock
  // keeps counting even when the finger stops moving.
  let seekCardEl = null, seekTimeEl = null, seekLeftEl = null, seekRightEl = null,
    seekFillEl = null, seekCurEl = null, seekTgtEl = null;
  let seekCardVideo = null, seekCardTarget = 0, seekCardRef = 0, seekCardTimer = 0;
  const ensureSeekCard = () => {
    ensureHud();
    if (seekCardEl) return;
    seekCardEl = document.createElement("div"); seekCardEl.className = "seekcard";
    seekTimeEl = document.createElement("div"); seekTimeEl.className = "stime";
    const row = document.createElement("div"); row.className = "prow";
    seekLeftEl = document.createElement("span"); seekLeftEl.className = "ptime left";
    const track = document.createElement("div"); track.className = "ptrack";
    seekFillEl = document.createElement("div"); seekFillEl.className = "pfill";
    seekCurEl = document.createElement("div"); seekCurEl.className = "pdot cur";
    seekTgtEl = document.createElement("div"); seekTgtEl.className = "pdot tgt";
    track.appendChild(seekFillEl); track.appendChild(seekCurEl); track.appendChild(seekTgtEl);
    seekRightEl = document.createElement("span"); seekRightEl.className = "ptime right";
    row.appendChild(seekLeftEl); row.appendChild(track); row.appendChild(seekRightEl);
    seekCardEl.appendChild(seekTimeEl); seekCardEl.appendChild(row);
    hudRoot.appendChild(seekCardEl);
  };
  const paintSeekCard = () => {
    const v = seekCardVideo;
    if (!v || !seekCardEl) return;
    const dur = (Number.isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
    // The white dot is the REFERENCE the jump is measured from (the playhead
    // when the finger went down), not the live playhead: the gesture keeps the
    // video playing, so a live value made the white dot crawl forward while the
    // blue target followed the finger — both dots appeared to move together.
    const cur = seekCardRef;
    seekTimeEl.textContent = fmtTime(seekCardTarget) + " / " + fmtTime(dur);
    seekLeftEl.textContent = fmtTime(cur);
    seekRightEl.textContent = fmtTime(dur);
    const cp = dur ? clamp(cur / dur * 100, 0, 100) : 0;
    const tp = dur ? clamp(seekCardTarget / dur * 100, 0, 100) : 0;
    seekFillEl.style.width = cp + "%";
    seekCurEl.style.left = cp + "%";
    seekTgtEl.style.left = tp + "%";
  };
  const showSeekCard = (v, target, cancelled, ref) => {
    ensureSeekCard();
    seekCardVideo = v; seekCardTarget = target;
    if (Number.isFinite(ref)) seekCardRef = ref;
    seekCardEl.classList.toggle("cancelled", !!cancelled);
    paintSeekCard();
    seekCardEl.classList.add("show");
    if (!seekCardTimer) seekCardTimer = setInterval(paintSeekCard, 250);
  };
  const hideSeekCard = () => {
    if (seekCardTimer) { clearInterval(seekCardTimer); seekCardTimer = 0; }
    seekCardVideo = null;
    if (seekCardEl) { seekCardEl.classList.remove("show"); seekCardEl.classList.remove("cancelled"); }
  };
  let lockBadgeEl = null, lockBadgeTimer = 0;
  // Drawn padlocks instead of emoji: consistent with the settings page icons
  // and immune to whatever emoji font the page happens to load.
  const LOCK_GLYPH =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="5" y="10.4" width="14" height="9.6" rx="2.4"/>' +
    '<path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/></svg>';
  const UNLOCK_GLYPH =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="5" y="10.4" width="14" height="9.6" rx="2.4"/>' +
    '<path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.4-1.2"/></svg>';
  const flashLockBadge = (on, target) => {
    ensureHud();
    if (!lockBadgeEl) {
      lockBadgeEl = document.createElement("div"); lockBadgeEl.className = "lockbadge";
      hudRoot.appendChild(lockBadgeEl);
    }
    // `target` is the half that just changed, so the badge names that slider
    // instead of repeating the aggregate state.
    const key = on
      ? (target === "volume" ? "gestureLockVolume" : target === "brightness" ? "gestureLockBrightness" : "gestureLockOn")
      : (target === "volume" ? "gestureLockVolumeOff" : target === "brightness" ? "gestureLockBrightnessOff" : "gestureLockOff");
    lockBadgeEl.textContent = "";
    lockBadgeEl.insertAdjacentHTML("afterbegin", on ? LOCK_GLYPH : UNLOCK_GLYPH);
    const label = document.createElement("span");
    label.textContent = t(key);
    lockBadgeEl.appendChild(label);
    lockBadgeEl.classList.add("show");
    clearTimeout(lockBadgeTimer);
    lockBadgeTimer = setTimeout(() => lockBadgeEl.classList.remove("show"), 1500);
  };
  const showCenter = (msg, ms = 700) => {
    ensureHud();
    centerEl.textContent = msg; centerEl.classList.add("show");
    clearTimeout(centerTimer);
    centerTimer = setTimeout(() => centerEl.classList.remove("show"), ms);
  };
  // Speed-tier indicator: show all tiers with the active one highlighted.
  // The current rate is appended when it is not one of the preset tiers, so
  // fine-grained dragging (e.g. 1.75x) still has a highlighted value.
  let tiersTimer = 0, tiersHideTimer = 0, tiersSuppressed = false;
  // Hard ceiling for the sweep below: a stroke whose end event never arrives
  // at all gets cleaned up after this long, live or not.
  const TIER_SWEEP_MAX_MS = 90000;
  const fmtRate = (x) => String(+(Math.round(x * 100) / 100));
  // Hiding must NOT depend on CSS: if any rule, inline style or page style
  // overrides the class, the row would stay on screen. `display:none` is an
  // inline property that cannot be overridden by a page, and the `suppressed`
  // latch makes sure a late touchmove (Android fires a few after the lift)
  // cannot resurrect the row before the next press.
  const hideTiers = () => {
    clearTimeout(tiersTimer);
    tiersSuppressed = true;
    if (tiersEl) tiersEl.classList.remove("show");
    clearTimeout(tiersHideTimer);
    tiersHideTimer = setTimeout(() => {
      if (tiersEl && !tiersEl.classList.contains("show")) tiersEl.style.display = "none";
    }, 220);
  };
  // Two small chevrons are painted inside the active tier.
  const CHEV = '<span class="chev"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">'
    + '<path d="M8 5v14l11-7z"/></svg></span>';
  const showTiers = (active) => {
    if (tiersSuppressed) {
      // The latch stops a late post-lift touchmove (Android fires a few) from
      // resurrecting the row. A LIVE speed hold is the opposite case: its
      // moves are real feedback, and a mid-hold hide — a tab switch, or the
      // 3s sweep below before it learned to defer — must not leave the hold
      // blind, so a hold re-arms here instead.
      const c = currentStroke();
      if (!(c && c.s && c.s.active && c.s.longPressTriggered)) return;
      tiersSuppressed = false;
    }
    ensureHud();
    const all = tierList(active);
    // On a narrow phone the full ladder would overflow the viewport, so show a
    // 5-tier window centred on the active value — the same "few big pills"
    // feel as a 3-tier row, without losing the ability to reach every step.
    const i = tierIndex(all, active);
    const narrow = (typeof innerWidth === "number" ? innerWidth : 400) < 430;
    let from = 0, to = all.length;
    if (narrow && all.length > 5) { from = clamp(i - 2, 0, all.length - 5); to = from + 5; }
    const tiers = all.slice(from, to);
    const html = tiers.map((x) => {
      const on = Math.abs(x - active) < 0.01;
      return `<span class="t${on ? " active" : ""}">${on ? CHEV + CHEV : ""}${fmtRate(x)}x</span>`;
    }).join("");
    // Rebuilding the row on every move frame causes needless layout churn.
    if (tiersEl._html !== html) { tiersEl.innerHTML = html; tiersEl._html = html; }
    // opacity only affects the inactive labels (see CSS); the container's own
    // opacity stays under the control of .show
    tiersEl.style.setProperty("--vw-tier-op", String(clamp(S ? (S.longPressIndicatorOpacity ?? 0.55) : 0.55, 0.2, 1)));
    clearTimeout(tiersHideTimer);
    if (tiersEl.style.display === "none") {
      tiersEl.style.display = "flex";
      void tiersEl.offsetWidth; // force reflow so the fade-in replays
    }
    tiersEl.classList.add("show");
    // Safety auto-hide: native-fullscreen builds sometimes swallow the end
    // event, which used to leave the indicator stuck on screen forever. A
    // LIVE speed hold defers the sweep instead of dying under it: a
    // stationary hold produces no moves, so the plain 3s hide fired mid-hold
    // on every motionless long press — exactly "the UI disappears after a
    // while even though I never lifted my finger". The deferral is bounded
    // by TIER_SWEEP_MAX_MS so a truly lost finger is still cleaned up.
    clearTimeout(tiersTimer);
    const tiersShownAt = Date.now();
    tiersTimer = setTimeout(function sweep() {
      const c = currentStroke();
      const live = !!(c && c.s && c.s.active && c.s.longPressTriggered);
      if (live && Date.now() - tiersShownAt < TIER_SWEEP_MAX_MS) { tiersTimer = setTimeout(sweep, 3000); return; }
      hideTiers();
    }, 3000);
  };
  // --- volume / brightness meters -------------------------------------------
  // One card per slider: brightness pinned to the left edge, volume to the
  // right. They are separate elements with separate fade timers, so a stroke
  // never reuses the other slider's geometry, and each shows its own value as
  // a percentage instead of an icon that only hints at "somewhere in between".
  const SUN_GLYPH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7' +
    'M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/></svg>';
  const VOL_GLYPH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.4h2.8L11 6v12L6.8 14.6H4z"/>' +
    '<path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.6 6.6a8 8 0 0 1 0 10.8"/></svg>';
  const meters = { brightness: null, volume: null };
  const meterTimers = { brightness: 0, volume: 0 };
  const ensureMeter = (kind) => {
    ensureHud();
    if (meters[kind]) return meters[kind];
    const el = document.createElement("div");
    el.className = "meter " + (kind === "brightness" ? "bright" : "vol");
    el.setAttribute("data-gestio-meter", kind);
    const ic = document.createElement("div");
    ic.className = "mi";
    ic.innerHTML = kind === "brightness" ? SUN_GLYPH : VOL_GLYPH;
    const track = document.createElement("div");
    track.className = "mt";
    const fill = document.createElement("div");
    fill.className = "mf";
    const mark = document.createElement("div");
    mark.className = "m100";
    track.appendChild(fill);
    track.appendChild(mark);
    const pct = document.createElement("div");
    pct.className = "mp";
    pct.textContent = "0%";
    el.appendChild(ic); el.appendChild(track); el.appendChild(pct);
    hudRoot.appendChild(el);
    meters[kind] = { el, track, fill, mark, pct };
    return meters[kind];
  };
  // `percent` is the real value shown to the user (0..600 for a boosted
  // volume); `fillPct` is where the bar ends, relative to the maximum the
  // slider can reach. `markPct` draws the 100% notch when the bar can go past
  // "normal maximum" — without it a 300% boost squeezed 100% down to a third
  // of the track and the scale stopped meaning anything.
  const showMeter = (kind, percent, fillPct, markPct) => {
    const m = ensureMeter(kind);
    const hudH = uiRect.height || (typeof innerHeight === "number" ? innerHeight : 640);
    const ratio = clamp(S ? (S.sideBarHeightRatio ?? 0.6) : 0.6, 0.15, 1);
    // Card chrome (icon + gaps + number + padding) is ~78px. Cap the track so a
    // short windowed player still fits the whole card.
    const trackH = Math.max(40, Math.min(Math.round(hudH * ratio), Math.round(hudH) - 78));
    m.track.style.height = trackH + "px";
    m.track.style.width = clamp(Number(S && S.sideBarWidth) || 4, 2, 14) + "px";
    m.el.style.setProperty("--m-margin", clamp(S ? (S.sideBarMargin ?? 16) : 16, 0, 80) + "px");
    m.fill.style.height = clamp(fillPct, 0, 100) + "%";
    m.pct.textContent = Math.round(clamp(percent, 0, 999)) + "%";
    if (Number.isFinite(markPct)) {
      m.mark.style.display = "block";
      m.mark.style.bottom = clamp(markPct, 0, 100) + "%";
    } else {
      m.mark.style.display = "none";
    }
    m.el.classList.add("show");
    clearTimeout(meterTimers[kind]);
    meterTimers[kind] = setTimeout(() => m.el.classList.remove("show"),
      (S ? (S.sideBarHideDelay || 800) : 800));
  };
  const hideMeters = () => {
    for (const kind of Object.keys(meters)) {
      const m = meters[kind];
      if (!m) continue;
      clearTimeout(meterTimers[kind]);
      m.el.classList.remove("show");
    }
  };
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
                 : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const vibrate = (ms = 12) => {
    if (S && S.hapticFeedbackEnabled && navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
  };

  // ---------------------------------------------------------------------------
  // 4. actions
  // ---------------------------------------------------------------------------
  const doSeek = (v, target) => {
    target = clamp(target, 0, v.duration || 0);
    try {
      if (typeof v.fastSeek === "function" && Math.abs(target - v.currentTime) > 1) v.fastSeek(target);
      else v.currentTime = target;
    } catch (_) { try { v.currentTime = target; } catch (_) {} }
  };

  // --- accumulating double taps ----------------------------------------------
  // With `doubleTapAccumulateEnabled` a burst of taps in the same zone adds one
  // step each, and the seek is applied ONCE — when the burst ends. Applying
  // every step as it arrives is wrong twice over: three taps seek +10s then
  // +20s and land on +30s while the hint promises +20s, and the jump happens on
  // the second tap, so a burst can never grow past its first pair.
  const pendingTapSeek = (() => {
    let timer = 0, video = null, dir = 1, total = 0;
    const clear = () => { if (timer) clearTimeout(timer); timer = 0; video = null; total = 0; };
    return {
      clear,
      // One entry per tap after the first; each call replaces the pending jump
      // with the larger total and restarts the "the burst is over" timer.
      add(v, direction, seconds) {
        clear();
        video = v; dir = direction > 0 ? 1 : -1; total = seconds;
        timer = setTimeout(() => {
          const vid = video, sign = dir, amount = total;
          timer = 0; video = null; total = 0;
          if (!vid || !amount) return;
          doSeek(vid, vid.currentTime + sign * amount);
          showHint((sign > 0 ? "+" : "−") + amount + "s", 1200);
        }, Math.max(160, (S && S.doubleTapInterval ? S.doubleTapInterval : 300) + 40));
      }
    };
  })();

  // Discrete tier table — the usual rates plus the base long-press speed and
  // the current value, with a slightly denser ladder so in-between rates stay
  // reachable. Dragging moves exactly ONE tier per `longPressDragSensitivity`
  // px, which makes the mapping predictable instead of progressive.
  const BASE_TIERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  const tierList = (extra) => {
    const set = new Set(BASE_TIERS);
    if (S && Number.isFinite(S.longPressSpeed)) set.add(S.longPressSpeed);
    if (Number.isFinite(extra)) set.add(extra);
    return [...set].filter((x) => x >= 0.25 && x <= 16).sort((a, b) => a - b);
  };
  const tierIndex = (list, rate) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i] - rate);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  // --- speed lock: one source of truth --------------------------------------
  // main-world.js pins HTMLMediaElement.playbackRate to the
  // `data-gestio-rate` attribute, but that attribute only says "a pin
  // exists" — not which speed the user last chose. Keeping the value in memory
  // is what lets a second long press re-enter the hold at the LOCKED speed
  // instead of falling back to the configured boost value (which reads as
  // "my 4x keeps resetting to 2x"). baseRate remembers where to go back to
  // when the speed is exited.
  let lockedRate = null;   // last locked speed, null = no lock
  let baseRate = 1;        // speed to restore when the user exits speed mode
  const pinAttr = () => {
    try { return document.documentElement.dataset.gestioRate; } catch (_) { return null; }
  };
  // Adopt a pin this session did not create (stale attribute left by an older
  // code path) so the locked value is never silently lost.
  const readLockedRate = () => {
    if (lockedRate == null) {
      const raw = pinAttr();
      const n = raw == null ? NaN : parseFloat(raw);
      if (Number.isFinite(n) && n > 0) lockedRate = n;
    }
    return lockedRate;
  };
  const isSpeedLocked = () => readLockedRate() != null;
  const pinRate = (v, rate) => {
    const next = Number(rate);
    if (!Number.isFinite(next) || next <= 0) return;
    try { document.documentElement.dataset.gestioRate = String(next); } catch (_) {}
    lockedRate = next;
    try { v.playbackRate = next; } catch (_) {}
  };
  const unpinRate = (v) => {
    try { delete document.documentElement.dataset.gestioRate; } catch (_) {}
    lockedRate = null;
  };
  // Strict "hold to preview" semantics block rate dragging while a rate is
  // locked: the only move there is swipe-down-to-unlock. That is correct for a
  // preview, but annoying when you just want 4x -> 2x and stay locked, so it is
  // an explicit option (default on). Off restores the strict behaviour.
  const lockedDragAllowed = () => !!S && S.longPressDragWhileLocked !== false;
  // Single write path for the playback rate. While a pin is active
  // main-world.js coerces EVERY assignment to the pinned value, so the pin has
  // to be moved FIRST — otherwise the drag looks like it does nothing and the
  // release then restores the old locked speed.
  const setRate = (v, rate, tick) => {
    if (lockedRate != null) {
      // A lock is active: move the pin first (main-world coerces the write to
      // the pinned value) and keep it in sync, because a page or a full page
      // re-render may have dropped the attribute in the meantime.
      try { document.documentElement.dataset.gestioRate = String(rate); } catch (_) {}
      lockedRate = rate;
    }
    try { v.playbackRate = rate; } catch (_) {}
    showTiers(rate);
    if (tick) vibrate(10); // one short haptic tick per tier
  };
  // Swipe down: leave speed mode entirely and hand playback back to the rate
  // that was running before the lock (1x unless the site was already faster).
  const exitSpeed = (v) => {
    const back = (Number.isFinite(baseRate) && baseRate > 0) ? baseRate : 1;
    unpinRate(v);
    try { v.playbackRate = back; } catch (_) {}
    showHint(t("gestureSpeedExited", { SPEED: fmtRate(back) }), 1400);
  };
  // Enter the long-press speed hold. The anchor is the LOCKED speed when there
  // is one — the hold must never fall back to the boost value, or the user sees
  // the lock as "lost" the moment they long press again.
  const beginSpeedHold = (v, s) => {
    const locked = isSpeedLocked();
    if (!locked) {
      // Captured before we touch the rate: a site playing at 1.25x must not be
      // forced to 1x when the user later swipes down to exit.
      const cur = Number(v.playbackRate);
      if (Number.isFinite(cur) && cur > 0) baseRate = cur;
    }
    const anchorRate = locked ? readLockedRate() : (S.longPressSpeed || 2);
    const anchorTiers = tierList(anchorRate);
    s.speedAnchorRate = anchorRate;
    s.speedAnchorIndex = tierIndex(anchorTiers, anchorRate);
    s.speedTierCount = anchorTiers.length;
    setRate(v, anchorRate);
    // When the rate was already locked the hint has to be the unlock one
    // ("swipe down to exit speed") — not "swipe up to lock" again.
    const hint = locked
      ? "↓ " + t("gestureUnlockHint") + (lockedDragAllowed() ? " · " + t("gestureDragHint") : "")
      : (S.longPressLockEnabled ? "↑ " + t("gestureLockHint") : t("gestureSpeedForwarding", { SPEED: fmtRate(anchorRate) }));
    showHint(hint, 1600);
  };

  // Web Audio volume boost chain (per video). Two rules learned the hard way:
  //
  // 1. LAZY. `createMediaElementSource` is irreversible: from that moment the
  //    element's audio only reaches the speakers through this graph (resampled
  //    to the AudioContext rate, with no way back). Building it just because the
  //    user nudged the volume down rerouted audio for the rest of the session.
  //    Only a real boost (gain > 1) may create it.
  // 2. The compressor is a BOOST-ONLY effect and must leave the path at gain 1.
  //    Measured (OfflineAudioContext, 440 Hz + partials, 200 ms loud/quiet):
  //    Chrome's DynamicsCompressor does NOT sit idle at unity gain — the
  //    -24 dB / 12:1 curve turned a 33 dB dynamic range into 15 dB and made
  //    quiet passages ~7x louder, i.e. an obvious "the sound changed" even
  //    though the pitch measured identical (439.9 Hz in, 439.9 Hz out).
  //    The graph is only built when you boost past 100%; ours used to build
  //    it for any volume change, which is what made the sound change.
  const audioChains = new WeakMap();
  function setLimiter(chain, on) {
    if (chain.limited === on) return;
    try {
      chain.gain.disconnect();
      if (on) {
        chain.gain.connect(chain.comp);
        chain.comp.connect(chain.ctx.destination);
      } else {
        chain.comp.disconnect();
        chain.gain.connect(chain.ctx.destination);
      }
      chain.limited = on;
    } catch (_) {}
  }
  function getAudioChain(v) {
    if (audioChains.has(v)) return audioChains.get(v);
    try {
      if (v.mediaKeys) return null; // DRM: don't route through Web Audio
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(v);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.ratio.value = 12;
      src.connect(gain);
      gain.connect(ctx.destination); // unity gain: audio stays out of the comp
      const chain = { ctx, src, gain, comp, limited: false };
      audioChains.set(v, chain);
      return chain;
    } catch (_) { return null; }
  }
  function setBoost(v, mul) {
    if (!(mul > 1.0001)) {
      // Plain volume (<= 100%): release an existing boost but never build a graph.
      const chain = audioChains.get(v);
      if (chain) {
        try { chain.gain.gain.setTargetAtTime(1, chain.ctx.currentTime, 0.015); } catch (_) {}
        setLimiter(chain, false);
      }
      return true;
    }
    const chain = getAudioChain(v);
    if (!chain) return false;
    try {
      setLimiter(chain, true);
      chain.gain.gain.setTargetAtTime(mul, chain.ctx.currentTime, 0.015);
      if (chain.ctx.state === "suspended") chain.ctx.resume().catch(() => {});
      return true;
    } catch (_) { return false; }
  }
  // Effective volume = v.volume (capped at 1 by the platform) × boost gain.
  // Without this cache a boost of 200% reads back as 100% on the next gesture,
  // so the first vertical swipe after buffing the volume jumped back to 100%.
  const boostCache = new WeakMap();
  const gainOf = (v) => {
    const g = boostCache.get(v);
    return Number.isFinite(g) && g > 0 ? g : 1;
  };
  const effectiveVolume = (v) => clamp((Number(v.volume) || 0) * gainOf(v), 0, 6);
  const setVolume = (v, vol) => {
    const max = (S && S.volumeBoostEnabled) ? (S.volumeBoostMax / 100) : 1;
    vol = clamp(vol, 0, max);
    if (vol <= 1) {
      boostCache.set(v, 1);
      v.volume = vol;
      if (vol > 0 && v.muted) v.muted = false;
      setBoost(v, 1);
    } else {
      v.volume = 1;
      if (v.muted) v.muted = false;
      if (!setBoost(v, vol)) {
        // fall back to native max if Web Audio unavailable
        boostCache.set(v, 1);
        v.volume = 1;
      } else {
        boostCache.set(v, vol);
      }
    }
    return vol;
  };

  const filterCache = new WeakMap();
  const brightnessCache = new WeakMap();
  function setBrightness(v, pct) {
    pct = clamp(pct, S ? S.brightnessMin : 5, S ? S.brightnessMax : 100);
    // Dimming is drawn by the HUD veil (see .bright-veil); the filter on the
    // element is only kept for the brightening side, where a black overlay
    // cannot help. The two must never stack, so crossing 100% in either
    // direction cleans up after the other one.
    if (!hud) ensureHud();
    if (brightVeil) brightVeil.style.opacity = pct < 100 ? ((100 - pct) / 100).toFixed(3) : "0";
    if (pct > 100) {
      let base = filterCache.get(v);
      if (base === undefined) { base = v.style.filter || ""; filterCache.set(v, base); }
      const cleaned = base.replace(/brightness\([^)]*\)\s*/g, "").trim();
      v.style.filter = (cleaned ? cleaned + " " : "") + `brightness(${pct / 100})`;
    } else if (/brightness\(/.test(v.style.filter || "")) {
      // Dropping back to <=100% must also remove a filter an earlier stroke
      // (or a >100% pass) left behind.
      if (!filterCache.has(v)) filterCache.set(v, v.style.filter || "");
      const cleaned = filterCache.get(v).replace(/brightness\([^)]*\)\s*/g, "").trim();
      v.style.filter = cleaned;
    }
    brightnessCache.set(v, pct);
    return pct;
  }

  const togglePlay = (v) => {
    if (v.paused || v.ended) v.play().catch(() => {}); else v.pause();
  };
  const toggleFullscreen = (v) => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        // prefer the player container
        let el = v;
        for (let p = v.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/(player|video|media|plyr|vjs|jwplayer|dplayer|xgplayer|artplayer)/i.test(p.className + " " + p.id)) { el = p; break; }
        }
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) req.call(el);
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      }
    } catch (_) {}
  };

  // ---------------------------------------------------------------------------
  // 5. A-B loop
  // ---------------------------------------------------------------------------
  const AB = {
    video: null, phase: "IDLE", a: null, b: null,
    loopCount: 0, on: false, raf: 0, panel: null,
    // Cached placement state: the stored inset (pos), the last measured card
    // size, the scale the card was last drawn at, where it was put last (for
    // drag offsets) and a short busy window so an in-flight seek cannot
    // retrigger the lap detection.
    pos: null, measured: null, lastPlaced: null, scale: 1, busyUntil: 0, headTimer: 0,
    // Page-local "the user tucked the card away" flag (see abPanelHidden).
    hidden: false
  };
  // The identity of "this page" for anything stored per page. YouTube serves
  // every video from /watch, so there the video id is the page.
  const pageKey = () => {
    let key = location.hostname + location.pathname;
    if (location.hostname.includes("youtube.com")) {
      const m = location.search.match(/[?&]v=([\w-]+)/); if (m) key = "youtube:" + m[1];
    }
    return key;
  };
  const abKey = () => "abloop:" + pageKey();
  // Whether the card is tucked away is a PAGE decision, not a browser-wide
  // preference: hiding it on one site (or on one video) used to hide it
  // everywhere, which read as "the panel disappeared".
  //
  // It lives in sessionStorage, and that is deliberate. Tucking the card away
  // is a transient "not right now" about the picture in front of you, not a
  // preference for all time — a fresh tab should start with the card visible.
  // sessionStorage gives exactly that: it survives a reload of this tab, it is
  // per tab (two tabs of the same episode stop sharing the flag with no
  // bookkeeping at all), and it disappears when the tab closes, so nothing is
  // left behind on disk. It is NOT per page though — same origin, same tab,
  // different paths share one store — which is why the page is still part of
  // the key.
  //
  // One entry holds the map of hidden pages instead of one key per page, and
  // only hidden pages are kept: showing the card deletes its entry again, so
  // the map is as small as the pages the user actually tucked away. No cap —
  // the store belongs to this tab and dies with it.
  const AB_HIDDEN_STORE = "gestio:abpanel";
  const readAbHiddenMap = () => {
    try {
      const raw = sessionStorage.getItem(AB_HIDDEN_STORE);
      const map = raw ? JSON.parse(raw) : null;
      return map && typeof map === "object" ? map : {};
    } catch (_) { return {}; }
  };
  const readAbHidden = (key) => {
    try { return readAbHiddenMap()[key || pageKey()] === 1; } catch (_) { return false; }
  };
  const writeAbHidden = (hidden, key) => {
    const id = key || pageKey();
    try {
      const map = readAbHiddenMap();
      if (hidden) map[id] = 1; else delete map[id];
      if (Object.keys(map).length) sessionStorage.setItem(AB_HIDDEN_STORE, JSON.stringify(map));
      else sessionStorage.removeItem(AB_HIDDEN_STORE);
    } catch (_) {}
  };
  // A page always opens NOT looping. What is remembered for a page is the
  // segment (A, B), so the bar comes back with the same marks — but the loop
  // itself is started by the button and by nothing else. Restoring it "on" used
  // to make a reload, or a new tab on the same video, start repeating a
  // two-minute stretch of the file while the user was watching normally.
  const restoreAB = async () => {
    if (!S || !S.abLoopEnabled) return;
    const data = await loadConfig(abKey());
    if (data && typeof data === "object" && Number.isFinite(data.a) && Number.isFinite(data.b)) {
      AB.a = data.a; AB.b = data.b;
      AB.phase = "IDLE"; AB.on = false;
      updateABPanel();
    }
  };
  let abSaveTimer;
  const persistAB = () => {
    clearTimeout(abSaveTimer);
    abSaveTimer = setTimeout(() => {
      saveConfig(abKey(), { a: AB.a, b: AB.b, url: location.href, title: document.title });
    }, 300);
  };
  // The lap seek has to be exact and single-shot. It used to go through
  // doSeek(), which prefers fastSeek(): that snaps to the nearest keyframe,
  // which can be a second or two BEFORE A — the watch loop then saw
  // `currentTime < A - 0.5` and seeked again, lap after lap. On Android that
  // burst of `seeking` events is exactly what pops the browser's own control
  // bar on every restart (and stutters the picture). A precise seek that lands
  // inside already-buffered data fixes both: one seek, no rebuffer spinner.
  const abJump = (v, target) => {
    let t = target;
    try {
      const b = v.buffered;
      if (b && b.length) {
        let pick = null;
        for (let i = 0; i < b.length; i++) {
          if (t >= b.start(i) - 0.2 && t <= b.end(i) - 0.1) { pick = t; break; }
          // Never aim at a hole in the buffer: the browser would fetch, show
          // its loading UI and wake the native controls.
          if (b.start(i) > t && (pick === null || b.start(i) < pick)) pick = b.start(i);
        }
        if (pick !== null) t = pick;
      }
    } catch (_) {}
    try { v.currentTime = t; } catch (_) {}
  };
  // How many passes before the loop stops itself. 0 = never, and that is the
  // default: not asking for a limit must never produce one. It is read from the
  // settings on every lap instead of being cached in the page, so editing the
  // count (or switching the limit off) applies to the next lap, not the next
  // page load.
  const abLoopLimit = () => {
    if (!S || !S.abMaxLoopsOn) return 0;
    const n = Math.round(Number(S.abMaxLoopsCount));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 0;
  };
  const abWatch = () => {
    cancelAnimationFrame(AB.raf);
    const tick = () => {
      AB.raf = requestAnimationFrame(tick);
      // A page restored from storage has no player yet, and a lazy player can
      // appear a moment later: without this the button could sit green over a
      // loop that never attaches to anything.
      const v = AB.video || abPickVideo();
      if (!AB.on || !v || !validVideo(v)) return;
      AB.video = v;
      if (AB.phase !== "LOOPING" || AB.a === null || AB.b === null) return;
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      // A seek reports intermediate states (`currentTime` still near B, then a
      // jump); checking the condition again inside that window fired a second
      // seek on top of the first. The fixed 400ms window alone is not enough —
      // a slow seek outlives it, the crossing clause re-fires on the stale
      // position and counts a pass that never happened — so a seek that is
      // still in flight also holds the tick off, whatever its duration.
      if (v.seeking || now < AB.busyUntil) return;
      if (v.currentTime >= AB.b - 0.05) {
        AB.loopCount++;
        const limit = abLoopLimit();
        if (limit && AB.loopCount >= limit) {
          // The button has two states, so a finished loop is simply off. A and B
          // stay put: pressing it again repeats the same segment, from a fresh
          // count (abToggle resets loopCount). The playhead is at B, so the
          // last pass has been played in full.
          try { unpinRate(v); } catch (_) {}
          v.pause(); AB.on = false;
          cancelAnimationFrame(AB.raf);
          showHint(t("abLoopMaxReached"));
          updateABPanel();
          return;
        }
        AB.busyUntil = now + 400;
        abJump(v, AB.a);
      } else if (v.currentTime < AB.a - 0.5) {
        // Out of the segment mid-loop (a page seek, a scrub): pull the playhead
        // back. This is not a completed pass, so it does not count towards a
        // limit — with a phantom count, "3 times" would play twice.
        AB.busyUntil = now + 400;
        abJump(v, AB.a);
      }
    };
    AB.raf = requestAnimationFrame(tick);
  };
  const abSetA = () => {
    const v = AB.video || findVideo(innerWidth / 2, innerHeight / 2);
    if (!v) return;
    AB.video = v; AB.a = v.currentTime;
    if (AB.b !== null && AB.b - AB.a < 0.5) { showHint(t("abLoopTooShort")); AB.a = Math.max(0, AB.b - 0.5); }
    // Marks only: A and B place the window, they never start the repeat. A
    // loop that is already running simply keeps going with the new mark (its
    // phase stays LOOPING); otherwise the button waits in its off state until
    // it is pressed — or P is hit.
    if (AB.on) { AB.phase = "LOOPING"; abWatch(); }
    else {
      AB.phase = (AB.b !== null && AB.b > AB.a) ? "READY" : "A_SET";
      cancelAnimationFrame(AB.raf);
    }
    AB.loopCount = 0;
    persistAB(); updateABPanel();
    const both = AB.a !== null && AB.b !== null && AB.b > AB.a;
    showHint(t("abGuideSetA") + ": " + fmtTime(AB.a) + (!AB.on && both ? " · " + t("abMarksReady") : ""));
    vibrate();
  };
  const abSetB = () => {
    const v = AB.video || findVideo(innerWidth / 2, innerHeight / 2);
    if (!v) return;
    AB.video = v;
    if (AB.a === null) { AB.a = v.currentTime; }
    AB.b = v.currentTime;
    if (AB.b - AB.a < 0.5) {
      // auto swap if user tapped B before A chronologically
      if (AB.a > AB.b) { const x = AB.a; AB.a = AB.b; AB.b = x; }
      else { showHint(t("abLoopTooShort")); AB.b = Math.min(v.duration, AB.a + 0.5); }
    }
    // Same rule as A: recording the end never starts the repeat by itself.
    if (AB.on) { AB.phase = "LOOPING"; abWatch(); }
    else {
      AB.phase = AB.b > AB.a ? "READY" : "A_SET";
      cancelAnimationFrame(AB.raf);
    }
    AB.loopCount = 0;
    persistAB(); updateABPanel();
    showHint(t("abGuideSetB") + ": " + fmtTime(AB.b) + (AB.on ? "" : " · " + t("abMarksReady")));
    vibrate();
  };
  // One button, two states: looping or not. There used to be a third (pause),
  // and a press on the running button only paused it — the card then showed a
  // "resume" glyph that looked like a third, half-selected state. Stopping is
  // what people expect from pressing a lit loop button, and the marks stay, so
  // pressing it again resumes the same segment.
  const abToggle = () => {
    if (AB.on) {
      AB.on = false; AB.loopCount = 0;
      cancelAnimationFrame(AB.raf);
      if (AB.video) try { unpinRate(AB.video); } catch (_) {}
      updateABPanel(); showHint(t("abLoopDisabled"));
      return;
    }
    if (AB.a === null || AB.b === null) { showHint(t("abGuideSetA")); return; }
    if (AB.b - AB.a < 0.5) { showHint(t("abLoopTooShort")); return; }
    // The page just came back from storage, so nothing has picked a player yet.
    // Looking at the middle of the viewport was a guess that missed the video
    // whenever the player sits off-centre; the panel's own picker knows better.
    AB.video = abPickVideo() || AB.video;
    if (!AB.video) { showHint(t("abNoVideo")); return; }
    // The phase has to be restored here as well: a page that came back with
    // marks but no running loop sits at IDLE, and the watcher only repeats at
    // LOOPING — turning the button on without it lit the ring and did nothing.
    AB.phase = "LOOPING"; AB.on = true; AB.loopCount = 0;
    // Starting from outside the segment — typically the playhead still sits at
    // B because the user marked it there moments ago — must not count as a
    // completed pass, or "3 times" plays twice. Park at A; the B-crossings
    // that follow are the laps.
    {
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const p = AB.video.currentTime;
      if (p >= AB.b - 0.05 || p < AB.a - 0.5) {
        AB.busyUntil = now + 400;
        abJump(AB.video, AB.a);
      }
    }
    abWatch(); updateABPanel(); showHint(t("abLoopEnabled"));
  };
  // Stop, do not forget: switching the feature off (popup / settings page) has
  // to leave the loop idle, but A and B stay recorded, so turning it back on
  // shows the same segment with the button in its "off" state instead of a
  // green ring that no longer loops anything.
  const abStop = () => {
    const was = AB.on;
    AB.on = false; AB.loopCount = 0;
    cancelAnimationFrame(AB.raf);
    if (was && AB.video) { try { unpinRate(AB.video); } catch (_) {} }
    updateABPanel();
  };
  const abClear = () => {
    AB.a = null; AB.b = null; AB.phase = "IDLE"; AB.on = false;
    cancelAnimationFrame(AB.raf); persistAB(); updateABPanel();
    showHint(t("abLoopCleared"));
  };
  // Tuck the card away. Only the card goes: a running loop keeps looping, and
  // the marks are untouched — it comes back exactly as it was. The flag is per
  // tab AND per page (see readAbHidden), so tucking it away here leaves every
  // other tab and every other video alone. The way back is the popup switch,
  // which now drives this page only.
  const setAbPanelVisible = (v) => {
    const on = !!v;
    AB.hidden = !on;
    writeAbHidden(!on);
    if (on) {
      // Remembering "show it here" is enough while the feature itself is off:
      // the settings broadcast builds the card once the loop is switched on.
      if (!S || !S.abLoopEnabled) return;
      startABTicker();
      ensureABPanel();
      placeABPanel();
      updateABPanel();
      showHint(t("abPanelShown"));
    } else {
      removeABPanel(true);
      showHint(t("abPanelHiddenHint"));
    }
  };
  const abHide = () => setAbPanelVisible(false);
  // Page-local only: there is no browser-wide switch any more, because that is
  // exactly what made one page's choice hide the bar on all of them.
  const abPanelHidden = () => !!AB.hidden;
  const abAdjustA = (d) => { if (AB.a !== null) { AB.a = clamp(AB.a + d, 0, AB.b ?? Infinity); persistAB(); updateABPanel(); } };
  const abAdjustB = (d) => { if (AB.b !== null) { AB.b = clamp(AB.b + d, AB.a ?? 0, Infinity); persistAB(); updateABPanel(); } };

  // Inline SVG keeps the bar crisp at every scale and free of emoji-font
  // fallbacks (the old ⏻ ○ ⏸ ✕ glyph set rendered as tofu on some Android
  // builds and looked like three different icon families at once).
  const AB_ICONS = {
    // Ring of two chasing arrows = "loop", the standard repeat glyph.
    loop: '<svg viewBox="0 0 24 24"><path d="M6.5 9.4a6.1 6.1 0 0 1 10.4-1.6"/><path d="M17.7 4.3v3.7H14"/><path d="M17.5 14.6A6.1 6.1 0 0 1 7.1 16.2"/><path d="M6.3 19.7v-3.7h3.7"/></svg>',
    // A sweeping broom, not a bin or an ✕: both of those read as "delete the
    // loop" / "close the panel", while this control only wipes the A and B
    // marks. Solid shapes (fill) read far better than 1.5px strokes at 13px,
    // hence the mixed style in this one icon.
    clear: '<svg viewBox="0 0 24 24">' +
      '<path d="M12 2.9v4.5" stroke-width="2.5"/>' +
      '<rect x="5.7" y="7.6" width="12.6" height="3.6" rx="1.4" fill="currentColor" stroke="none"/>' +
      '<path d="M8.3 11.4h7.4l1.25 8.2a1.2 1.2 0 0 1-1.19 1.35H8.24a1.2 1.2 0 0 1-1.19-1.35Z" fill="currentColor" stroke="none"/>' +
      // the dust it is sweeping up
      '<path d="M4.4 14.9l1.7.9M3.7 18.6l1.9.35" stroke-width="1.6" opacity=".85"/></svg>',
    // Hide: the ring broken by a slash (the shape from the request). It is the
    // whole card that goes away, and the popup holds the way back.
    hide: '<svg viewBox="0 0 24 24">' +
      '<path d="M18.72 7.29A8.2 8.2 0 0 1 7.29 18.72"/>' +
      '<path d="M5.28 16.71A8.2 8.2 0 0 1 16.71 5.28"/>' +
      '<path d="M4.5 19.5 19.5 4.5"/></svg>'
  };

  // Always hh:mm:ss, so the read-out never changes width mid-gesture (B
  // crossing the ten-minute mark used to shove the timeline sideways).
  const abClock = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  };
  // While the loop runs the bar fades so it stays out of the picture; when it
  // is idle it is clear, because then it is a control you want to see.
  const abOpacity = (live) => {
    const v = S ? S[live ? "abPanelOpacityOn" : "abPanelOpacityOff"] : undefined;
    return clamp(Number.isFinite(v) ? v : (live ? 0.55 : 0.95), 0.1, 1);
  };

  function updateABPanel() {
    const p = AB.panel;
    const r = p && p.shadowRoot;
    if (!r) return;
    const ta = r.getElementById("ta"), tb = r.getElementById("tb");
    if (ta) ta.textContent = "A " + (AB.a === null ? "--:--:--" : abClock(AB.a));
    if (tb) tb.textContent = "B " + (AB.b === null ? "--:--:--" : abClock(AB.b));
    // The bar also shows WHERE the loop sits in the file: the highlighted span
    // between the two pins is the loop window, the dot is the playhead.
    const v = AB.video;
    const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const pctA = dur && AB.a !== null ? clamp(AB.a / dur, 0, 1) : null;
    const pctB = dur && AB.b !== null ? clamp(AB.b / dur, 0, 1) : null;
    const span = r.getElementById("span");
    if (span) {
      if (pctA === null || pctB === null) span.style.opacity = "0";
      else {
        span.style.opacity = ".9";
        span.style.left = (pctA * 100).toFixed(2) + "%";
        span.style.width = Math.max(0, (pctB - pctA) * 100).toFixed(2) + "%";
      }
    }
    for (const [id, pct] of [["pina", pctA], ["pinb", pctB]]) {
      const pin = r.getElementById(id);
      if (!pin) continue;
      if (pct === null) pin.style.display = "none";
      else { pin.style.display = "block"; pin.style.left = (pct * 100).toFixed(2) + "%"; }
    }
    const live = !!AB.on;
    const box = r.querySelector(".box");
    if (box) {
      box.classList.toggle("on", live);
      box.style.opacity = String(abOpacity(live));
    }
    const main = r.getElementById("loop");
    if (main) {
      // Two states, one glyph, two clearly different chips: filled green while
      // the loop runs, an outlined neutral one while it does not. Swapping the
      // glyph — or striking it through — read as a third, "unpressed" look at
      // this size (14px is not enough for a slash over two arrows).
      const st = live ? "on" : "off";
      main.classList.toggle("on", live);
      if (main.getAttribute("data-state") !== st) {
        main.setAttribute("data-state", st);
        main.innerHTML = AB_ICONS.loop;
      }
      main.title = t(live ? "abStopLoop" : "abStart");
      main.setAttribute("aria-label", main.title);
    }
    abHead();
  }

  // Playhead only — driven by a slow interval instead of the loop's animation
  // frame, so normal playback (and seeks made with the page's own controls)
  // keep the dot moving without adding work to every frame.
  function abHead() {
    const p = AB.panel;
    const r = p && p.shadowRoot;
    if (!r) return;
    const track = r.getElementById("track"), hd = r.getElementById("hd");
    const v = AB.video;
    const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (!track || !hd) return;
    if (!dur) { track.classList.remove("live"); return; }
    track.classList.add("live");
    hd.style.left = (clamp(v.currentTime / dur, 0, 1) * 100).toFixed(2) + "%";
  }
  function ensureABPanel() {
    if (AB.panel) return;
    // Hidden from its own button or by the popup switch.
    if (abPanelHidden()) return;
    // Nothing to control on a page without a player: an article or a listing
    // page used to get a floating A-B bar the moment the setting was enabled.
    if (!abPickVideo()) return;
    const host = document.createElement("div");
    host.setAttribute("data-gestio", "abpanel");
    // Left/top are driven by placeABPanel(); touch-action:none keeps a drag
    // from scrolling the page underneath (the bar sits on the player).
    Object.assign(host.style, {
      position: "fixed", zIndex: "2147483647", left: "0px", top: "0px",
      pointerEvents: "auto", transformOrigin: "top left", touchAction: "none", cursor: "grab"
    });
    const root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    // One glass card, two rows: the loop window (read-out + mini timeline) on
    // top, the controls on the bottom. Widths are fixed so the card scales as a
    // unit and never re-flows while a finger is on it.
    st.textContent = `
      :host{all:initial;display:block;contain:layout style}
      *{box-sizing:border-box}
      .box{--a:#9ed3ff;--b:#ffd7a4;position:relative;display:flex;flex-direction:column;gap:6px;
        width:${AB_W}px;padding:8px 9px;border-radius:14px;color:#fff;
        font:12px/1.15 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
        background:linear-gradient(180deg,rgba(32,32,36,.9),rgba(12,12,14,.93));
        border:1px solid rgba(255,255,255,.11);
        box-shadow:0 10px 26px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.07);
        -webkit-backdrop-filter:blur(14px) saturate(140%);backdrop-filter:blur(14px) saturate(140%);
        -webkit-user-select:none;user-select:none;cursor:grab;
        transition:box-shadow .16s ease,border-color .16s ease,opacity .16s ease}
      .box.dragging{cursor:grabbing;border-color:rgba(255,255,255,.24);
        box-shadow:0 18px 36px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.09)}
      /* The idle/looping opacity is set inline from the two settings; any
         direct interaction brings the card back to full strength so it is
         never a struggle to hit a button on a faded bar. */
      .box:hover,.box.dragging{opacity:1!important}
      .head{display:flex;align-items:center;gap:8px}
      .grip{flex:0 0 auto;display:grid;grid-template-columns:repeat(2,3px);grid-auto-rows:3px;gap:2px;
        padding:2px 1px;opacity:.38}
      .grip i{width:3px;height:3px;border-radius:50%;background:#fff}
      #label{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0}
      .t{flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;
        color:rgba(255,255,255,.92)}
      .t.a{color:var(--a)}
      .t.b{color:var(--b)}
      .track{position:relative;flex:1 1 auto;min-width:30px;height:6px;border-radius:99px;
        background:rgba(255,255,255,.16);box-shadow:inset 0 1px 2px rgba(0,0,0,.35)}
      .span{position:absolute;top:0;bottom:0;left:0;width:0;border-radius:99px;opacity:0;
        background:linear-gradient(90deg,#79bdff,#ffc27c);
        box-shadow:0 0 6px rgba(120,190,255,.35)}
      .pin{position:absolute;top:50%;left:0;display:none;width:2px;height:10px;margin:-5px 0 0 -1px;
        border-radius:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.45)}
      .pin.a{background:var(--a)}
      .pin.b{background:var(--b)}
      #hd{position:absolute;top:50%;left:0;width:8px;height:8px;margin:-4px 0 0 -4px;
        border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 0 6px rgba(255,255,255,.4);
        opacity:0;transition:opacity .15s}
      .track.live #hd{opacity:1}
      .row{display:flex;align-items:center;gap:6px}
      .grp{display:flex;align-items:center;gap:3px;padding:3px;border-radius:10px;
        background:rgba(255,255,255,.06)}
      .acts{display:flex;align-items:center;gap:3px;margin-left:auto}
      button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;
        justify-content:center;height:23px;min-width:23px;padding:0 5px;border-radius:7px;
        cursor:pointer;color:rgba(255,255,255,.78);font:inherit;line-height:1;
        transition:background .13s,color .13s,transform .09s}
      button:hover{background:rgba(255,255,255,.13);color:#fff}
      button:active{transform:scale(.93)}
      button:focus-visible{outline:2px solid #7fb6ff;outline-offset:1px}
      .set{font-size:11px;font-weight:700;letter-spacing:.06em}
      .set.a{color:var(--a);background:rgba(158,211,255,.16)}
      .set.b{color:var(--b);background:rgba(255,215,164,.16)}
      .set.a:hover{background:rgba(158,211,255,.3)}
      .set.b:hover{background:rgba(255,215,164,.3)}
      .n{min-width:19px;padding:0 3px;font-size:13px;line-height:1;color:rgba(255,255,255,.7)}
      .acts button{width:25px;padding:0}
      button svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2;
        stroke-linecap:round;stroke-linejoin:round}
      /* off: an outlined chip, on: a filled one. The outline is what makes
         "not looping" look deliberate instead of like a dimmed, un-pressed
         button — and the difference survives without relying on hue. */
      #loop{color:rgba(255,255,255,.66);background:transparent;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
      #loop:hover{color:#fff;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
      #loop.on{color:#7ef0b0;background:rgba(126,240,176,.18);box-shadow:inset 0 0 0 1px rgba(126,240,176,.42)}
      #loop svg{width:14px;height:14px}
      #clear svg{width:14px;height:14px}
      #hide svg{width:13px;height:13px}`;
    root.appendChild(st);
    const box = document.createElement("div");
    box.className = "box";
    box.title = t("abDragTitle");
    box.innerHTML = [
      '<div class="head">',
      '<span class="grip" aria-hidden="true"><i></i><i></i><i></i><i></i></span>',
      '<div id="label">',
      '<span class="t a" id="ta">A:--</span>',
      '<span class="track" id="track"><span class="span" id="span"></span>',
      '<span class="pin a" id="pina"></span><span class="pin b" id="pinb"></span>',
      '<span id="hd"></span></span>',
      '<span class="t b" id="tb">B:--</span>',
      '</div></div>',
      '<div class="row">',
      '<div class="grp"><button class="set a" id="a">A</button>',
      '<button class="n" id="am">−</button><button class="n" id="ap">+</button></div>',
      '<div class="grp"><button class="set b" id="b">B</button>',
      '<button class="n" id="bm">−</button><button class="n" id="bp">+</button></div>',
      '<div class="acts"><button id="loop"></button><button id="clear"></button>',
      '<button id="hide"></button></div>',
      '</div>'
    ].join("");
    root.appendChild(box);
    // Every control's action, keyed by the element: the click handler below is
    // the normal route, and a press whose target never reaches the card (see
    // onForeignDown) is resolved through this map instead.
    const acts = new Map();
    const icon = (id, svg) => { const el = root.getElementById(id); if (el) el.innerHTML = svg; };
    icon("loop", AB_ICONS.loop);
    icon("clear", AB_ICONS.clear);
    icon("hide", AB_ICONS.hide);
    const btn = (id, fn, title) => {
      const el = root.getElementById(id);
      if (!el) return;
      if (title) el.title = title;
      acts.set(el, fn);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (justDragged) return; // the click a drag leaves behind
        fn();
      });
    };
    btn("a", abSetA, t("abGuideSetA"));
    btn("b", abSetB, t("abGuideSetB"));
    btn("am", () => abAdjustA(-0.5), "A −0.5s");
    btn("ap", () => abAdjustA(0.5), "A +0.5s");
    btn("bm", () => abAdjustB(-0.5), "B −0.5s");
    btn("bp", () => abAdjustB(0.5), "B +0.5s");
    btn("loop", abToggle, t("abStart"));
    btn("clear", abClear, t("abClearTitle"));
    btn("hide", abHide, t("abHideTitle"));
    // A plain tap on the card must not reach the player underneath (a tap on a
    // running video is play/pause).
    box.addEventListener("click", (e) => e.stopPropagation());

    // --- move the bar --------------------------------------------------------
    // This is the only overlay that lives on the picture, and the top-right
    // corner is where the player's own controls and the notch usually are, so
    // it must be movable. Two ways in: drag the card body (or the grip) right
    // away, or hold anywhere — buttons included — for a moment; a quick tap on
    // a button stays a button.
    //
    // The stroke is tracked on `window`, not on the card. The card is only
    // ~226x54px on a windowed player: a finger leaves it within a frame or two
    // of moving, and those moves were delivered to the <video> underneath, so
    // the drag died on the first frame — which is why the bar "could not be
    // dragged" (worst in fullscreen, where the picture fills the screen). The
    // window is also the only place that keeps receiving moves once the card
    // is allowed to leave the player's rectangle.
    let press = null, dragging = false, holdTimer = 0, justDragged = false, suppressTimer = 0;
    const DRAG_SLOP = 5, HOLD_MS = 260;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } };
    // How long a press may stay silent before it is treated as one whose end
    // event never arrived. Same fuse as startPress: it only has to catch a
    // lost pointerup, so it is far longer than any real pause on a control.
    const PRESS_IDLE_MS = 2500;
    const pressLive = () => !!press && (Date.now() - (press.lastMove || press.at || 0)) < PRESS_IDLE_MS;
    // Where the card sits in its own coordinate space, plus how much the
    // container scales it. Some players run fullscreen inside a transformed
    // box, where `left` and `clientX` are not in the same units; the ratio
    // keeps the card exactly under the finger in both cases.
    const dragBase = () => {
      const p = AB.panel;
      let got = null;
      try { got = p.getBoundingClientRect(); } catch (_) {}
      const s = AB.scale || 1;
      const own = (p.offsetWidth || AB_W) * s;
      const k = got && got.width > 0 && own > 0 ? got.width / own : 1;
      return {
        left: parseFloat(p.style.left) || 0,
        top: parseFloat(p.style.top) || 0,
        k: k || 1
      };
    };
    const beginDrag = (anchorX, anchorY) => {
      if (dragging || !press) return;
      dragging = true;
      box.classList.add("dragging");
      press.base = dragBase();
      press.ax = anchorX; press.ay = anchorY;
      vibrate(8);
    };
    const moveTo = (e) => {
      const p = AB.panel, b = press.base;
      if (!p || !b) return;
      const left = b.left + (e.clientX - press.ax) / b.k;
      const top = b.top + (e.clientY - press.ay) / b.k;
      p.style.left = Math.round(left) + "px";
      p.style.top = Math.round(top) + "px";
      if (AB.lastPlaced) { AB.lastPlaced.left = left; AB.lastPlaced.top = top; }
    };
    const endDrag = () => {
      const rect = abRect();
      const lp = AB.lastPlaced || { left: AB_PAD, top: AB_PAD, w: AB_W, h: AB_H };
      const w = lp.w || AB_W, h = lp.h || AB_H;
      const vb = viewBounds();
      const maxL = Math.max(AB_PAD, vb.width - w - AB_PAD);
      const maxT = Math.max(AB_PAD, vb.height - h - AB_PAD);
      const left = clamp(lp.left, AB_PAD, maxL);
      const top = clamp(lp.top, AB_PAD, maxT);
      // Store the inset from the NEAREST player edges. It is allowed to be
      // negative now that the bar can sit outside the picture, and that is what
      // keeps it in the same place across a fullscreen toggle.
      const ax = left + w / 2 > rect.left + rect.width / 2 ? "r" : "l";
      const ay = top + h / 2 > rect.top + rect.height / 2 ? "b" : "t";
      AB.pos = {
        ax, ay,
        dx: Math.round(ax === "r" ? rect.left + rect.width - left - w : left - rect.left),
        dy: Math.round(ay === "b" ? rect.top + rect.height - top - h : top - rect.top)
      };
      saveAbPos(AB.pos);
      placeABPanel();
    };
    // Which control is under a screen point. Only needed for the foreign press
    // path below: the document cannot be asked — `elementFromPoint` reports
    // whatever swallowed the tap — so the buttons are measured directly.
    const buttonAt = (x, y) => {
      let hit = null;
      for (const b of acts.keys()) {
        let r = null;
        try { r = b.getBoundingClientRect(); } catch (_) {}
        if (!r || !r.width) continue;
        if (x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) hit = b;
      }
      return hit;
    };
    const cancelStroke = () => {
      if (!press) return;
      clearHold();
      detachStroke();
      press = null;
      dragging = false;
      box.classList.remove("dragging");
    };
    const onMove = (e) => {
      if (!press) return;
      // Nothing below the window may see a move that belongs to this stroke.
      // The player's own handlers (and this extension's gesture layer) sit on
      // document / the <video>, and they read a drag over the picture as
      // "seek", "volume" or "brightness" — which is what made the native
      // control bar and both side meters appear while the card was dragged.
      e.stopPropagation();
      if (press.id != null && e.pointerId != null && e.pointerId !== press.id) return;
      press.lx = e.clientX; press.ly = e.clientY;
      press.lastMove = Date.now();
      if (!dragging) {
        if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < DRAG_SLOP) return;
        // Moving off a button before the hold keeps it a button stroke; the hold
        // itself stays armed, so "press, drift, keep holding" still drags.
        if (!press.armed) return;
        clearHold();
        beginDrag(press.x, press.y);
      }
      moveTo(e);
      if (e.cancelable) e.preventDefault();
    };
    const detachStroke = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
    const onUp = (e) => {
      if (!press) return;
      // The release belongs to the stroke as well: a `pointerup` that reaches
      // the player ends its own gesture (and can commit a seek).
      e.stopPropagation();
      const stroke = press, wasDrag = dragging;
      clearHold();
      detachStroke();
      press = null;
      dragging = false;
      box.classList.remove("dragging");
      if (stroke.foreign) {
        // Nothing of this stroke happened on the card, so the browser's follow-up
        // click will land on the player underneath (which reads it as
        // play/pause): eat exactly one click.
        const kill = (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          window.removeEventListener("click", kill, true);
        };
        window.addEventListener("click", kill, true);
        setTimeout(() => window.removeEventListener("click", kill, true), 400);
      }
      if (!wasDrag) {
        // A press that arrived with a foreign target never reached the button,
        // so its own click handler will not run: do the work here.
        if (stroke.foreign) {
          const el = buttonAt(stroke.x, stroke.y);
          const fn = el && acts.get(el);
          if (fn) { try { fn(); } catch (_) {} }
        }
        return;
      }
      // Swallow the click this drag leaves behind, then let taps through again.
      justDragged = true;
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => { justDragged = false; }, 350);
      endDrag();
      e.stopPropagation();
    };
    const startPress = (x, y, id, armed) => {
      // A stroke whose `pointerup` never arrived — a fullscreen transition
      // cancels the pointer sequence, and the cancelled events are not
      // guaranteed to reach us — used to wedge the bar for good: `press` stayed
      // set, so every later press returned early and the card looked frozen
      // while still being painted. Only a genuinely live stroke may block one.
      if (press) {
        // A live stroke may span seconds (hold, then drag), so this is a long
        // fuse: it only has to catch the stroke whose end never arrived.
        if (Date.now() - (press.at || 0) < 2500) return false;
        cancelStroke();
      }
      press = {
        id, x, y, lx: x, ly: y, at: Date.now(), lastMove: Date.now(),
        base: null, ax: x, ay: y, armed, foreign: false
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      clearHold();
      holdTimer = setTimeout(() => {
        holdTimer = 0;
        if (!press || dragging) return;
        press.armed = true;
        // Anchor at the finger's LATEST position: the hold may have started with
        // a few pixels of drift, and anchoring at the original press point would
        // jump the card by that amount.
        beginDrag(press.lx, press.ly);
      }, HOLD_MS);
      return true;
    };
    // --- who owns the finger ------------------------------------------------
    // `contains()` does not see into a shadow tree (a shadow child's parent is
    // the ShadowRoot, not the host), so the check walks the composed path —
    // which is also what makes it work whether or not the browser retargets.
    const fromPanel = (e) => {
      let path = [];
      try { path = e.composedPath ? e.composedPath() : []; } catch (_) {}
      if (path.length) return path.indexOf(host) >= 0 || path.indexOf(root) >= 0;
      const t = e.target;
      return !!t && (t === host || host.contains(t) ||
        (t.getRootNode && t.getRootNode() === root));
    };
    const panelBox = () => {
      let r = null;
      try { r = host.getBoundingClientRect(); } catch (_) {}
      return r && r.width && r.height ? r : null;
    };
    // A finger is wider than the card, and a press that lands a hair outside
    // the edge is still aimed at it.
    const panelHolds = (x, y, pad) => {
      const r = panelBox();
      if (!r) return false;
      const p = pad == null ? 12 : pad;
      return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
    };
    // Shared by the window-capture route and the card's own fallback below.
    const beginPanelPress = (e, el) => {
      if (e.button > 0) return;
      // Re-place first: a background tab can throttle rAF, and the grab offset
      // has to be relative to where the card is on screen right now.
      placeABPanel();
      const closest = (sel) => !!(el && el.closest && el.closest(sel));
      // A press on a button only arms the drag after the hold; anywhere else
      // (and on the grip) a plain swipe moves the card.
      startPress(e.clientX, e.clientY, e.pointerId, !closest("button") || closest(".grip"));
    };
    // A press on the card is taken at the window's CAPTURE phase instead of on
    // the card itself: everything below the window is the page, and a press on
    // the picture means "pause" / "show the control bar" to any player.
    const onPanelDown = (e) => {
      if (e.button > 0 || !fromPanel(e)) return;
      e.stopPropagation();
      // Inside a shadow tree `e.target` is retargeted to the host by the time
      // it reaches the window, so the pressed element comes from the composed
      // path — reading the host instead made every press look "not a button".
      let first = null;
      try { first = e.composedPath && e.composedPath()[0]; } catch (_) {}
      beginPanelPress(e, first || e.target);
    };
    // Fullscreen safety net. Going fullscreen usually promotes the player's own
    // overlay into the top layer *after* ours, and on Android the media surface
    // sits above the page entirely: the card is still painted, but the press is
    // delivered to something else, so every control on it looks dead. When a
    // press lands inside the card while its target is not the card, the stroke
    // is taken over here and resolved against the button rects.
    const onForeignDown = (e) => {
      if (e.button > 0 || !AB.panel || AB.panel.style.display === "none") return;
      if (fromPanel(e)) return;
      const r = panelBox();
      if (!r) return;
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const hit = buttonAt(e.clientX, e.clientY);
      if (!startPress(e.clientX, e.clientY, e.pointerId, !hit)) return;
      if (press) press.foreign = true;
      // Whatever element the press actually hit, it was aimed at the card: the
      // page must not see it, or a video starts its own swipe on the very next
      // move (that is the seek/volume/brightness triple).
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    // The touch stream needs the same treatment: one finger produces both a
    // pointer and a touch sequence, and page players commonly listen to touch
    // only. Without this a drag on the card also ran the player's gesture.
    //
    // It also drives the stroke. Android cancels the pointer stream in the
    // middle of a drag often enough (a top-layer change, a native player taking
    // the surface) that a card which only listened to pointermove could freeze
    // under the finger; the touch stream is the same finger, and `moveTo()` is
    // absolute, so a stroke seen on both streams still moves the card once.
    const swallowTouch = (e) => {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      // A press whose pointerup never arrived (a fullscreen transition cancels
      // the sequence, and Android does not always deliver the cancel) used to
      // keep this handler swallowing EVERY touch on the page: `stopPropagation`
      // at the window's capture phase means the gesture layer never sees the
      // touch stream at all, and on mobile fullscreen — where the pointer
      // stream is deliberately ignored — that killed brightness / volume swipes
      // and the long press until the card was pressed again. Expire it instead.
      const live = pressLive();
      if (press && !live) cancelStroke();
      // touchstart may start a stroke the window never saw (the top-layer
      // fallback): a finger that lands on the card still belongs to it. Moves and
      // releases only belong to it once such a stroke actually exists.
      const target = e.type === "touchstart" || e.type === "touchcancel";
      if (!live && !(target && panelHolds(t.clientX, t.clientY))) return;
      // Nothing below the window is allowed to read this finger (see
      // onPanelDown).
      e.stopPropagation();
      // touchstart / touchend keep their default while the stroke belongs to
      // the card: cancelling them also cancels the click every button runs on.
      // A stroke the player swallowed has no click of ours to protect — the one
      // it would produce lands on the video as play/pause.
      const ours = !press || !press.foreign;
      const keepClick = (e.type === "touchstart" || e.type === "touchend") && ours;
      if (e.cancelable && !keepClick) e.preventDefault();
      if (!press || t.clientX == null) return;
      const asPointer = {
        type: e.type, clientX: t.clientX, clientY: t.clientY,
        pointerId: press.id, cancelable: false,
        preventDefault() {}, stopPropagation() {}
      };
      if (e.type === "touchmove") onMove(asPointer);
      else if (e.type === "touchend" || e.type === "touchcancel") onUp(asPointer);
    };
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((t) =>
      window.addEventListener(t, swallowTouch, { capture: true, passive: false }));
    window.addEventListener("pointerdown", onPanelDown, true);
    window.addEventListener("pointerdown", onForeignDown, true);
    // Fallback for a press that never reached the window — a non-composed
    // event, or a host that swallowed it before the bubble phase. Harmless
    // when the window route already ran: the card cannot be pressed twice.
    box.addEventListener("pointerdown", (e) => beginPanelPress(e, e.target));
    // A hold cannot survive the page going away or a fullscreen transition
    // re-parenting the card: drop it rather than leaving it open.
    const onHidden = () => { if (document.hidden) cancelStroke(); };
    window.addEventListener("blur", cancelStroke);
    document.addEventListener("visibilitychange", onHidden);
    AB.cancelStroke = cancelStroke;
    // The card can be hidden and rebuilt (see setAbPanelVisible), so every
    // window/document listener above is taken back down with it.
    AB.detach = () => {
      window.removeEventListener("pointerdown", onPanelDown, true);
      window.removeEventListener("pointerdown", onForeignDown, true);
      ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((t) =>
        window.removeEventListener(t, swallowTouch, { capture: true }));
      window.removeEventListener("blur", cancelStroke);
      document.removeEventListener("visibilitychange", onHidden);
      detachStroke();
    };
    box.addEventListener("click", (e) => {
      if (!justDragged) return;
      e.stopPropagation(); e.preventDefault();
    }, true);

    // Claim the slot before mounting: mounting can (via the fullscreen host /
    // guard) come back through here, and a second host would be orphaned —
    // visible on screen, but no longer the one the module can place or remove.
    AB.panel = host;
    mountUi(host);
    ensureUiGuard();
    startABTicker();
    layoutHud();
    updateABPanel();
  }

  // One timer for the whole bar: it keeps the bar bound to a player that
  // actually exists and moves the playhead dot. It is also the only thing that
  // notices a player appearing or going away (SPA navigation, a page with no
  // video at all), so the bar is never left floating over a page that has
  // nothing to loop.
  //
  // The tucked-away flag is re-read when the page identity changes: an SPA
  // swaps the video without a reload, and a card hidden on one video used to
  // stay hidden on every later one, which is the same cross-page leak in
  // miniature. That is also why the timer keeps running while the card is
  // tucked away — it is the only thing watching for that change.
  let abPageId = null;
  function abTick() {
    if (document.hidden) return;
    if (!S || !S.abLoopEnabled) return;
    if (abTrackPage()) AB.hidden = readAbHidden();
    if (abPanelHidden()) {
      if (AB.panel) removeABPanel(true); // keeps a running loop alive
      return;
    }
    const v = abPickVideo();
    if (!v) {
      if (AB.panel && AB.panel.style.display !== "none") {
        AB.panel.style.display = "none";
        cancelAnimationFrame(AB.raf);
      }
      return;
    }
    // Keep the bar bound to the player it is drawn over: a page restored from
    // storage has marks but no video yet, and the playhead dot (and A / B
    // capture) need one whether or not the loop is running.
    AB.video = v;
    if (!AB.panel) { ensureABPanel(); return; }
    if (AB.panel.style.display === "none") {
      AB.panel.style.display = "";
      placeABPanel();
      if (AB.on) abWatch();
    }
    abHead();
  }
  // True when the page identity changed since the last call. The first call
  // only records it: boot has already read the stored flag.
  function abTrackPage() {
    const id = pageKey();
    if (id === abPageId) return false;
    const first = abPageId === null;
    abPageId = id;
    return !first;
  }
  function startABTicker() {
    if (AB.headTimer) return;
    if (!S || !S.abLoopEnabled) return;
    AB.headTimer = setInterval(abTick, 240);
  }
  function stopABTicker() {
    if (AB.headTimer) { clearInterval(AB.headTimer); AB.headTimer = 0; }
  }
  // `keepLoop` is for hiding the card while the loop keeps running: removing the
  // UI must not also stop the lap watcher. The ticker deliberately survives the
  // card: it is what notices the next page (or the popup switch) wanting it
  // back, and what re-reads the per-page flag on an SPA navigation.
  function removeABPanel(keepLoop) {
    if (!keepLoop) cancelAnimationFrame(AB.raf);
    const p = AB.panel;
    AB.panel = null;
    // The window/document listeners this card installed go with it; the card is
    // rebuilt from scratch when it comes back.
    try { if (AB.detach) AB.detach(); } catch (_) {}
    AB.detach = null;
    if (!p) return;
    // The fullscreen guard re-attaches anything it knows about, so the panel
    // has to be forgotten there too or it comes back from the dead.
    const i = uiHosts.indexOf(p);
    if (i >= 0) uiHosts.splice(i, 1);
    try { p.remove(); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // 6. gesture state machine
  // ---------------------------------------------------------------------------
  const state = new WeakMap();
  // The stroke that is currently open (its video + its state object). Every
  // move/up event used to search the document — `collectVideos()` walks all
  // nodes and every shadow root — just to find the active gesture again, twice
  // per frame on a busy player. Remembering the pair from pointerdown is O(1)
  // and behaves identically, with the scan kept only as a fallback.
  let activeStroke = null;
  const currentStroke = () => {
    if (activeStroke && activeStroke.s && activeStroke.s.active && activeStroke.v) return activeStroke;
    for (const candidate of collectVideos()) {
      const cs = state.get(candidate);
      if (cs && cs.active) { activeStroke = { v: candidate, s: cs }; return activeStroke; }
    }
    return null;
  };
  const fresh = () => ({
    active: false, video: null, startX: 0, startY: 0, lastX: 0, lastY: 0,
    startTime: 0, moved: false, axis: null, zone: "center",
    longPressTimer: 0, longPressTriggered: false, longPressConfirmed: false,
    originalRate: 1, originalVolume: 1, originalBrightness: null,
    wasPlaying: false,
    speedLocked: false, speedUnlocked: false, draggingSpeed: false,
    speedAnchorRate: null, speedAnchorIndex: null, speedTierCount: 0,
    seekTarget: null, seekCancelled: false, seekWarningShown: false, seeking: false,
    volumeVal: null, brightnessVal: null, lockHintShown: false,
    // Fixed references captured on the first vertical move (see onMove): the
    // value must scale with total travel, not with travel added per frame.
    volumeAnchor: null, brightnessAnchor: null,
    boostHintShown: false, suppressClick: false,
    lastMoveTime: 0, velocityX: 0, velocityY: 0,
    forcePlayed: false, claimed: false,
    // Set when the stroke was handed back to the page (windowed vertical swipe
    // we do not own): every later move is ignored and no tap is registered.
    passthrough: false,
    source: "", pauseGuard: null, pointerId: null
  });
  const st = (v) => { let s = state.get(v); if (!s) { s = fresh(); state.set(v, s); } return s; };

  // In fullscreen, use the whole viewport for hit-zone math: on mobile native
  // video fullscreen the <video> rect can be stale/odd, but gestures map to the
  // visible screen, so the hit zones are computed from the viewport.
  const gestureRect = (v) => {
    const fs = fullscreenEl();
    if (fs) return { left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight };
    try { return v.getBoundingClientRect(); } catch (_) {
      return { left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight };
    }
  };

  const zoneAt = (x, v) => {
    const r = gestureRect(v);
    const rel = (x - r.left) / (r.width || 1);
    if (rel < 0.34) return "left";
    if (rel > 0.66) return "right";
    return "center";
  };

  // 3x2 grid: for the left/right columns, the upper half double-taps forward
  // and the lower half double-taps backward (center stays play/pause). Only
  // applies to the built-in right/left presets, not to "custom" per-zone maps.
  const doubleTapAction = (zone, y, v) => {
    const mode = S.oneHandedMode || "right";
    if (S.gridLayout === "3x2" && mode !== "custom" && zone !== "center") {
      const r = gestureRect(v);
      const h = (r.height || 1) * (S.gestureAreaRatio || 0.8);
      return ((y - r.top) / h) < 0.5 ? "seekForward" : "seekBackward";
    }
    return gset(zone + "DoubleTap");
  };

  const performAction = (action, v) => {
    switch (action) {
      case "seekBackward": {
        const d = S ? S.doubleTapSeekDuration : 10;
        doSeek(v, v.currentTime - d); showHint("−" + d + "s"); break;
      }
      case "seekForward": {
        const d = S ? S.doubleTapSeekDuration : 10;
        doSeek(v, v.currentTime + d); showHint("+" + d + "s"); break;
      }
      case "playPause": togglePlay(v); break;
      case "fullscreen":
        // The settings page has a "double tap to fullscreen" switch; honour it
        // instead of always allowing the action (it used to be ignored).
        if (!S || S.doubleTapFullscreenEnabled !== false) toggleFullscreen(v);
        break;
      default: break;
    }
  };

  // The rate the hold currently sits on. While a pin is active the element
  // already reports the pinned value; the fallbacks only guard against a page
  // that resets playbackRate mid-stroke (or a detached video).
  const heldRate = (v, s) => {
    const cur = Number(v && v.playbackRate);
    if (Number.isFinite(cur) && cur > 0) return cur;
    const locked = readLockedRate();
    if (locked != null) return locked;
    return (s && Number.isFinite(s.speedAnchorRate) && s.speedAnchorRate > 0) ? s.speedAnchorRate : 1;
  };

  const finishLongPress = (v, s) => {
    // Hide the tier row the instant the finger lifts and report the outcome
    // through a toast only: no lingering overlay that would need a delayed
    // timer to clean up.
    hideTiers();
    if (!s.longPressTriggered || !v) return;
    if (s.speedUnlocked) {
      // Swipe down = exit speed mode: drop the lock and go back to the rate
      // that was playing before the lock (1x unless the site was faster).
      exitSpeed(v);
    } else if (s.speedLocked) {
      // Swipe up = lock at whatever the hold ended on (dragging may have moved
      // it). `v.playbackRate` is already the pinned value while locked.
      pinRate(v, heldRate(v, s));
      showHint(t("gestureSpeedLocked", { SPEED: fmtRate(readLockedRate()) }), 1600);
      vibrate(20);
    } else if (isSpeedLocked()) {
      // A speed was already locked and no direction was chosen: keep the lock
      // (and the re-tuned value the drag already wrote). Re-target the pin
      // here instead of dropping it — dropping it silently unlocked the rate,
      // so the NEXT long press fell back to the default 2x ("the lock
      // disappeared by itself").
      pinRate(v, heldRate(v, s));
      if (s.draggingSpeed) showHint(t("gestureSpeedLocked", { SPEED: fmtRate(readLockedRate()) }), 1600);
    } else {
      // Without a lock the pre-gesture rate is restored, so a drag is only a
      // PREVIEW — you must swipe up (release-to-lock) to keep the new speed.
      // That is what makes the gesture feel like a preview instead of
      // silently changing the rate.
      unpinRate(v);
      const back = Number.isFinite(s.originalRate) ? s.originalRate : 1;
      try { v.playbackRate = back; } catch (_) {}
      if (s.draggingSpeed) showHint(t("gestureSpeedRestored", { SPEED: fmtRate(back) }), 1400);
    }
  };

  // per-site gating: blacklist + explicit site rules
  const siteAllowed = () => {
    if (!S) return true;
    const host = location.hostname || "";
    const bl = S.gestureBlacklist || [];
    if (bl.some(d => d && (host === d || host.endsWith("." + d)))) return false;
    const rules = S.siteRules || [];
    for (const rule of rules) {
      if (!rule || !rule.match) continue;
      let hit = false;
      try { hit = new RegExp(rule.match, "i").test(location.href); } catch (_) { hit = location.href.includes(rule.match); }
      if (hit) return rule.enabled !== false;
    }
    return true;
  };
  // Native event blocking can be global (gestureShield / nativeEventBlocking)
  // or enabled per-site via siteEventBlocking = { "example.com": true }.
  const shouldBlockNative = () => {
    if (!S) return false;
    if (S.gestureShield || S.nativeEventBlocking) return true;
    const map = S.siteEventBlocking || {};
    const host = location.hostname || "";
    if (map[host]) return true;
    return Object.keys(map).some(d => d && map[d] && (host === d || host.endsWith("." + d)));
  };

  // --- vertical-only lock (brightness / volume) -----------------------------
  // An extra on top of the base gesture set. It deliberately sits on a
  // different axis than seek (horizontal) and long-press (hold), so locking
  // brightness/volume can never eat those.
  //
  // The lock is PER PAGE. `lockVerticalSwipe` / `lockVerticalTarget` in the
  // settings are only the starting state for a page that loads from now on:
  // once the page is up it owns its own copy, so a two-finger tap here never
  // reaches another tab — and never rewrites the state the next page will
  // start from. Saving it instead (the old behaviour) made one tab's tap show
  // up in every freshly opened tab while leaving the ones already open alone,
  // which is neither "global" nor "per page".
  let pageLock = null; // Set<"brightness" | "volume">, created on first use
  const initialLockSet = () => {
    const set = new Set();
    if (!S || !S.lockVerticalSwipe) return set;
    const t = S.lockVerticalTarget || "both";
    if (t === "both") { set.add("brightness"); set.add("volume"); }
    else set.add(t);
    return set;
  };
  const readLockSet = () => (pageLock || (pageLock = initialLockSet()));
  const verticalActionBlocked = (action) => {
    if (action !== "volume" && action !== "brightness") return false;
    return readLockSet().has(action);
  };
  // --- where a vertical swipe is allowed to do anything ----------------------
  // Windowed playback is the conflict case: a page-scrolling swipe and a
  // volume swipe are the same finger movement. `nonFullscreenVertical` decides
  // who wins —
  //   "fullscreen" (default): only in real fullscreen; windowed vertical
  //                swipes are handed back to the page, which scrolls normally.
  //   "edge":      windowed, but only when the finger starts in a narrow lane
  //                against the video's left or right edge.
  //   "always":    everywhere (the old behaviour).
  const nonFsVertical = () => {
    // Only touch input has a page scroll to fight with: a mouse drag over a
    // windowed player keeps the full gesture set, so the policy is applied to
    // touch devices only.
    if (!isMobile) return "always";
    return (S && S.nonFullscreenVertical) || "fullscreen";
  };
  // Android's native video fullscreen frequently reports no fullscreenElement,
  // so "only in fullscreen" cannot rely on the Fullscreen API alone: a video
  // that covers (almost) the whole viewport is fullscreen for our purposes —
  // and there is no page scroll left to protect.
  const looksFullscreen = (v) => {
    if (!v) return false;
    let r = null;
    try { r = v.getBoundingClientRect(); } catch (_) { return false; }
    if (!r || !(r.width > 0)) return false;
    const vw = innerWidth || 1, vh = innerHeight || 1;
    return r.width >= vw * 0.9 && r.height >= vh * 0.8;
  };
  const EDGE_LANE = (width) => clamp((width || 400) * 0.14, 32, 88);
  const inEdgeLane = (x, v) => {
    const r = gestureRect(v);
    const lane = EDGE_LANE(r.width);
    return (x - r.left) <= lane || (r.left + r.width - x) <= lane;
  };
  // True when this vertical stroke is ours to consume. A stroke we do not own
  // must not be preventDefault-ed: with `touch-action:pan-y` the browser then
  // scrolls the page exactly like it would without us.
  const ownsVertical = (action, x, v) => {
    if (action !== "volume" && action !== "brightness") return false;
    if (fullscreenEl() || looksFullscreen(v)) return true;
    const mode = nonFsVertical();
    if (mode === "always") return true;
    if (mode === "edge") return inEdgeLane(x, v);
    return false;
  };

  // The lock is per slider: brightness and volume are tracked as two
  // independent halves of the page's own set (see `pageLock` above). Nothing
  // here touches the stored settings — those only seed a new page.
  const writeLockSet = (set) => {
    pageLock = new Set(set);
  };
  const toggleVerticalLock = (side) => {
    if (!S || (side !== "volume" && side !== "brightness")) return null;
    // Same half = release that slider, other half = protect it. The two halves
    // never fight over one slot, so both can be locked at once — which is also
    // what the two switches in the settings page start a new page from.
    const set = readLockSet();
    const wasLocked = set.has(side);
    writeLockSet(wasLocked ? [...set].filter((x) => x !== side) : [...set, side]);
    vibrate(20);
    flashLockBadge(!wasLocked, side);
    return wasLocked ? "off" : "on";
  };
  // Drop every in-flight gesture without committing anything (used when a
  // second finger lands: the stroke is no longer a single-finger gesture).
  const dropGestures = () => {
    for (const v of collectVideos()) {
      const cs = state.get(v);
      if (!cs || !cs.active) continue;
      clearTimeout(cs.longPressTimer);
      if (cs.pauseGuard) { try { v.removeEventListener("pause", cs.pauseGuard); } catch (_) {} }
      Object.assign(cs, fresh());
      // The tap record must not survive a chord: otherwise the first single tap
      // after a two-finger toggle could merge into a double tap and seek.
      cs.tap = null;
    }
    activeStroke = null;
    hideTiers(); hideSeekCard(); hideHint(); hideMeters();
  };

  // Called the moment a press turns into a real gesture (axis locked or long
  // press fired): keep the video running for the whole stroke, and remember
  // whether *we* started it so the pause can be handed back.
  //
  // `opts.noPlay` is for volume / brightness strokes: they change a slider, not
  // the picture, so there is nothing to preview. Forcing playback there made a
  // paused video start playing under the finger and pause again on release.
  //
  // A paused video is left paused unless `gesturePlayWhenPaused` is on. Running
  // it during the stroke ("so the speed change is visible") reads as a glitch
  // on a paused element: the picture starts moving under the finger for no
  // reason and stops again on release, and a speed the user cannot hear has
  // nothing to preview. The rate / seek target still applies, so the change is
  // there the moment playback resumes.
  const claimGesture = (v, s, opts) => {
    if (s.claimed) return;
    s.claimed = true;
    s.wasPlaying = !v.paused;
    if (opts && opts.noPlay) return;
    if (s.wasPlaying) {
      // Some sites' native control bar pauses the video as soon as a touch
      // starts. Hold playback for the whole gesture.
      const guard = () => {
        const cs = state.get(v);
        if (cs && cs.active && v.paused && !v.ended) v.play().catch(() => {});
      };
      s.pauseGuard = guard;
      try { v.addEventListener("pause", guard); } catch (_) {}
    } else if (v.readyState >= 2 && S && S.gesturePlayWhenPaused) {
      // Explicitly opted in: run it so the seek preview / speed change is
      // actually visible, then hand the pause back on release.
      s.forcePlayed = true;
      v.play().catch(() => {});
    }
  };

  const onStart = (e, source = "pointer") => {
    if (!S || !S.enabled || isLocked() || !siteAllowed()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // On mobile native fullscreen the touch stream is authoritative: pointer
    // events in the video top layer are often incomplete (no move/up). Let the
    // touch handler drive the gesture there.
    if (source === "pointer" && isMobile && fullscreenEl()) return;
    // Only ignore genuine web-page controls, never the player's own overlay
    // (which is often a <div> covering the whole video). The video finder
    // already snaps to the underlying <video>.
    if (isUI(e.target)) return;
    const v = findVideo(e.clientX, e.clientY, false);
    if (!v) return;
    // Does a vertical swipe started here belong to us? On a windowed player the
    // answer is often "no" (see nonFullscreenVertical). Cancelling touchstart is
    // exactly what would make the page unscrollable, so in that case the page
    // keeps its native panning — the gesture engine still sees every move, and
    // horizontal seek / long press are unaffected because the axis is only
    // claimed once the finger has actually travelled.
    const verticalOurs = (!isMobile || source !== "touch") ||
      ownsVertical(gset(zoneAt(e.clientX, v) + "VerticalSwipe"), e.clientX, v);
    // respect native-event blocking (global + per-site)
    if (shouldBlockNative()) stopNative(e, source === "touch" && !verticalOurs);
    const s = st(v);
    // A swallowed end event (native fullscreen can cancel the touch stream) used
    // to leave the gesture "active" forever: the HUD stuck on screen and every
    // later gesture was ignored. A fresh press after a quiet period resets the
    // leftovers; a duplicate event from the other input stream (pointerdown +
    // touchstart for the same finger) is ignored instead.
    if (s.active) {
      const idle = performance.now() - (s.lastMoveTime || s.startTime || 0);
      if (idle < 1200) return;
      clearTimeout(s.longPressTimer);
      if (s.pauseGuard) { try { v.removeEventListener("pause", s.pauseGuard); } catch (_) {} }
      Object.assign(s, fresh());
      hideTiers();
    }
    Object.assign(s, fresh(), {
      active: true, video: v, source: source || "pointer",
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY, startTime: performance.now(),
      zone: zoneAt(e.clientX, v),
      originalRate: v.playbackRate, originalVolume: v.volume,
      seekStartTime: Number.isFinite(v.currentTime) ? v.currentTime : null,
      wasPlaying: !v.paused,
      lastMoveTime: performance.now()
    });
    // Adopt an existing pin (if any) so the speed state is known from the very
    // first frame; the live value is re-read where it matters.
    readLockedRate();
    // A new press means the previous tap's held click will never be needed.
    cancelPendingClick();
    // A genuine new press re-arms the tier row (see hideTiers' latch).
    tiersSuppressed = false;
    // Pointer capture keeps move/up events flowing even if the finger leaves
    // the video rect.
    if (e.pointerId != null && e.target && e.target.setPointerCapture) {
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    }
    applyTouchAction();
    // Every hint, bar and card is laid out inside the HUD box: point it at the
    // video that was just pressed before anything is drawn.
    layoutHud(v);
    try { s.originalBrightness = brightnessCache.get(v) ?? 100; } catch (_) { s.originalBrightness = 100; }
    // This press owns the stroke now: remember both ends of it so move/end do
    // not have to scan the document (see activeStroke in onMove).
    activeStroke = { v, s };
    // Playback is deliberately NOT touched here. On Android Edge a single tap
    // is the browser's own control-bar gesture ("tap to reveal controls, then
    // press the play/pause button"), so starting playback on press turned every
    // tap into a play→pause flicker and left the controls out of sync.
    // Playback is only forced once the stroke becomes a real gesture, which
    // is exactly what `claimGesture` below does.
    if (S.longPressEnabled) {
      const delay = isMobile ? Math.max(S.longPressDelay, S.longPressDelayMobile) : S.longPressDelay;
      s.longPressTimer = setTimeout(() => {
        if (!s.active || s.moved) return;
        s.longPressTriggered = true; s.longPressConfirmed = true;
        claimGesture(v, s);
        vibrate(15);
        // An already-locked rate is the anchor; otherwise the configured
        // long-press speed is. Dragging is measured in TIERS from this anchor,
        // never from the freshly applied rate (that fed back and ran away).
        beginSpeedHold(v, s);
      }, delay);
    }
    if (shouldBlockNative()) stopNative(e, source === "touch" && !verticalOurs);
  };

  // `noPrevent` keeps stopPropagation (the page's own handlers still never see
  // the touch) but leaves the default action alone, which is what lets the
  // browser pan the page on a swipe we do not own.
  const stopNative = (e, noPrevent) => {
    if (!e.cancelable) return;
    if (!noPrevent) e.preventDefault();
    e.stopPropagation();
  };

  const onMove = (e, source = "pointer") => {
    if (!S || !S.enabled || isLocked()) return;
    // find the active video from the gesture state (never rely on a custom
    // DOM property that is never assigned)
    const stroke = currentStroke();
    if (!stroke) return;
    const s = stroke.s, v = stroke.v;
    if (!s.active || !v) return;
    // The swipe was handed back to the page (it was not ours to consume): stay
    // out of the way until the finger lifts.
    if (s.passthrough) return;
    // A single physical stroke produces both pointermove and touchmove on
    // Android. Only accept events from the stream that started this gesture,
    // otherwise velocity doubles and seek/volume jump erratically.
    if (source && s.source && source !== s.source) {
      // ...but a speed hold still has to keep the page still. Windowed players
      // carry `touch-action: pan-y` so the page stays scrollable; once the hold
      // has started, a vertical drift is a lock / exit command, and the browser
      // must not pan instead. Cancelling the default on `pointermove` does NOT
      // stop a touch scroll — the compositor only listens to `touchmove` — so
      // the duplicate stream is cancelled here even though its deltas are
      // ignored. Without this the browser scrolled, fired pointercancel and the
      // lock swipe never reached its distance threshold.
      if (s.longPressTriggered && e.cancelable) e.preventDefault();
      return;
    }
    const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    // velocity tracking for flick-to-seek
    const nowT = performance.now();
    const dtMove = Math.max(1, nowT - (s.lastMoveTime || nowT));
    const sm = S.velocitySmoothing ?? 0.3;
    s.velocityX = s.velocityX * (1 - sm) + (Math.abs(e.clientX - s.lastX) / dtMove) * sm;
    s.velocityY = s.velocityY * (1 - sm) + (Math.abs(e.clientY - s.lastY) / dtMove) * sm;
    s.lastMoveTime = nowT;
    s.lastX = e.clientX; s.lastY = e.clientY;
    if (adx > (S.moveThreshold || 10) || ady > (S.moveThreshold || 10)) s.moved = true;

    if (s.longPressTriggered) {
      // The hold already owns the stroke: from here on a vertical drift is a
      // lock / exit command, never a page scroll. Cancel the default on the
      // FIRST move — windowed players carry `touch-action: pan-y` (the page
      // must stay scrollable when the swipe is not ours), so without this the
      // browser starts panning as soon as the finger moves, fires touchcancel
      // and the lock swipe dies before it reaches its distance threshold. That
      // is why the lock/release gesture only failed on windowed playback.
      if (e.cancelable) e.preventDefault();
      // lock / exit / drag after long press. Only claim the stroke for a
      // direction when it really means lock (up) or exit (down); a plain
      // downward drift during a horizontal drag must fall through to the rate
      // mapping instead of swallowing the frame.
      if (S.longPressLockEnabled && ady > (S.longPressLockSwipeDistance || 40) && ady > adx) {
        if (dy < 0) {
          // Up = lock at the current hold value. Re-arming after a down-swipe
          // makes the pair reversible inside a single stroke.
          if (!s.speedLocked) {
            s.speedLocked = true;
            if (s.speedUnlocked) { s.speedUnlocked = false; hideHint(); }
            showHint("↑ " + t("gestureReleaseLock"));
          }
          if (e.cancelable) e.preventDefault();
          return;
        }
        // Down = exit speed. Allowed whenever a lock exists (including one just
        // created by this stroke's up-swipe), which is what makes "down to
        // leave speed mode" reliable instead of only working on a second press.
        if ((s.speedLocked || isSpeedLocked()) && !s.speedUnlocked) {
          s.speedUnlocked = true; s.speedLocked = false;
          showHint("↓ " + t("gestureReleaseUnlock"));
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
      // Horizontal drag latency: once a drag has started it keeps applying even
      // inside the deadzone, so a small correction back to the anchor value is
      // possible (gating on the deadzone would freeze the last value).
      // Locked gestures never re-drag the rate (gated on either lock-trigger
      // flag); the only available move is swipe-down.
      const lockDecided = s.speedLocked || s.speedUnlocked;
      // A locked rate can still be re-tuned when the user asked for it; the
      // new value simply becomes the locked one. Blocking it entirely is why
      // long-pressing a locked 4x used to do nothing at all.
      const canDrag = !isSpeedLocked() || lockedDragAllowed();
      if (S.longPressDragEnabled && canDrag && !lockDecided && adx > (S.longPressMoveDeadzone || 20) && adx > ady) s.draggingSpeed = true;
      if (S.longPressDragEnabled && canDrag && !lockDecided && s.draggingSpeed) {
        // Once the horizontal intent is latched, keep mapping dx no matter how
        // much the finger drifts vertically: the axis is decided once and then
        // only dx is read. Re-requiring `adx >= ady` on every frame used to
        // freeze the rate whenever the stroke leaned slightly, which read as
        // "the drag is too slow / not following my finger".
        // Tier-quantised mapping: each
        // `longPressDragSensitivity` px of horizontal travel steps exactly one
        // tier away from the anchor, clamped at both ends of the ladder.
        // 45px/tier by default: 2x -> 4x is a 90px nudge, so the change is
        // felt immediately. Clamped so a stale/odd stored value can neither
        // make it glacial (>160) nor twitchy (<28).
        const pxPerTier = clamp(S.longPressDragSensitivity || 45, 28, 160);
        const tiers = tierList(s.speedAnchorRate);
        const base = Number.isFinite(s.speedAnchorIndex)
          ? s.speedAnchorIndex
          : tierIndex(tiers, Number.isFinite(s.speedAnchorRate) ? s.speedAnchorRate : heldRate(v, s));
        const steps = Math.round(dx / pxPerTier);
        const idx = clamp(base + steps, 0, tiers.length - 1);
        const next = tiers[idx];
        if (Math.abs(next - heldRate(v, s)) > 0.001) {
          // setRate moves the pin along with the value when a lock is active,
          // so the drag is audible immediately and the release cannot restore
          // the old locked speed.
          setRate(v, next, true);
        } else showTiers(heldRate(v, s)); // keep the indicator alive while holding
        if (e.cancelable) e.preventDefault();
        return;
      }
      return;
    }

    // axis lock
    if (!s.axis) {
      if (adx > (S.directionThreshold || 15) && adx > ady * 1.2) s.axis = "x";
      else if (ady > (S.directionThreshold || 15) && ady > adx * 1.6) s.axis = "y";
      else return;
      clearTimeout(s.longPressTimer);
      if (s.axis === "y") {
        const action = gset(s.zone + "VerticalSwipe");
        // Locked slider: tell the user once why nothing moves, then let the
        // page have the swipe (a "locked" bar must not also freeze the page).
        if (verticalActionBlocked(action)) {
          if (!s.lockHintShown) { s.lockHintShown = true; flashLockBadge(true, action); }
          s.passthrough = true;
          return;
        }
        // Not ours in this context (windowed playing, vertical swipes disabled
        // or outside the edge lanes): release it to the page.
        if (!ownsVertical(action, s.startX, v)) {
          s.passthrough = true;
          return;
        }
        // Volume / brightness change a slider, not the picture — nothing to
        // preview, so never force playback here (a paused video used to start
        // playing under the finger and pause again on release).
        claimGesture(v, s, { noPlay: true });
      } else {
        claimGesture(v, s);
      }
      if (e.cancelable) e.preventDefault();
    }

    if (s.axis === "x") {
      if (!S.swipeSeekEnabled) return;
      // Cancel state machine: swiping DOWN past `seekCancelSwipeDistance`
      // aborts, at half that distance it warns, and coming back up re-arms.
      // Cancel is checked before the offset is applied,
      // so a cancelled stroke freezes the preview instead of jumping around.
      const cancelDist = Math.max(20, S.seekCancelSwipeDistance || 40);
      if (dy > cancelDist) {
        if (!s.seekCancelled) {
          s.seekCancelled = true; s.seekWarningShown = false;
          showHint("✕ " + t("gestureSeekCancelHint"), 1200);
        }
      } else if (dy > cancelDist * 0.5) {
        if (!s.seekWarningShown) {
          s.seekWarningShown = true; s.seekCancelled = false;
          showHint(t("gestureSeekHint") + " · " + t("gestureSeekCancel"), 1200);
        }
      } else if (s.seekCancelled || s.seekWarningShown) {
        s.seekCancelled = false; s.seekWarningShown = false; hideHint();
      }
      // Deadzone: nothing happens for the first `swipeSeekSensitivity` px, so a
      // slightly slanted swipe is not read as a jump.
      const deadzone = Math.max(8, S.swipeSeekSensitivity || 30);
      if (!s.seeking && adx < deadzone) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      s.seeking = true;
      const r = gestureRect(v); // viewport-sized in native fullscreen
      // The curve: ratio = dx / videoWidth (clamped to ±1), then
      // |ratio|^1.5. Small drags are very fine (a few px ≈ a second), while a
      // full-width drag spans maxSeekRatio × duration. Distances are measured
      // from the gesture START, so dragging back always returns to the origin.
      const ratio = clamp(dx / (r.width || 400), -1, 1);
      const span = Math.pow(Math.abs(ratio), 1.5) * (v.duration || 0) * (S.maxSeekRatio ?? 1);
      // The anchor is captured ONCE (at pointer-down) and never re-read from the
      // live playhead: the gesture keeps playback running, so a live anchor made
      // the target slide with the video and both dots drifted together.
      if (!Number.isFinite(s.seekStartTime)) {
        s.seekStartTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      }
      const origin = s.seekStartTime;
      let target = clamp(origin + Math.sign(ratio) * span, 0, v.duration || 0);
      // Unlimited range is the default (this build is fully unlocked). The
      // ±10s cap only applies when "unlimited" is switched off, so the limit
      // hint can never fire for a normal install.
      if (!S.swipeSeekFreeAllowed) {
        const lim = 10;
        target = clamp(target, Math.max(0, origin - lim), Math.min(v.duration || 0, origin + lim));
      }
      s.seekTarget = target;
      if (S.thumbnailPreviewEnabled) showSeekCard(v, target, s.seekCancelled, origin);
      if (e.cancelable) e.preventDefault();
    } else if (s.axis === "y") {
      const action = gset(s.zone + "VerticalSwipe");
      // The lock / ownership checks already ran when the axis was claimed; this
      // only guards against a setting flipping mid-stroke.
      if (verticalActionBlocked(action)) return;
      const r = gestureRect(v); // viewport-sized in native fullscreen
      if (action === "volume") {
        const max = S.volumeBoostEnabled ? S.volumeBoostMax / 100 : 1;
        // The anchor is captured ONCE, on the first vertical move: `dy` is the
        // total travel since the press, so re-reading the live value each frame
        // added the whole offset again and again — a 200px swipe slammed the
        // slider to 0 (or to max) instead of moving it ~25%.
        if (s.volumeAnchor == null) {
          s.volumeAnchor = effectiveVolume(v) * 100;
          // Re-assert an existing boost (a suspended AudioContext would make
          // the cached value a lie). Never create a chain just to read it.
          if (S.volumeBoostEnabled && gainOf(v) > 1) setBoost(v, gainOf(v));
        }
        const next = clamp(s.volumeAnchor - dy / r.height * 100, 0, max * 100);
        s.volumeVal = next;
        const applied = setVolume(v, next / 100);
        // Bar fills towards the reachable maximum (300% when boost is on) and
        // the notch marks plain 100%, so the number and the scale agree.
        showMeter("volume", applied * 100, max > 1 ? (applied / max) * 100 : applied * 100,
          max > 1 ? 100 / max : undefined);
        if (applied > 1 && !s.boostHintShown) { s.boostHintShown = true; showHint(t("gestureVolumeBoostHint", { MAX: S.volumeBoostMax })); }
      } else if (action === "brightness") {
        // Same fixed-anchor rule as volume; the live value is written below.
        if (s.brightnessAnchor == null) s.brightnessAnchor = s.originalBrightness ?? 100;
        const next = setBrightness(v, s.brightnessAnchor - dy / r.height * (S.brightnessMax - S.brightnessMin));
        s.brightnessVal = next;
        const lo = S.brightnessMin, hi = S.brightnessMax;
        showMeter("brightness", next, ((next - lo) / Math.max(1, hi - lo)) * 100);
      }
      if (e.cancelable) e.preventDefault();
    }
  };

  const onEnd = (e, source = "pointer", force = false) => {
    const stroke = currentStroke();
    if (!stroke) return;
    const s = stroke.s, vid = stroke.v;
    if (!s || !s.active) return;
    // Cancel events must always be able to end the gesture, even when they come
    // from the "other" input stream (Android cancels the touch stream but the
    // gesture was claimed by pointer, and vice versa).
    if (!force && source && s.source && source !== s.source) return;
    // ...except in the one case where the other stream is known to be wrong:
    // mobile native fullscreen ignores the pointer stream at onStart because it
    // is incomplete there (no move/up, and a cancel as soon as the player takes
    // the surface). Letting that cancel through ended a hold that was still
    // running on the touch stream — the speed dropped back and the tier row
    // disappeared while the finger had not moved.
    if (source === "pointer" && s.source === "touch" && isMobile && fullscreenEl()) return;
    clearTimeout(s.longPressTimer);
    // release the pause guard installed on gesture start
    if (s.pauseGuard && vid) {
      try { vid.removeEventListener("pause", s.pauseGuard); } catch (_) {}
      s.pauseGuard = null;
    }
    s.active = false;
    if (activeStroke && activeStroke.s === s) activeStroke = null;
    hideSeekCard();

    if (s.longPressTriggered) {
      finishLongPress(vid, s);
    } else if (s.axis === "x") {
      // Commit only what the preview promised. There is intentionally no
      // flick/velocity multiplier here: the seek is purely positional, so
      // the target you see is exactly the target you get.
      if (s.seekCancelled) showHint("✕ " + t("gestureSeekCancelled"), 1200);
      // A sub-0.4s jump is indistinguishable from where we already are — skip
      // it so dragging back to the start never triggers a pointless seek.
      else if (s.seekTarget !== null && Math.abs(s.seekTarget - vid.currentTime) > 0.4) {
        pendingTapSeek.clear(); // a swipe wins over a pending tap burst
        doSeek(vid, s.seekTarget);
      }
    } else if (s.axis === "y") {
      // volume/brightness already applied
    } else if (s.passthrough || force) {
      // A stroke the page owns (or a cancelled one): not a tap, so it must not
      // seed the double-tap detector — a scroll would otherwise pair with the
      // next real tap and seek.
    } else {
      // tap → double-tap zone logic
      const now = performance.now();
      const dt = s.tap || { time: 0, x: 0, y: 0, count: 0 };
      const near = Math.hypot(e.clientX - dt.x, e.clientY - dt.y) < 50;
      const within = now - dt.time >= 50 && now - dt.time <= S.doubleTapInterval;
      if (S.doubleTapEnabled && near && within) {
        // This is the double tap: the first tap's held click is not wanted.
        cancelPendingClick();
        dt.count++;
        const action = doubleTapAction(s.zone, e.clientY, vid);
        const dir = action === "seekForward" ? 1 : action === "seekBackward" ? -1 : 0;
        if (S.doubleTapAccumulateEnabled && dir) {
          // taps so far = dt.count (the first tap seeds it with 1), so the
          // total is base × (taps - 1): 2 taps = one step, 3 = two steps…
          const base = Number(S.doubleTapSeekDuration) || 10;
          const step = base * Math.max(1, dt.count - 1);
          // Keep the record alive — the next tap has to continue this burst
          // instead of starting a fresh one.
          dt.time = now; dt.x = e.clientX; dt.y = e.clientY;
          s.tap = dt;
          pendingTapSeek.add(vid, dir, step);
          showHint((dir > 0 ? "+" : "−") + step + "s");
        } else {
          performAction(action, vid);
          dt.time = 0; dt.count = 0;
        }
        s.suppressClick = true;
        setTimeout(() => { s.suppressClick = false; }, S.doubleTapInterval || 300);
      } else {
        s.tap = { time: now, x: e.clientX, y: e.clientY, count: 1 };
        // Desktop: hold the click when a second tap would do something other
        // than play/pause, so a double-tap-to-seek cannot also toggle playback.
        if (!isMobile && S.doubleTapEnabled) {
          const act = doubleTapAction(s.zone, e.clientY, vid);
          if (act && act !== "none" && act !== "playPause") {
            const target = e.target && e.target.isConnected ? e.target : vid;
            cancelPendingClick();
            pendingClick = { x: e.clientX, y: e.clientY, target, video: vid };
            pendingClickTimer = setTimeout(() => {
              const p0 = pendingClick;
              pendingClick = null; pendingClickTimer = 0;
              if (!p0) return;
              const el = p0.target && p0.target.isConnected ? p0.target : p0.video;
              if (!el) return;
              try {
                const ev = new MouseEvent("click", {
                  bubbles: true, cancelable: true, composed: true, view: window,
                  clientX: p0.x, clientY: p0.y, button: 0, detail: 1
                });
                ev.__gestioReplay = true;
                el.dispatchEvent(ev);
              } catch (_) {}
            }, Math.max(120, S.doubleTapInterval || 300));
            s.suppressClick = true;
            setTimeout(() => { s.suppressClick = false; }, (S.doubleTapInterval || 300) + 60);
          }
        }
      }
    }
    // Hand the pause back: a stroke that started on a paused element (we had to
    // run it to make the preview visible) ends paused again. Taps never get
    // here, they never started playback.
    if (s.claimed && s.forcePlayed && !s.wasPlaying && vid) {
      try { vid.pause(); } catch (_) {}
    }
    // Any *claimed* gesture blocks the trailing synthetic click (the player's
    // own play/pause toggle, a seek jump). Deliberately not `s.moved` and not
    // the velocity tracker: a finger tap always drifts a couple of pixels, and
    // blocking on that noise made single-tap play/pause feel dead on phones.
    // Only a real gesture marks a block, never a tap.
    const claimed = s.longPressTriggered || s.draggingSpeed || s.axis === "x" || s.axis === "y";
    if (claimed) lastGestureEnd = performance.now();
    if (s.suppressClick && e.cancelable) e.preventDefault();
    // reset most fields but keep the tap record and click-suppression flag
    const tap = s.tap;
    const suppressClick = s.suppressClick;
    Object.assign(s, fresh(), { tap, suppressClick });
    if (shouldBlockNative() && e.cancelable) e.stopPropagation();
  };

  // wheel: Alt + scroll → seek
  let wheelAcc = 0, wheelTimer = 0;
  const onWheel = (e) => {
    if (!S || !S.enabled || !S.wheelSeekEnabled || !e.altKey) return;
    const v = findVideo(e.clientX, e.clientY, true);
    if (!v || v.paused) return;
    if (e.cancelable) e.preventDefault();
    wheelAcc += (e.deltaY > 0 ? 1 : -1) * S.wheelSeekDuration;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      doSeek(v, v.currentTime + wheelAcc);
      showHint((wheelAcc >= 0 ? "+" : "−") + Math.abs(wheelAcc) + "s");
      wheelAcc = 0;
    }, Math.max(50, S.wheelDebounce || 200));
  };

  // keyboard shortcuts for A-B loop
  // Normalize shifted punctuation: browsers report e.key = "{" for Shift+[,
  // but the config uses the physical key "[". Map back before matching.
  const KEY_BASE = { "{":"[", "}":"]", "|":"\\", ":":";", '"':"'", "<":",", ">":".", "?":"/",
    "!":"1", "@":"2", "#":"3", "$":"4", "%":"5", "^":"6", "&":"7", "*":"8", "(":"9", ")":"0", "_":"-" , "+":"=" };
  const baseKey = (k) => KEY_BASE[k] || k;
  const onKey = (e) => {
    if (!S || !S.enabled || !S.abLoopEnabled || !S.abShortcutsEnabled) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable) return;
    const bk = baseKey(e.key);
    const combo = (e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + bk;
    const norm = (x) => String(x || "").toLowerCase().replace(/\s/g, "");
    const K = S.abShortcuts || {};
    // combo (with modifiers) takes priority over bare key so "Shift+[" never
    // accidentally fires the plain "[" action.
    const actions = [
      [K.toggle, abToggle], [K.setA, abSetA], [K.setB, abSetB], [K.clear, abClear],
      // P used to pause the loop. With two states there is nothing to pause,
      // so it now starts / stops it, like the button. The settings key keeps
      // its old name so saved shortcut maps still map it.
      [K.togglePause, abToggle],
      [K.adjustABack, () => abAdjustA(-0.5)], [K.adjustAForward, () => abAdjustA(0.5)],
      [K.adjustBBack, () => abAdjustB(-0.5)], [K.adjustBForward, () => abAdjustB(0.5)]
    ];
    for (const [keys, fn] of actions) {
      const list = String(keys || "").split("|").map(norm).filter(Boolean);
      if (list.includes(norm(combo))) { e.preventDefault(); fn(); return; }
    }
    // bare keys only apply when no modifier is held
    if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      for (const [keys, fn] of actions) {
        const list = String(keys || "").split("|").map(norm).filter(Boolean);
        if (list.includes(norm(bk))) { e.preventDefault(); fn(); return; }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 6b. Extras: playback lock overlay + auto-rotate (all local)
  // ---------------------------------------------------------------------------
  let lockHost = null, lockRoot = null, locked = false;
  const LOCK_KEY = "gestio_locked";
  const isLocked = () => locked;

  // --- always-on lock button ------------------------------------------------
  // "Lock button" in the options page used to build the overlay only *after*
  // the popup had locked the page, so the button it names never appeared by
  // itself and the position / size settings looked broken. This pins a small
  // button to the video corner instead: tap it to lock, and the overlay (whose
  // own button unlocks) takes over from there.
  let pinHost = null, pinBtn = null, pinTimer = 0;

  // Padlock icons drawn as SVG (same visual family as the A-B panel): emoji
  // 🔒 renders differently on every platform and came out near-invisible at
  // 44px against the dark chip on some Android builds. Closed shackle = "this
  // locks", open shackle = "this releases".
  const LOCK_SVG_CLOSED =
    '<svg viewBox="0 0 24 24">' +
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/>' +
    '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>' +
    '<path d="M12 14.4v2.2"/></svg>';
  const LOCK_SVG_OPEN =
    '<svg viewBox="0 0 24 24">' +
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/>' +
    '<path d="M8 10.5V7.6a4 4 0 0 1 7.9-.9"/>' +
    '<path d="M12 14.4v2.2"/></svg>';

  function buildPin() {
    if (pinHost) return;
    pinHost = document.createElement("div");
    pinHost.setAttribute("data-gestio", "lockpin");
    pinHost.style.cssText = "position:fixed;z-index:2147483645;display:none;pointer-events:none";
    const root = pinHost.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = `
      .btn{display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;
        background:rgba(0,0,0,.5);color:#fff;line-height:1;cursor:pointer;opacity:.45;
        pointer-events:auto;transition:opacity .18s;font-family:inherit}
      .btn:hover,.btn:focus-visible{opacity:.95}
      .btn svg{width:46%;height:46%;display:block;fill:none;stroke:currentColor;stroke-width:2;
        stroke-linecap:round;stroke-linejoin:round}
    `;
    root.appendChild(st);
    pinBtn = document.createElement("button");
    pinBtn.className = "btn";
    pinBtn.type = "button";
    pinBtn.innerHTML = LOCK_SVG_CLOSED;
    pinBtn.title = t("lockBtnPin");
    pinBtn.setAttribute("aria-label", t("lockBtnPin"));
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      setLock(true);
    });
    root.appendChild(pinBtn);
    mountUi(pinHost);
    ensureUiGuard();
  }

  // The video the button should sit on. AB.video is the player the user last
  // interacted with; the fallback covers a page the user has not touched yet.
  function pinTarget() {
    if (AB.video && validVideo(AB.video)) return AB.video;
    return findVideo(innerWidth / 2, innerHeight / 2);
  }

  function updatePin() {
    if (!S || !S.gestureLockEnabled || locked) {
      if (pinHost) pinHost.style.display = "none";
      return;
    }
    buildPin();
    const v = pinTarget();
    const r = v ? v.getBoundingClientRect() : null;
    // Hide when the player is off screen / too small to tap reliably.
    if (!r || r.width < 120 || r.height < 90 || r.bottom < 0 || r.top > innerHeight) {
      pinHost.style.display = "none";
      return;
    }
    const size = clamp(Number(S.lockBtnSize) || 44, 32, 80);
    const edge = 14;
    const pos = gset("lockButtonPosition") || "left";
    pinBtn.style.width = size + "px";
    pinBtn.style.height = size + "px";
    pinBtn.style.fontSize = Math.round(size * 0.45) + "px";
    pinHost.style.top = Math.round(r.bottom - size - edge) + "px";
    if (pos === "right") {
      pinHost.style.left = "auto";
      pinHost.style.right = Math.round(Math.max(0, innerWidth - r.right) + edge) + "px";
    } else {
      pinHost.style.right = "auto";
      pinHost.style.left = Math.round(Math.max(0, r.left) + edge) + "px";
    }
    pinHost.style.display = "block";
  }

  // One cheap query per tick; only while the feature is on.
  function startPin() {
    if (pinTimer) return;
    pinTimer = setInterval(updatePin, 700);
    updatePin();
  }

  function buildLock() {
    if (lockHost) return;
    lockHost = document.createElement("div");
    lockHost.setAttribute("data-gestio", "lock");
    lockHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:none;pointer-events:auto";
    lockRoot = lockHost.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = `
      .veil{position:absolute;inset:0;background:transparent;cursor:not-allowed}
      .btn{position:absolute;bottom:26px;width:52px;height:52px;border-radius:50%;border:0;
        background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer;opacity:.6;
        display:flex;align-items:center;justify-content:center}
      .btn:hover{opacity:1}
      .btn svg{width:46%;height:46%;display:block;fill:none;stroke:currentColor;stroke-width:2;
        stroke-linecap:round;stroke-linejoin:round}
      .btn.left{left:20px} .btn.right{right:20px}
      .quick{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);display:flex;gap:18px}
      .quick button{width:48px;height:48px;border-radius:50%;border:0;background:rgba(0,0,0,.55);
        color:#fff;font-size:19px;cursor:pointer;opacity:.85}
    `;
    lockRoot.appendChild(st);
    const veil = document.createElement("div"); veil.className = "veil";
    veil.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
    lockRoot.appendChild(veil);
    const btn = document.createElement("button"); btn.className = "btn";
    btn.innerHTML = LOCK_SVG_OPEN;
    btn.title = t("lockBtnRelease");
    btn.setAttribute("aria-label", t("lockBtnRelease"));
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault(); setLock(false);
    });
    lockRoot.appendChild(btn);
    lockHost._btn = btn;
    const quick = document.createElement("div"); quick.className = "quick";
    const mk = (txt, fn) => { const b = document.createElement("button"); b.textContent = txt; b.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); fn(); }); return b; };
    quick.appendChild(mk("⏮", () => { const v = AB.video || findVideo(innerWidth / 2, innerHeight / 2); if (v) doSeek(v, v.currentTime - (S.doubleTapSeekDuration || 10)); }));
    quick.appendChild(mk("⏯", () => { const v = AB.video || findVideo(innerWidth / 2, innerHeight / 2); if (v) togglePlay(v); }));
    quick.appendChild(mk("⏭", () => { const v = AB.video || findVideo(innerWidth / 2, innerHeight / 2); if (v) doSeek(v, v.currentTime + (S.doubleTapSeekDuration || 10)); }));
    lockRoot.appendChild(quick);
    lockHost._quick = quick;
    mountUi(lockHost);
    ensureUiGuard();
  }

  function setLock(on) {
    locked = !!on;
    if (on) buildLock();
    if (lockHost) {
      layoutHud();
      lockHost.style.display = on ? "block" : "none";
      const pos = gset("lockButtonPosition") || "left";
      lockHost._btn.className = "btn " + pos;
      // lockBtnSize is a real setting; the stylesheet only carries a 52px
      // default, so apply the configured size inline.
      const size = clamp(Number(S && S.lockBtnSize) || 44, 32, 80);
      lockHost._btn.style.width = size + "px";
      lockHost._btn.style.height = size + "px";
      lockHost._quick.style.display = (S && S.lockQuickMenuEnabled) ? "flex" : "none";
    }
    try { on ? localStorage.setItem(LOCK_KEY, "1") : localStorage.removeItem(LOCK_KEY); } catch (_) {}
    // The overlay carries its own unlock button, so the pinned one hides while
    // locked and comes back the moment the overlay is dismissed.
    if (on) { if (pinHost) pinHost.style.display = "none"; }
    else updatePin();
    showHint(on ? t("lockBtnOn") : t("lockBtnOff"));
  }

  // auto-rotate to landscape when entering fullscreen (mobile only; best-effort)
  function autoRotate() {
    if (!S || !S.autoRotateFullscreen) return;
    try {
      if (!isMobile || !screen.orientation || !screen.orientation.lock) return;
      document.addEventListener("fullscreenchange", function handler() {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          screen.orientation.lock("landscape").catch(() => {});
        } else {
          try { screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
        }
      });
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // 7. registration
  // ---------------------------------------------------------------------------
  let registered = false;
  let lastGestureEnd = 0; // timestamp of the last finished gesture, for click gating
  // Desktop only: a tap that lands in a double-tap seek zone has its synthetic
  // click held for `doubleTapInterval` and replayed if no second tap follows.
  // Without the hold, the first tap of a double-tap pauses the video (its click
  // reaches the player) and the seek then happens on a paused video. Phones are
  // exempt: there the tap's whole job is to reveal the native control bar, so it
  // must never be delayed.
  let pendingClick = null, pendingClickTimer = 0;
  const cancelPendingClick = () => {
    if (pendingClickTimer) clearTimeout(pendingClickTimer);
    pendingClickTimer = 0;
    pendingClick = null;
  };
  function register() {
    if (registered) return;
    registered = true;
    const opt = { capture: true, passive: false };
    // Pointer stream (mouse + pen, and touch on browsers that only emit pointer).
    document.addEventListener("pointerdown", (e) => onStart(e, "pointer"), opt);
    document.addEventListener("pointermove", (e) => onMove(e, "pointer"), opt);
    document.addEventListener("pointerup", (e) => onEnd(e, "pointer"), opt);
    document.addEventListener("pointercancel", (e) => onEnd(e, "pointer", true), opt);
    // Touch stream (authoritative on mobile native fullscreen). Ignore multi-
    // touch (pinch-zoom): a gesture is always a single finger.
    const touchEvt = (e) => {
      const list = e.touches || e.changedTouches || [];
      return {
        clientX: e.clientX, clientY: e.clientY, target: list[0] ? list[0].target : null,
        pointerType: "touch", button: 0, cancelable: e.cancelable,
        pointerId: null,
        preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation()
      };
    };
    document.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0]; if (t0) onStart({ ...touchEvt(e), clientX: t0.clientX, clientY: t0.clientY }, "touch");
    }, opt);
    document.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0]; if (t0) onMove({ ...touchEvt(e), clientX: t0.clientX, clientY: t0.clientY }, "touch");
    }, opt);
    document.addEventListener("touchend", (e) => {
      if (e.changedTouches.length !== 1) return;
      const t0 = e.changedTouches[0]; if (t0) onEnd({ ...touchEvt(e), clientX: t0.clientX, clientY: t0.clientY }, "touch");
    }, opt);
    document.addEventListener("touchcancel", (e) => {
      onEnd({ ...touchEvt(e), clientX: 0, clientY: 0 }, "touch", true);
    }, opt);
    // Two-finger tap → toggle the brightness/volume lock for the half the
    // fingers land on. Multi-touch was already ignored by the gesture engine,
    // so this chord is free: it cannot collide with horizontal seek, vertical
    // swipe or a single-finger hold.
    //
    // The chord is deliberately forgiving, because a real two-finger tap is
    // never perfectly simultaneous: fingers land a beat apart, one lifts
    // before the other, and Android sometimes cancels the stream when the top
    // layer changes. So we (a) accept any point on the video rather than only
    // the exact midpoint, (b) fire as soon as ONE finger lifts, and (c) treat a
    // cancel with both fingers gone as a completed tap when nothing moved.
    let chord = null;
    let chordCool = 0;
    const CHORD_MAX_MS = 900;   // longest press that still counts as a tap
    const CHORD_SLOP = 26;      // px the midpoint may drift

    const chordMid = (e) => {
      const a = e.touches && e.touches[0], b = e.touches && e.touches[1];
      if (!a || !b) return null;
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    const chordBegin = (e) => {
      const mid = chordMid(e);
      if (!mid) return false;
      // Snap to the video under either finger, not just the midpoint: on a
      // native-fullscreen player the midpoint can sit on a control overlay.
      const a = e.touches[0], b = e.touches[1];
      const hit = findVideo(mid.x, mid.y, false) ||
        findVideo(a.clientX, a.clientY, false) ||
        findVideo(b.clientX, b.clientY, false);
      if (!hit) return false;
      const rect = gestureRect(hit);
      const side = mid.x < rect.left + (rect.width || 0) / 2 ? "brightness" : "volume";
      // A single-finger stroke already in flight is abandoned, never committed.
      dropGestures();
      chord = { time: performance.now(), x: mid.x, y: mid.y, moved: false, side };
      return true;
    };
    // Finish the chord and toggle the half it belongs to.
    const chordFinish = (moved) => {
      if (!chord) return;
      const held = performance.now() - chord.time;
      const side = chord.side;
      const ok = held <= CHORD_MAX_MS && !moved;
      chord = null;
      if (!ok) return;
      chordCool = performance.now() + 280;
      toggleVerticalLock(side);
    };
    document.addEventListener("touchstart", (e) => {
      if (!S || !S.enabled || S.twoFingerLockEnabled === false) return;
      const n = (e.touches || []).length;
      if (n === 2 && !chord) {
        if (performance.now() < chordCool) return;
        if (chordBegin(e) && e.cancelable) e.preventDefault();
      } else if (n > 2) {
        chord = null; // three fingers: not our chord
      }
    }, opt);
    document.addEventListener("touchmove", (e) => {
      if (!chord) return;
      const n = (e.touches || []).length;
      if (n < 2) return;
      const mid = chordMid(e);
      if (mid && Math.hypot(mid.x - chord.x, mid.y - chord.y) > CHORD_SLOP) chord.moved = true;
      if (e.cancelable) e.preventDefault();
    }, opt);
    document.addEventListener("touchend", (e) => {
      if (!chord) return;
      // Fire on the FIRST finger that lifts instead of waiting for both, so a
      // tap where one finger leaves before the other still counts.
      if ((e.touches || []).length >= 2) return;
      chordFinish(chord.moved);
    }, opt);
    document.addEventListener("touchcancel", (e) => {
      if (!chord) return;
      // Native fullscreen can cancel the stream while both fingers are still
      // down (top-layer change). Lifting both inside the window still counts —
      // unless it happened instantly, which means the cancel came from the DOM
      // changing rather than from the user.
      const held = performance.now() - chord.time;
      if ((e.touches || []).length === 0 && held >= 120) chordFinish(chord.moved);
      else chord = null;
    }, opt);
    document.addEventListener("wheel", onWheel, opt);
    document.addEventListener("keydown", onKey, true);
    // Hard safety net for the speed-tier row: whichever input stream ended the
    // stroke — or even if the end event never reached onEnd because Android
    // swallowed the touch stream — the row must never outlive the finger.
    //
    // "Whichever" only means the stream that is driving the stroke: on Android
    // the pointer sequence is cancelled the moment the player takes the surface,
    // while the touch stream keeps holding, and that stray cancel used to hide
    // the row mid-hold (the speed looked like it had given up).
    const streamHolds = (e) => {
      const cur = currentStroke();
      if (!cur || !cur.s || !cur.s.active || !cur.s.source) return false;
      const touchEvt = e && typeof e.type === "string" && e.type.indexOf("touch") === 0;
      return (touchEvt ? "touch" : "pointer") !== cur.s.source;
    };
    const dropTiers = (e) => { if (!streamHolds(e)) hideTiers(); };
    ["pointerup", "pointercancel", "touchend", "touchcancel", "mouseup"]
      .forEach((evt) => document.addEventListener(evt, dropTiers, true));
    const dropSeek = (e) => { if (!streamHolds(e)) hideSeekCard(); };
    ["pointercancel", "touchcancel", "mouseup"].forEach((evt) => document.addEventListener(evt, dropSeek, true));
    window.addEventListener("blur", () => hideTiers(), true);
    window.addEventListener("blur", () => hideSeekCard(), true);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { hideTiers(); hideSeekCard(); } });
    // A player that inserts its <video> after load (most SPA players) never had
    // touch-action set: (re)apply when a media element becomes usable.
    ["play", "loadedmetadata", "canplay"].forEach((evt) => {
      document.addEventListener(evt, () => scheduleTouchAction(300), true);
    });
    // The HUD is pinned to the video's box while windowed, so it has to follow
    // the page when it scrolls (capture catches inner scrollers too).
    window.addEventListener("scroll", scheduleLayout, true);
    window.addEventListener("resize", scheduleLayout);
    // A long press is our speed hold; without this the Android context menu
    // steals it on windowed players, where we no longer cancel touchstart.
    document.addEventListener("contextmenu", (e) => {
      if (!S || !S.enabled || !shouldBlockNative()) return;
      if (findVideo(e.clientX, e.clientY, false) && e.cancelable) e.preventDefault();
    }, true);
    // Click suppression: after any real gesture, the browser/player would fire
    // a synthetic click (play/pause toggle, seek jump). Block it for
    // clickBlockTimeout.
    document.addEventListener("click", (e) => {
      if (e.__gestioReplay) return; // our own replayed tap click
      // A click on our own overlays is a control, not a click on the video:
      // suppressing it (within the post-gesture window) made the A-B card's
      // buttons feel dead right after a swipe.
      if (isUI(e.target)) return;
      const v = findVideo(e.clientX, e.clientY);
      const within = performance.now() - lastGestureEnd < (S ? S.clickBlockTimeout || 200 : 200);
      if (v && (within || st(v).suppressClick)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  // react to runtime messages (settings changed, options actions)
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || typeof msg.action !== "string") return;
    switch (msg.action) {
      case "ping": reply({ pong: true }); return true;
      case "settings_changed":
        // Reply once the new settings are in: returning true without ever
        // calling reply() left the port open ("message port closed before a
        // response was received") and options.js waited on a promise.
        getSettings()
          .then(() => {
            const on = !!(S && S.abLoopEnabled);
            // Switching the feature off stops the loop instead of freezing it
            // mid-run: A and B are kept, the button returns as "not playing".
            if (!on) {
              if (AB.on) abStop();
              removeABPanel(false);
              stopABTicker();
            } else if (abPanelHidden()) {
              // The timer stays: it is what brings the card back on the next
              // page (or when the popup switch flips).
              startABTicker();
              removeABPanel(true);
            } else {
              startABTicker();
              ensureABPanel();
            }
            updateABPanel();
            if (S && S.gestureLockEnabled) startPin();
            updatePin();
            reply({ ok: true });
          })
          .catch(() => reply({ ok: false }));
        return true;
      // The card's visibility is a per-page state now, so the popup asks the
      // page it is showing rather than reading a global preference.
      case "ab_panel_get": reply({ ok: true, visible: !abPanelHidden() }); return true;
      case "ab_panel_set":
        setAbPanelVisible(!!msg.visible);
        reply({ ok: true, visible: !abPanelHidden() });
        return true;
      case "lock_toggle": setLock(!locked); reply({ ok: true, locked }); return true;
      case "lock_set": setLock(!!msg.value); reply({ ok: true, locked }); return true;
      case "lock_get": reply({ ok: true, locked }); return true;
      case "ab_set_a": abSetA(); reply({ ok: true }); return true;
      case "ab_set_b": abSetB(); reply({ ok: true }); return true;
      case "ab_toggle": abToggle(); reply({ ok: true }); return true;
      case "ab_clear": abClear(); reply({ ok: true }); return true;
      default: return false;
    }
  });

  // Keep the on-video wording in step with the settings page without waiting
  // for a broadcast: storage changes reach us directly, even when the service
  // worker is asleep and cannot answer messages.
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local" || !S || !ch) return;
      const next = ch[SETTINGS_KEY] && ch[SETTINGS_KEY].newValue;
      if (next && next.language) S.language = next.language;
    });
  } catch (_) {}

  // ---------------------------------------------------------------------------
  // 8. boot
  // ---------------------------------------------------------------------------
  (async () => {
    await getSettings();
    // Snapshot the stored lock once: from here on this page has its own copy
    // and the settings are only what the NEXT page will start from.
    pageLock = initialLockSet();
    // Same idea for the card: whether it is tucked away belongs to this tab,
    // and within the tab to this page.
    AB.hidden = readAbHidden();
    register();
    applyTouchAction();
    autoRotate();
    if (S && S.abLoopEnabled) { startABTicker(); ensureABPanel(); await restoreAB(); }
    if (S && S.gestureLockEnabled) {
      let wasLocked = false;
      try { wasLocked = localStorage.getItem(LOCK_KEY) === "1"; } catch (_) {}
      if (wasLocked) setLock(true);
      // Keep the pinned button in sync with videos that appear later (SPA
      // navigation, a player that swaps out on route change, fullscreen).
      startPin();
    }
  })();
})();
