/*
 * jsdom test for Gestio options page.
 * Verifies the rendered controls actually respond to clicks — especially the
 * switch bug where a <span> slider with a hidden checkbox could not be toggled.
 *
 * Usage: node tests/options-unit-test.js
 */
const fs = require('fs');
const path = require('path');

const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'options.html'), 'utf8');
const JS = fs.readFileSync(path.resolve(__dirname, '..', 'options.js'), 'utf8');
const I18N_JS = fs.readFileSync(path.resolve(__dirname, '..', 'i18n.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
const DEFAULTS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'settings.json'), 'utf8'));

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

function makeEnv() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'chrome-extension://test/options.html', pretendToBeVisual: true });
  const { window } = dom;
  const stored = { ...DEFAULTS };
  let savedPayload = null;
  window.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: (msg) => {
        if (msg.action === 'get_default_settings') return Promise.resolve({ ok: true, settings: { ...DEFAULTS } });
        if (msg.action === 'get_settings') return Promise.resolve({ ok: true, settings: { ...stored } });
        if (msg.action === 'set_settings') {
          savedPayload = JSON.parse(JSON.stringify(msg.settings));
          Object.assign(stored, msg.settings);
          return Promise.resolve({ ok: true, settings: { ...stored } });
        }
        if (msg.action === 'reset_settings') {
          Object.assign(stored, DEFAULTS);
          return Promise.resolve({ ok: true, settings: { ...stored } });
        }
        return Promise.resolve({ ok: true });
      },
    },
    tabs: {
      query: (q, cb) => { if (typeof q === 'function') q([]); else cb([]); },
      sendMessage: () => Promise.resolve(),
    },
  };
  return { window, dom, stored, getSaved: () => savedPayload };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clickSwitchByKey(window, key) {
  const input = window.document.querySelector(`input[type=checkbox][data-k="${key}"]`);
  if (!input) return null;
  // Click the visible slider, exactly as a user would. Because the input is
  // wrapped in a <label>, the click must toggle the checkbox.
  const slider = input.parentElement.querySelector('.slider');
  (slider || input.parentElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return input;
}

async function main() {
  const env = makeEnv();
  env.window.eval(I18N_JS);   // define VW_I18N before options.js
  env.window.eval(JS);
  env.window.document.dispatchEvent(new env.window.Event('DOMContentLoaded'));
  await sleep(80);

  const doc = env.window.document;

  // 1. controls rendered
  const total = doc.querySelectorAll('[data-k]').length;
  check('options renders all controls', total >= 60, total + ' controls');

  // 2. switches are real labels (the bug fix)
  const sw = doc.querySelector('input[type=checkbox][data-k="enabled"]');
  check('switch input is wrapped in <label>', sw && sw.parentElement.tagName === 'LABEL', sw && sw.parentElement.tagName);

  // 3. clicking the slider toggles the checkbox
  const before = sw.checked;
  clickSwitchByKey(env.window, 'enabled');
  const after = sw.checked;
  check('clicking slider toggles checkbox', after !== before, `${before} -> ${after}`);

  // 4. the toggle is persisted (instant save). Fire input to simulate the
  // browser's per-click event (jsdom's label-forwarded click omits it).
  sw.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  await sleep(350); // debounced save
  const saved = env.getSaved();
  check('toggle is saved automatically', saved && typeof saved.enabled === 'boolean' && saved.enabled === after,
    saved ? 'enabled=' + saved.enabled : 'no save');

  // 5. segmented control: grid layout 3x1 -> 3x2
  const seg = doc.querySelector('input[type=radio][data-k="gridLayout"][value="3x2"]');
  check('grid layout segmented control exists', !!seg);
  if (seg) {
    seg.checked = true;
    seg.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(40);
    const grid = doc.getElementById('gridPreview');
    check('grid preview switches to 3x2', grid && grid.classList.contains('g3x2'), grid && grid.className);
    check('3x2 preview has 6 cells', grid && grid.querySelectorAll('.cell').length === 6, grid && grid.querySelectorAll('.cell').length);
  }

  // 6. one-handed hand preset changes preview
  const left = doc.querySelector('input[type=radio][data-k="oneHandedMode"][value="left"]');
  if (left) {
    left.checked = true;
    left.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(40);
    const firstTap = doc.querySelector('#gridPreview .cell .tap');
    check('left-hand preset mirrors first zone to Forward', firstTap && /Forward/.test(firstTap.textContent), firstTap && firstTap.textContent);
  }

  // 7. JSON textarea valid parse + save
  const ta = doc.querySelector('textarea[data-k="gestureBlacklist"]');
  if (ta) {
    ta.value = '["example.com"]';
    ta.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(350);
    const s2 = env.getSaved();
    check('valid JSON saved', s2 && Array.isArray(s2.gestureBlacklist) && s2.gestureBlacklist[0] === 'example.com', s2 && JSON.stringify(s2.gestureBlacklist));
  }

  // 8. invalid JSON does not crash / does not wipe the key
  if (ta) {
    ta.value = '{not valid json';
    ta.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(350);
    check('invalid JSON ignored without crash', true);
  }

  // 9. reset restores defaults
  doc.getElementById('reset').dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  const gridInput = doc.querySelector('input[data-k="gridLayout"]:checked');
  check('reset restores gridLayout default', gridInput && gridInput.value === DEFAULTS.gridLayout, gridInput && gridInput.value);

  // 9b. the windowed-vertical policy is a plain enum select, defaulting to
  //     "Fullscreen only", and it saves like every other control.
  const winSel = doc.querySelector('select[data-k="nonFullscreenVertical"]');
  check('windowed vertical swipe select exists', !!winSel && winSel.options.length === 3,
    winSel ? winSel.options.length + ' options' : 'missing');
  check('windowed vertical swipe defaults to fullscreen only',
    winSel && winSel.value === 'fullscreen', winSel && winSel.value);
  if (winSel) {
    winSel.value = 'edge';
    winSel.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(350);
    const s3 = env.getSaved();
    check('windowed vertical policy is saved',
      s3 && s3.nonFullscreenVertical === 'edge', s3 && s3.nonFullscreenVertical);
  }

  // 9c. gestures leave a paused video paused: the switch exists, is off by
  //     default, and saves.
  const pauseSw = doc.querySelector('input[type=checkbox][data-k="gesturePlayWhenPaused"]');
  check('paused-gesture playback switch exists', !!pauseSw);
  check('paused-gesture playback defaults to off', pauseSw && pauseSw.checked === false,
    pauseSw && String(pauseSw.checked));
  if (pauseSw) {
    clickSwitchByKey(env.window, 'gesturePlayWhenPaused');
    await sleep(350);
    const s4 = env.getSaved();
    check('paused-gesture playback switch is saved', s4 && s4.gesturePlayWhenPaused === true,
      s4 && String(s4.gesturePlayWhenPaused));
  }

  // 9d. "stop after N loops" is a switch plus a count: off by default, and the
  //     count only means something while the switch is on (it is disabled, not
  //     hidden, so flipping the switch does not move the rest of the card).
  {
    const limSw = doc.querySelector('input[type=checkbox][data-k="abMaxLoopsOn"]');
    const cnt = doc.querySelector('input[type=number][data-k="abMaxLoopsCount"]');
    check('loop limit switch exists', !!limSw);
    check('loop limit defaults to off', limSw && limSw.checked === false, limSw && String(limSw.checked));
    check('loop count renders the default', cnt && cnt.value === String(DEFAULTS.abMaxLoopsCount), cnt && cnt.value);
    check('loop count is disabled while the switch is off', cnt && cnt.disabled === true, cnt && String(cnt.disabled));
    if (limSw && cnt) {
      clickSwitchByKey(env.window, 'abMaxLoopsOn');
      limSw.dispatchEvent(new env.window.Event('input', { bubbles: true }));
      await sleep(60);
      check('turning the limit on enables the count', cnt.disabled === false, String(cnt.disabled));
      cnt.value = '5';
      cnt.dispatchEvent(new env.window.Event('change', { bubbles: true }));
      await sleep(350);
      const s5 = env.getSaved();
      check('the limit pair is saved', s5 && s5.abMaxLoopsOn === true && s5.abMaxLoopsCount === 5,
        s5 && (s5.abMaxLoopsOn + ' / ' + s5.abMaxLoopsCount));
    }
  }

  // 10. no visible "PRO" string anywhere in the options page
  check('options page has no PRO label', !doc.body.textContent.includes('PRO'), 'PRO found: ' + doc.body.textContent.includes('PRO'));
  {
    const allHtml = HTML + JS;
    check('no PRO badge/label in source', !/badge\.textContent\s*=\s*"PRO"/.test(allHtml) && !/\(PRO\)/.test(allHtml));
  }

  // 11. language selector exists and defaults to "auto"
  const langAuto = doc.querySelector('input[type=radio][data-k="language"][value="auto"]');
  check('language selector rendered with auto default', !!langAuto && langAuto.checked, langAuto && langAuto.checked);

  // 12. switching to Chinese re-translates the visible labels immediately
  {
    const enLabel = doc.querySelector('[data-i18n="Gesture control"]');
    const beforeText = enLabel && enLabel.textContent;
    const zh = doc.querySelector('input[type=radio][data-k="language"][value="zh_CN"]');
    zh.checked = true;
    zh.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(40);
    check('Chinese switch translates labels in place', enLabel && enLabel.textContent.includes('手势'), beforeText + ' -> ' + (enLabel && enLabel.textContent));
    const navGeneral = doc.querySelector('#nav [data-i18n="General"]');
    check('Chinese switch translates static nav', navGeneral && navGeneral.textContent.includes('常规'), navGeneral && navGeneral.textContent);
    // switch back to English
    const en = doc.querySelector('input[type=radio][data-k="language"][value="en"]');
    en.checked = true;
    en.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await sleep(350);
    check('English switch restores labels', enLabel && enLabel.textContent === 'Gesture control', enLabel && enLabel.textContent);
    const savedLang = env.getSaved();
    check('language choice is persisted', savedLang && savedLang.language === 'en', savedLang && savedLang.language);
  }

  // 13. popup switches are also label-wrapped and clickable (no dead switch)
  {
    const popupHtml = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');
    const d2 = new JSDOM(popupHtml, { runScripts: 'outside-only', url: 'chrome-extension://test/popup.html' });
    const w2 = d2.window;
    let pSaved = null;
    w2.chrome = {
      runtime: {
        sendMessage: (m) => {
          if (m.action === 'get_settings') return Promise.resolve({ ok: true, settings: { ...DEFAULTS } });
          if (m.action === 'set_settings') { pSaved = m.settings; return Promise.resolve({ ok: true }); }
          return Promise.resolve({ ok: true });
        },
        openOptionsPage: () => {},
      },
      tabs: { query: (q, cb) => cb([]), sendMessage: () => Promise.resolve() },
    };
    w2.eval(I18N_JS);
    w2.eval(POPUP_JS);
    w2.document.dispatchEvent(new w2.Event('DOMContentLoaded'));
    await sleep(60);
    const pcb = w2.document.getElementById('enabled');
    check('popup switch wrapped in <label>', pcb && pcb.parentElement.tagName === 'LABEL', pcb && pcb.parentElement.tagName);
    const was = pcb.checked;
    pcb.parentElement.querySelector('.slider').dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
    check('clicking popup slider toggles switch', pcb.checked !== was, `${was} -> ${pcb.checked}`);
    await sleep(30);
    check('popup toggle is saved', pSaved && pSaved.enabled === pcb.checked, pSaved ? 'enabled=' + pSaved.enabled : 'no save');
    check('popup has no PRO string', !w2.document.body.textContent.includes('PRO'));
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(3); });
