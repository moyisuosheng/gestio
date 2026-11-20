/**
 * Popup status-message tests (jsdom).
 *
 * Why: on Android, opening an already-downloaded video hands off to the
 * browser's own player at `content://media/...`. That URL never appears in
 * chrome.tabs.query(), cannot be matched by any host permission and cannot be
 * scripted, so gestures are simply dead there. Before this test the popup said
 * "Open a normal web page (http/https)" (or worse: reported the neighbouring
 * tab as active), which reads like a bug in the extension instead of a platform
 * limit. Each unsupported scheme now gets its own explanation.
 *
 * Run: node tests/popup-status-test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const POPUP_HTML = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
const POPUP_JS = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
const I18N_JS = fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8");

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Mobile Safari/537.36 EdgA/160.0.0.0";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Safari/537.36 Edg/160.0.0.0";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPopup({ tabs, ping = null, ua = DESKTOP_UA, lang = "en", delay = 0, wait = 80, settings = {}, panelVisible }) {
  const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only", url: "chrome-extension://test/popup.html" });
  const w = dom.window;
  // jsdom 24 has no `userAgent` option; the property is writable, so override it
  // before popup.js runs — that is the only way to exercise the Android branch.
  Object.defineProperty(w.navigator, "userAgent", { value: ua, configurable: true });
  const sent = [], tabMsgs = [];
  w.chrome = {
    runtime: {
      sendMessage: async (m) => {
        sent.push(m);
        // `delay` emulates Android, where the MV3 worker is usually asleep and
        // the first message has to wake it (hundreds of ms).
        if (delay) await sleep(delay);
        if (m.action === "get_settings") return { ok: true, settings: { enabled: true, language: lang, ...settings } };
        return { ok: true };
      },
      openOptionsPage: () => {},
    },
    tabs: {
      query: () => Promise.resolve(tabs),
      sendMessage: (id, m) => {
        tabMsgs.push({ id, m });
        return Promise.resolve(
          m && m.action === "ab_panel_get" && panelVisible !== undefined
            ? { ok: true, visible: panelVisible }
            : m && m.action === "ab_panel_set" ? { ok: true, visible: m.visible }
            : ping);
      },
    },
  };
  w.eval(I18N_JS);
  w.eval(POPUP_JS);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await sleep(wait);
  const el = w.document.getElementById("status");
  const btn = w.document.getElementById("lockBtn");
  return { doc: w.document, status: el && el.textContent, cls: el && el.className,
    disabled: btn && btn.disabled, sent, tabMsgs };
}

(async () => {
  // 1. Android local file: the media page is not a tab at all, so the popup
  //    gets an empty query result. Must not say "open a normal web page".
  {
    const r = await openPopup({ tabs: [], ua: ANDROID_UA });
    check("[popup] android + no tab explains the built-in local player",
      /content:\/\//.test(r.status) && /http\(s\)/.test(r.status) && r.cls.includes("bad"), r.status);
    check("[popup] the lock button is disabled on such a page", r.disabled === true, "disabled=" + r.disabled);
  }

  // 2. content:// tab (if a build ever exposes it) gets the same message.
  {
    const r = await openPopup({ tabs: [{ id: 1, url: "content://media/external/downloads/13433105" }] });
    check("[popup] content:// is reported as an unscriptable player page",
      /content:\/\//.test(r.status) && /http\(s\)/.test(r.status), r.status);
  }

  // 3. file:// on desktop → hint about the file-URL toggle.
  {
    const r = await openPopup({ tabs: [{ id: 2, url: "file:///D:/video/movie.mp4" }] });
    check("[popup] desktop file:// points at “Allow access to file URLs”",
      /Allow access to file URLs/.test(r.status), r.status);
  }

  // 4. file:// on Android → no such toggle exists, say so instead.
  {
    const r = await openPopup({ tabs: [{ id: 3, url: "file:///sdcard/Download/movie.mp4" }], ua: ANDROID_UA });
    check("[popup] android file:// explains that local files are off limits",
      /do not let extensions read local files/.test(r.status) && /http\(s\)/.test(r.status), r.status);
  }

  // 5. Browser-internal pages.
  {
    const r = await openPopup({ tabs: [{ id: 4, url: "edge://extensions/" }] });
    check("[popup] browser-internal page is called out", /Browser-internal/.test(r.status), r.status);
  }

  // 6. Normal page that answers the ping → still the green "active" state and
  //    the lock button usable again.
  {
    const r = await openPopup({ tabs: [{ id: 5, url: "https://example.com/watch" }], ping: { pong: true } });
    check("[popup] a scriptable page still reports active", /Active on this page/.test(r.status), r.status);
    check("[popup] the lock button is enabled on a scriptable page", r.disabled === false, "disabled=" + r.disabled);
  }

  // 7. Chinese UI keeps the same information (no fallback to English).
  {
    const r = await openPopup({ tabs: [], ua: ANDROID_UA, lang: "zh_CN" });
    check("[popup] the local-player message is translated", /本地文件播放页/.test(r.status) && !/browser’s own player/.test(r.status), r.status);
  }

  // 8. Slow worker (Android): the status line must wait for the stored language
  //    instead of rendering the first message with the fallback language, and it
  //    must not be overwritten by the initial translation pass (that pass only
  //    knows the placeholder "Checking this tab…").
  {
    const r = await openPopup({ tabs: [], ua: ANDROID_UA, lang: "zh_CN", delay: 300, wait: 700 });
    check("[popup] a slow worker still renders the message in the chosen language",
      /本地文件播放页/.test(r.status), r.status);
    check("[popup] the status message is not reset to the placeholder",
      !/正在检查此标签页|Checking this tab/.test(r.status), r.status);
  }

  // 9. The A-B card switch belongs to the page, not to the browser: it mirrors
  //    the tab it is showing, and it is only usable while A-B loop is on (the
  //    panel cannot exist without it).
  {
    const r = await openPopup({
      tabs: [{ id: 1, url: "https://example.com/watch" }], ping: { pong: true },
      settings: { abLoopEnabled: true }, panelVisible: false, wait: 200,
    });
    const el = r.doc.getElementById("abPanelVisible");
    const row = r.doc.getElementById("abPanelRow");
    check("[popup] the A-B card switch mirrors this page", !!el && el.checked === false, "checked=" + (el && el.checked));
    check("[popup] ...and is usable while the loop is on",
      !!el && el.disabled === false && !!row && !row.classList.contains("is-off"),
      "disabled=" + (el && el.disabled));
  }
  {
    const r = await openPopup({
      tabs: [{ id: 1, url: "https://example.com/watch" }], ping: { pong: true },
      settings: { abLoopEnabled: false }, wait: 200,
    });
    const el = r.doc.getElementById("abPanelVisible");
    const row = r.doc.getElementById("abPanelRow");
    check("[popup] the nested switch is unavailable while the loop is off",
      !!el && el.disabled === true && !!row && row.classList.contains("is-off"),
      "disabled=" + (el && el.disabled));
  }
  {
    // No content script answers (browser page / local file): the switch cannot
    // do anything, so it must not pretend it can.
    const r = await openPopup({ tabs: [{ id: 1, url: "edge://settings" }], wait: 200 });
    const el = r.doc.getElementById("abPanelVisible");
    check("[popup] an unscriptable page disables the card switch", !!el && el.disabled === true, "disabled=" + (el && el.disabled));
  }

  {
    // Flipping the A-B card switch sends it to THIS tab, and writes no global
    // preference (that is what used to hide the card on every other site).
    const r = await openPopup({
      tabs: [{ id: 1, url: "https://example.com/watch" }], ping: { pong: true },
      settings: { abLoopEnabled: true }, panelVisible: true, wait: 200,
    });
    const el = r.doc.getElementById("abPanelVisible");
    el.checked = false;
    el.dispatchEvent(new r.doc.defaultView.Event("change"));
    await sleep(60);
    const call = r.tabMsgs.find((x) => x.m && x.m.action === "ab_panel_set");
    check("[popup] flipping the switch talks to this page only",
      !!call && call.id === 1 && call.m.visible === false, JSON.stringify(r.tabMsgs));
    check("[popup] ...and writes no global setting",
      !r.sent.some((m) => m.action === "set_settings" && m.settings && "abPanelVisible" in m.settings),
      JSON.stringify(r.sent));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(3); });
