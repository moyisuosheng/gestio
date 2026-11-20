/*
 * jsdom test for the gesture cheat sheet (guide.html) language bootstrap.
 *
 * Regression: the page used to depend on a single chrome.runtime.sendMessage
 * round trip. On Android the service worker is killed aggressively, that reply
 * never arrived, and the sheet stayed English while the settings page was
 * already Chinese. The page now resolves the language from ?lang= first, then
 * chrome.storage.local, then the message.
 *
 * Usage: node tests/guide-lang-test.js
 */
const fs = require('fs');
const path = require('path');

const { JSDOM } = require('jsdom');

const DIR = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(DIR, 'guide.html'), 'utf8');
const I18N_JS = fs.readFileSync(path.join(DIR, 'i18n.js'), 'utf8');
const GUIDE_JS = fs.readFileSync(path.join(DIR, 'guide.js'), 'utf8');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's own bootstrap, taken from its external file (jsdom runs it
// manually so the test can control which chrome.* APIs exist). It used to be
// read out of an inline <script> — which MV3's default CSP silently blocks in
// the real extension, so these tests passed while the shipped page stayed
// English. It now has to live in guide.js, and test 8 enforces that.
const BOOTSTRAP = GUIDE_JS;

function makePage(url, chromeImpl) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url, pretendToBeVisual: true });
  const { window } = dom;
  delete window.chrome;
  if (chromeImpl) window.chrome = chromeImpl;
  window.eval(I18N_JS);
  window.eval(BOOTSTRAP);
  return { dom, window };
}

const heading = (window) => window.document.querySelector('h2').textContent;
const firstDesc = (window) => (window.document.querySelectorAll('.row .d')[0] || {}).textContent || '';

