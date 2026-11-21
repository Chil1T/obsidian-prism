/**
 * Obsidian Prism — Channel 4 On-Demand Host UI Localization Runtime
 * Zero-dependency UMD runtime (CommonJS + Browser IIFE) with:
 *   1. Universal 4-layer external localization auto-yield (known markers, zero-signature Chrome UI zh-CN sampling,
 *      1200ms delayed-plugin recheck, and 3000ms ping-pong conflict circuit breaker)
 *   2. 100% reversible destroy() using WeakMap snapshots (zero DOM property pollution)
 *   3. Strict Prism-owned UI, model-selector, code/editor, and chat-prose isolation
 *   4. 0fps visibility/blur hibernation + single-rAF batched scheduling (max 160 nodes/frame)
 *
 * Upstream Credit:
 *   Dictionary & DOM localization approach inspired by yiheng8023/antigravity-chinese (v3.3.19)
 *   (MIT License, Copyright (c) 2026 Antigravity Chinese Localization Contributors,
 *    https://github.com/yiheng8023/antigravity-chinese).
 *   Re-architected for Obsidian Prism (GPL-3.0-only) as a Zero-ASAR pure CDP on-demand channel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    if (root) root.__agPrismHostI18nFactory = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var hasOwn = Object.prototype.hasOwnProperty;
  var ZH_CHAR_RE = /[\u4e00-\u9fa5]/;
  var EN_ALPHA_RE = /[a-zA-Z]/;

  var IGNORED_TAGS = {
    SCRIPT: 1,
    STYLE: 1,
    NOSCRIPT: 1,
    CODE: 1,
    PRE: 1,
    SVG: 1,
    PATH: 1,
    CANVAS: 1,
    INPUT: 1,
    TEXTAREA: 1,
    SELECT: 1,
    OPTION: 1,
    KBD: 1,
    IFRAME: 1,
    VIDEO: 1,
    AUDIO: 1,
    TITLE: 1,
  };

  var IGNORED_CLASSES = [
    'monaco-editor',
    'view-lines',
    'view-line',
    'monaco-mouse-cursor-text',
    'xterm',
    'terminal',
    'token',
    'hljs',
    'code-block',
    'editor-instance',
  ];

  var MODEL_SELECTOR_TESTIDS = {
    'model-selector-trigger': 1,
    'model-selector-panel': 1,
    'model-selector-item': 1,
    'model-selector-effort-option': 1,
    'model-selector-effort-group': 1,
    'model-selector-list': 1,
    'model-selector-orchestrator': 1,
    'orchestrator-effort-bar': 1,
  };

  var PRISM_OWNED_IDS = {
    'ag-cs-settings-sec': 1,
    'ag-prism-pulse-bar': 1,
    'ag-pulse-status-bar': 1,
  };

  var PRISM_OWNED_ATTRS = [
    'data-ag-prism-pulse-bar',
    'data-ag-prism-ui',
    'data-ag-cs-ui',
    'data-ag-no-i18n',
    'data-ag-prism-sidebar-owned',
    'data-ag-prism-omni-owned',
    'data-ag-prism-fallback',
  ];

  var PRISM_CLASS_PREFIXES = ['ag-cs-', 'ag-prism-', 'ag-v2-', 'ag-omni-', 'ag-ss-', 'ces-', 'ag-anim-'];

  var CHAT_PROSE_CLASSES = ['prose', 'markdown-body', 'chat-markdown-message', 'rendered-markdown'];
  var CHAT_PROSE_ATTRS = ['data-markdown-root', 'data-message-content', 'data-message-id'];
  var CHAT_PROSE_TESTIDS = {
    'user-message': 1,
    'assistant-message': 1,
    'agent-input-box': 1,
    'user-message-bubble': 1,
    'user-message-content': 1,
    'user-input-step': 1,
    'planner-response-text': 1,
    'agent-response': 1,
    'artifact-view': 1,
    'side-question-panel': 1,
    'side-question-conversation': 1,
    'subagent-tab-conversation': 1,
    'terminal-output': 1,
    'background-task-command': 1,
    'entity-pill': 1,
    'attached-context-pill': 1,
    'user-message-document-chip': 1,
    'artifact-card': 1,
    'bubble-artifact-card': 1,
    'thinking-collapsible-trigger': 1,
  };

  var USER_CONTENT_BOUNDARY = {
    testids: {
      'conversation-list-sidebar': 1,
      'conversation-row-sidebar': 1,
      'project-header': 1,
      'workspace-switcher': 1,
      'home-greeting': 1,
      'conversation-navigator': 1,
      'editor-tabs': 1,
      'file-tabs': 1,
      'file-tab': 1,
      'editor-tab': 1,
    },
    classes: ['tabs-container', 'tab-label', 'monaco-icon-label', 'editor-tabs', 'file-tabs'],
    attrs: ['data-resource-name', 'data-uri', 'data-file-path'],
  };

  var TRANSLATABLE_ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt', 'aria-description'];

  var KNOWN_EXTERNAL_GLOBALS = [
    '__AGY_I18N_INITIALIZED__',
    '__AGY_I18N__',
    '__ANTIGRAVITY_CN__',
    '__ANTIGRAVITY_I18N__',
    '__AG_I18N__',
    '__AG_CN_PATCH__',
    '__AGY_CN__',
    '__I18N_PATCHED__',
  ];

  var KNOWN_EXTERNAL_ATTRS = ['data-agy-i18n', 'data-ag-cn', 'data-i18n-patched', 'data-translated'];

  var CHROME_ZH_ANCHORS = {
    设置: 1,
    偏好设置: 1,
    新建对话: 1,
    扩展: 1,
    终端: 1,
    源代码管理: 1,
    工作区: 1,
    视图: 1,
    窗口: 1,
    自动化: 1,
    项目列表: 1,
  };

  function getAttr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    return el.getAttribute(name);
  }

  function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
    return getAttr(el, name) !== null;
  }

  function getClassTokens(el) {
    if (!el) return [];
    var raw = typeof el.className === 'string' ? el.className : '';
    if (!raw) return [];
    return raw.trim().split(/\s+/);
  }

  function isPrismOwnedSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var id = el.id || getAttr(el, 'id') || '';
    if (id && hasOwn.call(PRISM_OWNED_IDS, id)) return true;
    for (var i = 0; i < PRISM_OWNED_ATTRS.length; i++) {
      if (hasAttr(el, PRISM_OWNED_ATTRS[i])) return true;
    }
    var tokens = getClassTokens(el);
    for (var t = 0; t < tokens.length; t++) {
      var cls = tokens[t];
      for (var p = 0; p < PRISM_CLASS_PREFIXES.length; p++) {
        if (cls.indexOf(PRISM_CLASS_PREFIXES[p]) === 0) return true;
      }
    }
    return false;
  }

  function isPrismOwnedElement(el) {
    var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
    var depth = 0;
    while (cur && depth < 128) {
      if (cur.nodeType === 1 && isPrismOwnedSelf(cur)) return true;
      cur = cur.parentElement || cur.parentNode;
      depth++;
    }
    return false;
  }

  function isModelSelectorSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid && hasOwn.call(MODEL_SELECTOR_TESTIDS, tid)) return true;
    if (hasAttr(el, 'data-effort')) return true;
    return false;
  }

  function isChatProseSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid && hasOwn.call(CHAT_PROSE_TESTIDS, tid)) return true;
    for (var i = 0; i < CHAT_PROSE_ATTRS.length; i++) {
      if (hasAttr(el, CHAT_PROSE_ATTRS[i])) return true;
    }
    var tokens = getClassTokens(el);
    for (var t = 0; t < tokens.length; t++) {
      for (var c = 0; c < CHAT_PROSE_CLASSES.length; c++) {
        if (tokens[t] === CHAT_PROSE_CLASSES[c]) return true;
      }
    }
    return false;
  }

  function isUserContentBoundarySelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid && hasOwn.call(USER_CONTENT_BOUNDARY.testids, tid)) return true;
    for (var i = 0; i < USER_CONTENT_BOUNDARY.attrs.length; i++) {
      if (hasAttr(el, USER_CONTENT_BOUNDARY.attrs[i])) return true;
    }
    var tokens = getClassTokens(el);
    for (var t = 0; t < tokens.length; t++) {
      for (var c = 0; c < USER_CONTENT_BOUNDARY.classes.length; c++) {
        if (tokens[t] === USER_CONTENT_BOUNDARY.classes[c]) return true;
      }
    }
    return false;
  }

  function isUserContentBoundary(el) {
    var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
    var depth = 0;
    while (cur && depth < 128) {
      if (cur.nodeType === 1 && isUserContentBoundarySelf(cur)) return true;
      cur = cur.parentElement || cur.parentNode;
      depth++;
    }
    return false;
  }

  function isConversationStreamSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid === 'conversation-view' || tid === 'agent-input-box') return true;
    if (hasAttr(el, 'data-cascade-id')) return true;
    return false;
  }

  function isInteractiveChatChromeSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isDirectIgnoredSelf(el)) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (tag === 'BUTTON') return true;
    var role = getAttr(el, 'role');
    if (role === 'button' || role === 'menu' || role === 'menuitem' || role === 'tooltip' || role === 'toolbar' || role === 'tab' || role === 'tablist') {
      return true;
    }
    var tid = getAttr(el, 'data-testid');
    if (tid === 'permissions-selector-trigger' || tid === 'plan-command-fyi-alert') return true;
    return false;
  }

  function isDirectIgnoredSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (IGNORED_TAGS[tag]) return true;
    if (el.isContentEditable === true || getAttr(el, 'contenteditable') === 'true') return true;
    if (isPrismOwnedSelf(el)) return true;
    if (isModelSelectorSelf(el)) return true;
    if (isChatProseSelf(el)) return true;
    if (isUserContentBoundarySelf(el)) return true;
    var tokens = getClassTokens(el);
    for (var i = 0; i < tokens.length; i++) {
      for (var j = 0; j < IGNORED_CLASSES.length; j++) {
        if (tokens[i] === IGNORED_CLASSES[j]) return true;
      }
    }
    return false;
  }

  function isIgnoredBoundary(el) {
    if (!el) return false;
    var startEl = el.nodeType === 3 ? el.parentElement || el.parentNode : el;
    if (!startEl || startEl.nodeType !== 1) return false;

    var cur = startEl;
    var sawInteractiveChrome = false;
    var depth = 0;
    while (cur && depth < 128) {
      if (cur.nodeType === 1) {
        if (isDirectIgnoredSelf(cur)) return true;
        if (isInteractiveChatChromeSelf(cur)) sawInteractiveChrome = true;
        if (isConversationStreamSelf(cur) && !sawInteractiveChrome) {
          return true;
        }
      }
      cur = cur.parentElement || cur.parentNode;
      depth++;
    }
    if (cur) return true;
    return false;
  }

  function isInsideConversationStream(el) {
    var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
    var depth = 0;
    while (cur && depth < 128) {
      if (cur.nodeType === 1 && (isConversationStreamSelf(cur) || isChatProseSelf(cur))) return true;
      cur = cur.parentElement || cur.parentNode;
      depth++;
    }
    return false;
  }

  function isChromeControlElement(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
    if (isUserContentBoundarySelf(el)) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (tag === 'NAV' || tag === 'ASIDE' || tag === 'HEADER' || tag === 'BUTTON') return true;
    var role = getAttr(el, 'role');
    if (role === 'tablist' || role === 'toolbar' || role === 'menubar' || role === 'menu' || role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      return true;
    }
    if (tid === 'permissions-selector-trigger') return true;
    return false;
  }

  function isLeafChromeControl(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
    if (isUserContentBoundarySelf(el)) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (tag === 'BUTTON') return true;
    var role = getAttr(el, 'role');
    if (role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return true;
    if (tid === 'permissions-selector-trigger' || tid === 'new-conversation-button' || tid === 'settings-button') return true;
    return false;
  }

  function isExplicitDelayedChromeControl(el) {
    if (!el || el.nodeType !== 1) return false;
    var tid = getAttr(el, 'data-testid');
    if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
    if (isUserContentBoundarySelf(el)) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (tag === 'BUTTON' || tag === 'NAV' || tag === 'HEADER') return true;
    var role = getAttr(el, 'role');
    if (role === 'button' || role === 'menu' || role === 'menubar' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio' || role === 'tab' || role === 'tablist' || role === 'toolbar') {
      return true;
    }
    if (tid === 'permissions-selector-trigger' || tid === 'new-conversation-button' || tid === 'settings-button') return true;
    return false;
  }

  function isInsideExplicitDelayedChrome(el) {
    var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
    var depth = 0;
    while (cur && depth < 128) {
      if (cur.nodeType === 1) {
        if (isDirectIgnoredSelf(cur) || isConversationStreamSelf(cur)) return false;
        if (isExplicitDelayedChromeControl(cur)) return true;
      }
      cur = cur.parentElement || cur.parentNode;
      depth++;
    }
    return false;
  }

  function detectLayer1External(rootObj, doc) {
    if (rootObj) {
      for (var i = 0; i < KNOWN_EXTERNAL_GLOBALS.length; i++) {
        var key = KNOWN_EXTERNAL_GLOBALS[i];
        if (rootObj[key]) return { hit: true, detail: 'global:' + key };
      }
    }
    if (doc) {
      var docEl = doc.documentElement;
      var body = doc.body;
      for (var j = 0; j < KNOWN_EXTERNAL_ATTRS.length; j++) {
        var attr = KNOWN_EXTERNAL_ATTRS[j];
        if ((docEl && hasAttr(docEl, attr)) || (body && hasAttr(body, attr))) {
          return { hit: true, detail: 'attr:' + attr };
        }
      }
      if (docEl && !hasAttr(docEl, 'data-ag-prism-lang-owned')) {
        var htmlLang = String(getAttr(docEl, 'lang') || docEl.lang || '').trim();
        if (/^zh(?:$|[-_])/i.test(htmlLang)) {
          return { hit: true, detail: 'html-lang:' + htmlLang };
        }
      }
    }
    return { hit: false, detail: null };
  }

  function collectTextSkippingIgnored(el, outChunks, textSnapshots) {
    if (!el) return;
    if (el.nodeType === 3) {
      if (textSnapshots && textSnapshots.has(el)) {
        var snap = textSnapshots.get(el);
        if (snap && snap.expected === el.nodeValue) return;
      }
      var val = el.nodeValue || '';
      if (val) outChunks.push(val);
      return;
    }
    if (el.nodeType !== 1) return;
    if (isDirectIgnoredSelf(el) || isConversationStreamSelf(el)) return;
    var child = el.firstChild;
    while (child) {
      collectTextSkippingIgnored(child, outChunks, textSnapshots);
      child = child.nextSibling;
    }
  }

  function detectLayer2ChromeZh(doc, options) {
    if (!doc) return { hit: false, sampled: 0, zhCount: 0, anchorHits: 0 };
    var rootEl = doc.body || doc.documentElement;
    if (!rootEl) return { hit: false, sampled: 0, zhCount: 0, anchorHits: 0 };

    var opts = options || {};
    var textSnapshots = opts.textSnapshots || null;
    var samples = [];
    var seenTexts = Object.create(null);
    var zhCount = 0;
    var anchorHits = 0;
    var visited = 0;
    var MAX_VISIT = 2200;
    var MAX_SAMPLES = 48;

    function recordSample(text) {
      var trimmed = String(text || '').replace(/\s+/g, ' ').trim();
      if (!trimmed || trimmed.length > 60) return;
      if (!ZH_CHAR_RE.test(trimmed) && !EN_ALPHA_RE.test(trimmed)) return;
      if (hasOwn.call(seenTexts, trimmed)) return;
      seenTexts[trimmed] = 1;
      samples.push(trimmed);
      if (ZH_CHAR_RE.test(trimmed)) {
        zhCount++;
        if (hasOwn.call(CHROME_ZH_ANCHORS, trimmed)) {
          anchorHits++;
        }
      }
    }

    function walk(node, insideChrome) {
      if (!node || samples.length >= MAX_SAMPLES || visited >= MAX_VISIT) return;
      visited++;

      if (node.nodeType === 3) {
        if (insideChrome) {
          if (textSnapshots && textSnapshots.has(node)) {
            var snap = textSnapshots.get(node);
            if (snap && snap.expected === node.nodeValue) return;
          }
          recordSample(node.nodeValue);
        }
        return;
      }
      if (node.nodeType !== 1) return;
      if (isDirectIgnoredSelf(node) || isConversationStreamSelf(node)) return;

      if (isLeafChromeControl(node)) {
        var chunks = [];
        collectTextSkippingIgnored(node, chunks, textSnapshots);
        if (chunks.length > 0) {
          recordSample(chunks.join(' '));
        }
        return;
      }

      var nowInChrome = insideChrome || isChromeControlElement(node);
      var child = node.firstChild;
      while (child && samples.length < MAX_SAMPLES && visited < MAX_VISIT) {
        walk(child, nowInChrome);
        child = child.nextSibling;
      }
    }

    walk(rootEl, false);

    var ratio = samples.length > 0 ? zhCount / samples.length : 0;
    var hit = (zhCount >= 3 && ratio >= 0.25) || anchorHits >= 2;
    return {
      hit: hit,
      sampled: samples.length,
      zhCount: zhCount,
      anchorHits: anchorHits,
      ratio: ratio,
    };
  }

  function detectExternalLocalization(rootObj, doc, options) {
    var l1 = detectLayer1External(rootObj, doc);
    if (l1.hit) {
      return { detected: true, layer: 1, reason: 'external-ui-zh', detail: l1.detail };
    }
    var l2 = detectLayer2ChromeZh(doc, options);
    if (l2.hit) {
      return { detected: true, layer: 2, reason: 'external-ui-zh', detail: l2 };
    }
    return { detected: false, layer: 0, reason: null, detail: l2 };
  }

  function createHostI18nEngine(dictData) {
    var data = dictData || {};
    var exactDict = data.exact || {};
    var rawPatterns = (data.patterns || []).concat(data.rules || []);
    var patterns = [];
    for (var i = 0; i < rawPatterns.length; i++) {
      var p = rawPatterns[i];
      if (!p || typeof p.regex !== 'string' || typeof p.replacement !== 'string') continue;
      try {
        patterns.push({
          regex: new RegExp(p.regex),
          replacement: p.replacement,
        });
      } catch (e) {}
    }

    var translatedValues = Object.create(null);
    for (var k in exactDict) {
      if (hasOwn.call(exactDict, k)) {
        translatedValues[exactDict[k]] = true;
      }
    }

    var translationCache = typeof Map !== 'undefined' ? new Map() : null;
    var MAX_CACHE_SIZE = 10000;

    function cacheAndReturn(key, value) {
      if (translationCache) {
        if (translationCache.size >= MAX_CACHE_SIZE) {
          var iter = translationCache.keys();
          for (var ci = 0; ci < 1000; ci++) {
            var oldK = iter.next().value;
            if (oldK !== undefined) translationCache.delete(oldK);
            else break;
          }
        }
        translationCache.set(key, value);
      }
      return value;
    }

    function normalizeWhitespace(str) {
      return str.replace(/\s+/g, ' ').trim();
    }

    function applyPatterns(text) {
      for (var idx = 0; idx < patterns.length; idx++) {
        var pat = patterns[idx];
        pat.regex.lastIndex = 0;
        if (pat.regex.test(text)) {
          pat.regex.lastIndex = 0;
          var result = text.replace(pat.regex, pat.replacement);
          for (var pi = 0; pi < patterns.length; pi++) {
            patterns[pi].regex.lastIndex = 0;
            if (patterns[pi].regex.test(result)) {
              patterns[pi].regex.lastIndex = 0;
              result = result.replace(patterns[pi].regex, patterns[pi].replacement);
            }
          }
          return result;
        }
      }
      return null;
    }

    function translateSingleUnit(rawStr) {
      if (!rawStr || typeof rawStr !== 'string' || rawStr.length > 512) return null;
      var normalized = normalizeWhitespace(rawStr);
      if (!normalized) return null;

      if (translationCache && translationCache.has(normalized)) {
        return translationCache.get(normalized);
      }

      if (hasOwn.call(exactDict, normalized)) {
        return cacheAndReturn(normalized, exactDict[normalized]);
      }

      if (!EN_ALPHA_RE.test(normalized)) {
        return cacheAndReturn(normalized, null);
      }

      if (translatedValues[normalized]) {
        return cacheAndReturn(normalized, null);
      }

      if (ZH_CHAR_RE.test(normalized) && !/[a-zA-Z]{2,}/.test(normalized)) {
        return cacheAndReturn(normalized, null);
      }

      var patRes = applyPatterns(normalized);
      if (patRes !== null) {
        return cacheAndReturn(normalized, patRes);
      }

      var punctuationMatch = normalized.match(/^([\w\s\-\/]+)([:：…\.？\?!！]+)$/);
      if (punctuationMatch) {
        var base = punctuationMatch[1].trim();
        var punc = punctuationMatch[2];
        if (hasOwn.call(exactDict, base)) {
          return cacheAndReturn(normalized, exactDict[base] + (punc === ':' ? '：' : punc));
        }
      }

      var hotkeyMatch = normalized.match(
        /(\((?:Ctrl|Cmd|Alt|Shift)\+[^\s\)]+\)|\b(?:Ctrl|Cmd|Alt|Shift)\+[\w;:,\\/+\-]+)$/i
      );
      if (hotkeyMatch && hotkeyMatch.index > 0) {
        var cmdBase = normalized.slice(0, hotkeyMatch.index).trim();
        var hotkey = hotkeyMatch[1].trim();
        if (cmdBase && /^[\w\s\-\/]+$/.test(cmdBase) && hasOwn.call(exactDict, cmdBase)) {
          return cacheAndReturn(normalized, exactDict[cmdBase] + ' ' + hotkey);
        }
      }

      if (
        normalized.indexOf('. ') !== -1 ||
        normalized.indexOf('! ') !== -1 ||
        normalized.indexOf('? ') !== -1 ||
        normalized.indexOf('。') !== -1
      ) {
        var sentences = normalized.split(/([.!?]\s+|[。！？]\s*)/);
        var anyTranslated = false;
        var allTranslated = true;
        var translatedParts = [];
        for (var sIdx = 0; sIdx < sentences.length; sIdx++) {
          var part = sentences[sIdx];
          var trimmedPart = part.trim();
          if (!trimmedPart || /^[.!?。！？\s]+$/.test(part)) {
            translatedParts.push(part.replace(/\.\s*/g, '。 '));
            continue;
          }
          var transPart =
            (hasOwn.call(exactDict, trimmedPart) ? exactDict[trimmedPart] : null) ||
            (hasOwn.call(exactDict, trimmedPart + '.') ? exactDict[trimmedPart + '.'] : null);
          if (!transPart) {
            transPart = applyPatterns(trimmedPart);
          }
          if (!transPart) {
            var pMatch = trimmedPart.match(/^([\w\s\-\/]+)([:：…\.？\?!！]+)$/);
            if (pMatch && hasOwn.call(exactDict, pMatch[1].trim())) {
              transPart = exactDict[pMatch[1].trim()] + (pMatch[2] === ':' ? '：' : pMatch[2]);
            }
          }
          if (transPart) {
            anyTranslated = true;
            translatedParts.push(transPart);
          } else {
            allTranslated = false;
            translatedParts.push(part);
          }
        }
        if (anyTranslated && allTranslated) {
          return cacheAndReturn(
            normalized,
            translatedParts.join('').replace(/([。！？])[。！？.]*\s*/g, '$1 ').trim()
          );
        }
      }

      return cacheAndReturn(normalized, null);
    }

    return {
      translate: translateSingleUnit,
      exactDict: exactDict,
      patterns: patterns,
      translatedValues: translatedValues,
      cache: translationCache,
      normalizeWhitespace: normalizeWhitespace,
    };
  }

  function isFloatingElement(el, doc) {
    if (!el || el.nodeType !== 1) return false;
    if (doc && (el === doc.body || el === doc.documentElement)) return false;
    if (el.id === 'workbench' || el.id === 'root' || el.id === 'app') return false;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (cls && cls.indexOf('monaco-workbench') !== -1) return false;

    var role = getAttr(el, 'role') || '';
    if (role === 'tooltip' || role === 'menu' || role === 'dialog') return true;
    if (hasAttr(el, 'data-floating-ui-portal') || hasAttr(el, 'data-radix-popper-content-wrapper')) return true;
    if (cls) {
      if (
        cls.indexOf('popover') !== -1 ||
        cls.indexOf('tooltip') !== -1 ||
        cls.indexOf('context-view') !== -1 ||
        cls.indexOf('monaco-hover') !== -1
      ) {
        return true;
      }
    }
    return false;
  }

  function isWorkbenchOrRoot(el, doc) {
    if (!el || el.nodeType !== 1) return true;
    if (doc && (el === doc.body || el === doc.documentElement)) return true;
    if (el.id === 'workbench' || el.id === 'root' || el.id === 'app') return true;
    var tid = getAttr(el, 'data-testid');
    if (tid === 'sidebar-split' || tid === 'aux-pane-split') return true;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (cls && cls.indexOf('monaco-workbench') !== -1) return true;
    return false;
  }

  function createWeakNodeTracker() {
    var hasWeakRef = typeof WeakRef === 'function';
    if (!hasWeakRef) {
      var fallbackSet = new Set();
      return {
        add: function (node) {
          if (!node) return;
          fallbackSet.add(node);
          if (fallbackSet.size > 256) this.prune();
        },
        delete: function (node) {
          fallbackSet.delete(node);
        },
        prune: function () {
          fallbackSet.forEach(function (n) {
            if (!n || n.isConnected === false) fallbackSet.delete(n);
          });
        },
        forEachAll: function (cb) {
          fallbackSet.forEach(function (n) {
            if (n) cb(n);
          });
        },
        countActive: function () {
          var count = 0;
          fallbackSet.forEach(function (n) {
            if (!n || n.isConnected === false) {
              fallbackSet.delete(n);
              return;
            }
            count++;
          });
          return count;
        },
        clear: function () {
          fallbackSet.clear();
        },
      };
    }
    var refs = new Set();
    var nodeToRef = new WeakMap();
    return {
      add: function (node) {
        if (!node || nodeToRef.has(node)) return;
        var ref = new WeakRef(node);
        nodeToRef.set(node, ref);
        refs.add(ref);
        if (refs.size > 256) this.prune();
      },
      delete: function (node) {
        if (!node) return;
        var ref = nodeToRef.get(node);
        if (ref) {
          refs.delete(ref);
          nodeToRef.delete(node);
        }
      },
      prune: function () {
        refs.forEach(function (ref) {
          var n = ref.deref();
          if (!n || n.isConnected === false) {
            refs.delete(ref);
            if (n) nodeToRef.delete(n);
          }
        });
      },
      forEachAll: function (cb) {
        refs.forEach(function (ref) {
          var n = ref.deref();
          if (!n) {
            refs.delete(ref);
            return;
          }
          cb(n);
        });
      },
      countActive: function () {
        var count = 0;
        refs.forEach(function (ref) {
          var n = ref.deref();
          if (!n || n.isConnected === false) {
            refs.delete(ref);
            if (n) nodeToRef.delete(n);
            return;
          }
          count++;
        });
        return count;
      },
      clear: function () {
        refs.clear();
        nodeToRef = new WeakMap();
      },
    };
  }

  function mountHostI18n(options) {
    var opts = options || {};
    var win = opts.root || (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
    var doc = opts.doc || (win && win.document) || (typeof document !== 'undefined' ? document : null);
    try {
      if (win && win.__agPrismHostI18n && typeof win.__agPrismHostI18n.destroy === 'function') {
        win.__agPrismHostI18n.destroy();
      }
    } catch (e) {}
    var mode = opts.mode === 'on' || opts.mode === 'off' ? opts.mode : 'auto';
    var nowFn =
      typeof opts.nowFn === 'function'
        ? opts.nowFn
        : function () {
            return Date.now();
          };
    var setTimeoutFn =
      typeof opts.setTimeoutFn === 'function'
        ? opts.setTimeoutFn
        : function (fn, ms) {
            return setTimeout(fn, ms);
          };
    var clearTimeoutFn =
      typeof opts.clearTimeoutFn === 'function'
        ? opts.clearTimeoutFn
        : function (id) {
            clearTimeout(id);
          };
    var rafFn =
      typeof opts.rafFn === 'function'
        ? opts.rafFn
        : win && typeof win.requestAnimationFrame === 'function'
        ? function (cb) {
            return win.requestAnimationFrame(cb);
          }
        : function (cb) {
            return setTimeoutFn(cb, 16);
          };
    var cancelRafFn =
      typeof opts.cancelRafFn === 'function'
        ? opts.cancelRafFn
        : win && typeof win.cancelAnimationFrame === 'function'
        ? function (id) {
            win.cancelAnimationFrame(id);
          }
        : function (id) {
            clearTimeoutFn(id);
          };

    var engine = createHostI18nEngine(opts.dict || { exact: {}, patterns: [] });
    var translateSingleUnit = engine.translate;
    var translatedValues = engine.translatedValues || Object.create(null);

    var state = {
      active: false,
      mode: mode,
      status: 'off',
      reason: null,
      yielded: false,
      destroyed: false,
    };

    var textSnapshots = new WeakMap();
    var textUntranslatedCache = new WeakMap();
    var attrSnapshots = new WeakMap();
    var attrUntranslatedCache = new WeakMap();
    var elementConflictState = new WeakMap();
    var exemptElements = new WeakSet();
    var exemptNodes = new WeakSet();
    var processedAlerts = new WeakSet();

    var modifiedTextNodes = createWeakNodeTracker();
    var modifiedAttrElements = createWeakNodeTracker();

    var observer = null;
    var observing = false;
    var pendingNodes = [];
    var pendingNodeSet = new Set();
    var rafId = null;
    var hoverScanTimer = null;
    var layer2bTimers = [];
    var domReadyHandler = null;
    var hoverHandler = null;
    var visibilityHandler = null;
    var blurHandler = null;
    var focusHandler = null;

    var bootAt = nowFn();
    var delayedExternalNodes = new Set();
    var globalConflictRecords = [];
    var lastHoverTime = 0;
    var pausedByVisibilityOrBlur = false;
    var missedWhilePaused = false;

    var MAX_NODES_PER_FRAME = 160;
    var LAYER2B_WINDOW_MS = 1200;
    var CONFLICT_WINDOW_MS = 3000;
    var NODE_CONFLICT_THRESHOLD = 3;
    var GLOBAL_CONFLICT_NODE_THRESHOLD = 5;

    function setRootStatusAttr(val) {
      try {
        if (doc && doc.documentElement && typeof doc.documentElement.setAttribute === 'function') {
          doc.documentElement.setAttribute('data-ag-prism-host-i18n', val);
        }
      } catch (e) {}
    }

    function countTranslatedUnits() {
      var textCount = modifiedTextNodes.countActive();
      var attrCount = 0;
      modifiedAttrElements.prune();
      modifiedAttrElements.forEachAll(function (el) {
        if (el.isConnected === false) return;
        var map = attrSnapshots.get(el);
        if (map) attrCount += map.size;
      });
      return textCount + attrCount;
    }

    function disconnectObserver() {
      if (observer && observing) {
        try {
          observer.disconnect();
        } catch (e) {}
        observing = false;
      }
    }

    function reconnectObserver() {
      if (state.destroyed || !state.active) return;
      if (observer && !observing && doc && doc.documentElement) {
        try {
          observer.observe(doc.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          observing = true;
        } catch (e) {}
      }
    }

    function clearAllTimersAndListeners() {
      if (rafId !== null) {
        try {
          cancelRafFn(rafId);
        } catch (e) {}
        rafId = null;
      }
      if (hoverScanTimer !== null) {
        try {
          clearTimeoutFn(hoverScanTimer);
        } catch (e) {}
        hoverScanTimer = null;
      }
      while (layer2bTimers.length > 0) {
        var tid = layer2bTimers.pop();
        try {
          clearTimeoutFn(tid);
        } catch (e) {}
      }
      if (doc && typeof doc.removeEventListener === 'function') {
        if (domReadyHandler) doc.removeEventListener('DOMContentLoaded', domReadyHandler);
        if (hoverHandler) {
          doc.removeEventListener('pointerenter', hoverHandler, { capture: true });
          doc.removeEventListener('contextmenu', hoverHandler, { capture: true });
        }
        if (visibilityHandler) doc.removeEventListener('visibilitychange', visibilityHandler);
      }
      if (win && typeof win.removeEventListener === 'function') {
        if (blurHandler) win.removeEventListener('blur', blurHandler);
        if (focusHandler) win.removeEventListener('focus', focusHandler);
      }
      domReadyHandler = null;
      hoverHandler = null;
      visibilityHandler = null;
      blurHandler = null;
      focusHandler = null;
    }

    function rollbackAllSnapshots() {
      disconnectObserver();
      modifiedTextNodes.forEachAll(function (node) {
        var snap = textSnapshots.get(node);
        if (snap) {
          try {
            if (node.nodeValue === snap.expected) {
              node.nodeValue = snap.orig;
            }
          } catch (e) {}
          textSnapshots.delete(node);
        }
      });
      modifiedTextNodes.clear();

      modifiedAttrElements.forEachAll(function (el) {
        var attrMap = attrSnapshots.get(el);
        if (attrMap) {
          attrMap.forEach(function (snap, attr) {
            try {
              if (el.getAttribute(attr) === snap.expected && typeof el.setAttribute === 'function') {
                el.setAttribute(attr, snap.orig);
              }
            } catch (e) {}
          });
          attrSnapshots.delete(el);
        }
      });
      modifiedAttrElements.clear();
    }

    function teardownRuntime(nextStatus, nextReason, yieldedFlag) {
      state.active = false;
      state.destroyed = true;
      state.status = nextStatus;
      state.reason = nextReason;
      state.yielded = Boolean(yieldedFlag);

      clearAllTimersAndListeners();
      rollbackAllSnapshots();
      pendingNodes.length = 0;
      pendingNodeSet.clear();
      delayedExternalNodes.clear();
      globalConflictRecords.length = 0;

      setRootStatusAttr(nextStatus);
    }

    function yieldAndRollback(reason) {
      if (state.yielded || state.status === 'yielded') return;
      teardownRuntime('yielded', reason, true);
    }

    function recordGlobalConflict(el, now) {
      var cutoff = now - CONFLICT_WINDOW_MS;
      var nextList = [];
      var found = false;
      for (var i = 0; i < globalConflictRecords.length; i++) {
        var rec = globalConflictRecords[i];
        if (rec.at >= cutoff) {
          if (rec.node === el) {
            rec.at = now;
            found = true;
          }
          nextList.push(rec);
        }
      }
      if (!found) {
        nextList.push({ node: el, at: now });
      }
      globalConflictRecords = nextList;
      return globalConflictRecords.length;
    }

    function recordElementConflict(el, currentText, expectedText, origText, translatedAt) {
      if (!el || el.nodeType !== 1) return false;
      if (exemptElements.has(el)) return true;
      var st = elementConflictState.get(el);
      if (!st) return false;

      var now = nowFn();
      var isBackToOrig =
        origText !== undefined
          ? currentText === origText
          : hasOwn.call(st.entries, currentText) || currentText === st.lastOrig;
      var isExternalZh = ZH_CHAR_RE.test(currentText || '') && currentText !== expectedText;
      if (isBackToOrig || isExternalZh) {
        var refAt = translatedAt || st.lastTranslatedAt;
        var inWindow =
          now - refAt <= CONFLICT_WINDOW_MS ||
          (st.conflicts.length > 0 && now - st.conflicts[st.conflicts.length - 1] <= CONFLICT_WINDOW_MS);
        if (inWindow) {
          if (st.lastCountedVersion === st.writeVersion) {
            return exemptElements.has(el);
          }
          st.lastCountedVersion = st.writeVersion;

          var recent = [];
          for (var i = 0; i < st.conflicts.length; i++) {
            if (now - st.conflicts[i] <= CONFLICT_WINDOW_MS) {
              recent.push(st.conflicts[i]);
            }
          }
          recent.push(now);
          st.conflicts = recent;

          if (recent.length >= 2) {
            var globalCount = recordGlobalConflict(el, now);
            if (globalCount >= GLOBAL_CONFLICT_NODE_THRESHOLD) {
              yieldAndRollback('conflict-breaker');
              return true;
            }
          }
          if (recent.length >= NODE_CONFLICT_THRESHOLD) {
            exemptElements.add(el);
            var ch = el.firstChild;
            while (ch) {
              if (ch.nodeType === 3) {
                exemptNodes.add(ch);
                modifiedTextNodes.delete(ch);
                textSnapshots.delete(ch);
              }
              ch = ch.nextSibling;
            }
            return true;
          }
          return false;
        }
      }
      return false;
    }

    /**
     * Checks whether a previously translated node was modified externally.
     * Returns true if the node should NOT be translated (exempted or circuit-broken).
     */
    function checkNodeConflict(node) {
      if (!node || node.nodeType !== 3) return false;
      var parent = node.parentElement || node.parentNode;
      if (parent && exemptElements.has(parent)) return true;
      if (exemptNodes.has(node)) return true;
      var snap = textSnapshots.get(node);
      if (!snap) return false;
      var currentVal = node.nodeValue;
      if (currentVal === snap.expected) return false;

      if (parent && parent.nodeType === 1) {
        if (recordElementConflict(parent, currentVal, snap.expected, snap.orig, snap.translatedAt)) {
          exemptNodes.add(node);
          modifiedTextNodes.delete(node);
          textSnapshots.delete(node);
          return true;
        }
      }

      // Host updated to genuinely new English copy (e.g. "Save" -> "Saved")
      var isBackToOrig = currentVal === snap.orig;
      var isExternalZh = ZH_CHAR_RE.test(currentVal || '');
      if (!isBackToOrig && !isExternalZh) {
        textSnapshots.delete(node);
        modifiedTextNodes.delete(node);
      }
      return false;
    }

    function checkChildListConflict(el) {
      if (!el || el.nodeType !== 1) return false;
      if (exemptElements.has(el)) return true;
      var st = elementConflictState.get(el);
      if (!st) return false;

      var curText = el.textContent || '';
      if (curText === st.lastExpected) return false;

      var isBackToOrig = hasOwn.call(st.entries, curText) || curText === st.lastOrig;
      var isExternalZh =
        ZH_CHAR_RE.test(curText) &&
        curText !== st.lastExpected &&
        (!st.lastExpected || curText.indexOf(st.lastExpected) === -1) &&
        (!el.children || el.children.length === 0);
      if (isBackToOrig || isExternalZh) {
        if (recordElementConflict(el, curText, st.lastExpected, isBackToOrig ? curText : undefined, st.lastTranslatedAt)) {
          return true;
        }
      } else {
        elementConflictState.delete(el);
      }
      return false;
    }

    function applyTextWrite(node, origVal, newVal) {
      var prevSnap = textSnapshots.get(node);
      var baseOrig = prevSnap ? prevSnap.orig : origVal;
      var now = nowFn();
      node.nodeValue = newVal;
      textSnapshots.set(node, {
        orig: baseOrig,
        expected: newVal,
        translatedAt: now,
      });
      textUntranslatedCache.delete(node);
      modifiedTextNodes.add(node);

      var parent = node.parentElement || node.parentNode;
      if (parent && parent.nodeType === 1) {
        var st = elementConflictState.get(parent);
        if (!st) {
          st = {
            writeVersion: 0,
            lastCountedVersion: 0,
            lastTranslatedAt: now,
            lastOrig: baseOrig,
            lastExpected: newVal,
            entries: Object.create(null),
            conflicts: [],
          };
          elementConflictState.set(parent, st);
        }
        st.writeVersion++;
        st.lastTranslatedAt = now;
        st.lastOrig = baseOrig;
        st.lastExpected = newVal;
        if (Object.keys(st.entries).length > 16) {
          st.entries = Object.create(null);
        }
        st.entries[baseOrig] = true;
      }
    }

    function sliceEdgeWhitespace(str) {
      var len = str.length;
      var start = 0;
      while (start < len && /\s/.test(str.charAt(start))) start++;
      var end = len;
      while (end > start && /\s/.test(str.charAt(end - 1))) end--;
      return {
        leading: str.slice(0, start),
        trailing: str.slice(end),
      };
    }

    function translateTextNode(node) {
      if (!state.active || state.destroyed) return;
      if (!node || node.nodeType !== 3) return;
      if (node.isConnected === false) return;
      if (exemptNodes.has(node)) return;

      var parent = node.parentElement || node.parentNode;
      if (parent && exemptElements.has(parent)) return;
      if (parent && isIgnoredBoundary(parent)) return;

      if (checkNodeConflict(node) || !state.active) return;

      var original = node.nodeValue;
      if (!original) return;

      var snap = textSnapshots.get(node);
      if (snap && snap.expected === original) return;
      if (!snap && textUntranslatedCache.get(node) === original) return;

      var trimmed = original.trim();
      if (!trimmed) {
        textUntranslatedCache.set(node, original);
        return;
      }

      if (trimmed === '.' && node.previousSibling && ZH_CHAR_RE.test(node.previousSibling.textContent || '')) {
        applyTextWrite(node, original, original.replace('.', '。'));
        return;
      }

      var translated = translateSingleUnit(trimmed);
      if (translated !== null && translated !== trimmed) {
        var edges = sliceEdgeWhitespace(original);
        var leadingSpace = edges.leading;
        var trailingSpace = edges.trailing;
        if (!leadingSpace && node.previousSibling) {
          var prevText = (node.previousSibling.textContent || '').trim();
          if (/[a-zA-Z0-9]$/.test(prevText) && /^[\u4e00-\u9fa5]/.test(translated)) {
            leadingSpace = ' ';
          }
        }
        applyTextWrite(node, original, leadingSpace + translated + trailingSpace);
      } else {
        textUntranslatedCache.set(node, original);
      }
    }

    function translateAttributes(el) {
      if (!el || el.nodeType !== 1 || el.isConnected === false || typeof el.getAttribute !== 'function') return;
      for (var i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
        var attr = TRANSLATABLE_ATTRS[i];
        if (!hasAttr(el, attr)) continue;
        var val = getAttr(el, attr);
        if (!val) continue;

        var attrMap = attrSnapshots.get(el);
        var snap = attrMap ? attrMap.get(attr) : null;
        if (snap && snap.expected === val) continue;
        if (snap && snap.expected !== val) {
          attrMap.delete(attr);
          if (attrMap.size === 0) {
            attrSnapshots.delete(el);
            modifiedAttrElements.delete(el);
            attrMap = null;
          }
          snap = null;
        }

        var untransMap = attrUntranslatedCache.get(el);
        if (!snap && untransMap && untransMap.get(attr) === val) continue;

        var trans = translateSingleUnit(val);
        if (trans !== null && trans !== val && typeof el.setAttribute === 'function') {
          var baseOrig = val;
          el.setAttribute(attr, trans);
          if (!attrMap) {
            attrMap = new Map();
            attrSnapshots.set(el, attrMap);
          }
          attrMap.set(attr, { orig: baseOrig, expected: trans });
          modifiedAttrElements.add(el);
          if (untransMap) untransMap.delete(attr);
        } else {
          if (!untransMap) {
            untransMap = new Map();
            attrUntranslatedCache.set(el, untransMap);
          }
          untransMap.set(attr, val);
        }
      }
    }

    function translateElement(el, visitedSet) {
      if (!state.active || state.destroyed) return;
      if (!el || el.nodeType !== 1) return;
      if (el.isConnected === false) return;
      if (exemptElements.has(el)) return;
      if (isDirectIgnoredSelf(el)) return;

      if (visitedSet) {
        if (visitedSet.has(el)) return;
        visitedSet.add(el);
      }

      if (isIgnoredBoundary(el)) {
        // If this is a conversation stream wrapper (e.g. conversation-view / data-cascade-id),
        // skip its own text/attrs and prose children, but still descend into child interactive buttons/toolbars.
        if (isConversationStreamSelf(el) || isInsideConversationStream(el)) {
          var sub = el.firstChild;
          while (sub) {
            if (!state.active || state.destroyed) return;
            if (sub.nodeType === 1) translateElement(sub, visitedSet);
            sub = sub.nextSibling;
          }
        }
        return;
      }

      if (getAttr(el, 'data-testid') === 'plan-command-fyi-alert' && typeof el.querySelector === 'function') {
        var alertSpan = el.querySelector('span');
        if (alertSpan && !processedAlerts.has(alertSpan)) {
          var alertChild = alertSpan.firstChild;
          while (alertChild) {
            if (alertChild.nodeType === 3 && alertChild.nodeValue && alertChild.nodeValue.trim() === 'Type') {
              applyTextWrite(alertChild, alertChild.nodeValue, alertChild.nodeValue.replace('Type', '输入'));
            }
            alertChild = alertChild.nextSibling;
          }
          processedAlerts.add(alertSpan);
        }
      }

      translateAttributes(el);

      var first = el.firstChild;
      if (first && first.nextSibling) {
        var hasElementSibling = false;
        var cur = first;
        while (cur) {
          if (cur.nodeType === 1) {
            hasElementSibling = true;
            break;
          }
          cur = cur.nextSibling;
        }
        if (hasElementSibling) {
          var alsoNode = null;
          var whenNode = null;
          var scanCur = first;
          while (scanCur) {
            if (scanCur.nodeType === 3 && scanCur.nodeValue) {
              var tVal = scanCur.nodeValue.trim();
              if (tVal === 'Also includes') {
                alsoNode = scanCur;
              } else if (alsoNode && tVal === 'when working in this project.') {
                whenNode = scanCur;
                break;
              }
            }
            scanCur = scanCur.nextSibling;
          }
          if (alsoNode && whenNode && !exemptNodes.has(alsoNode) && !exemptNodes.has(whenNode)) {
            applyTextWrite(alsoNode, alsoNode.nodeValue, '在此项目中工作时，也包含');
            var between = alsoNode.nextSibling;
            while (between && between !== whenNode) {
              if (between.nodeType === 3 && !(between.nodeValue || '').trim()) {
                applyTextWrite(between, between.nodeValue, '');
              }
              between = between.nextSibling;
            }
            applyTextWrite(whenNode, whenNode.nodeValue, '。');
          }
        }
      }

      var child = el.firstChild;
      while (child) {
        if (!state.active || state.destroyed) return;
        if (child.nodeType === 3) {
          translateTextNode(child);
        } else if (child.nodeType === 1) {
          translateElement(child, visitedSet);
        }
        child = child.nextSibling;
      }
    }

    function safeTranslateNodes(nodes) {
      if (!state.active || state.destroyed) return;
      disconnectObserver();
      try {
        for (var i = 0; i < nodes.length; i++) {
          if (!state.active || state.destroyed) break;
          var node = nodes[i];
          if (!node || node.isConnected === false) continue;
          if (node.nodeType === 1) {
            translateElement(node);
          } else if (node.nodeType === 3) {
            translateTextNode(node);
          }
        }
      } catch (e) {}
      reconnectObserver();
    }

    function safeFullScan() {
      if (!state.active || state.destroyed || !doc || !doc.documentElement) return;
      var visitedSet = new WeakSet();
      disconnectObserver();
      try {
        translateElement(doc.documentElement, visitedSet);
      } catch (e) {}
      reconnectObserver();
    }

    function isPaused() {
      var hidden = Boolean(doc && doc.hidden === true);
      return hidden || pausedByVisibilityOrBlur;
    }

    function enqueueNode(node) {
      if (!node || !state.active || state.destroyed) return;
      if (node.isConnected === false) return;
      if (pendingNodeSet.has(node)) return;
      if (pendingNodes.length < 640) {
        pendingNodes.push(node);
        pendingNodeSet.add(node);
      }
    }

    function flushPendingNodes() {
      rafId = null;
      if (!state.active || state.destroyed) return;
      if (isPaused()) {
        missedWhilePaused = true;
        return;
      }
      modifiedTextNodes.prune();
      modifiedAttrElements.prune();
      if (pendingNodes.length === 0) return;
      var batch = pendingNodes.splice(0, MAX_NODES_PER_FRAME);
      for (var i = 0; i < batch.length; i++) {
        pendingNodeSet.delete(batch[i]);
      }
      safeTranslateNodes(batch);
      if (state.active && !state.destroyed && pendingNodes.length > 0) {
        scheduleFlush();
      }
    }

    function scheduleFlush() {
      if (!state.active || state.destroyed) return;
      if (isPaused()) {
        missedWhilePaused = true;
        return;
      }
      if (rafId === null) {
        rafId = rafFn(flushPendingNodes);
      }
    }

    function inspectExternalDelayedMutation(node) {
      if (state.mode !== 'auto') return false;
      if (nowFn() - bootAt > LAYER2B_WINDOW_MS) return false;
      if (!node) return false;

      function checkSingleTextNode(tNode) {
        if (!tNode || tNode.nodeType !== 3) return;
        var parent = tNode.parentElement || tNode.parentNode;
        if (
          !parent ||
          isPrismOwnedElement(parent) ||
          isUserContentBoundary(parent) ||
          isInsideConversationStream(parent) ||
          isIgnoredBoundary(parent)
        ) {
          return;
        }
        var val = (tNode.nodeValue || '').trim();
        if (!val || !ZH_CHAR_RE.test(val)) return;
        var snap = textSnapshots.get(tNode);
        if (snap && snap.expected === tNode.nodeValue) return;
        if (hasOwn.call(translatedValues, val) || isInsideExplicitDelayedChrome(parent)) {
          delayedExternalNodes.add(parent);
        }
      }

      if (node.nodeType === 3) {
        checkSingleTextNode(node);
      } else if (node.nodeType === 1) {
        if (
          isPrismOwnedElement(node) ||
          isUserContentBoundary(node) ||
          isInsideConversationStream(node) ||
          isIgnoredBoundary(node)
        ) {
          return false;
        }
        var stack = [node];
        var steps = 0;
        while (stack.length > 0 && steps < 120) {
          steps++;
          var cur = stack.pop();
          if (cur.nodeType === 3) {
            checkSingleTextNode(cur);
          } else if (
            cur.nodeType === 1 &&
            !isDirectIgnoredSelf(cur) &&
            !isConversationStreamSelf(cur)
          ) {
            var ch = cur.firstChild;
            while (ch) {
              stack.push(ch);
              ch = ch.nextSibling;
            }
          }
        }
      }

      if (delayedExternalNodes.size >= 2) {
        yieldAndRollback('external-ui-zh');
        return true;
      }
      return false;
    }

    function scanFloatingContainers() {
      if (!state.active || state.destroyed || isPaused() || !doc || !doc.body) return;
      disconnectObserver();
      try {
        var last = doc.body.lastElementChild;
        if (last && isFloatingElement(last, doc)) {
          translateElement(last);
        }
        if (last && last.previousElementSibling && isFloatingElement(last.previousElementSibling, doc)) {
          translateElement(last.previousElementSibling);
        }
        if (typeof doc.querySelectorAll === 'function') {
          var tooltips = doc.querySelectorAll(
            '[role="tooltip"], [role="menu"], [role="dialog"], [data-floating-ui-portal], [data-radix-popper-content-wrapper], .popover, .tooltip, .context-view, .monaco-hover'
          );
          if (tooltips && tooltips.length > 0) {
            for (var tIdx = 0; tIdx < tooltips.length; tIdx++) {
              if (!state.active) break;
              translateElement(tooltips[tIdx]);
            }
          }
        }
      } catch (e) {}
      reconnectObserver();
    }

    function runHoverTargetScan(target) {
      if (!state.active || state.destroyed || isPaused() || !target || target.nodeType !== 1) return;
      if (target.isConnected === false) return;
      disconnectObserver();
      try {
        translateElement(target);
        var parent = target.parentElement;
        if (parent && !isWorkbenchOrRoot(parent, doc)) {
          var childCnt =
            typeof parent.childElementCount === 'number'
              ? parent.childElementCount
              : parent.children
              ? parent.children.length
              : 99;
          if (childCnt <= 8) {
            translateElement(parent);
          }
        }
      } catch (err) {}
      reconnectObserver();
    }

    function enterHibernation() {
      if (!state.active || state.destroyed) return;
      pausedByVisibilityOrBlur = true;
      if (rafId !== null) {
        cancelRafFn(rafId);
        rafId = null;
      }
      if (hoverScanTimer !== null) {
        clearTimeoutFn(hoverScanTimer);
        hoverScanTimer = null;
      }
      missedWhilePaused = true;
      pendingNodes.length = 0;
      pendingNodeSet.clear();
      if (nowFn() - bootAt > LAYER2B_WINDOW_MS) {
        disconnectObserver();
      }
    }

    function wakeFromHibernation() {
      if (!state.active || state.destroyed) return;
      if (doc && doc.hidden) return;
      pausedByVisibilityOrBlur = false;
      if (missedWhilePaused || pendingNodes.length > 0 || !observing) {
        missedWhilePaused = false;
        pendingNodes.length = 0;
        pendingNodeSet.clear();
        safeFullScan();
        pendingNodes.length = 0;
        pendingNodeSet.clear();
        reconnectObserver();
      }
    }

    function attachListenersAndObserver() {
      if (!doc || !doc.documentElement || state.destroyed || !state.active) return;

      if (!isPaused()) {
        safeFullScan();
      } else {
        missedWhilePaused = true;
      }
      if (!state.active || state.destroyed) return;

      var MutationObserverClass =
        opts.MutationObserver ||
        (win && win.MutationObserver) ||
        (typeof MutationObserver !== 'undefined' ? MutationObserver : null);

      if (MutationObserverClass) {
        observer = new MutationObserverClass(function (mutations) {
          if (!state.active || state.destroyed) return;
          for (var i = 0; i < mutations.length; i++) {
            if (!state.active || state.destroyed) return;
            var mutation = mutations[i];
            if (mutation.type === 'childList') {
              var targetEl = mutation.target;
              var added = mutation.addedNodes || [];
              if (targetEl && targetEl.nodeType === 1 && checkChildListConflict(targetEl)) {
                continue;
              }
              if (!state.active || state.destroyed) return;
              for (var j = 0; j < added.length; j++) {
                if (inspectExternalDelayedMutation(added[j])) return;
                enqueueNode(added[j]);
              }
            } else if (mutation.type === 'characterData' && mutation.target) {
              var target = mutation.target;
              if (inspectExternalDelayedMutation(target)) return;
              if (checkNodeConflict(target)) continue;
              if (!state.active || state.destroyed) return;
              enqueueNode(target);
            }
          }
          if (pendingNodes.length > 0) {
            scheduleFlush();
          }
        });
        if (!isPaused() || nowFn() - bootAt <= LAYER2B_WINDOW_MS) {
          reconnectObserver();
        }
      }

      // Layer 2b delayed-plugin check within 1200ms window (auto mode only)
      if (state.mode === 'auto') {
        var checkDelays = [450, 1150];
        for (var d = 0; d < checkDelays.length; d++) {
          (function (delayMs) {
            var tid = setTimeoutFn(function () {
              if (!state.active || state.destroyed || state.mode !== 'auto') return;
              if (nowFn() - bootAt > LAYER2B_WINDOW_MS + 100) return;
              var l1 = detectLayer1External(win, doc);
              if (l1.hit) {
                yieldAndRollback('external-ui-zh');
                return;
              }
              var l2 = detectLayer2ChromeZh(doc, { textSnapshots: textSnapshots });
              if (l2.hit) {
                yieldAndRollback('external-ui-zh');
                return;
              }
              if (delayMs >= 1150 && isPaused()) {
                disconnectObserver();
              }
            }, delayMs);
            layer2bTimers.push(tid);
          })(checkDelays[d]);
        }
      }

      // Hover & ContextMenu targeted floating scan (leading + trailing 120ms throttle)
      hoverHandler = function (e) {
        if (!state.active || state.destroyed || isPaused()) return;
        var target = e && e.target;
        var now = nowFn();
        var elapsed = now - lastHoverTime;
        var ranImmediate = false;
        if (elapsed >= 120) {
          lastHoverTime = now;
          ranImmediate = true;
          runHoverTargetScan(target);
        }
        if (hoverScanTimer !== null) {
          clearTimeoutFn(hoverScanTimer);
        }
        var delay = ranImmediate ? 50 : Math.max(50, 120 - elapsed + 20);
        hoverScanTimer = setTimeoutFn(function () {
          hoverScanTimer = null;
          lastHoverTime = nowFn();
          if (!ranImmediate) {
            runHoverTargetScan(target);
          }
          scanFloatingContainers();
        }, delay);
      };

      if (typeof doc.addEventListener === 'function') {
        doc.addEventListener('pointerenter', hoverHandler, { capture: true, passive: true });
        doc.addEventListener('contextmenu', hoverHandler, { capture: true, passive: true });

        visibilityHandler = function () {
          if (!state.active || state.destroyed) return;
          if (doc.hidden) {
            enterHibernation();
          } else {
            wakeFromHibernation();
          }
        };
        doc.addEventListener('visibilitychange', visibilityHandler);
      }

      if (win && typeof win.addEventListener === 'function') {
        blurHandler = function () {
          enterHibernation();
        };
        focusHandler = function () {
          wakeFromHibernation();
        };
        win.addEventListener('blur', blurHandler);
        win.addEventListener('focus', focusHandler);
      }
    }

    function boot(targetMode) {
      mode = targetMode === 'on' || targetMode === 'off' ? targetMode : 'auto';
      state.mode = mode;

      if (mode === 'off') {
        teardownRuntime('off', 'disabled', false);
        return;
      }

      state.destroyed = false;
      state.yielded = false;
      state.reason = null;
      bootAt = nowFn();
      pausedByVisibilityOrBlur = Boolean(doc && doc.hidden === true);
      missedWhilePaused = false;
      delayedExternalNodes.clear();
      globalConflictRecords.length = 0;

      if (mode === 'auto') {
        var extCheck = detectExternalLocalization(win, doc);
        if (extCheck.detected) {
          state.active = false;
          state.status = 'yielded';
          state.reason = extCheck.reason || 'external-ui-zh';
          state.yielded = true;
          setRootStatusAttr('yielded');
          return;
        }
      }

      state.active = true;
      state.status = 'active';
      setRootStatusAttr('active');

      if (doc) {
        if (doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
          domReadyHandler = function () {
            if (!state.active || state.destroyed) return;
            if (state.mode === 'auto') {
              var recheck = detectExternalLocalization(win, doc);
              if (recheck.detected) {
                yieldAndRollback(recheck.reason || 'external-ui-zh');
                return;
              }
            }
            attachListenersAndObserver();
          };
          doc.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
        } else {
          attachListenersAndObserver();
        }
      }
    }

    boot(mode);

    var instance = {
      getStatus: function () {
        return {
          active: state.active,
          mode: state.mode,
          status: state.status,
          reason: state.reason,
          translatedCount: countTranslatedUnits(),
          yielded: state.yielded,
        };
      },
      destroy: function () {
        teardownRuntime('off', 'destroyed', false);
      },
      setMode: function (nextMode) {
        var norm = nextMode === 'on' || nextMode === 'off' ? nextMode : 'auto';
        if (norm === state.mode && ((norm === 'off' && state.status === 'off') || (norm !== 'off' && state.active))) {
          return instance.getStatus();
        }
        teardownRuntime('off', 'mode-switch', false);
        boot(norm);
        return instance.getStatus();
      },
      scan: function () {
        if (state.active && !state.destroyed) {
          safeFullScan();
        }
        return instance.getStatus();
      },
    };

    if (win) {
      win.__agPrismHostI18n = instance;
    }

    return instance;
  }

  return {
    createHostI18nEngine: createHostI18nEngine,
    mountHostI18n: mountHostI18n,
    detectExternalLocalization: detectExternalLocalization,
    detectLayer1External: detectLayer1External,
    detectLayer2ChromeZh: detectLayer2ChromeZh,
    isPrismOwnedElement: isPrismOwnedElement,
    isUserContentBoundary: isUserContentBoundary,
    isIgnoredBoundary: isIgnoredBoundary,
  };
});
