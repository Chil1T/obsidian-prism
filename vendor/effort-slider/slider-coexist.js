(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    try { root.__agPrismEffortSlider?.destroy?.(); } catch {}
    if (typeof window !== 'undefined' && window !== root) {
      try { window.__agPrismEffortSlider?.destroy?.(); } catch {}
    }
    const api = factory(root);
    root.__agPrismEffortSlider = api;
    if (typeof window !== 'undefined') window.__agPrismEffortSlider = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (globalRoot) {
  'use strict';

  const SLIDER_STYLE_ID = 'ag-codex-effort-slider-styles';
  const HIDE_STYLE_ID = 'ag-prism-effort-slider-hide';
  const PRISM_OWNER_ATTR = 'data-ag-prism-slider';
  const THROTTLE_MS = 120;

  function resolveUpstreamLib(win) {
    if (win && win.AntigravityCodexEffortSlider) return win.AntigravityCodexEffortSlider;
    if (globalRoot && globalRoot.AntigravityCodexEffortSlider) return globalRoot.AntigravityCodexEffortSlider;
    if (typeof require === 'function') {
      try {
        globalRoot.__agCodexEffortSliderDisableAutoBoot = true;
        if (win) win.__agCodexEffortSliderDisableAutoBoot = true;
        return require('./upstream-client.js');
      } catch {}
    }
    return null;
  }

  function isModelMenuOpen(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return false;
    return Boolean(
      doc.querySelector(
        '[data-testid="model-selector-panel"], .ces-menu-section, [data-ces-effort-row="true"], [role="dialog"] [data-ces-settings]'
      )
    );
  }

  function isIgnoredChatOrSidebarTarget(node) {
    if (!node || typeof node.closest !== 'function') return false;
    return Boolean(
      node.closest(
        '[data-testid="autoscroll-viewport"], aside, [data-op-thought="1"], .ag-cs-crab, .ag-cs-conv-aura-host, #ag-pulse-status-bar'
      )
    );
  }

  function mutationTouchesModelControls(records, doc) {
    if (!Array.isArray(records) || records.length === 0) return true;
    const menuOpen = isModelMenuOpen(doc);
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const t = rec && rec.target;
      if (t && isIgnoredChatOrSidebarTarget(t)) continue;
      if (menuOpen) return true;
      if (t && typeof t.getAttribute === 'function') {
        const tid = t.getAttribute('data-testid') || '';
        if (tid.includes('model-selector')) return true;
        if (typeof t.closest === 'function' && t.closest('[data-testid="model-selector-trigger"], [data-testid="model-selector-panel"], [role="menu"], [role="listbox"]')) {
          return true;
        }
      }
      const added = rec && rec.addedNodes;
      if (added && added.length) {
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (!n || n.nodeType !== 1) continue;
          const tid = n.getAttribute?.('data-testid') || '';
          if (tid.includes('model-selector')) return true;
          const role = n.getAttribute?.('role') || '';
          if (role === 'menu' || role === 'listbox' || role === 'dialog') return true;
          if (
            (n.tagName === 'DIV' || n.tagName === 'BUTTON') &&
            typeof n.querySelector === 'function' &&
            n.querySelector('[data-testid="model-selector-panel"], [data-testid="model-selector-trigger"]')
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function createThrottledMutationObserverClass(BaseMO, doc, stats) {
    if (typeof BaseMO !== 'function') return null;
    return function ThrottledPrismMutationObserver(callback) {
      let timer = null;
      let lastRunAt = 0;
      let queuedRecords = [];
      let disconnected = false;

      const flush = () => {
        timer = null;
        if (disconnected) return;
        const batch = queuedRecords;
        queuedRecords = [];
        if (!mutationTouchesModelControls(batch, doc)) {
          stats.skippedIrrelevant += 1;
          return;
        }
        lastRunAt = Date.now();
        stats.executedScans += 1;
        callback(batch, wrapper);
      };

      const inner = new BaseMO((records) => {
        if (disconnected) return;
        stats.rawMutations += 1;
        if (Array.isArray(records)) {
          for (let i = 0; i < records.length && queuedRecords.length < 48; i++) {
            queuedRecords.push(records[i]);
          }
        }
        const menuNow = isModelMenuOpen(doc);
        if (!mutationTouchesModelControls(records, doc) && !menuNow) {
          queuedRecords = [];
          stats.skippedIrrelevant += 1;
          return;
        }
        const elapsed = Date.now() - lastRunAt;
        if (menuNow || (elapsed >= THROTTLE_MS && timer === null)) {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          flush();
        } else if (timer === null) {
          timer = setTimeout(flush, Math.max(16, THROTTLE_MS - elapsed));
          if (timer && typeof timer.unref === 'function') timer.unref();
        }
      });

      const wrapper = {
        observe(target, options) {
          disconnected = false;
          // Drop characterData:true when observing document.body to eliminate streaming text overhead
          const safeOpts =
            target === doc?.body && options && options.characterData
              ? { ...options, characterData: false }
              : options;
          return inner.observe(target, safeOpts);
        },
        disconnect() {
          disconnected = true;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          queuedRecords = [];
          return inner.disconnect();
        },
        takeRecords() {
          return typeof inner.takeRecords === 'function' ? inner.takeRecords() : [];
        },
      };
      return wrapper;
    };
  }

  function createEffortSliderController(envOpts) {
    const getWin = () => (envOpts && envOpts.window) || (typeof window !== 'undefined' ? window : globalRoot);
    const getDoc = () => (envOpts && envOpts.document) || getWin()?.document || null;

    let currentMode = 'auto';
    let prismInstance = null;
    let yieldedToExternal = false;
    const perfStats = {
      rawMutations: 0,
      executedScans: 0,
      skippedIrrelevant: 0,
    };

    function hasExternalInstance() {
      const win = getWin();
      const doc = getDoc();
      if (!win) return false;
      const inst = win.__agCodexEffortSliderInstance;
      if (inst && !inst.__prismOwned) return true;
      const styleEl = doc?.getElementById?.(SLIDER_STYLE_ID);
      if (styleEl && styleEl.getAttribute(PRISM_OWNER_ATTR) !== '1' && !prismInstance) {
        return true;
      }
      return false;
    }

    const HIDE_CSS_TEXT =
      '.ces-ag-section,.ces-menu-section,[data-ces-effort-row="true"],.ces-set,.ces-settings-panel{display:none!important}' +
      '[data-ces-part="trigger-effort"]{color:inherit!important;opacity:.7!important;font-weight:inherit!important}';

    function clearTriggerEffortTint(doc) {
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const spans = doc.querySelectorAll(
        '[data-ces-part="trigger-effort"], [data-testid="model-selector-trigger"] span[style]'
      );
      for (let i = 0; i < spans.length; i++) {
        const sp = spans[i];
        if (sp.style) {
          sp.style.color = '';
          sp.style.opacity = '';
          sp.style.fontWeight = '';
        }
        sp.removeAttribute?.('data-ces-part');
      }
      const panels = doc.querySelectorAll('.ces-ag-panel-enhanced');
      for (let i = 0; i < panels.length; i++) {
        panels[i].classList?.remove?.('ces-ag-panel-enhanced');
      }
      const selectedItems = doc.querySelectorAll('[data-ces-model-selected]');
      for (let i = 0; i < selectedItems.length; i++) {
        selectedItems[i].removeAttribute?.('data-ces-model-selected');
      }
    }

    function setHideExternalCss(hidden) {
      const doc = getDoc();
      if (!doc || typeof doc.getElementById !== 'function') return;
      const existing = doc.getElementById(HIDE_STYLE_ID);
      if (!hidden) {
        if (existing) existing.remove();
        return;
      }
      if (existing) {
        if (existing.textContent !== HIDE_CSS_TEXT) existing.textContent = HIDE_CSS_TEXT;
        return;
      }
      if (doc.head || doc.documentElement) {
        const st = doc.createElement('style');
        st.id = HIDE_STYLE_ID;
        st.textContent = HIDE_CSS_TEXT;
        (doc.head || doc.documentElement).appendChild(st);
      }
    }

    function stopPrismInstance() {
      const win = getWin();
      const doc = getDoc();
      if (prismInstance) {
        try {
          prismInstance.stop();
        } catch {}
        if (win && win.__agCodexEffortSliderInstance === prismInstance) {
          delete win.__agCodexEffortSliderInstance;
        }
        prismInstance = null;
      }
      clearTriggerEffortTint(doc);
      const styleEl = doc?.getElementById?.(SLIDER_STYLE_ID);
      if (styleEl && styleEl.getAttribute(PRISM_OWNER_ATTR) === '1') {
        styleEl.remove();
      }
    }

    function mountBuiltIn() {
      const win = getWin();
      const doc = getDoc();
      if (!win || !doc || !doc.body) return false;
      const lib = resolveUpstreamLib(win);
      if (!lib || typeof lib.installCodexEffortSlider !== 'function') return false;

      const BaseMO = win.MutationObserver || (typeof MutationObserver === 'function' ? MutationObserver : null);
      const ThrottledMO = createThrottledMutationObserverClass(BaseMO, doc, perfStats);
      const winProxy = Object.create(win);
      if (ThrottledMO) {
        Object.defineProperty(winProxy, 'MutationObserver', {
          value: ThrottledMO,
          configurable: true,
        });
      }

      const inst = lib.installCodexEffortSlider({
        document: doc,
        window: winProxy,
      });
      if (!inst) return false;
      inst.__prismOwned = true;
      win.__agCodexEffortSliderInstance = inst;
      prismInstance = inst;

      const styleEl = doc.getElementById?.(SLIDER_STYLE_ID);
      if (styleEl) styleEl.setAttribute(PRISM_OWNER_ATTR, '1');
      return true;
    }

    function sync(cfg) {
      const raw = cfg && cfg.effortSliderModule;
      currentMode = raw === 'on' || raw === 'off' ? raw : 'auto';

      if (currentMode === 'off') {
        yieldedToExternal = false;
        stopPrismInstance();
        clearTriggerEffortTint(getDoc());
        setHideExternalCss(true);
        return getState();
      }

      setHideExternalCss(false);

      if (hasExternalInstance()) {
        // Yield politely to external slider (e.g., app.asar Codex slider) to prevent duplicate body observers
        yieldedToExternal = true;
        stopPrismInstance();
        try { getWin()?.__agCodexEffortSliderInstance?.rescan?.(); } catch {}
        return getState();
      }

      yieldedToExternal = false;
      if (!prismInstance) {
        mountBuiltIn();
      } else {
        try { prismInstance.rescan?.(); } catch {}
      }
      return getState();
    }

    function destroy() {
      stopPrismInstance();
      setHideExternalCss(false);
      yieldedToExternal = false;
    }

    function getState() {
      return {
        mode: currentMode,
        mountedPrism: Boolean(prismInstance),
        yieldedToExternal: Boolean(yieldedToExternal || (currentMode !== 'off' && hasExternalInstance())),
        hasExternal: hasExternalInstance(),
        throttleMs: THROTTLE_MS,
        perfStats: { ...perfStats },
      };
    }

    return {
      THROTTLE_MS,
      sync,
      destroy,
      getState,
      createEffortSliderController,
    };
  }

  return createEffortSliderController();
});