(async () => {
  // 1. ?lang= alone — no extension APIs at all (worst case: page opened in a
  //    plain tab where chrome.runtime does not exist).
  {
    const { window } = makePage('chrome-extension://test/guide.html?lang=zh_CN', null);
    await sleep(20);
    check('?lang=zh_CN translates without any chrome API',
      /网格/.test(heading(window)), heading(window));
    check('descriptions are Chinese too', /[\u4e00-\u9fa5]/.test(firstDesc(window)),
      firstDesc(window).slice(0, 24));
  }

  // 2. storage only — the Android case: the service worker never answers.
  {
    const { window } = makePage('chrome-extension://test/guide.html', {
      runtime: {
        getURL: (p) => 'chrome-extension://test/' + p,
        getManifest: () => ({ version: 'test' }),
        sendMessage: () => { /* never replies */ },
      },
      i18n: { getUILanguage: () => 'en-US' },
      storage: {
        local: { get: (k, cb) => setTimeout(() => cb({ gestio_settings_v1: { language: 'zh_CN' } }), 5) },
        onChanged: { addListener: () => {} },
      },
    });
    await sleep(60);
    check('storage alone translates when sendMessage never replies',
      /网格/.test(heading(window)), heading(window));
  }

  // 3. the old message path still works
  {
    const { window } = makePage('chrome-extension://test/guide.html', {
      runtime: {
        getURL: (p) => 'chrome-extension://test/' + p,
        sendMessage: (msg, cb) => cb({ ok: true, settings: { language: 'zh_CN' } }),
      },
      i18n: { getUILanguage: () => 'en-US' },
      storage: { local: { get: (k, cb) => cb({}) }, onChanged: { addListener: () => {} } },
    });
    await sleep(30);
    check('get_settings message still translates the sheet',
      /网格/.test(heading(window)), heading(window));
  }

  // 4. English stays English (no over-translation)
  {
    const { window } = makePage('chrome-extension://test/guide.html?lang=en', {
      runtime: { sendMessage: (m, cb) => cb({ ok: true, settings: { language: 'en' } }) },
      i18n: { getUILanguage: () => 'zh-CN' },
      storage: { local: { get: (k, cb) => cb({}) }, onChanged: { addListener: () => {} } },
    });
    await sleep(30);
    check('forced English stays English', /grid/.test(heading(window)), heading(window));
    check('<html lang> follows the choice', window.document.documentElement.lang === 'en',
      window.document.documentElement.lang);
  }

  // 5. A slow reply that says "auto" must not undo an explicit choice. This is
  //    the failure mode that made the sheet flash Chinese and fall back to
  //    English a moment later: ?lang= landed first, storage answered second.
  {
    const { window } = makePage('chrome-extension://test/guide.html?lang=zh_CN', {
      runtime: {
        getURL: (p) => 'chrome-extension://test/' + p,
        sendMessage: (msg, cb) => setTimeout(() => cb({ ok: true, settings: { language: 'auto' } }), 30),
      },
      i18n: { getUILanguage: () => 'en-US' },
      storage: {
        local: { get: (k, cb) => setTimeout(() => cb({ gestio_settings_v1: { language: 'auto' } }), 15) },
        onChanged: { addListener: () => {} },
      },
    });
    await sleep(90);
    check('a late "auto" reply cannot overwrite ?lang=zh_CN',
      /网格/.test(heading(window)), heading(window));
    check('the sheet keeps the chosen language in <html lang>',
      window.document.documentElement.lang === 'zh-CN', window.document.documentElement.lang);
  }

  // 6. ...but a real change while the sheet is open still takes effect.
  {
    let fire = null;
    const { window } = makePage('chrome-extension://test/guide.html?lang=zh_CN', {
      runtime: { getURL: (p) => 'chrome-extension://test/' + p, sendMessage: () => {} },
      i18n: { getUILanguage: () => 'en-US' },
      storage: {
        local: { get: (k, cb) => cb({ gestio_settings_v1: { language: 'zh_CN' } }) },
        onChanged: { addListener: (fn) => { fire = fn; } },
      },
    });
    await sleep(40);
    check('starts in Chinese', /网格/.test(heading(window)), heading(window));
    if (fire) fire({ gestio_settings_v1: { newValue: { language: 'en' } } }, 'local');
    await sleep(20);
    check('switching to English in the options page updates an open sheet',
      /grid/.test(heading(window)), heading(window));
    if (fire) fire({ gestio_settings_v1: { newValue: { language: 'auto' } } }, 'local');
    await sleep(20);
    check('switching back to auto is honoured (browser UI is English here)',
      /grid/.test(heading(window)), heading(window));
  }

  // 7. every static string in the shipped pages has a Chinese entry — a missing
  //    key silently falls back to English, which is exactly how this bug looked.
  {
    const sandbox = { chrome: { i18n: { getUILanguage: () => 'zh-CN' } }, navigator: { language: 'zh-CN' } };
    sandbox.global = sandbox;
    require('vm').createContext(sandbox);
    require('vm').runInContext(I18N_JS, sandbox);
    const ZH = sandbox.VW_I18N.ZH;
    const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    for (const file of ['guide.html', 'options.html', 'popup.html']) {
      const html = fs.readFileSync(path.join(DIR, file), 'utf8');
      const re = /data-i18n(?:-html|-title)?="([^"]*)"/g;
      const missing = [];
      let m;
      while ((m = re.exec(html))) {
        const key = unescape(m[1]);
        if (!ZH[key]) missing.push(key);
      }
      check(`${file}: every data-i18n key has a Chinese entry`, missing.length === 0,
        missing.slice(0, 3).join(' | '));
    }
  }

  // 8. MV3 serves extension pages with `script-src 'self'`; any inline <script>
  //    is dropped without a visible error, which is what kept this sheet
  //    English. Every script in every page must therefore be an external file.
  {
    for (const file of ['guide.html', 'options.html', 'popup.html']) {
      const html = fs.readFileSync(path.join(DIR, file), 'utf8');
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
        .filter((m) => m[1].trim().length > 0);
      check(`${file}: no inline <script> (blocked by MV3 CSP)`, inline.length === 0,
        inline.length ? inline[0][1].trim().slice(0, 40) : '');
    }
  }

  // 9. the cheat sheet actually loads its bootstrap as a file
  {
    const html = fs.readFileSync(path.join(DIR, 'guide.html'), 'utf8');
    check('guide.html loads guide.js', /<script src="guide\.js"><\/script>/.test(html));
    check('guide.js bootstraps i18n', /VW_I18N\.apply/.test(GUIDE_JS));
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
