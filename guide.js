/*
 * Gestio — language bootstrap for the gesture cheat sheet (guide.html).
 *
 * IMPORTANT: this used to live inline in guide.html. MV3 extension pages are
 * served with the default CSP `script-src 'self'`, which blocks inline
 * <script> blocks outright — so none of the translation code below ever ran in
 * the real extension and the sheet stayed English no matter what the settings
 * page said. It must stay in its own file.
 *
 * Language sources, cheapest first:
 *   1. localStorage cache — synchronous, so the first paint is already correct
 *   2. ?lang= in the URL (the settings page passes its current choice)
 *   3. chrome.storage.local — works even with no service worker alive
 *   4. the old get_settings message, only as a fallback
 * A storage listener keeps an already-open sheet in sync.
 *
 * Precedence matters: answers arrive in no guaranteed order, and a slow reply
 * saying "auto" must never overwrite an explicit 中文/English choice.
 */
(function () {
  var KEY = "gestio_settings_v1";
  var CACHE = "gestio_lang";
  var lang = "auto";
  var explicit = null;   // "zh_CN" | "en" once any source names one

  function apply() {
    try { if (window.VW_I18N) window.VW_I18N.apply(document, lang); } catch (_) {}
  }
  // `live` is only true for a storage event (the user changed the setting while
  // this sheet is open) — that one may also go back to "auto".
  // `fromCache` marks the value as a hint for the first paint only: it must be
  // silently overridden by whichever real source answers next.
  function useLang(l, live, fromCache) {
    if (!l || typeof l !== "string") return;
    if (!fromCache) {
      if (l === "auto" && explicit && !live) return; // stale reply: never downgrade
      if (l !== "auto") explicit = l;
    }
    try { localStorage.setItem(CACHE, l); } catch (_) {}
    if (l === lang) return;
    lang = l;
    apply();
  }

  // 1. synchronous cache — no flicker, no dependency on any async API
  try {
    var cached = localStorage.getItem(CACHE);
    if (cached) useLang(cached, false, true);
  } catch (_) {}

  apply(); // first paint (cache, else "auto" = browser UI language)

  // 2. ?lang= from the settings page
  try {
    var m = /[?&]lang=([^&]+)/.exec(location.search);
    if (m) useLang(decodeURIComponent(m[1]), false);
  } catch (_) {}

  // 3. storage
  try {
    chrome.storage.local.get(KEY, function (obj) {
      var s = obj && obj[KEY];
      if (s && s.language) useLang(s.language, false);
    });
  } catch (_) {}

  // 4. legacy message fallback
  try {
    chrome.runtime.sendMessage({ action: "get_settings" }, function (r) {
      if (r && r.settings && r.settings.language) useLang(r.settings.language, false);
    });
  } catch (_) {}

  // keep an open sheet in sync with the settings page
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== "local" || !ch[KEY]) return;
      var s = ch[KEY].newValue;
      if (s && s.language) useLang(s.language, true);
    });
  } catch (_) {}
})();
