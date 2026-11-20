/*
 * Gestio — MAIN world helper.
 * Runs in the page's JS world so it can pin HTMLMediaElement.playbackRate
 * against sites that forcibly reset it. Communication is via a DOM attribute:
 *   document.documentElement.dataset.gestioRate = "2"   (pin to 2x)
 *   remove attribute                                        (release pin)
 */
(() => {
  "use strict";
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    if (!desc || !desc.configurable) return;
    const nativeSet = desc.set;
    const nativeGet = desc.get;

    const pinnedRate = () => {
      const raw = document.documentElement.dataset.gestioRate;
      if (!raw) return null;
      const v = parseFloat(raw);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
      configurable: true,
      get() { return nativeGet.call(this); },
      set(value) {
        const pin = pinnedRate();
        if (pin !== null) {
          nativeSet.call(this, pin);
          return;
        }
        nativeSet.call(this, value);
      }
    });

    // When pin is active, force every video back to it and watch ratechange.
    new MutationObserver(() => {
      const pin = pinnedRate();
      if (pin !== null) {
        document.querySelectorAll("video").forEach((v) => {
          if (Math.abs(v.playbackRate - pin) > 0.01) {
            try { nativeSet.call(v, pin); } catch (_) {}
          }
        });
      }
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-gestio-rate"]
    });

    document.addEventListener("ratechange", (e) => {
      const pin = pinnedRate();
      if (pin !== null && e.target instanceof HTMLMediaElement) {
        if (Math.abs(e.target.playbackRate - pin) > 0.01) {
          try { nativeSet.call(e.target, pin); } catch (_) {}
        }
      }
    }, true);
  } catch (_) {}
})();
