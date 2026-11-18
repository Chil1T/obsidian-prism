// Obsidian Prism — Omni Built-in Browser, Context Menu & Streaming Workbench Client (v1.0.1)
// Second-channel runtime (`window.__agPrismOmni`) + CommonJS factory for deterministic unit tests.
// Engineering & security guarantees:
// 1. ZERO hover popups or inline action clutter; enhanced actions live in Right-Click (`contextmenu`) menu.
// 2. Zero-DOM-Mutation bare URL/path activation via CSS Custom Highlight API (`CSS.highlights` + Range)
//    so React 19 `HostText` nodes are never split or detached (`0` `removeChild`/`insertBefore` crashes),
//    with automatic `<span>` fallback only in headless test harnesses lacking `CSS.highlights`.
// 3. Dual-engine side pane: isolated Electron `wcvBrowser` (`persist:ag-prism-omni`) for external web URLs
//    with full Base UI portal/menu/QuickPick/visibility auto-hide, plus origin-locked `/viewer` iframe.
// 4. 100% alignment with `style.css` tokens (`--ag-cs-*`) and zero-residue re-entrant `destroy() <-> sync()`.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  const W = root || (typeof window !== 'undefined' ? window : globalThis);
  if (W && W.document && !W.__agPrismOmniDisableAutoBoot) {
    try {
      W.__agPrismOmni?.destroy?.();
    } catch (_) {}
    const instance = api.createOmniClient({ window: W, document: W.document });
    W.__agPrismOmni = instance;
    if (typeof globalThis !== 'undefined') {
      globalThis.__agPrismOmni = instance;
    }
    const initCfg = W.__agPrism?.getState?.()?.cfg || W.__agPrismOmniBootCfg || null;
    const initMeta = W.__agPrismOmniServerMeta || null;
    instance.sync(initCfg, initMeta);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = '1.0.1';
  const STYLE_EL_ID = 'ag-prism-omni-css';
  const WCV_TAB_KEY = 'ag-prism-omni-browser';
  const HL_URL_NAME = 'ag-omni-url';
  const HL_PATH_NAME = 'ag-omni-path';

  // Compact 5-locale fallback table [zh-CN, zh-TW, yue, en, ja]; primary source is `window.__agCsLocales`
  const LANG_INDEX = { 'zh-CN': 0, 'zh-TW': 1, yue: 2, en: 3, ja: 4 };
  const FALLBACK_ROWS = {
    omniOpenBuiltin: ['在右侧面板打开', '在右側面板開啟', '喺右邊面板打開', 'Open in Side Pane', '右パネルで開く'],
    omniOpenPreview: ['在右侧检视台预览', '在右側檢視台預覽', '喺右邊檢視台預覽', 'Preview in Workbench', 'ワークベンチでプレビュー'],
    omniOpenExternal: ['使用系统默认程序打开', '使用系統預設程式開啟', '用系統預設程式打開', 'Open in Default App', '既定のアプリで開く'],
    omniOpenBrowser: ['在系统浏览器中打开', '在系統瀏覽器中開啟', '喺系統瀏覽器打開', 'Open in System Browser', '標準ブラウザで開く'],
    omniRevealFolder: ['在文件夹中显示', '在資料夾中顯示', '喺資料夾入面顯示', 'Reveal in Folder', 'フォルダに表示'],
    omniInsertMention: ['作为 @引用 填入输入框', '作為 @引用 填入輸入框', '當做 @引用 填入輸入框', 'Insert as @Mention', '@参照として入力欄へ挿入'],
    omniCopyLink: ['复制链接地址', '複製連結位址', '複製連結地址', 'Copy Link URL', 'リンクURLをコピー'],
    omniCopyAbsPath: ['复制绝对路径', '複製絕對路徑', '複製絕對路徑', 'Copy Absolute Path', '絶対パスをコピー'],
    omniCopyRelPath: ['复制相对路径', '複製相對路徑', '複製相對路徑', 'Copy Relative Path', '相対パスをコピー'],
    omniCopyText: ['复制文本', '複製文字', '複製文字', 'Copy Text', 'テキストをコピー'],
    omniZoomDiagram: ['放大查看图表', '放大檢視圖表', '放大睇圖表', 'Zoom Diagram', '図を拡大表示'],
    omniViewWorkbench: ['检视台视图', '檢視台檢視', '檢視台檢視', 'Workbench View', 'プレビュー表示'],
    omniViewRaw: ['原始视图', '原始檢視', '原始檢視', 'Raw View', 'ソース表示'],
    omniReload: ['刷新', '重新整理', '重新整理', 'Reload', '再読み込み'],
    omniBack: ['后退', '返回', '後退', 'Back', '戻る'],
    omniForward: ['前进', '前進', '前進', 'Forward', '進む'],
    omniClose: ['关闭面板', '關閉面板', '關閉面板', 'Close Pane', 'パネルを閉じる'],
    omniCopied: ['已复制', '已複製', '已複製', 'Copied', 'コピー済'],
    omniOfflineHint: [
      '本地流式检视网关未连接，可使用系统默认程序打开或定位文件。',
      '本機串流檢視閘道未連線，可使用系統預設程式開啟或顯示檔案。',
      '本地串流檢視網關未連線，可以用系統預設程式打開或者定位檔案。',
      'Local streaming gateway is offline. Use default app or reveal in folder.',
      'ローカルプレビューサーバーが未接続です。既定のアプリまたはフォルダ表示をご利用ください。',
    ],
    omniViewportFull: ['自适应宽度 (100%)', '自適應寬度 (100%)', '自適應闊度 (100%)', 'Fluid Width (100%)', '自動幅 (100%)'],
    omniViewportTablet: ['平板宽度 (768px)', '平板寬度 (768px)', '平板闊度 (768px)', 'Tablet Width (768px)', 'タブレット幅 (768px)'],
    omniViewportMobile: ['手机宽度 (390px)', '手機寬度 (390px)', '手機闊度 (390px)', 'Mobile Width (390px)', 'モバイル幅 (390px)'],
  };

  const PREVIEW_KIND_BY_EXT = {
    mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video', ogv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio',
    svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', bmp: 'image', ico: 'image',
    html: 'html', htm: 'html', pdf: 'pdf',
    csv: 'table', tsv: 'table', jsonl: 'table', ndjson: 'table',
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
    mmd: 'mermaid', mermaid: 'mermaid',
  };

  const AUX_SWITCHABLE_EXTS = new Set(Object.keys(PREVIEW_KIND_BY_EXT));

  const KNOWN_FILE_EXTS = new Set([
    ...AUX_SWITCHABLE_EXTS,
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
    'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf',
    'md', 'mdx', 'txt', 'log', 'rst', 'css', 'scss', 'less', 'vue', 'svelte',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua',
    'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'proto', 'xml', 'lock', 'dockerfile',
  ]);

  const SKIP_WALK_TAGS = new Set([
    'PRE', 'CODE', 'A', 'BUTTON', 'SCRIPT', 'STYLE', 'TEXTAREA',
    'INPUT', 'SELECT', 'OPTION', 'SVG', 'NOSCRIPT', 'IFRAME', 'CANVAS',
  ]);

  const SCAN_CONTAINER_SELECTOR = [
    '[data-testid="planner-response-text"]',
    '[data-testid="agent-response"]',
    '[data-testid="artifact-view"]',
    '[data-testid="background-task-command"]',
    '[data-testid="terminal-output"]',
    '.markdown-body',
    '[data-omni-scan="true"]',
  ].join(', ');

  const EXCLUDED_ANCESTOR_SELECTOR = [
    'pre', 'code', 'a', 'button', 'svg',
    '[contenteditable="true"]',
    '[data-testid="agent-input-box"]',
    '[data-testid="entity-pill"]',
    '.inline-pill',
    '.code-block',
    '.ag-prism-thought-overlay',
    '[data-ag-cs-spark-streaming="1"]',
    '[data-ag-cs-thought-streaming="1"]',
    '.ag-omni-autolink',
    '.ag-omni-dock',
    '.ag-omni-menu',
    '.ag-omni-aux-bar',
  ].join(', ');

  const FILE_PILL_SELECTOR = [
    '[data-testid="entity-pill"]',
    '.inline-pill',
    '.ag-prism-thought-file-pill',
    'a[href^="file:"]',
    'a[href^="vscode-file:"]',
    'a[href^="antigravity-ide://file"]',
    '[data-testid="attached-context-pill"]',
    '[data-testid="user-message-document-chip"]',
    '[data-testid="artifact-card"]',
    '[data-testid="bubble-artifact-card"]',
    '[data-testid="artifact-row"]',
  ].join(', ');

  const AUX_FILE_VIEW_SELECTOR = [
    '[data-testid="binary-file-no-preview"]',
    '[data-testid="artifact-pdf-no-preview"]',
    '[data-testid="csv-file-viewer"]',
    '[data-testid="image-file-viewer"]',
    '[data-testid="html-file-preview"]',
    '[data-testid="artifact-pdf-view"]',
    '.file-viewer-root',
    '[data-testid="file-view"]',
    '[data-testid="aux-file-view"]',
    '[data-omni-aux-file]',
  ].join(', ');

  const BLOCKING_OVERLAY_SELECTOR = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[data-base-ui-portal] [role="menu"]',
    '[data-base-ui-portal] [role="listbox"]',
    '[data-base-ui-portal] [role="dialog"]',
    '[data-base-ui-portal] [data-open]',
    '[data-base-ui-portal] [data-popup-open]',
    '[data-testid="quick-pick"]',
    '.quick-input-widget:not([style*="display: none"])',
    '.aux-drawer-popup',
    '.ag-cs-effort-popover',
    '.ag-cs-ctx-popover',
    '.ag-cs-nav-outline-popover',
  ].join(', ');

  const BARE_TOKEN_RE = new RegExp(
    [
      '(https?:\\/\\/[^\\s<>"\'`\\]]+)',
      '\\b(localhost:\\d{2,5}(?:\\/[^\\s<>"\'`\\]]*)?)',
      '\\b([A-Za-z]:[\\\\/](?:[^\\s<>"\'|?*:\\r\\n]+[\\\\/])*[^\\s<>"\'|?*:\\r\\n]+\\.[A-Za-z0-9]{1,8}(?:#L\\d+(?:-L?\\d+)?|:\\d+(?::\\d+)?)?)',
      '(?<![A-Za-z0-9_@:/.-])((?:\\.{1,2}\\/|~\\/|\\/(?![\\/\\s])|[A-Za-z0-9_.-]+\\/)(?:[A-Za-z0-9_.-]+\\/)*[A-Za-z0-9_.-]+\\.[A-Za-z0-9]{1,8}(?:#L\\d+(?:-L?\\d+)?|:\\d+(?::\\d+)?)?)',
    ].join('|'),
    'g'
  );

  const TRAILING_PUNCT_RE = /[.,;:!?。，；：！？、）】》"'`]+$/;

  function normalizeLangCode(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^zh[-_](?:TW|HK|MO|Hant)/i.test(s)) return 'zh-TW';
    if (/^(?:yue|zh[-_]yue)/i.test(s)) return 'yue';
    if (/^ja\b/i.test(s)) return 'ja';
    if (/^en\b/i.test(s)) return 'en';
    if (/^zh\b/i.test(s)) return 'zh-CN';
    return '';
  }

  function splitPathAndLineRange(rawInput) {
    let str = String(rawInput || '').trim();
    if (!str) return { pathPart: '', lineStart: null, lineEnd: null };
    let lineStart = null;
    let lineEnd = null;
    const hashMatch = /#L(\d+)(?:-L?(\d+))?$/i.exec(str);
    if (hashMatch) {
      lineStart = parseInt(hashMatch[1], 10);
      lineEnd = hashMatch[2] ? parseInt(hashMatch[2], 10) : null;
      str = str.slice(0, hashMatch.index);
    } else {
      const colonMatch = /:(\d+)(?:(?:-(\d+))|(?::\d+))?$/.exec(str);
      if (colonMatch && colonMatch.index > 2) {
        lineStart = parseInt(colonMatch[1], 10);
        lineEnd = colonMatch[2] ? parseInt(colonMatch[2], 10) : null;
        str = str.slice(0, colonMatch.index);
      }
    }
    return { pathPart: str, lineStart, lineEnd };
  }

  function parseFileUriToPath(rawUriOrPath) {
    const input = String(rawUriOrPath || '').trim();
    if (!input) return { filePath: '', lineStart: null, lineEnd: null };
    let cleaned = input;
    if (/^antigravity-ide:\/\/file/i.test(cleaned)) {
      cleaned = 'file://' + cleaned.replace(/^antigravity-ide:\/\/file/i, '');
    } else if (/^vscode-file:\/\/vscode-app/i.test(cleaned)) {
      cleaned = 'file://' + cleaned.replace(/^vscode-file:\/\/vscode-app/i, '');
    }
    const { pathPart: preSplit, lineStart: preStart, lineEnd: preEnd } = splitPathAndLineRange(cleaned);
    let pathStr = preSplit;
    if (/^file:\/\//i.test(pathStr)) {
      let rest = pathStr.replace(/^file:\/\//i, '');
      if (/^localhost\//i.test(rest)) rest = rest.slice('localhost'.length);
      try { rest = decodeURIComponent(rest); } catch (_) {}
      if (/^\/[A-Za-z]:[\\/]/.test(rest)) {
        rest = rest.slice(1).replace(/\//g, '\\');
      } else if (/^[A-Za-z]:[\\/]/.test(rest)) {
        rest = rest.replace(/\//g, '\\');
      }
      pathStr = rest;
    } else {
      try {
        if (/%[0-9A-Fa-f]{2}/.test(pathStr)) pathStr = decodeURIComponent(pathStr);
      } catch (_) {}
    }
    const post = splitPathAndLineRange(pathStr);
    return {
      filePath: post.pathPart || pathStr,
      lineStart: preStart || post.lineStart || null,
      lineEnd: preEnd || post.lineEnd || null,
    };
  }

  function getFileExt(filePath) {
    const { pathPart } = splitPathAndLineRange(filePath);
    const clean = String(pathPart || '').split(/[?#]/)[0];
    const base = clean.split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) {
      return base.toLowerCase() === 'dockerfile' ? 'dockerfile' : '';
    }
    return base.slice(dot + 1).toLowerCase();
  }

  function getBaseName(filePath) {
    const { pathPart } = splitPathAndLineRange(filePath);
    const clean = String(pathPart || '').replace(/[\\/]+$/, '');
    const parts = clean.split(/[\\/]/);
    return parts[parts.length - 1] || clean;
  }

  function detectPreviewKind(filePath, explicitKind) {
    if (explicitKind && explicitKind !== 'auto') return explicitKind;
    return PREVIEW_KIND_BY_EXT[getFileExt(filePath)] || 'auto';
  }

  function normalizeSlashes(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  function computeRelativePath(absOrRawPath, workspaceRoot) {
    const raw = String(absOrRawPath || '').trim();
    if (!raw) return '';
    const { pathPart, lineStart, lineEnd } = splitPathAndLineRange(raw);
    const suffix = lineStart ? (lineEnd ? `#L${lineStart}-L${lineEnd}` : `#L${lineStart}`) : '';
    const normFile = normalizeSlashes(pathPart);
    if (!workspaceRoot) return normFile + suffix;
    const normRoot = normalizeSlashes(parseFileUriToPath(workspaceRoot).filePath).replace(/\/$/, '');
    if (!normRoot) return normFile + suffix;
    const isWinPath = /^[A-Za-z]:\//.test(normFile) || /^[A-Za-z]:\//.test(normRoot);
    const cmpFile = isWinPath ? normFile.toLowerCase() : normFile;
    const cmpRoot = isWinPath ? normRoot.toLowerCase() : normRoot;
    if (cmpFile === cmpRoot) return '.' + suffix;
    if (cmpFile.startsWith(cmpRoot + '/')) return normFile.slice(normRoot.length + 1) + suffix;
    return normFile + suffix;
  }

  function isHttpUrl(str) {
    return /^https?:\/\/[^\s]+$/i.test(String(str || '').trim());
  }

  function toFileUri(filePath) {
    const p = String(filePath || '').trim();
    if (!p) return '';
    if (/^file:\/\//i.test(p)) return p;
    const norm = normalizeSlashes(p);
    if (/^[A-Za-z]:\//.test(norm)) return 'file:///' + encodeURI(norm);
    if (norm.startsWith('/')) return 'file://' + encodeURI(norm);
    return '';
  }

  function tokenizeBareText(text) {
    const raw = String(text || '');
    if (!raw || raw.length < 4 || raw.length > 32000) return null;
    if (
      raw.indexOf('http') === -1 &&
      raw.indexOf('localhost:') === -1 &&
      raw.indexOf('/') === -1 &&
      raw.indexOf('\\') === -1
    ) {
      return null;
    }

    BARE_TOKEN_RE.lastIndex = 0;
    const tokens = [];
    let lastIdx = 0;
    let match;

    while ((match = BARE_TOKEN_RE.exec(raw)) !== null) {
      const fullMatch = match[0];
      const matchStart = match.index;
      let candidate = fullMatch;
      let trailing = '';

      while (candidate.length > 0) {
        const punct = TRAILING_PUNCT_RE.exec(candidate);
        if (punct) {
          trailing = punct[0] + trailing;
          candidate = candidate.slice(0, -punct[0].length);
          continue;
        }
        if (candidate.endsWith(')')) {
          const opens = (candidate.match(/\(/g) || []).length;
          const closes = (candidate.match(/\)/g) || []).length;
          if (closes > opens) {
            trailing = ')' + trailing;
            candidate = candidate.slice(0, -1);
            continue;
          }
        }
        break;
      }

      let kind = '';
      let url = '';
      let filePath = '';
      let lineStart = null;
      let lineEnd = null;

      if (match[1]) {
        if (isHttpUrl(candidate)) {
          kind = 'url';
          url = candidate;
        }
      } else if (match[2]) {
        kind = 'url';
        url = 'http://' + candidate;
      } else if (match[3] || match[4]) {
        const parsed = splitPathAndLineRange(candidate);
        const ext = getFileExt(parsed.pathPart);
        if (ext && KNOWN_FILE_EXTS.has(ext) && !/^https?:/i.test(candidate)) {
          kind = 'file';
          filePath = parsed.pathPart;
          lineStart = parsed.lineStart;
          lineEnd = parsed.lineEnd;
        }
      }

      if (!kind) continue;

      if (matchStart > lastIdx) {
        tokens.push({ type: 'text', value: raw.slice(lastIdx, matchStart), start: lastIdx, end: matchStart });
      }
      tokens.push({
        type: kind,
        display: candidate,
        url,
        filePath,
        lineStart,
        lineEnd,
        start: matchStart,
        end: matchStart + candidate.length,
      });
      lastIdx = matchStart + candidate.length;
      if (trailing) {
        tokens.push({ type: 'text', value: trailing, start: lastIdx, end: lastIdx + trailing.length });
        lastIdx += trailing.length;
      }
    }

    if (tokens.length === 0) return null;
    if (lastIdx < raw.length) {
      tokens.push({ type: 'text', value: raw.slice(lastIdx), start: lastIdx, end: raw.length });
    }
    return tokens;
  }

  function readFiberFileHint(el, maxDepth = 12) {
    if (!el || typeof el !== 'object') return '';
    try {
      const keys = Object.keys(el);
      const fk = keys.find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
      if (!fk || !el[fk]) return '';
      let cur = el[fk];
      for (let depth = 0; depth < maxDepth && cur; depth++, cur = cur.return) {
        if (
          typeof cur.key === 'string' &&
          (cur.key.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(cur.key) || cur.key.startsWith('/'))
        ) {
          return cur.key;
        }
        const p = cur.memoizedProps || (depth === 0 ? cur : null);
        if (!p || typeof p !== 'object') continue;
        const direct =
          p.fileUri || p.uri || p.filePath || p.absoluteUri || p.href ||
          p['data-uri'] || p['data-active-file-uri'] || p['data-file-uri'];
        if (typeof direct === 'string' && (direct.startsWith('file://') || /[\\/]/.test(direct))) {
          return direct;
        }
        if (Array.isArray(p.artifactUris) && typeof p.artifactUris[0] === 'string') {
          return p.artifactUris[0];
        }
        if (typeof p.title === 'string' && (p.title.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(p.title) || p.title.startsWith('/'))) {
          return p.title;
        }
      }
    } catch (_) {}
    return '';
  }

  function findClosest(el, selector) {
    let cur = el && el.nodeType === 1 ? el : el && el.parentElement ? el.parentElement : null;
    while (cur && cur.nodeType === 1) {
      if (typeof cur.matches === 'function' && cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function isMermaidContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    const tid = String(el.getAttribute?.('data-testid') || '').toLowerCase();
    const cls = String(el.className || '').toLowerCase();
    if (tid.includes('mermaid') || /\bmermaid\b/.test(cls)) {
      return Boolean(el.querySelector?.('svg') || el.tagName === 'SVG');
    }
    if (el.tagName === 'SVG') {
      const id = String(el.getAttribute?.('id') || '').toLowerCase();
      const roleDesc = String(el.getAttribute?.('aria-roledescription') || '').toLowerCase();
      if (
        id.startsWith('mermaid') ||
        roleDesc.includes('flowchart') ||
        roleDesc.includes('sequence') ||
        roleDesc.includes('diagram') ||
        roleDesc.includes('state') ||
        roleDesc.includes('gantt') ||
        roleDesc.includes('class') ||
        roleDesc.includes('er')
      ) {
        return true;
      }
    }
    return false;
  }

  function findMermaidTarget(startEl) {
    let cur = startEl && startEl.nodeType === 1 ? startEl : startEl?.parentElement;
    for (let i = 0; i < 8 && cur && cur.nodeType === 1; i++, cur = cur.parentElement) {
      if (cur.hasAttribute?.('data-omni-mermaid-box')) return cur;
      if (isMermaidContainer(cur)) {
        return cur.tagName === 'SVG' && cur.parentElement ? cur.parentElement : cur;
      }
    }
    return null;
  }

  function extractTargetMeta(startNode) {
    const el = startNode && startNode.nodeType === 1 ? startNode : startNode?.parentElement;
    if (!el) return null;
    if (findClosest(el, '.ag-omni-dock, .ag-omni-menu')) return null;

    // 1. Activated fallback autolink span
    const autoSpan = findClosest(el, '.ag-omni-autolink');
    if (autoSpan) {
      const autoUrl = autoSpan.getAttribute('data-omni-url');
      if (autoUrl) {
        return { kind: 'url', url: autoUrl, text: (autoSpan.textContent || '').trim(), element: autoSpan };
      }
      const autoPath = autoSpan.getAttribute('data-omni-path');
      if (autoPath) {
        const ls = parseInt(autoSpan.getAttribute('data-omni-line-start') || '', 10);
        const le = parseInt(autoSpan.getAttribute('data-omni-line-end') || '', 10);
        return {
          kind: 'file',
          filePath: autoPath,
          lineStart: Number.isFinite(ls) ? ls : null,
          lineEnd: Number.isFinite(le) ? le : null,
          text: (autoSpan.textContent || '').trim(),
          element: autoSpan,
        };
      }
    }

    // 2. Native file pill / inline-pill / artifact card / file:// anchor
    const pillEl = findClosest(el, FILE_PILL_SELECTOR);
    if (pillEl) {
      let rawRef =
        pillEl.getAttribute?.('data-uri') ||
        pillEl.getAttribute?.('data-file-uri') ||
        pillEl.getAttribute?.('data-file-path') ||
        pillEl.getAttribute?.('href') ||
        '';
      if (!rawRef || rawRef === '#') {
        const t = pillEl.getAttribute?.('title') || '';
        if (t.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('/') || /[\\/]/.test(t)) {
          rawRef = t;
        }
      }
      if (!rawRef) {
        const nestedPill = pillEl.querySelector?.('[data-uri], a[href^="file:"], [title]');
        if (nestedPill) {
          rawRef =
            nestedPill.getAttribute('data-uri') ||
            nestedPill.getAttribute('href') ||
            nestedPill.getAttribute('title') ||
            '';
        }
      }
      if (!rawRef) rawRef = readFiberFileHint(pillEl);
      if (rawRef && !/^https?:\/\//i.test(rawRef)) {
        const parsed = parseFileUriToPath(rawRef);
        let lineStart = parsed.lineStart;
        let lineEnd = parsed.lineEnd;
        const labelText = (pillEl.textContent || '').trim();
        if (!lineStart && labelText) {
          const labelRange = splitPathAndLineRange(labelText);
          if (labelRange.lineStart) {
            lineStart = labelRange.lineStart;
            lineEnd = labelRange.lineEnd;
          }
        }
        if (parsed.filePath) {
          return {
            kind: 'file',
            filePath: parsed.filePath,
            rawUri: rawRef.startsWith('file://') ? rawRef : toFileUri(parsed.filePath),
            lineStart,
            lineEnd,
            text: labelText || getBaseName(parsed.filePath),
            element: pillEl,
          };
        }
      }
    }

    // 3. Anchor with http(s) or file scheme href
    const anchor = findClosest(el, 'a[href]');
    if (anchor) {
      const href = String(anchor.getAttribute('href') || '').trim();
      if (isHttpUrl(href)) {
        return { kind: 'url', url: href, text: (anchor.textContent || '').trim(), element: anchor };
      }
      if (/^(?:file|vscode-file|antigravity-ide):/i.test(href)) {
        const parsed = parseFileUriToPath(href);
        if (parsed.filePath) {
          return {
            kind: 'file',
            filePath: parsed.filePath,
            rawUri: href,
            lineStart: parsed.lineStart,
            lineEnd: parsed.lineEnd,
            text: (anchor.textContent || '').trim() || getBaseName(parsed.filePath),
            element: anchor,
          };
        }
      }
    }

    // 4. Thought translator inline code chip (`code.ag-prism-thought-code`) carrying a URL or file path
    const thoughtCode = findClosest(el, 'code.ag-prism-thought-code');
    if (thoughtCode) {
      const rawCode = (thoughtCode.textContent || '').trim().replace(/^@/, '');
      if (isHttpUrl(rawCode)) {
        return { kind: 'url', url: rawCode, text: rawCode, element: thoughtCode };
      }
      if (/^localhost:\d{2,5}(?:\/[^\s]*)?$/i.test(rawCode)) {
        return { kind: 'url', url: 'http://' + rawCode, text: rawCode, element: thoughtCode };
      }
      if (!/\s/.test(rawCode)) {
        const parsedCode = parseFileUriToPath(rawCode);
        const ext = getFileExt(parsedCode.filePath);
        if (ext && KNOWN_FILE_EXTS.has(ext)) {
          return {
            kind: 'file',
            filePath: parsedCode.filePath,
            lineStart: parsedCode.lineStart,
            lineEnd: parsedCode.lineEnd,
            text: rawCode,
            element: thoughtCode,
          };
        }
      }
    }

    // 5. Code block path header (e.g. header bar above `<pre>` displaying `src/app.ts`)
    const codeHeader = findClosest(
      el,
      '[data-testid*="code-block-header"], [data-testid*="code-header"], .code-block-header, [data-code-file]'
    );
    if (codeHeader && el.tagName !== 'BUTTON') {
      const rawCodeFile =
        codeHeader.getAttribute?.('data-code-file') ||
        codeHeader.getAttribute?.('data-file-path') ||
        (el.textContent || codeHeader.textContent || '').trim();
      const parsedHeader = splitPathAndLineRange(rawCodeFile);
      const ext = getFileExt(parsedHeader.pathPart);
      if (ext && KNOWN_FILE_EXTS.has(ext) && !/\s/.test(parsedHeader.pathPart)) {
        return {
          kind: 'file',
          filePath: parsedHeader.pathPart,
          lineStart: parsedHeader.lineStart,
          lineEnd: parsedHeader.lineEnd,
          text: rawCodeFile,
          element: codeHeader,
        };
      }
    }

    // 6. Mermaid SVG diagram block
    const mermaidBox = findMermaidTarget(el);
    if (mermaidBox) {
      const svgEl = mermaidBox.tagName === 'SVG' ? mermaidBox : mermaidBox.querySelector?.('svg');
      const svgMarkup = svgEl ? svgEl.outerHTML : '';
      if (svgMarkup) {
        return {
          kind: 'mermaid',
          rawContent: svgMarkup,
          text: (mermaidBox.getAttribute?.('aria-label') || 'Mermaid Diagram').trim(),
          element: mermaidBox,
        };
      }
    }

    return null;
  }

  // Aligned 100% with `style.css` tokens (`--ag-cs-accent`, `--ag-cs-r-*`, `--ag-cs-popover-bg`, `--ag-cs-mono-stack`, etc.)
  const OMNI_CSS = [
    '::highlight(ag-omni-url){color:var(--link,var(--ag-cs-accent,var(--primary,#669DF6)));text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 46%,transparent)}',
    '::highlight(ag-omni-path){color:var(--ag-cs-accent,var(--primary,#669DF6));background-color:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 12%,transparent);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 36%,transparent)}',
    'html[data-ag-omni-hover-token="1"],html[data-ag-omni-hover-token="1"] body{cursor:pointer}',
    '.ag-omni-autolink{cursor:pointer;color:var(--link,var(--ag-cs-accent,var(--primary,#669DF6)));text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 44%,transparent);text-underline-offset:3px;border-radius:var(--ag-cs-r-sm,4px);transition:color .12s ease,background-color .12s ease,text-decoration-color .12s ease}',
    '.ag-omni-autolink[data-omni-path]{font-family:var(--ag-cs-mono-stack,var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));font-size:.92em;padding:0 3px;background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 9%,transparent);text-decoration:none;border:1px solid color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 22%,transparent)}',
    '.ag-omni-autolink:hover{background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 16%,transparent);text-decoration-color:var(--ag-cs-accent,var(--primary,#669DF6))}',
    'html[data-ag-cs-motion="off"] .ag-omni-autolink,html[data-ag-cs-motion="off"] .ag-omni-menu,html[data-ag-cs-motion="off"] .ag-omni-dock,html[data-ag-cs-motion="off"] .ag-omni-mermaid-zoom-btn{transition:none!important;animation:none!important}',
    '.ag-omni-menu{position:fixed;z-index:2147483640;min-width:208px;max-width:300px;padding:5px;border-radius:var(--ag-cs-r-lg,10px);background:var(--ag-cs-popover-bg,var(--card,rgba(23,24,30,.95)));color:var(--foreground,#F2F2F5);border:1px solid var(--ag-cs-border-2,var(--card-border,rgba(255,255,255,.12)));box-shadow:var(--ag-cs-surface-sh,0 14px 36px rgba(0,0,0,.38));backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12.5px;line-height:1.35;user-select:none;outline:none}',
    '.ag-omni-menu-header{padding:4px 8px 5px;font-size:11px;color:var(--muted-foreground,rgba(148,163,184,.85));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid var(--ag-cs-border-1,var(--border,rgba(148,163,184,.14)));margin-bottom:4px;font-family:var(--ag-cs-mono-stack,var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace))}',
    '.ag-omni-menu-sep{height:1px;margin:4px;background:var(--ag-cs-border-1,var(--border,rgba(148,163,184,.15)))}',
    '.ag-omni-menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:6px 9px;border:0;border-radius:var(--ag-cs-r-sm,4px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
    '.ag-omni-menu-item:hover,.ag-omni-menu-item[data-active="1"]{background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 16%,transparent);color:var(--foreground,inherit)}',
    '.ag-omni-menu-kbd{font-size:10.5px;color:var(--muted-foreground,inherit);opacity:.78;font-family:var(--ag-cs-mono-stack,ui-monospace,SFMono-Regular,Menlo,monospace);flex-shrink:0}',
    '.ag-omni-dock{position:relative;display:flex;flex-direction:column;flex:0 0 auto;height:100%;min-width:320px;max-width:78vw;background:var(--ag-cs-panel-bg,var(--background,#0E0E11));color:var(--foreground,#F2F2F5);border-left:1px solid var(--ag-cs-border-2,var(--border,rgba(148,163,184,.18)));z-index:28;overflow:hidden}',
    '.ag-omni-dock[data-dock-fallback="fixed"]{position:fixed;top:35px;right:0;bottom:0;height:auto;box-shadow:-12px 0 32px rgba(0,0,0,.28)}',
    '.ag-omni-sash{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:4;background:transparent}',
    '.ag-omni-sash:hover,.ag-omni-dock[data-resizing="1"] .ag-omni-sash{background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 55%,transparent)}',
    '.ag-omni-topbar{display:flex;align-items:center;gap:5px;height:36px;padding:0 8px 0 10px;flex-shrink:0;background:var(--card,var(--ag-cs-panel-bg,rgba(20,21,26,.96)));border-bottom:1px solid var(--ag-cs-border-1,var(--border,rgba(148,163,184,.16)));font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px}',
    '.ag-omni-btn{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border:1px solid transparent;border-radius:var(--ag-cs-r-sm,4px);background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer;opacity:.82}',
    '.ag-omni-btn:hover:not(:disabled){opacity:1;background:var(--ag-cs-hover-wash,color-mix(in srgb,var(--ag-cs-accent,#669DF6) 14%,transparent))}',
    '.ag-omni-btn:disabled{opacity:.32;cursor:default}',
    '.ag-omni-btn[data-active="1"]{opacity:1;background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 18%,transparent);border-color:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 38%,transparent)}',
    '.ag-omni-addr{flex:1 1 0%;min-width:0;height:24px;padding:0 8px;display:flex;align-items:center;gap:6px;border-radius:var(--ag-cs-r-sm,4px);background:var(--ag-cs-pill-bg,color-mix(in srgb,var(--foreground,#94a3b8) 6%,transparent));border:1px solid var(--ag-cs-border-1,var(--border,rgba(148,163,184,.14)));font-family:var(--ag-cs-mono-stack,var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace));font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
    '.ag-omni-addr-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ag-omni-vp-group{display:inline-flex;align-items:center;gap:2px}.ag-omni-vp-group[hidden],.ag-omni-offline[hidden]{display:none!important}',
    '.ag-omni-stage{position:relative;flex:1 1 0%;min-height:0;width:100%;display:flex;justify-content:center;align-items:stretch;background:var(--ag-cs-code-well,var(--content,rgba(9,11,15,.65)));overflow:auto}',
    '.ag-omni-viewport-box{position:relative;width:100%;height:100%;flex:0 0 auto;background:var(--background,#0E0E11)}',
    '.ag-omni-viewport-box[data-vp="768"]{width:768px;max-width:100%;border-left:1px solid var(--ag-cs-border-1,rgba(148,163,184,.2));border-right:1px solid var(--ag-cs-border-1,rgba(148,163,184,.2))}',
    '.ag-omni-viewport-box[data-vp="390"]{width:390px;max-width:100%;border-left:1px solid var(--ag-cs-border-1,rgba(148,163,184,.2));border-right:1px solid var(--ag-cs-border-1,rgba(148,163,184,.2))}',
    '.ag-omni-iframe{width:100%;height:100%;border:0;display:block;background:transparent}.ag-omni-dock[data-resizing="1"] .ag-omni-iframe{pointer-events:none}',
    '.ag-omni-offline{padding:24px 20px;display:flex;flex-direction:column;align-items:flex-start;gap:12px;font-size:12.5px;color:var(--secondary-foreground,var(--muted-foreground,#94a3b8))}',
    '.ag-omni-mermaid-zoom-btn{position:absolute;top:6px;right:6px;z-index:3;height:24px;padding:0 7px;border-radius:var(--ag-cs-r-sm,4px);border:1px solid var(--ag-cs-border-2,rgba(148,163,184,.22));background:var(--ag-cs-popover-bg,var(--card,rgba(20,23,30,.88)));color:var(--foreground,#e2e8f0);font-size:11px;cursor:pointer;opacity:0;transition:opacity .14s ease,background-color .14s ease}',
    '[data-omni-mermaid-box]:hover>.ag-omni-mermaid-zoom-btn,.ag-omni-mermaid-zoom-btn:focus-visible{opacity:.92}',
    '.ag-omni-mermaid-zoom-btn:hover{opacity:1!important;background:color-mix(in srgb,var(--ag-cs-accent,var(--primary,#669DF6)) 18%,var(--card,#1e293b))}',
    '.ag-omni-aux-bar{display:flex;align-items:center;gap:6px;padding:4px 10px;border-bottom:1px solid var(--ag-cs-border-1,var(--border,rgba(148,163,184,.16)));background:var(--card,var(--ag-cs-panel-bg,rgba(20,23,30,.9)));font-size:11.5px;flex-shrink:0}',
    '.ag-omni-aux-overlay{width:100%;flex:1 1 0%;min-height:360px;border:0;display:block}',
  ].join('');

  function createOmniClient(env = {}) {
    const W = env.window || (typeof window !== 'undefined' ? window : globalThis);
    const D = env.document || W?.document || null;

    let enabled = true;
    let linkTarget = 'builtin';
    let serverMeta = null;
    let cachedWorkspaceRoot = '';
    let mounted = false;
    let destroyed = false;

    let rpcSeq = 0;
    const pendingRpc = new Map();
    const processedTextNodes = new WeakSet();
    const createdAutolinks = new Set();
    const decoratedMermaidBoxes = new Set();
    const mountedAuxSwitches = new Set();

    // Zero-DOM-mutation CSS Custom Highlight API state
    const textNodeTokenMap = new WeakMap();
    const trackedHighlightNodes = new Set();
    let urlHighlight = null;
    let pathHighlight = null;
    let hoverTokenActive = false;

    let domObserver = null;
    let rootAttrObserver = null;
    let scanTimer = null;
    let pendingScanRoots = new Set();

    let activeMenuEl = null;
    let activeMenuItems = [];
    let activeMenuIndex = -1;

    let dockEl = null;
    let dockRefs = null;
    let dockWidthPx = 560;
    let dockViewportMode = '100%';
    let dockSession = null;
    let navHistory = [];
    let navIndex = -1;
    let savedHostSiblingStyle = null;
    let resizeObs = null;

    let wcvAcquired = false;
    let wcvVisible = false;
    let wcvCanBack = false;
    let wcvCanForward = false;
    let wcvCurrentUrl = '';
    let wcvCurrentTitle = '';
    let wcvUnsubGuest = null;

    function supportsHighlightApi() {
      return Boolean(
        W?.CSS?.highlights &&
          typeof W.CSS.highlights.set === 'function' &&
          typeof W.Highlight === 'function' &&
          typeof D?.createRange === 'function' &&
          (typeof D?.caretRangeFromPoint === 'function' || typeof D?.caretPositionFromPoint === 'function')
      );
    }

    function resolveLang() {
      const attrLang = normalizeLangCode(D?.documentElement?.getAttribute?.('data-ag-cs-lang'));
      if (attrLang) return attrLang;
      const cfgLang = normalizeLangCode(W?.__agPrism?.getState?.()?.cfg?.language);
      return cfgLang || 'zh-CN';
    }

    function getStrings() {
      const lang = resolveLang();
      const idx = LANG_INDEX[lang] ?? 0;
      const base = {};
      for (const k of Object.keys(FALLBACK_ROWS)) {
        base[k] = FALLBACK_ROWS[k][idx] || FALLBACK_ROWS[k][0];
      }
      try {
        const shared = W?.__agCsLocales?.getUiStrings?.(lang);
        if (shared && typeof shared === 'object') return { ...base, ...shared };
      } catch (_) {}
      return base;
    }

    function resolveEffectiveLinkMode(ev) {
      const invert = Boolean(ev && (ev.ctrlKey || ev.metaKey));
      const baseMode = linkTarget === 'external' ? 'external' : 'builtin';
      return invert ? (baseMode === 'builtin' ? 'external' : 'builtin') : baseMode;
    }

    function readVisualState() {
      const rootEl = D?.documentElement;
      const getAttr = (name, fallback) => {
        const v = rootEl?.getAttribute?.(name);
        return v ? String(v) : fallback;
      };
      const rawPalette = getAttr('data-ag-cs-palette', 'obsidian');
      return {
        theme: getAttr('data-ag-cs-theme', 'dark') === 'light' ? 'light' : 'dark',
        palette: rawPalette === 'claude' ? 'warm' : rawPalette,
        lightPreset: getAttr('data-ag-cs-light-preset', 'crystal'),
        accent: getAttr('data-ag-cs-accent', 'follow'),
        corners: getAttr('data-ag-cs-corners', 'balanced'),
        motion: getAttr('data-ag-cs-motion', 'standard'),
        lang: resolveLang(),
      };
    }

    // ── Bridge / RPC Client (`__agPrismOmniBridge` + `__agPrismOmniCall`) ────
    function installRpcResolver() {
      if (!W) return;
      const prevResolve = typeof W.__agPrismOmniResolve === 'function' ? W.__agPrismOmniResolve : null;
      W.__agPrismOmniResolve = (id, res) => {
        const entry = pendingRpc.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pendingRpc.delete(id);
          entry.resolve(res);
          return;
        }
        if (prevResolve && prevResolve !== W.__agPrismOmniResolve) {
          try { prevResolve(id, res); } catch (_) {}
        }
      };
    }

    function callOmniRpc(action, params = {}, timeoutMs = 6000) {
      if (!W) return Promise.resolve({ ok: false, offline: true });
      try {
        if (W.__agPrismOmniBridge && typeof W.__agPrismOmniBridge.call === 'function') {
          return Promise.resolve(W.__agPrismOmniBridge.call({ action, ...params }));
        }
        if (typeof W.__agPrismOmniCall === 'function') {
          installRpcResolver();
          const id = ++rpcSeq;
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              pendingRpc.delete(id);
              resolve({ ok: false, timeout: true });
            }, timeoutMs);
            pendingRpc.set(id, { resolve, timer });
            try {
              const directRet = W.__agPrismOmniCall(JSON.stringify({ id, action, ...params }));
              if (directRet !== undefined) {
                clearTimeout(timer);
                pendingRpc.delete(id);
                Promise.resolve(directRet)
                  .then((val) => {
                    if (typeof val === 'string') {
                      try { resolve(JSON.parse(val)); return; } catch (_) {}
                    }
                    resolve(val);
                  })
                  .catch((err) => resolve({ ok: false, error: String(err?.message || err) }));
              }
            } catch (err) {
              clearTimeout(timer);
              pendingRpc.delete(id);
              resolve({ ok: false, error: String(err?.message || err) });
            }
          });
        }
      } catch (_) {}
      return Promise.resolve({ ok: false, offline: true });
    }

    async function ensureServerMeta() {
      if (serverMeta && serverMeta.baseUrl && serverMeta.token) return serverMeta;
      const globalMeta = W?.__agPrismOmniServerMeta;
      if (globalMeta && globalMeta.baseUrl && globalMeta.token) {
        serverMeta = {
          baseUrl: String(globalMeta.baseUrl).replace(/\/+$/, ''),
          token: String(globalMeta.token),
          port: globalMeta.port || null,
        };
        return serverMeta;
      }
      const res = await callOmniRpc('getServerInfo', {});
      if (res && res.ok && res.baseUrl && res.token) {
        serverMeta = {
          baseUrl: String(res.baseUrl).replace(/\/+$/, ''),
          token: String(res.token),
          port: res.port || null,
        };
        return serverMeta;
      }
      return null;
    }

    function discoverWorkspaceRoot() {
      if (cachedWorkspaceRoot || !D) return cachedWorkspaceRoot;
      try {
        const composer = D.querySelector('[data-testid="agent-input-box"]');
        if (composer) {
          const fk = Object.keys(composer).find((k) => k.startsWith('__reactFiber'));
          let cur = fk ? composer[fk] : null;
          for (let i = 0; i < 6 && cur; i++, cur = cur.return) {
            const wsScripts = cur.memoizedProps?.agentScripts?.workspaceScriptsDir;
            if (typeof wsScripts === 'string' && wsScripts.startsWith('file://')) {
              const decoded = parseFileUriToPath(wsScripts).filePath;
              const trimmed = decoded.replace(/[\\/]\.(?:agents|gemini)(?:[\\/]agents)?$/i, '');
              if (trimmed && trimmed !== decoded) {
                cachedWorkspaceRoot = trimmed;
                return cachedWorkspaceRoot;
              }
            }
          }
        }
        const rootNode = D.getElementById?.('root');
        const rfk = rootNode ? Object.keys(rootNode).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber')) : null;
        if (rfk && rootNode[rfk]) {
          const queue = [rootNode[rfk]];
          let steps = 0;
          while (queue.length && steps++ < 500) {
            const n = queue.shift();
            if (!n) continue;
            const store = n.memoizedProps?.store;
            if (store && typeof store.getState === 'function') {
              const st = store.getState();
              const byWs = st?.vcsWorkspaceState?.byWorkspaceUri;
              if (byWs && typeof byWs === 'object') {
                const firstUri = Object.keys(byWs)[0];
                if (firstUri) {
                  cachedWorkspaceRoot = parseFileUriToPath(firstUri).filePath;
                  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
                }
              }
              const selUri = st?.settingsScreen?.selectedWorkspaceUri;
              if (typeof selUri === 'string' && selUri) {
                cachedWorkspaceRoot = parseFileUriToPath(selUri).filePath;
                if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
              }
              break;
            }
            if (n.child) queue.push(n.child);
            if (n.sibling) queue.push(n.sibling);
          }
        }
      } catch (_) {}
      return cachedWorkspaceRoot;
    }

    async function copyTextToClipboard(text) {
      const str = String(text ?? '');
      if (!str) return false;
      try {
        if (W?.navigator?.clipboard?.writeText) {
          await W.navigator.clipboard.writeText(str);
          return true;
        }
      } catch (_) {}
      try {
        if (D && typeof D.createElement === 'function') {
          const ta = D.createElement('textarea');
          ta.value = str;
          if (ta.style) {
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            ta.style.pointerEvents = 'none';
          }
          D.body?.appendChild?.(ta);
          ta.select?.();
          const ok = Boolean(D.execCommand?.('copy'));
          ta.remove?.();
          return ok;
        }
      } catch (_) {}
      return false;
    }

    async function openExternalTarget(targetUrlOrPath) {
      const raw = String(targetUrlOrPath || '').trim();
      if (!raw) return false;
      if (isHttpUrl(raw) && typeof W?.electronNative?.openExternal === 'function') {
        try {
          await W.electronNative.openExternal(raw);
          return true;
        } catch (_) {}
      }
      const rpcRes = await callOmniRpc('openExternal', { target: raw });
      if (rpcRes && rpcRes.ok) return true;
      if (typeof W?.electronNative?.openExternal === 'function') {
        try {
          const uri = isHttpUrl(raw) ? raw : toFileUri(raw) || raw;
          await W.electronNative.openExternal(uri);
          return true;
        } catch (_) {}
      }
      if (isHttpUrl(raw) && typeof W?.open === 'function') {
        try {
          W.open(raw, '_blank', 'noopener,noreferrer');
          return true;
        } catch (_) {}
      }
      return false;
    }

    async function revealFileInFolder(filePath, rawUri) {
      const cleanPath = splitPathAndLineRange(filePath).pathPart;
      if (!cleanPath) return false;
      if (typeof W?.electronNative?.revealInFilePicker === 'function') {
        try {
          const arg = rawUri && /^file:\/\//i.test(rawUri) ? rawUri : toFileUri(cleanPath) || cleanPath;
          await W.electronNative.revealInFilePicker(arg);
          return true;
        } catch (_) {}
      }
      const rpcRes = await callOmniRpc('revealInFolder', { path: cleanPath });
      return Boolean(rpcRes && rpcRes.ok);
    }

    function insertFileMentionIntoComposer(filePath) {
      if (!D) return false;
      const ce =
        D.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]') ||
        D.querySelector('#antigravity\\.agentSidePanelInputBox [contenteditable="true"]');
      if (!ce) return false;

      const wsRoot = discoverWorkspaceRoot();
      const rel = computeRelativePath(splitPathAndLineRange(filePath).pathPart, wsRoot);
      const tokenPath = rel && !rel.startsWith('..') ? rel : normalizeSlashes(splitPathAndLineRange(filePath).pathPart);
      const existing = String(ce.textContent || '');
      const needsLeadSpace = existing.length > 0 && !/\s$/.test(existing);
      const mentionStr = `${needsLeadSpace ? ' ' : ''}@${tokenPath} `;

      try { ce.focus?.(); } catch (_) {}

      let inserted = false;
      try {
        if (typeof D.execCommand === 'function') {
          const before = ce.textContent;
          const ok = D.execCommand('insertText', false, mentionStr);
          if (ok && ce.textContent !== before) inserted = true;
        }
      } catch (_) {}

      if (!inserted) {
        ce.textContent = String(ce.textContent || '') + mentionStr;
        try {
          const EvCtor = W?.InputEvent || W?.Event;
          if (typeof EvCtor === 'function') {
            ce.dispatchEvent(new EvCtor('input', { bubbles: true, cancelable: false, data: mentionStr, inputType: 'insertText' }));
          }
        } catch (_) {}
      }
      return true;
    }

    // ── Native Electron `wcvBrowser` Controller Bridge ───────────────────────
    function getWcvApi() {
      const api = W?.electronNative?.wcvBrowser;
      return api && typeof api.acquire === 'function' && typeof api.show === 'function' ? api : null;
    }

    function cleanupDetachedDockRefs() {
      if (resizeObs) {
        try { resizeObs.disconnect(); } catch (_) {}
        resizeObs = null;
      }
      if (savedHostSiblingStyle) {
        if (savedHostSiblingStyle.el?.isConnected && savedHostSiblingStyle.el.style) {
          savedHostSiblingStyle.el.style.flex = savedHostSiblingStyle.flex;
          savedHostSiblingStyle.el.style.minWidth = savedHostSiblingStyle.minWidth;
        }
        savedHostSiblingStyle = null;
      }
      dockEl = null;
      dockRefs = null;
    }

    function hasBlockingHostModal() {
      if (activeMenuEl || D?.hidden) return true;
      if (!D || typeof D.querySelector !== 'function') return false;
      return Boolean(D.querySelector(BLOCKING_OVERLAY_SELECTOR));
    }

    function syncWcvBounds() {
      const wcv = getWcvApi();
      if (dockEl && !dockEl.isConnected) {
        cleanupDetachedDockRefs();
      }
      if (!wcv || !wcvAcquired) return;
      if (
        !dockEl ||
        !dockEl.isConnected ||
        !dockRefs?.viewportBox?.isConnected ||
        dockSession?.engine !== 'wcv' ||
        hasBlockingHostModal()
      ) {
        if (wcvVisible) {
          wcvVisible = false;
          try { wcv.hide?.(WCV_TAB_KEY); } catch (_) {}
        }
        return;
      }
      const r = dockRefs.viewportBox.getBoundingClientRect?.();
      if (!r || r.width < 10 || r.height < 10) {
        if (wcvVisible) {
          wcvVisible = false;
          try { wcv.hide?.(WCV_TAB_KEY); } catch (_) {}
        }
        return;
      }
      const bounds = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
      try {
        if (!wcvVisible) {
          wcvVisible = true;
          Promise.resolve(wcv.show(WCV_TAB_KEY, bounds))
            .then((st) => {
              if (st && typeof st === 'object') applyWcvState(st);
            })
            .catch(() => {});
        } else {
          wcv.setBounds?.(WCV_TAB_KEY, bounds);
        }
      } catch (_) {}
    }

    function applyWcvState(st) {
      if (!st) return;
      if (typeof st.canGoBack === 'boolean') wcvCanBack = st.canGoBack;
      if (typeof st.canGoForward === 'boolean') wcvCanForward = st.canGoForward;
      if (typeof st.url === 'string' && st.url && st.url !== 'about:blank') wcvCurrentUrl = st.url;
      if (typeof st.title === 'string' && st.title) wcvCurrentTitle = st.title;
      updateDockHeaderState();
    }

    function hideWcvTemporary() {
      const wcv = getWcvApi();
      if (wcv && wcvVisible) {
        wcvVisible = false;
        try { wcv.hide?.(WCV_TAB_KEY); } catch (_) {}
      }
    }

    function disposeWcv() {
      if (wcvUnsubGuest) {
        try { wcvUnsubGuest(); } catch (_) {}
        wcvUnsubGuest = null;
      }
      const wcv = getWcvApi();
      if (wcv && wcvAcquired) {
        try { wcv.hide?.(WCV_TAB_KEY); } catch (_) {}
        try { wcv.dispose?.(WCV_TAB_KEY); } catch (_) {}
      }
      wcvAcquired = false;
      wcvVisible = false;
      wcvCanBack = false;
      wcvCanForward = false;
      wcvCurrentUrl = '';
      wcvCurrentTitle = '';
    }

    async function loadUrlInWcv(url) {
      const wcv = getWcvApi();
      if (!wcv) return false;
      try {
        if (!wcvUnsubGuest && typeof wcv.onGuestEvent === 'function') {
          wcvUnsubGuest = wcv.onGuestEvent((ev) => {
            if (!ev || ev.tabKey !== WCV_TAB_KEY) return;
            if (ev.type === 'new-window' && isHttpUrl(ev.url)) {
              try { wcv.navigate?.(WCV_TAB_KEY, ev.url); } catch (_) {}
              return;
            }
            applyWcvState(ev);
          });
        }
        if (!wcvAcquired) {
          wcvAcquired = true;
          wcvCurrentUrl = url;
          const st = await wcv.acquire({
            tabKey: WCV_TAB_KEY,
            initialUrl: url,
            partition: 'persist:ag-prism-omni',
          });
          applyWcvState(st);
        } else {
          wcvCurrentUrl = url;
          await wcv.navigate?.(WCV_TAB_KEY, url);
        }
        syncWcvBounds();
        return true;
      } catch (_) {
        disposeWcv();
        return false;
      }
    }

    // ── Right-Side Built-in Browser & Streaming Workbench Dock ───────────────
    function ensureDockMounted() {
      if (!D) return null;
      if (dockEl && dockEl.isConnected) return dockEl;
      cleanupDetachedDockRefs();

      const s = getStrings();
      const nextDock = D.createElement('aside');
      nextDock.className = 'ag-omni-dock ag-prism-omni-pane';
      nextDock.setAttribute('data-testid', 'ag-omni-dock');
      nextDock.setAttribute('data-ag-prism-omni-owned', '1');
      nextDock.style.width = `${dockWidthPx}px`;

      const sash = D.createElement('div');
      sash.className = 'ag-omni-sash';
      sash.addEventListener('mousedown', onSashMouseDown);

      const topbar = D.createElement('div');
      topbar.className = 'ag-omni-topbar';

      const mkBtn = (label, titleKey, onClick) => {
        const b = D.createElement('button');
        b.type = 'button';
        b.className = 'ag-omni-btn';
        b.textContent = label;
        b.setAttribute('data-i18n-title', titleKey);
        b.title = s[titleKey] || titleKey;
        b.addEventListener('click', onClick);
        return b;
      };

      const btnBack = mkBtn('←', 'omniBack', () => navigateDockHistory(-1));
      const btnFwd = mkBtn('→', 'omniForward', () => navigateDockHistory(1));
      const btnReload = mkBtn('↻', 'omniReload', () => reloadDock());

      const addrBox = D.createElement('div');
      addrBox.className = 'ag-omni-addr';
      const addrText = D.createElement('span');
      addrText.className = 'ag-omni-addr-text';
      addrBox.appendChild(addrText);
      addrBox.addEventListener('click', () => {
        const copyVal =
          dockSession?.type === 'url'
            ? wcvCurrentUrl || dockSession.url
            : dockSession?.filePath || '';
        if (!copyVal) return;
        void copyTextToClipboard(copyVal).then((ok) => {
          if (!ok) return;
          addrText.textContent = `${getStrings().omniCopied}: ${copyVal}`;
          setTimeout(() => {
            if (addrText.isConnected) updateDockHeaderState();
          }, 900);
        });
      });

      const vpGroup = D.createElement('div');
      vpGroup.className = 'ag-omni-vp-group';
      const mkVpBtn = (vpVal, label, titleKey) => {
        const b = mkBtn(label, titleKey, () => {
          dockViewportMode = vpVal;
          updateDockHeaderState();
          syncWcvBounds();
        });
        b.setAttribute('data-vp-btn', vpVal);
        return b;
      };
      const vpFull = mkVpBtn('100%', '100%', 'omniViewportFull');
      const vpTab = mkVpBtn('768', '768', 'omniViewportTablet');
      const vpMob = mkVpBtn('390', '390', 'omniViewportMobile');
      vpGroup.appendChild(vpFull);
      vpGroup.appendChild(vpTab);
      vpGroup.appendChild(vpMob);

      const btnReveal = mkBtn('⌖', 'omniRevealFolder', () => {
        if (dockSession?.filePath) void revealFileInFolder(dockSession.filePath, dockSession.rawUri);
      });
      const btnExt = mkBtn('↗', 'omniOpenBrowser', () => {
        if (!dockSession) return;
        if (dockSession.type === 'url') void openExternalTarget(wcvCurrentUrl || dockSession.url);
        else if (dockSession.filePath) void openExternalTarget(dockSession.filePath);
      });
      const btnClose = mkBtn('×', 'omniClose', () => closeDock());

      topbar.appendChild(btnBack);
      topbar.appendChild(btnFwd);
      topbar.appendChild(btnReload);
      topbar.appendChild(addrBox);
      topbar.appendChild(vpGroup);
      topbar.appendChild(btnReveal);
      topbar.appendChild(btnExt);
      topbar.appendChild(btnClose);

      const stage = D.createElement('div');
      stage.className = 'ag-omni-stage';

      const viewportBox = D.createElement('div');
      viewportBox.className = 'ag-omni-viewport-box';
      viewportBox.setAttribute('data-vp', dockViewportMode);

      const iframe = D.createElement('iframe');
      iframe.className = 'ag-omni-iframe';
      iframe.setAttribute('data-testid', 'ag-omni-iframe');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads');
      iframe.addEventListener('load', () => {
        if (dockSession?.type !== 'url') pushWorkbenchSyncToIframe(iframe);
      });

      const offlineBox = D.createElement('div');
      offlineBox.className = 'ag-omni-offline';
      offlineBox.hidden = true;
      const offlineMsg = D.createElement('div');
      offlineMsg.textContent = s.omniOfflineHint;
      const offlineActions = D.createElement('div');
      offlineActions.style.display = 'flex';
      offlineActions.style.gap = '8px';
      const offExtBtn = mkBtn(s.omniOpenExternal, 'omniOpenExternal', () => {
        if (dockSession?.filePath) void openExternalTarget(dockSession.filePath);
      });
      offExtBtn.style.border = '1px solid var(--ag-cs-border-2, rgba(148,163,184,0.28))';
      offExtBtn.style.padding = '0 10px';
      const offRevBtn = mkBtn(s.omniRevealFolder, 'omniRevealFolder', () => {
        if (dockSession?.filePath) void revealFileInFolder(dockSession.filePath, dockSession.rawUri);
      });
      offRevBtn.style.border = '1px solid var(--ag-cs-border-2, rgba(148,163,184,0.28))';
      offRevBtn.style.padding = '0 10px';
      offlineActions.appendChild(offExtBtn);
      offlineActions.appendChild(offRevBtn);
      offlineBox.appendChild(offlineMsg);
      offlineBox.appendChild(offlineActions);

      viewportBox.appendChild(iframe);
      viewportBox.appendChild(offlineBox);
      stage.appendChild(viewportBox);

      nextDock.appendChild(sash);
      nextDock.appendChild(topbar);
      nextDock.appendChild(stage);

      const nextRefs = {
        topbar, btnBack, btnFwd, btnReload, addrBox, addrText, vpGroup,
        vpBtns: [vpFull, vpTab, vpMob], btnReveal, btnExt, btnClose,
        stage, viewportBox, iframe, offlineBox, offlineMsg, offExtBtn, offRevBtn,
      };

      const auxSplit = D.querySelector('[data-testid="aux-pane-split"]');
      if (auxSplit && auxSplit.firstElementChild) {
        const mainPane = auxSplit.firstElementChild;
        savedHostSiblingStyle = {
          el: mainPane,
          flex: mainPane.style?.flex || '',
          minWidth: mainPane.style?.minWidth || '',
        };
        if (mainPane.style) {
          mainPane.style.flex = '1 1 0%';
          mainPane.style.minWidth = '320px';
        }
        const hostWidth = auxSplit.getBoundingClientRect?.()?.width || 1280;
        const kids = Array.from(auxSplit.children || []);
        const nativeRightOpen = kids.length >= 3 && (kids[2]?.getBoundingClientRect?.()?.width || 0) > 40;
        const ratio = nativeRightOpen ? 0.34 : 0.46;
        const cap = nativeRightOpen ? 500 : 680;
        dockWidthPx = Math.max(340, Math.min(cap, Math.round(hostWidth * ratio)));
        nextDock.style.width = `${dockWidthPx}px`;
        auxSplit.appendChild(nextDock);
      } else {
        nextDock.setAttribute('data-dock-fallback', 'fixed');
        (D.body || D.documentElement).appendChild(nextDock);
      }

      dockEl = nextDock;
      dockRefs = nextRefs;

      if (typeof W?.ResizeObserver === 'function') {
        resizeObs = new W.ResizeObserver(() => {
          syncWcvBounds();
        });
        resizeObs.observe(viewportBox);
      }

      return dockEl;
    }

    function onSashMouseDown(ev) {
      if (!dockEl || !W || !D) return;
      ev.preventDefault();
      const startX = ev.clientX;
      const startWidth = dockEl.getBoundingClientRect?.()?.width || dockWidthPx;
      dockEl.setAttribute('data-resizing', '1');

      const onMove = (me) => {
        const delta = startX - me.clientX;
        const maxW = Math.max(420, Math.floor((W.innerWidth || 1440) * 0.75));
        dockWidthPx = Math.max(320, Math.min(maxW, Math.round(startWidth + delta)));
        dockEl.style.width = `${dockWidthPx}px`;
        syncWcvBounds();
      };
      const onUp = () => {
        dockEl?.removeAttribute?.('data-resizing');
        W.removeEventListener('mousemove', onMove, true);
        W.removeEventListener('mouseup', onUp, true);
        syncWcvBounds();
      };
      W.addEventListener('mousemove', onMove, true);
      W.addEventListener('mouseup', onUp, true);
    }

    function updateDockHeaderState() {
      if (!dockRefs || !dockEl) return;
      const s = getStrings();
      const isUrl = dockSession?.type === 'url';
      const isHtmlFile = dockSession?.type === 'file' && dockSession?.kind === 'html';
      const showVp = Boolean(isUrl || isHtmlFile);

      dockRefs.vpGroup.hidden = !showVp;
      const activeVp = showVp ? dockViewportMode : '100%';
      dockRefs.viewportBox.setAttribute('data-vp', activeVp);
      for (const b of dockRefs.vpBtns) {
        if (b.getAttribute('data-vp-btn') === dockViewportMode) b.setAttribute('data-active', '1');
        else b.removeAttribute('data-active');
      }

      dockRefs.btnReveal.hidden = !dockSession?.filePath;
      dockRefs.btnExt.hidden = dockSession?.type === 'mermaid';
      dockRefs.btnExt.title = isUrl ? s.omniOpenBrowser : s.omniOpenExternal;

      for (const b of [
        dockRefs.btnBack, dockRefs.btnFwd, dockRefs.btnReload,
        dockRefs.btnReveal, dockRefs.btnClose, ...dockRefs.vpBtns,
      ]) {
        const tk = b.getAttribute('data-i18n-title');
        if (tk && s[tk]) b.title = s[tk];
      }
      dockRefs.offlineMsg.textContent = s.omniOfflineHint;
      dockRefs.offExtBtn.textContent = s.omniOpenExternal;
      dockRefs.offRevBtn.textContent = s.omniRevealFolder;

      if (dockSession?.engine === 'wcv') {
        dockRefs.btnBack.disabled = !wcvCanBack;
        dockRefs.btnFwd.disabled = !wcvCanForward;
        const disp = wcvCurrentTitle
          ? `${wcvCurrentTitle} — ${wcvCurrentUrl || dockSession.url}`
          : wcvCurrentUrl || dockSession.url;
        dockRefs.addrText.textContent = disp;
        dockRefs.addrBox.title = wcvCurrentUrl || dockSession.url;
      } else {
        dockRefs.btnBack.disabled = navIndex <= 0;
        dockRefs.btnFwd.disabled = navIndex < 0 || navIndex >= navHistory.length - 1;
        if (isUrl) {
          dockRefs.addrText.textContent = dockSession.url;
          dockRefs.addrBox.title = dockSession.url;
        } else if (dockSession?.type === 'mermaid') {
          dockRefs.addrText.textContent = dockSession.title || s.omniZoomDiagram;
          dockRefs.addrBox.title = dockSession.title || s.omniZoomDiagram;
        } else if (dockSession?.filePath) {
          const range = dockSession.lineStart
            ? dockSession.lineEnd
              ? ` #L${dockSession.lineStart}-L${dockSession.lineEnd}`
              : ` #L${dockSession.lineStart}`
            : '';
          dockRefs.addrText.textContent = `${getBaseName(dockSession.filePath)}${range}`;
          dockRefs.addrBox.title = dockSession.filePath;
        }
      }
    }

    function pushHistorySnapshot(entry) {
      if (navIndex < navHistory.length - 1) navHistory = navHistory.slice(0, navIndex + 1);
      const prev = navHistory[navHistory.length - 1];
      if (
        prev &&
        prev.type === entry.type &&
        prev.url === entry.url &&
        prev.filePath === entry.filePath &&
        prev.kind === entry.kind
      ) {
        navHistory[navHistory.length - 1] = { ...entry };
        navIndex = navHistory.length - 1;
        return;
      }
      navHistory.push({ ...entry });
      if (navHistory.length > 32) navHistory.shift();
      navIndex = navHistory.length - 1;
    }

    function navigateDockHistory(delta) {
      if (dockSession?.engine === 'wcv') {
        const wcv = getWcvApi();
        if (wcv) {
          try { wcv.control?.(WCV_TAB_KEY, delta < 0 ? 'back' : 'forward'); } catch (_) {}
          return;
        }
      }
      const nextIdx = navIndex + delta;
      if (nextIdx < 0 || nextIdx >= navHistory.length) return;
      navIndex = nextIdx;
      const snap = navHistory[navIndex];
      if (snap.type === 'url') void renderUrlInDock(snap.url, false);
      else void renderFileOrMermaidInDock(snap, false);
    }

    function reloadDock() {
      if (!dockSession) return;
      if (dockSession.engine === 'wcv') {
        try { getWcvApi()?.control?.(WCV_TAB_KEY, 'reload'); } catch (_) {}
        return;
      }
      if (dockRefs?.iframe) {
        if (dockSession.type === 'mermaid') pushWorkbenchSyncToIframe(dockRefs.iframe);
        else {
          const curSrc = dockRefs.iframe.getAttribute('src') || dockRefs.iframe.src;
          if (curSrc) dockRefs.iframe.src = curSrc;
        }
      }
    }

    function closeDock() {
      hideWcvTemporary();
      disposeWcv();
      if (dockEl) {
        try { dockEl.remove(); } catch (_) {}
      }
      cleanupDetachedDockRefs();
      dockSession = null;
    }

    function buildViewerUrl(meta, opts = {}) {
      const vs = readVisualState();
      const params = [
        `token=${encodeURIComponent(meta.token)}`,
        `path=${encodeURIComponent(opts.filePath || '')}`,
        `kind=${encodeURIComponent(opts.kind || 'auto')}`,
        `theme=${encodeURIComponent(vs.theme)}`,
        `palette=${encodeURIComponent(vs.palette)}`,
        `lightPreset=${encodeURIComponent(vs.lightPreset)}`,
        `accent=${encodeURIComponent(vs.accent)}`,
        `corners=${encodeURIComponent(vs.corners)}`,
        `lang=${encodeURIComponent(vs.lang)}`,
      ];
      if (opts.lineStart) params.push(`lineStart=${encodeURIComponent(String(opts.lineStart))}`);
      if (opts.lineEnd) params.push(`lineEnd=${encodeURIComponent(String(opts.lineEnd))}`);
      return `${meta.baseUrl}/viewer?${params.join('&')}`;
    }

    function buildSyncPayload(sessionOverride) {
      const vs = readVisualState();
      const sess = sessionOverride || dockSession;
      return {
        type: 'ag-prism-workbench-sync',
        theme: vs.theme,
        palette: vs.palette,
        lightPreset: vs.lightPreset,
        accent: vs.accent,
        corners: vs.corners,
        lang: vs.lang,
        path: sess?.filePath || '',
        ...(sess?.lineStart ? { lineStart: sess.lineStart } : {}),
        ...(sess?.lineEnd ? { lineEnd: sess.lineEnd } : {}),
        ...(sess?.rawContent ? { rawContent: sess.rawContent } : {}),
      };
    }

    // SEC-7: Strictly lock postMessage targetOrigin to `serverMeta.baseUrl` (never `'*'`)
    function pushWorkbenchSyncToIframe(iframeEl, sessionOverride) {
      if (!iframeEl || !iframeEl.contentWindow || !serverMeta?.baseUrl) return;
      try {
        iframeEl.contentWindow.postMessage(buildSyncPayload(sessionOverride), serverMeta.baseUrl);
      } catch (_) {}
    }

    function broadcastThemeAndLocaleSync() {
      const s = getStrings();
      if (dockRefs?.iframe && dockSession && dockSession.engine === 'iframe' && dockSession.type !== 'url') {
        pushWorkbenchSyncToIframe(dockRefs.iframe, dockSession);
      }
      for (const rec of mountedAuxSwitches) {
        if (rec.iframe && rec.iframe.isConnected && rec.iframe.contentWindow) {
          pushWorkbenchSyncToIframe(rec.iframe, { filePath: rec.filePath });
        }
        if (rec.btnWb && rec.btnRaw) {
          rec.btnWb.textContent = s.omniViewWorkbench;
          rec.btnRaw.textContent = s.omniViewRaw;
        }
      }
      for (const box of decoratedMermaidBoxes) {
        const btn = box.querySelector?.('.ag-omni-mermaid-zoom-btn');
        if (btn) {
          btn.textContent = `⤢ ${s.omniZoomDiagram}`;
          btn.title = s.omniZoomDiagram;
        }
      }
      if (dockEl) updateDockHeaderState();
    }

    async function renderUrlInDock(url, recordHistory = true) {
      ensureDockMounted();
      if (!dockRefs) return false;
      dockRefs.offlineBox.hidden = true;

      const isLocalGateway = Boolean(serverMeta?.baseUrl && url.startsWith(serverMeta.baseUrl + '/'));
      const canUseWcv = Boolean(getWcvApi()) && !isLocalGateway;
      dockSession = {
        type: 'url',
        url,
        filePath: '',
        kind: 'web',
        engine: canUseWcv ? 'wcv' : 'iframe',
      };
      if (recordHistory) pushHistorySnapshot(dockSession);

      if (canUseWcv) {
        dockRefs.iframe.hidden = true;
        dockRefs.iframe.removeAttribute('src');
        const ok = await loadUrlInWcv(url);
        if (ok) {
          updateDockHeaderState();
          return true;
        }
        dockSession.engine = 'iframe';
      }

      // SEC-2: External web URLs in fallback iframe MUST NOT carry `allow-same-origin`
      hideWcvTemporary();
      dockRefs.iframe.setAttribute(
        'sandbox',
        isLocalGateway
          ? 'allow-scripts allow-same-origin allow-forms allow-downloads'
          : 'allow-scripts allow-forms allow-popups allow-downloads'
      );
      dockRefs.iframe.hidden = false;
      dockRefs.iframe.src = url;
      updateDockHeaderState();
      return true;
    }

    async function renderFileOrMermaidInDock(spec, recordHistory = true) {
      ensureDockMounted();
      if (!dockRefs) return false;
      hideWcvTemporary();

      const resolvedKind = spec.type === 'mermaid' ? 'mermaid' : detectPreviewKind(spec.filePath, spec.kind);
      dockSession = {
        type: spec.type || 'file',
        url: '',
        filePath: spec.filePath || '',
        rawUri: spec.rawUri || '',
        kind: resolvedKind,
        lineStart: spec.lineStart || null,
        lineEnd: spec.lineEnd || null,
        rawContent: spec.rawContent || '',
        title: spec.title || '',
        engine: 'iframe',
      };
      if (recordHistory) pushHistorySnapshot(dockSession);

      const meta = await ensureServerMeta();
      if (!meta) {
        dockRefs.iframe.hidden = true;
        dockRefs.offlineBox.hidden = false;
        updateDockHeaderState();
        return false;
      }

      dockRefs.offlineBox.hidden = true;
      dockRefs.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
      dockRefs.iframe.hidden = false;
      const viewerUrl = buildViewerUrl(meta, {
        filePath: dockSession.filePath,
        kind: resolvedKind,
        lineStart: dockSession.lineStart,
        lineEnd: dockSession.lineEnd,
      });
      dockSession.url = viewerUrl;
      dockRefs.iframe.src = viewerUrl;
      updateDockHeaderState();
      pushWorkbenchSyncToIframe(dockRefs.iframe, dockSession);
      return true;
    }

    // ── Public API: `openUrl` & `openFile` ───────────────────────────────────
    async function openUrl(rawUrl, mode = 'auto') {
      const url = String(rawUrl || '').trim();
      if (!url) return false;
      const effectiveMode =
        mode === 'builtin' || mode === 'external'
          ? mode
          : linkTarget === 'external'
          ? 'external'
          : 'builtin';
      if (effectiveMode === 'external' || !enabled) return openExternalTarget(url);
      return renderUrlInDock(url, true);
    }

    async function openFile(rawFilePath, opts = {}) {
      const parsed = parseFileUriToPath(rawFilePath);
      const cleanPath = parsed.filePath;
      const lineStart = opts.lineStart ?? parsed.lineStart ?? null;
      const lineEnd = opts.lineEnd ?? parsed.lineEnd ?? null;
      const mode = opts.mode || 'workbench';

      if (mode === 'reveal') return revealFileInFolder(cleanPath, opts.rawUri);
      if (mode === 'external' || !enabled) return openExternalTarget(cleanPath);

      let finalPath = cleanPath;
      if (
        cleanPath &&
        opts.kind !== 'mermaid' &&
        !/^[A-Za-z]:[\\/]/.test(cleanPath) &&
        !cleanPath.startsWith('/')
      ) {
        const wsHint = discoverWorkspaceRoot();
        const res = await callOmniRpc('resolvePath', { rawPath: cleanPath, workspaceHint: wsHint });
        if (res && res.ok && res.absPath) finalPath = res.absPath;
        else if (wsHint) finalPath = normalizeSlashes(wsHint).replace(/\/$/, '') + '/' + cleanPath.replace(/^\.\//, '');
      }

      return renderFileOrMermaidInDock(
        {
          type: opts.kind === 'mermaid' && !finalPath ? 'mermaid' : 'file',
          filePath: finalPath,
          rawUri: opts.rawUri || toFileUri(finalPath),
          kind: opts.kind || 'auto',
          lineStart,
          lineEnd,
          rawContent: opts.rawContent || '',
          title: opts.title || '',
        },
        true
      );
    }

    // ── Right-Click Optical Context Menu ─────────────────────────────────────
    function closeContextMenu() {
      if (activeMenuEl) {
        try { activeMenuEl.remove(); } catch (_) {}
        activeMenuEl = null;
      }
      activeMenuItems = [];
      activeMenuIndex = -1;
      if (dockSession?.engine === 'wcv') syncWcvBounds();
    }

    function highlightMenuIndex(idx) {
      if (!activeMenuItems.length) return;
      const count = activeMenuItems.length;
      activeMenuIndex = ((idx % count) + count) % count;
      activeMenuItems.forEach((btn, i) => {
        if (i === activeMenuIndex) {
          btn.setAttribute('data-active', '1');
          btn.focus?.();
        } else {
          btn.removeAttribute('data-active');
        }
      });
    }

    function openContextMenuAt(clientX, clientY, headerLabel, entries) {
      if (!D) return;
      closeContextMenu();
      hideWcvTemporary();

      const menu = D.createElement('div');
      menu.className = 'ag-omni-menu ag-prism-omni-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('data-testid', 'ag-omni-context-menu');
      menu.setAttribute('data-ag-prism-omni-owned', '1');
      menu.tabIndex = -1;

      if (headerLabel) {
        const hdr = D.createElement('div');
        hdr.className = 'ag-omni-menu-header';
        hdr.textContent = headerLabel;
        menu.appendChild(hdr);
      }

      const itemButtons = [];
      for (const entry of entries) {
        if (!entry) continue;
        if (entry.separator) {
          const sep = D.createElement('div');
          sep.className = 'ag-omni-menu-sep';
          sep.setAttribute('role', 'separator');
          menu.appendChild(sep);
          continue;
        }
        const btn = D.createElement('button');
        btn.type = 'button';
        btn.className = 'ag-omni-menu-item';
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-omni-action', entry.id);

        const lbl = D.createElement('span');
        lbl.textContent = entry.label;
        btn.appendChild(lbl);

        if (entry.hint) {
          const kbd = D.createElement('span');
          kbd.className = 'ag-omni-menu-kbd';
          kbd.textContent = entry.hint;
          btn.appendChild(kbd);
        }

        const idx = itemButtons.length;
        btn.addEventListener('mouseenter', () => highlightMenuIndex(idx));
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeContextMenu();
          void entry.run();
        });

        itemButtons.push(btn);
        menu.appendChild(btn);
      }

      activeMenuEl = menu;
      activeMenuItems = itemButtons;
      (D.body || D.documentElement).appendChild(menu);

      const vw = W?.innerWidth || 1280;
      const vh = W?.innerHeight || 800;
      const rect = menu.getBoundingClientRect?.() || { width: 230, height: 220 };
      const left = Math.max(8, Math.min(clientX, vw - (rect.width || 230) - 8));
      const top = Math.max(8, Math.min(clientY, vh - (rect.height || 220) - 8));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;

      if (itemButtons.length > 0) highlightMenuIndex(0);
    }

    function buildMenuForTarget(meta, selectedText) {
      const s = getStrings();
      const entries = [];

      if (meta.kind === 'url') {
        entries.push({
          id: 'open-builtin',
          label: s.omniOpenBuiltin,
          hint: linkTarget === 'builtin' ? 'Click' : 'Ctrl+Click',
          run: () => openUrl(meta.url, 'builtin'),
        });
        entries.push({
          id: 'open-browser',
          label: s.omniOpenBrowser,
          hint: linkTarget === 'external' ? 'Click' : 'Ctrl+Click',
          run: () => openUrl(meta.url, 'external'),
        });
        entries.push({ separator: true });
        entries.push({
          id: 'copy-link',
          label: s.omniCopyLink,
          run: () => copyTextToClipboard(meta.url),
        });
        const copyTxt = selectedText || (meta.text && meta.text !== meta.url ? meta.text : '');
        if (copyTxt) {
          entries.push({ id: 'copy-text', label: s.omniCopyText, run: () => copyTextToClipboard(copyTxt) });
        }
        return { header: meta.url, entries };
      }

      if (meta.kind === 'file') {
        const wsRoot = discoverWorkspaceRoot();
        const absBase = meta.filePath;
        const relWithRange = computeRelativePath(
          absBase + (meta.lineStart ? (meta.lineEnd ? `#L${meta.lineStart}-L${meta.lineEnd}` : `#L${meta.lineStart}`) : ''),
          wsRoot
        );

        entries.push({
          id: 'open-preview',
          label: s.omniOpenPreview,
          run: () =>
            openFile(absBase, {
              mode: 'workbench',
              rawUri: meta.rawUri,
              lineStart: meta.lineStart,
              lineEnd: meta.lineEnd,
            }),
        });
        entries.push({
          id: 'reveal-folder',
          label: s.omniRevealFolder,
          run: () => revealFileInFolder(absBase, meta.rawUri),
        });
        entries.push({
          id: 'open-external',
          label: s.omniOpenExternal,
          run: () => openFile(absBase, { mode: 'external', rawUri: meta.rawUri }),
        });
        entries.push({ separator: true });
        entries.push({
          id: 'insert-mention',
          label: s.omniInsertMention,
          hint: '@',
          run: () => insertFileMentionIntoComposer(absBase),
        });
        entries.push({ separator: true });
        entries.push({
          id: 'copy-abs-path',
          label: s.omniCopyAbsPath,
          run: async () => {
            let finalAbs = absBase;
            if (!/^[A-Za-z]:[\\/]/.test(absBase) && !absBase.startsWith('/')) {
              const res = await callOmniRpc('resolvePath', { rawPath: absBase, workspaceHint: wsRoot });
              if (res?.ok && res.absPath) finalAbs = res.absPath;
            }
            return copyTextToClipboard(finalAbs);
          },
        });
        entries.push({
          id: 'copy-rel-path',
          label: s.omniCopyRelPath,
          run: async () => {
            let finalRel = relWithRange;
            if (!wsRoot) {
              const res = await callOmniRpc('resolvePath', { rawPath: absBase, workspaceHint: '' });
              if (res?.ok && res.relPath) finalRel = res.relPath;
            }
            return copyTextToClipboard(finalRel);
          },
        });
        if (selectedText) {
          entries.push({ id: 'copy-text', label: s.omniCopyText, run: () => copyTextToClipboard(selectedText) });
        }
        return { header: getBaseName(absBase), entries };
      }

      if (meta.kind === 'mermaid') {
        entries.push({
          id: 'zoom-diagram',
          label: s.omniZoomDiagram,
          run: () =>
            openFile('', {
              kind: 'mermaid',
              mode: 'workbench',
              rawContent: meta.rawContent,
              title: meta.text || s.omniZoomDiagram,
            }),
        });
        entries.push({
          id: 'copy-text',
          label: s.omniCopyText,
          run: () => copyTextToClipboard(meta.rawContent),
        });
        return { header: meta.text || 'Mermaid SVG', entries };
      }

      return null;
    }

    // ── Zero-DOM-Mutation CSS Highlight Hit-Testing ──────────────────────────
    function resolveCaretPoint(clientX, clientY) {
      if (!D || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      try {
        if (typeof D.caretRangeFromPoint === 'function') {
          const r = D.caretRangeFromPoint(clientX, clientY);
          if (r && r.startContainer) return { node: r.startContainer, offset: r.startOffset };
        }
        if (typeof D.caretPositionFromPoint === 'function') {
          const p = D.caretPositionFromPoint(clientX, clientY);
          if (p && p.offsetNode) return { node: p.offsetNode, offset: p.offset };
        }
      } catch (_) {}
      return null;
    }

    function pointHitsRangeRects(range, clientX, clientY) {
      if (!range || typeof range.getClientRects !== 'function') return true;
      const rects = range.getClientRects();
      if (!rects || rects.length === 0) return true;
      for (let i = 0; i < rects.length; i++) {
        const rc = rects[i];
        if (
          clientX >= rc.left - 2 &&
          clientX <= rc.right + 2 &&
          clientY >= rc.top - 2 &&
          clientY <= rc.bottom + 2
        ) {
          return true;
        }
      }
      return false;
    }

    function hitTestHighlightedToken(clientX, clientY) {
      const pt = resolveCaretPoint(clientX, clientY);
      if (!pt || pt.node.nodeType !== 3) return null;
      const rec = textNodeTokenMap.get(pt.node);
      if (!rec || !rec.spans.length) return null;
      for (let i = 0; i < rec.spans.length; i++) {
        const sp = rec.spans[i];
        if (pt.offset >= sp.start && pt.offset <= sp.end && pointHitsRangeRects(sp.range, clientX, clientY)) {
          return {
            kind: sp.type,
            url: sp.url || '',
            filePath: sp.filePath || '',
            lineStart: sp.lineStart,
            lineEnd: sp.lineEnd,
            text: sp.display,
            element: pt.node.parentElement,
          };
        }
      }
      return null;
    }

    function setHoverTokenCursor(active) {
      if (hoverTokenActive === active) return;
      hoverTokenActive = active;
      const rootEl = D?.documentElement;
      if (!rootEl) return;
      if (active) rootEl.setAttribute('data-ag-omni-hover-token', '1');
      else rootEl.removeAttribute('data-ag-omni-hover-token');
    }

    // ── Event Handlers ───────────────────────────────────────────────────────
    function onDocPointerMove(ev) {
      if (!enabled || !urlHighlight || (!urlHighlight.size && !pathHighlight?.size)) {
        if (hoverTokenActive) setHoverTokenCursor(false);
        return;
      }
      const el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
      if (!el || !findClosest(el, SCAN_CONTAINER_SELECTOR) || findClosest(el, EXCLUDED_ANCESTOR_SELECTOR)) {
        if (hoverTokenActive) setHoverTokenCursor(false);
        return;
      }
      const hit = hitTestHighlightedToken(ev.clientX, ev.clientY);
      setHoverTokenCursor(Boolean(hit));
    }

    function onDocClickCapture(ev) {
      if (!enabled) return;
      if (activeMenuEl && !findClosest(ev.target, '.ag-omni-menu')) {
        closeContextMenu();
      }
      if (ev.button !== 0 || ev.defaultPrevented || ev.altKey || ev.shiftKey) return;

      const el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
      if (!el) return;
      if (findClosest(el, '[data-testid="agent-input-box"], [contenteditable="true"], .ag-omni-dock, .ag-omni-menu, [data-omni-ignore]')) {
        return;
      }

      // 1. Check fallback `.ag-omni-autolink` span
      const autoSpan = findClosest(el, '.ag-omni-autolink');
      if (autoSpan) {
        const autoUrl = autoSpan.getAttribute('data-omni-url');
        const autoPath = autoSpan.getAttribute('data-omni-path');
        if (autoUrl) {
          ev.preventDefault();
          ev.stopPropagation();
          void openUrl(autoUrl, resolveEffectiveLinkMode(ev));
          return;
        }
        if (autoPath) {
          ev.preventDefault();
          ev.stopPropagation();
          const ls = parseInt(autoSpan.getAttribute('data-omni-line-start') || '', 10);
          const le = parseInt(autoSpan.getAttribute('data-omni-line-end') || '', 10);
          void openFile(autoPath, {
            mode: ev.ctrlKey || ev.metaKey ? 'external' : 'workbench',
            lineStart: Number.isFinite(ls) ? ls : null,
            lineEnd: Number.isFinite(le) ? le : null,
          });
          return;
        }
      }

      // 2. Intercept http(s) anchor left-click (skip `<a download>` & native file pills)
      const anchor = findClosest(el, 'a[href]');
      if (anchor) {
        if (anchor.hasAttribute('download') || anchor.getAttribute('data-testid') === 'entity-pill') return;
        const href = String(anchor.getAttribute('href') || '').trim();
        if (!isHttpUrl(href)) return;
        ev.preventDefault();
        ev.stopPropagation();
        void openUrl(href, resolveEffectiveLinkMode(ev));
        return;
      }

      // 3. Check zero-DOM-mutation CSS Highlight token at click coordinates
      if (urlHighlight || pathHighlight) {
        let sel = '';
        try { sel = String(W?.getSelection?.()?.toString?.() || '').trim(); } catch (_) {}
        if (!sel) {
          const hit = hitTestHighlightedToken(ev.clientX, ev.clientY);
          if (hit) {
            ev.preventDefault();
            ev.stopPropagation();
            if (hit.kind === 'url') {
              void openUrl(hit.url, resolveEffectiveLinkMode(ev));
            } else if (hit.kind === 'file') {
              void openFile(hit.filePath, {
                mode: ev.ctrlKey || ev.metaKey ? 'external' : 'workbench',
                lineStart: hit.lineStart,
                lineEnd: hit.lineEnd,
              });
            }
          }
        }
      }
    }

    function onDocContextMenu(ev) {
      if (!enabled) return;
      const el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
      if (!el) return;

      if (findClosest(el, '[data-testid="agent-input-box"] [contenteditable="true"]')) {
        closeContextMenu();
        return;
      }

      let selectedText = '';
      try { selectedText = String(W?.getSelection?.()?.toString?.() || '').trim(); } catch (_) {}

      const meta = extractTargetMeta(el) || hitTestHighlightedToken(ev.clientX, ev.clientY);
      if (!meta) {
        closeContextMenu();
        return;
      }

      const built = buildMenuForTarget(meta, selectedText);
      if (!built || !built.entries.length) return;

      ev.preventDefault();
      ev.stopPropagation();
      openContextMenuAt(ev.clientX || 0, ev.clientY || 0, built.header, built.entries);
    }

    function onDocKeyDown(ev) {
      if (!enabled) return;
      if (activeMenuEl) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          closeContextMenu();
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          highlightMenuIndex(activeMenuIndex + 1);
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          highlightMenuIndex(activeMenuIndex - 1);
          return;
        }
        if (ev.key === 'Enter' && activeMenuIndex >= 0 && activeMenuItems[activeMenuIndex]) {
          ev.preventDefault();
          activeMenuItems[activeMenuIndex].click();
        }
      } else if (ev.key === 'Escape' && dockEl && !ev.defaultPrevented) {
        const active = D?.activeElement;
        if (!active || active === D.body || findClosest(active, '.ag-omni-dock')) {
          closeDock();
        }
      }
    }

    function onWindowBlurOrScroll(ev) {
      if (activeMenuEl) {
        if (ev?.type === 'scroll' && findClosest(ev.target, '.ag-omni-menu')) return;
        closeContextMenu();
      }
      if (hoverTokenActive) setHoverTokenCursor(false);
      if (dockSession?.engine === 'wcv') syncWcvBounds();
    }

    // SEC-7: Strict origin + source window verification on incoming postMessage
    function onWindowMessage(ev) {
      if (!enabled || !ev || !ev.data || typeof ev.data !== 'object') return;
      if (!serverMeta?.baseUrl || ev.origin !== serverMeta.baseUrl) return;
      if (ev.data.type !== 'ag-prism-workbench-ready') return;

      if (dockRefs?.iframe && ev.source === dockRefs.iframe.contentWindow) {
        pushWorkbenchSyncToIframe(dockRefs.iframe, dockSession);
        return;
      }
      for (const rec of mountedAuxSwitches) {
        if (rec.iframe && rec.iframe.isConnected && ev.source === rec.iframe.contentWindow) {
          pushWorkbenchSyncToIframe(rec.iframe, { filePath: rec.filePath });
          return;
        }
      }
    }

    // ── Safe Incremental Scanner (`CSS.highlights` Primary + `<span>` Fallback) ─
    function isExcludedFromLinkify(node) {
      const parent = node?.parentElement;
      if (!parent) return true;
      if (SKIP_WALK_TAGS.has(parent.tagName)) return true;
      if (findClosest(parent, EXCLUDED_ANCESTOR_SELECTOR)) return true;
      return false;
    }

    function ensureHighlightRegistries() {
      if (!supportsHighlightApi()) return false;
      if (!urlHighlight) {
        urlHighlight = new W.Highlight();
        W.CSS.highlights.set(HL_URL_NAME, urlHighlight);
      }
      if (!pathHighlight) {
        pathHighlight = new W.Highlight();
        W.CSS.highlights.set(HL_PATH_NAME, pathHighlight);
      }
      return true;
    }

    function clearHighlightEntryForNode(textNode) {
      const prev = textNodeTokenMap.get(textNode);
      if (prev && prev.spans) {
        for (const sp of prev.spans) {
          if (sp.range) {
            urlHighlight?.delete?.(sp.range);
            pathHighlight?.delete?.(sp.range);
          }
        }
      }
      textNodeTokenMap.delete(textNode);
      trackedHighlightNodes.delete(textNode);
    }

    function pruneDisconnectedHighlights() {
      if (!trackedHighlightNodes.size) return;
      for (const tn of Array.from(trackedHighlightNodes)) {
        if (!tn.isConnected) clearHighlightEntryForNode(tn);
      }
    }

    function registerHighlightOnTextNode(textNode) {
      const raw = textNode.nodeValue || '';
      const existing = textNodeTokenMap.get(textNode);
      if (existing && existing.rawValue === raw) return;
      if (existing) clearHighlightEntryForNode(textNode);
      if (isExcludedFromLinkify(textNode)) return;

      const tokens = tokenizeBareText(raw);
      if (!tokens) {
        textNodeTokenMap.set(textNode, { rawValue: raw, spans: [] });
        return;
      }

      ensureHighlightRegistries();
      const spans = [];
      for (const tok of tokens) {
        if (tok.type === 'text') continue;
        try {
          const range = D.createRange();
          range.setStart(textNode, tok.start);
          range.setEnd(textNode, tok.end);
          if (tok.type === 'url') urlHighlight.add(range);
          else pathHighlight.add(range);
          spans.push({ ...tok, range });
        } catch (_) {}
      }
      if (spans.length > 0) {
        textNodeTokenMap.set(textNode, { rawValue: raw, spans });
        trackedHighlightNodes.add(textNode);
      }
    }

    function linkifyTextNodeFallback(textNode) {
      if (!D || !textNode || processedTextNodes.has(textNode)) return;
      processedTextNodes.add(textNode);
      if (isExcludedFromLinkify(textNode)) return;

      const tokens = tokenizeBareText(textNode.nodeValue);
      if (!tokens) return;
      const parent = textNode.parentNode;
      if (!parent) return;

      const frag = D.createDocumentFragment();
      for (const tok of tokens) {
        if (tok.type === 'text') {
          const tn = D.createTextNode(tok.value);
          processedTextNodes.add(tn);
          frag.appendChild(tn);
        } else {
          const span = D.createElement('span');
          span.className = 'ag-omni-autolink';
          span.setAttribute('role', 'link');
          span.tabIndex = 0;
          span.textContent = tok.display;
          if (tok.type === 'url') {
            span.setAttribute('data-omni-url', tok.url);
          } else {
            span.setAttribute('data-omni-path', tok.filePath);
            if (tok.lineStart) span.setAttribute('data-omni-line-start', String(tok.lineStart));
            if (tok.lineEnd) span.setAttribute('data-omni-line-end', String(tok.lineEnd));
          }
          createdAutolinks.add(span);
          frag.appendChild(span);
        }
      }
      parent.replaceChild(frag, textNode);
    }

    function scanContainerForBareTokens(container) {
      if (!D || !container || container.nodeType !== 1) return;
      if (findClosest(container, EXCLUDED_ANCESTOR_SELECTOR)) return;

      const useHighlights = supportsHighlightApi();
      const handleNode = useHighlights ? registerHighlightOnTextNode : linkifyTextNodeFallback;

      if (typeof D.createTreeWalker === 'function') {
        const walker = D.createTreeWalker(container, 4 /* SHOW_TEXT */, {
          acceptNode(node) {
            if (!useHighlights && processedTextNodes.has(node)) return 2;
            if (isExcludedFromLinkify(node)) return 2;
            return 1;
          },
        });
        const batch = [];
        let cur;
        while ((cur = walker.nextNode()) && batch.length < 400) batch.push(cur);
        for (let i = 0; i < batch.length; i++) handleNode(batch[i]);
      } else {
        const walk = (el, budget) => {
          if (!el || budget.n <= 0) return;
          if (el.nodeType === 3) {
            budget.n--;
            handleNode(el);
            return;
          }
          if (el.nodeType !== 1) return;
          if (SKIP_WALK_TAGS.has(el.tagName) || findClosest(el, EXCLUDED_ANCESTOR_SELECTOR)) return;
          for (const k of Array.from(el.childNodes || [])) walk(k, budget);
        };
        walk(container, { n: 400 });
      }
    }

    function decorateMermaidContainers(scopeEl) {
      if (!D || !scopeEl || typeof scopeEl.querySelectorAll !== 'function') return;
      const candidates = scopeEl.querySelectorAll(
        '[data-testid*="mermaid"], .mermaid, svg[id^="mermaid"], svg[aria-roledescription]'
      );
      for (const node of candidates) {
        if (!isMermaidContainer(node)) continue;
        const box = node.tagName === 'SVG' && node.parentElement ? node.parentElement : node;
        if (!box || box.hasAttribute('data-omni-mermaid-box') || findClosest(box, '.ag-omni-dock')) continue;

        const prevPos = box.style?.position || '';
        box.setAttribute('data-omni-mermaid-box', '1');
        if (prevPos) box.setAttribute('data-omni-orig-pos', prevPos);
        if (box.style && (!prevPos || prevPos === 'static')) box.style.position = 'relative';

        const btn = D.createElement('button');
        btn.type = 'button';
        btn.className = 'ag-omni-mermaid-zoom-btn';
        btn.setAttribute('data-testid', 'ag-omni-mermaid-zoom');
        btn.setAttribute('data-ag-prism-omni-owned', '1');
        const s = getStrings();
        btn.textContent = `⤢ ${s.omniZoomDiagram}`;
        btn.title = s.omniZoomDiagram;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const svgEl = box.tagName === 'SVG' ? box : box.querySelector?.('svg');
          if (!svgEl) return;
          void openFile('', {
            kind: 'mermaid',
            mode: 'workbench',
            rawContent: svgEl.outerHTML,
            title: getStrings().omniZoomDiagram,
          });
        });

        box.appendChild(btn);
        decoratedMermaidBoxes.add(box);
      }
    }

    function extractAuxFileRef(viewEl) {
      if (!viewEl) return '';
      const directAttr =
        viewEl.getAttribute?.('data-omni-aux-file') ||
        viewEl.getAttribute?.('data-active-file-uri') ||
        viewEl.getAttribute?.('data-file-uri') ||
        viewEl.getAttribute?.('data-uri') ||
        viewEl.getAttribute?.('data-file-path') ||
        '';
      if (directAttr) return directAttr;

      const subNode = viewEl.querySelector?.('[data-active-file-uri], [data-file-uri], [data-uri]');
      if (subNode) {
        const subAttr =
          subNode.getAttribute('data-active-file-uri') ||
          subNode.getAttribute('data-file-uri') ||
          subNode.getAttribute('data-uri') ||
          '';
        if (subAttr) return subAttr;
      }

      const fromSelfFiber = readFiberFileHint(viewEl, 12);
      if (fromSelfFiber) return fromSelfFiber;

      if (viewEl.firstElementChild) {
        const fromChildFiber = readFiberFileHint(viewEl.firstElementChild, 6);
        if (fromChildFiber) return fromChildFiber;
      }
      return '';
    }

    function resolveAuxMountHost(viewEl) {
      const tid = String(viewEl.getAttribute?.('data-testid') || '');
      const isChildLeaf =
        tid === 'binary-file-no-preview' ||
        tid === 'artifact-pdf-no-preview' ||
        tid === 'image-file-viewer' ||
        tid === 'html-file-preview' ||
        Boolean(viewEl.classList?.contains?.('file-viewer-root'));

      if (isChildLeaf && viewEl.parentElement) {
        const shell = findClosest(viewEl.parentElement, '.relative.h-full.w-full');
        const shellTid = String(shell?.getAttribute?.('data-testid') || '');
        if (
          shell &&
          shell !== D.body &&
          shell !== D.documentElement &&
          !shellTid.includes('split') &&
          shellTid !== 'overview-panel-host'
        ) {
          return shell;
        }
        const parent = viewEl.parentElement;
        const ptid = String(parent.getAttribute?.('data-testid') || '');
        if (
          parent !== D.body &&
          parent !== D.documentElement &&
          !ptid.includes('split') &&
          ptid !== 'conversation-view' &&
          parent.children?.length === 1
        ) {
          return parent;
        }
      }
      return viewEl;
    }

    function decorateAuxUnsupportedViews(scopeEl) {
      if (!D || !scopeEl || typeof scopeEl.querySelectorAll !== 'function') return;
      const candidates = [];
      if (typeof scopeEl.matches === 'function' && scopeEl.matches(AUX_FILE_VIEW_SELECTOR)) {
        candidates.push(scopeEl);
      }
      for (const el of scopeEl.querySelectorAll(AUX_FILE_VIEW_SELECTOR)) candidates.push(el);

      for (const viewEl of candidates) {
        if (
          viewEl.hasAttribute('data-omni-aux-mounted') ||
          findClosest(viewEl, '[data-omni-aux-mounted], .ag-omni-dock')
        ) {
          continue;
        }
        const rawAttr = extractAuxFileRef(viewEl);
        if (!rawAttr) continue;
        const { filePath } = parseFileUriToPath(rawAttr);
        const ext = getFileExt(filePath);
        if (!ext || !AUX_SWITCHABLE_EXTS.has(ext)) continue;

        const hostEl = resolveAuxMountHost(viewEl);
        if (
          hostEl.hasAttribute('data-omni-aux-mounted') ||
          hostEl.querySelector?.('[data-testid="ag-omni-aux-switcher"]')
        ) {
          continue;
        }

        viewEl.setAttribute('data-omni-aux-mounted', '1');
        hostEl.setAttribute('data-omni-aux-mounted', '1');

        const origHostDisplay = hostEl.style?.display || '';
        const origHostFlexDir = hostEl.style?.flexDirection || '';
        if (hostEl !== viewEl && hostEl.style) {
          hostEl.style.display = 'flex';
          hostEl.style.flexDirection = 'column';
        }

        const s = getStrings();
        const bar = D.createElement('div');
        bar.className = 'ag-omni-aux-bar';
        bar.setAttribute('data-testid', 'ag-omni-aux-switcher');
        bar.setAttribute('data-ag-prism-omni-owned', '1');

        const btnWb = D.createElement('button');
        btnWb.type = 'button';
        btnWb.className = 'ag-omni-btn';
        btnWb.textContent = s.omniViewWorkbench;

        const btnRaw = D.createElement('button');
        btnRaw.type = 'button';
        btnRaw.className = 'ag-omni-btn';
        btnRaw.setAttribute('data-active', '1');
        btnRaw.textContent = s.omniViewRaw;

        bar.appendChild(btnWb);
        bar.appendChild(btnRaw);

        const rec = {
          viewEl, hostEl, origHostDisplay, origHostFlexDir,
          bar, btnWb, btnRaw, iframe: null, filePath, hiddenKids: [],
        };

        const switchMode = async (toWorkbench) => {
          if (toWorkbench) {
            btnWb.setAttribute('data-active', '1');
            btnRaw.removeAttribute('data-active');
            const meta = await ensureServerMeta();
            if (!meta) {
              void openFile(filePath, { mode: 'workbench' });
              return;
            }
            if (hostEl.style) {
              hostEl.style.display = 'flex';
              hostEl.style.flexDirection = 'column';
            }
            for (const ch of Array.from(hostEl.children || [])) {
              if (ch === bar || ch === rec.iframe) continue;
              if (ch.style) {
                rec.hiddenKids.push({ el: ch, display: ch.style.display || '' });
                ch.style.display = 'none';
              }
            }
            if (!rec.iframe) {
              const ifr = D.createElement('iframe');
              ifr.className = 'ag-omni-aux-overlay';
              ifr.setAttribute('data-ag-prism-omni-owned', '1');
              ifr.setAttribute('referrerpolicy', 'no-referrer');
              ifr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
              ifr.addEventListener('load', () => pushWorkbenchSyncToIframe(ifr, { filePath }));
              rec.iframe = ifr;
              hostEl.appendChild(ifr);
            }
            rec.iframe.hidden = false;
            rec.iframe.src = buildViewerUrl(meta, { filePath, kind: detectPreviewKind(filePath) });
          } else {
            btnRaw.setAttribute('data-active', '1');
            btnWb.removeAttribute('data-active');
            if (rec.iframe) rec.iframe.hidden = true;
            for (const item of rec.hiddenKids) {
              if (item.el?.style) item.el.style.display = item.display;
            }
            rec.hiddenKids = [];
          }
        };

        btnWb.addEventListener('click', () => void switchMode(true));
        btnRaw.addEventListener('click', () => void switchMode(false));

        if (hostEl.firstChild) hostEl.insertBefore(bar, hostEl.firstChild);
        else hostEl.appendChild(bar);
        mountedAuxSwitches.add(rec);
      }
    }

    function runScanNow(targetRoot) {
      if (!enabled || !D) return;
      const root = targetRoot || D.body || D.documentElement;
      if (!root || root.nodeType !== 1) return;

      pruneDisconnectedHighlights();
      if (typeof root.matches === 'function' && root.matches(SCAN_CONTAINER_SELECTOR)) {
        scanContainerForBareTokens(root);
      } else if (typeof root.querySelectorAll === 'function') {
        for (const c of root.querySelectorAll(SCAN_CONTAINER_SELECTOR)) {
          scanContainerForBareTokens(c);
        }
      }
      decorateMermaidContainers(root);
      decorateAuxUnsupportedViews(root);
    }

    function scheduleIncrementalScan(node) {
      if (!enabled || !D) return;
      const el = node && node.nodeType === 1 ? node : node?.parentElement;
      if (el) pendingScanRoots.add(el);
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (!enabled) {
          pendingScanRoots.clear();
          return;
        }
        pruneDisconnectedHighlights();
        const roots = Array.from(pendingScanRoots);
        pendingScanRoots.clear();
        for (const r of roots) {
          if (!r || !r.isConnected) continue;
          const scanBox = findClosest(r, SCAN_CONTAINER_SELECTOR);
          if (scanBox) scanContainerForBareTokens(scanBox);
          else runScanNow(r);
          decorateMermaidContainers(r);
          decorateAuxUnsupportedViews(r);
        }
        if (dockSession?.engine === 'wcv') syncWcvBounds();
      }, 60);
    }

    // ── Lifecycle & Zero-Residue Teardown ────────────────────────────────────
    function ensureStyleInjected() {
      if (!D) return;
      let styleEl = D.getElementById?.(STYLE_EL_ID);
      if (!styleEl) {
        styleEl = D.createElement('style');
        styleEl.id = STYLE_EL_ID;
        styleEl.textContent = OMNI_CSS;
        (D.head || D.documentElement)?.appendChild?.(styleEl);
      }
    }

    function unwrapAllModifications() {
      // 1. Clear CSS Custom Highlights (zero DOM changes needed)
      for (const tn of Array.from(trackedHighlightNodes)) {
        textNodeTokenMap.delete(tn);
      }
      trackedHighlightNodes.clear();
      if (urlHighlight) {
        try { urlHighlight.clear(); } catch (_) {}
        urlHighlight = null;
      }
      if (pathHighlight) {
        try { pathHighlight.clear(); } catch (_) {}
        pathHighlight = null;
      }
      try {
        W?.CSS?.highlights?.delete?.(HL_URL_NAME);
        W?.CSS?.highlights?.delete?.(HL_PATH_NAME);
      } catch (_) {}
      setHoverTokenCursor(false);

      // 2. Unwrap fallback autolink spans if any were created
      const parentsToNormalize = new Set();
      for (const span of Array.from(createdAutolinks)) {
        const p = span.parentNode;
        if (p && D) {
          const tn = D.createTextNode(span.textContent || '');
          p.replaceChild(tn, span);
          parentsToNormalize.add(p);
        } else {
          try { span.remove?.(); } catch (_) {}
        }
      }
      createdAutolinks.clear();
      for (const p of parentsToNormalize) {
        try { p.normalize?.(); } catch (_) {}
      }

      // 3. Remove Mermaid zoom buttons
      for (const box of Array.from(decoratedMermaidBoxes)) {
        box.querySelectorAll?.('.ag-omni-mermaid-zoom-btn').forEach((b) => b.remove());
        const origPos = box.getAttribute?.('data-omni-orig-pos') || '';
        if (box.style) box.style.position = origPos;
        box.removeAttribute?.('data-omni-orig-pos');
        box.removeAttribute?.('data-omni-mermaid-box');
      }
      decoratedMermaidBoxes.clear();

      // 4. Remove Aux view switchers & restore shell styles
      for (const rec of Array.from(mountedAuxSwitches)) {
        for (const item of rec.hiddenKids) {
          if (item.el?.style) item.el.style.display = item.display;
        }
        if (rec.hostEl && rec.hostEl.style) {
          rec.hostEl.style.display = rec.origHostDisplay || '';
          rec.hostEl.style.flexDirection = rec.origHostFlexDir || '';
        }
        try { rec.bar?.remove?.(); } catch (_) {}
        try { rec.iframe?.remove?.(); } catch (_) {}
        rec.viewEl?.removeAttribute?.('data-omni-aux-mounted');
        rec.hostEl?.removeAttribute?.('data-omni-aux-mounted');
      }
      mountedAuxSwitches.clear();
    }

    function ensureRootAttrObserver() {
      if (!D?.documentElement || !W || typeof W.MutationObserver !== 'function' || rootAttrObserver) return;
      rootAttrObserver = new W.MutationObserver((mutations) => {
        let needSync = false;
        for (const m of mutations) {
          const attr = m.attributeName;
          if (attr === 'data-ag-prism-omni') {
            const v = D.documentElement.getAttribute('data-ag-prism-omni');
            if (v === 'off' && enabled) { sync({ omniModule: 'off' }); return; }
            if (v === 'on' && !enabled) { sync({ omniModule: 'on' }); return; }
          } else if (attr === 'data-ag-prism-link-target') {
            const lt = D.documentElement.getAttribute('data-ag-prism-link-target');
            if (lt === 'builtin' || lt === 'external') linkTarget = lt;
          } else {
            needSync = true;
          }
        }
        if (needSync && enabled) broadcastThemeAndLocaleSync();
      });
      rootAttrObserver.observe(D.documentElement, {
        attributes: true,
        attributeFilter: [
          'data-ag-cs-theme', 'data-ag-cs-palette', 'data-ag-cs-light-preset',
          'data-ag-cs-accent', 'data-ag-cs-corners', 'data-ag-cs-motion',
          'data-ag-cs-lang', 'data-ag-prism-omni', 'data-ag-prism-link-target',
        ],
      });
    }

    function attachRuntime() {
      if (mounted || !D || !W) return;
      mounted = true;
      installRpcResolver();
      ensureStyleInjected();
      ensureRootAttrObserver();

      D.addEventListener('click', onDocClickCapture, true);
      D.addEventListener('contextmenu', onDocContextMenu, true);
      D.addEventListener('keydown', onDocKeyDown, true);
      D.addEventListener('mousemove', onDocPointerMove, { passive: true });
      D.addEventListener('visibilitychange', onWindowBlurOrScroll);
      D.addEventListener('scroll', onWindowBlurOrScroll, true);
      W.addEventListener?.('blur', onWindowBlurOrScroll);
      W.addEventListener?.('resize', onWindowBlurOrScroll);
      W.addEventListener?.('message', onWindowMessage);

      if (typeof W.MutationObserver === 'function') {
        domObserver = new W.MutationObserver((mutations) => {
          let checkWcvOverlay = false;
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.type === 'childList') {
              if (dockSession?.engine === 'wcv' && (m.addedNodes.length || m.removedNodes?.length)) {
                checkWcvOverlay = true;
              }
              for (let j = 0; j < m.addedNodes.length; j++) {
                const n = m.addedNodes[j];
                if (n.nodeType === 1 && String(n.className || '').includes('ag-omni-')) continue;
                scheduleIncrementalScan(n);
              }
            } else if (m.type === 'characterData' && m.target) {
              if (supportsHighlightApi() && m.target.nodeType === 3) {
                registerHighlightOnTextNode(m.target);
              } else {
                scheduleIncrementalScan(m.target);
              }
            } else if (m.type === 'attributes') {
              if (dockSession?.engine === 'wcv') checkWcvOverlay = true;
              const attrName = m.attributeName;
              if (
                (attrName === 'data-ag-cs-spark-streaming' || attrName === 'data-ag-cs-thought-streaming') &&
                m.target &&
                !m.target.hasAttribute?.(attrName)
              ) {
                scheduleIncrementalScan(m.target);
              }
            }
          }
          // Immediately yield/restore native WCV surface when host portals/menus open or close
          if (checkWcvOverlay && dockSession?.engine === 'wcv') {
            syncWcvBounds();
          }
        });
        const obsRoot = D.body || D.documentElement;
        if (obsRoot) {
          domObserver.observe(obsRoot, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
              'data-open',
              'data-popup-open',
              'role',
              'hidden',
              'data-ag-cs-spark-streaming',
              'data-ag-cs-thought-streaming',
            ],
          });
        }
      }

      runScanNow(D.body || D.documentElement);
    }

    function detachRuntime(removeRootAttrs = false) {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      pendingScanRoots.clear();

      if (domObserver) {
        try { domObserver.disconnect(); } catch (_) {}
        domObserver = null;
      }
      closeContextMenu();
      closeDock();
      unwrapAllModifications();

      if (D) {
        D.removeEventListener('click', onDocClickCapture, true);
        D.removeEventListener('contextmenu', onDocContextMenu, true);
        D.removeEventListener('keydown', onDocKeyDown, true);
        D.removeEventListener('mousemove', onDocPointerMove, { passive: true });
        D.removeEventListener('visibilitychange', onWindowBlurOrScroll);
        D.removeEventListener('scroll', onWindowBlurOrScroll, true);
        try { D.getElementById?.(STYLE_EL_ID)?.remove?.(); } catch (_) {}
        if (removeRootAttrs && D.documentElement) {
          D.documentElement.removeAttribute?.('data-ag-prism-omni');
          D.documentElement.removeAttribute?.('data-ag-prism-link-target');
          D.documentElement.removeAttribute?.('data-ag-omni-hover-token');
        }
      }
      if (W) {
        W.removeEventListener?.('blur', onWindowBlurOrScroll);
        W.removeEventListener?.('resize', onWindowBlurOrScroll);
        W.removeEventListener?.('message', onWindowMessage);
      }
      mounted = false;
    }

    function sync(cfg = null, incomingServerMeta = null) {
      if (incomingServerMeta && typeof incomingServerMeta === 'object' && incomingServerMeta.baseUrl) {
        serverMeta = {
          baseUrl: String(incomingServerMeta.baseUrl).replace(/\/+$/, ''),
          token: String(incomingServerMeta.token || ''),
          port: incomingServerMeta.port || null,
        };
      }

      const rootEl = D?.documentElement;
      const rawOmni =
        cfg && cfg.omniModule !== undefined
          ? cfg.omniModule
          : rootEl?.getAttribute?.('data-ag-prism-omni') || 'on';
      const nextEnabled = rawOmni !== 'off' && rawOmni !== false;

      if (destroyed && !nextEnabled) return getState();
      destroyed = false;
      ensureRootAttrObserver();

      const rawTarget =
        cfg && cfg.linkTarget !== undefined
          ? cfg.linkTarget
          : rootEl?.getAttribute?.('data-ag-prism-link-target') || linkTarget || 'builtin';
      linkTarget = rawTarget === 'external' ? 'external' : 'builtin';

      enabled = nextEnabled;
      if (rootEl?.setAttribute) {
        if (rootEl.getAttribute('data-ag-prism-omni') !== (enabled ? 'on' : 'off')) {
          rootEl.setAttribute('data-ag-prism-omni', enabled ? 'on' : 'off');
        }
        if (rootEl.getAttribute('data-ag-prism-link-target') !== linkTarget) {
          rootEl.setAttribute('data-ag-prism-link-target', linkTarget);
        }
      }

      if (!enabled) {
        detachRuntime(false);
        return getState();
      }

      attachRuntime();
      broadcastThemeAndLocaleSync();
      return getState();
    }

    function destroy() {
      destroyed = true;
      enabled = false;
      if (rootAttrObserver) {
        try { rootAttrObserver.disconnect(); } catch (_) {}
        rootAttrObserver = null;
      }
      for (const item of pendingRpc.values()) {
        clearTimeout(item.timer);
        item.resolve({ ok: false, disposed: true });
      }
      pendingRpc.clear();
      detachRuntime(true);
    }

    function getState() {
      return {
        version: VERSION,
        enabled,
        mounted,
        highlightMode: supportsHighlightApi() ? 'css-highlights' : 'span-fallback',
        linkTarget,
        hasServerMeta: Boolean(serverMeta?.baseUrl && serverMeta?.token),
        serverMeta: serverMeta ? { ...serverMeta } : null,
        dockOpen: Boolean(dockEl && dockEl.isConnected),
        dockSession: dockSession ? { ...dockSession } : null,
        menuOpen: Boolean(activeMenuEl && activeMenuEl.isConnected),
      };
    }

    return {
      version: VERSION,
      sync,
      openUrl,
      openFile,
      destroy,
      getState,
      _scanRoot: runScanNow,
    };
  }

  return {
    VERSION,
    PREVIEW_KIND_BY_EXT,
    createOmniClient,
    normalizeLangCode,
    splitPathAndLineRange,
    parseFileUriToPath,
    detectPreviewKind,
    computeRelativePath,
    tokenizeBareText,
    extractTargetMeta,
  };
});
