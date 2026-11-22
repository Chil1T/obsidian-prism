// Obsidian Prism — OpenAI-Compatible Thought Translator Settings Workbench UI (v1.0.7-beta.1 Five-Locale & Sync Hardened)
// Extracted modular UI component mounted on globalThis.__agPrismThoughtSettingsUi

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const WB_STR_KEYS =
    'defaultProfName|customProfPrefix|viewLabel|optImmersive|optBilingual|styleLabel|optTech|optConcise|optCustom|customPromptPh|profilesLabel|addProfile|delProfile|fieldName|fieldNamePh|fetchModels|saveBtn|testBtn|clearCacheBtn|privacyHint|keylessPh|keylessBadge|clearKeyBtn|keyClearedBadge|fetchingModels|fetchErr|savingCfg|saveErr|testingConn|testErr|clearDualOk|clearLocalOk|usageHint|bridgeOfflineHint|proxyLabel|proxyModeAuto|proxyModeCustom|proxyModeDirect|proxyHintAuto|proxyHintDirect|proxyHintValid|proxyHintSavedAuth|proxyHintInvalid|proxyClearBtn|toolSumLabel|toolSumDesc|toolSumOn|toolSumOff'.split(
      '|'
    );
  const wbFmt = (t, args) => t.replace(/\{(\d)\}/g, (_, i) => String(args[i] ?? ''));
  const WB_FMT_SPECS = [
    ['savedKeyPh', (t) => (m) => wbFmt(t, [m])],
    ['cacheBadge', (t) => (n) => wbFmt(t, [n])],
    ['cacheDetail', (t) => (l, d, k) => wbFmt(t, [l, d]) + (k ? ` (${k})` : '')],
    ['quickSelect', (t) => (n) => wbFmt(t, [n])],
    ['fetchOk', (t) => (n, ms) => wbFmt(t, [n, ms])],
    ['saveOk', (t, f0, f1) => (nm, md) => wbFmt(t, [nm || f0, md || f1])],
    ['testOk', (t) => (ms, md, r) => wbFmt(t, [ms, md, r])],
  ];
  const WB_DATA = {
    'zh-CN': [
      'OpenAI 兼容主力渠道|自定义渠道|译文阅读视图|纯译文沉浸|译文+原文对照|润色文风预设|专业工程手稿|精炼核心要点|自定义提示词|在此输入仅保存在本机私密配置 (~/.gemini/config/) 的自定义系统提示词，绝不写入 Git 仓库…|OpenAI 兼容渠道预设|+ 新增渠道|删除当前|渠道名称|例如：主力网关 / 本地 Ollama|拉取模型列表|保存渠道配置|发送测试消息|清空缓存|密钥与自定义提示词以 0600 权限独立保存在本机 ~/.gemini/config/，脱敏回显，不进入公开 Git 仓库。|本地渠道可留空免密|本地免密|清除密钥|待保存清除|正在拉取上游模型列表…|拉取模型失败|正在保存配置…|保存失败（守护进程离线）|正在保存并发送测试消息…|测试连接失败|✓ 已清空双端转译缓存|✓ 已清空前端缓存|开启后点击展开英文思考块可见译文；本身已是目标语言的思考块自动保留原文；免费机翻在代理环境下会自动跟随系统代理。|Prism 后台服务未连接，请确认插件守护进程已启动。|自定义代理地址|自动检测|自定义|直连|留空自动检测环境变量与系统代理；支持 http://、https://、socks5://、socks5h://|已启用直连模式，将忽略环境变量与系统代理。|✓ 代理地址格式有效（保存后优先使用此代理，凭证自动脱敏）|✓ 已保存带认证代理（凭证已脱敏，清空或覆盖可修改）|✕ 代理地址无效：仅支持 http://、https://、socks5://、socks5h://（端口 1-65535，禁止换行或控制字符）|清除|「正在探索」工具摘要翻译|仅批量翻译探索/工具列表中的自然语言短句（默认关闭），自动保护文件名、路径、行号与退出码，关闭后立即无损还原原文。|已开启|已关闭',
      ['已保存 {0}（留空保持不变）', '缓存 {0} 条', '前端缓存 {0} 条 / 磁盘缓存 {1} 条', '▾ 从已拉取的 {0} 个上游模型中快速选择…', '✓ 成功拉取 {0} 个模型 · {1}ms', '✓ 已保存（{0} · {1}）', '✓ 连通正常 · {0}ms · {1} 回复: 「{2}」'],
      '渠道',
      '未设模型',
    ],
    'zh-TW': [
      'OpenAI 相容主力管道|自訂管道|譯文閱讀視圖|純譯文沉浸|譯文+原文對照|潤飾文風預設|專業工程手稿|精煉核心要點|自訂提示詞|在此輸入僅儲存在本機私密設定 (~/.gemini/config/) 的自訂系統提示詞，絕不寫入 Git 儲存庫…|OpenAI 相容管道預設|+ 新增管道|刪除目前|管道名稱|例如：主力閘道 / 本機 Ollama|擷取模型清單|儲存管道設定|傳送測試訊息|清除快取|金鑰與自訂提示詞以 0600 權限獨立儲存在本機 ~/.gemini/config/，遮罩回顯，不進入公開 Git 儲存庫。|本機管道可留空免密|本機免密|清除金鑰|待儲存清除|正在擷取上游模型清單…|擷取模型失敗|正在儲存設定…|儲存失敗（守護行程離線）|正在儲存並傳送測試訊息…|測試連線失敗|✓ 已清除雙端轉譯快取|✓ 已清除前端快取|開啟後點擊展開英文思考區塊即可見譯文；本身已是目標語言的思考區塊自動保留原文；免費機翻在代理環境下會自動跟隨系統代理。|Prism 背景服務未連線，請確認外掛守護行程已啟動。|自訂代理位址|自動偵測|自訂|直連|留空自動偵測環境變數與系統代理；支援 http://、https://、socks5://、socks5h://|已啟用直連模式，將略過環境變數與系統代理。|✓ 代理位址格式有效（儲存後優先使用此代理，憑證自動遮罩）|✓ 已儲存含驗證代理（憑證已遮罩，清空或覆寫可修改）|✕ 代理位址無效：僅支援 http://、https://、socks5://、socks5h://（連接埠 1-65535，禁止換行或控制字元）|清除|「正在探索」工具摘要翻譯|僅批次翻譯探索/工具清單中的自然語言短句（預設關閉），自動保護檔名、路徑、行號與結束碼，關閉後立即無損還原原文。|已開啟|已關閉',
      ['已儲存 {0}（留空維持不變）', '快取 {0} 筆', '前端快取 {0} 筆 / 磁碟快取 {1} 筆', '▾ 從已擷取的 {0} 個上游模型中快速選擇…', '✓ 成功擷取 {0} 個模型 · {1}ms', '✓ 已儲存（{0} · {1}）', '✓ 連線正常 · {0}ms · {1} 回覆: 「{2}」'],
      '管道',
      '未設模型',
    ],
    yue: [
      'OpenAI 兼容主力渠道|自訂渠道|譯文閱讀視圖|純譯文沉浸|譯文+原文對照|潤飾文風預設|專業工程手稿|精煉核心要點|自訂提示詞|喺度輸入只會儲存喺本機私密設定 (~/.gemini/config/) 嘅自訂系統提示詞，絕唔寫入 Git 倉庫…|OpenAI 兼容渠道預設|+ 新增渠道|刪除而家呢個|渠道名稱|例如：主力網關 / 本機 Ollama|拉取模型清單|儲存渠道設定|發送測試訊息|清空快取|金鑰同自訂提示詞以 0600 權限獨立保存喺本機 ~/.gemini/config/，遮罩顯示，唔會寫入公開 Git 倉庫。|本機渠道可留空免密|本機免密|清除金鑰|待儲存清除|正在拉取上游模型清單…|拉取模型失敗|正在儲存設定…|儲存失敗（守護進程離線）|正在儲存並發送測試訊息…|測試連接失敗|✓ 已清空雙端轉譯快取|✓ 已清空前端快取|開啟後撳開英文思考區塊就睇到譯文；本身已經係目標語言嘅思考區塊會自動保留原文；免費機翻喺代理環境下會自動跟隨系統代理。|Prism 後台服務未連接，請確認外掛守護進程已經啟動。|自訂代理地址|自動偵測|自訂|直連|留空自動偵測環境變數同系統代理；支援 http://、https://、socks5://、socks5h://|已啟用直連模式，會略過環境變數同系統代理。|✓ 代理地址格式有效（儲存後優先使用呢個代理，憑證自動遮罩）|✓ 已儲存認證代理（憑證已遮罩，清空或覆寫可修改）|✕ 代理地址無效：只支援 http://、https://、socks5://、socks5h://（端口 1-65535，禁止換行或控制字符）|清除|「正在探索」工具摘要翻譯|只批量翻譯探索/工具列表入面嘅自然語言短句（預設關閉），自動保護檔名、路徑、行號同退出碼，關閉後即刻無損還原原文。|已開啟|已關閉',
      ['已儲存 {0}（留空保持唔變）', '快取 {0} 條', '前端快取 {0} 條 / 磁碟快取 {1} 條', '▾ 由已拉取嘅 {0} 個上游模型入面快速揀選…', '✓ 成功拉取 {0} 個模型 · {1}ms', '✓ 已儲存（{0} · {1}）', '✓ 連通正常 · {0}ms · {1} 回覆: 「{2}」'],
      '渠道',
      '未設模型',
    ],
    en: [
      'Primary OpenAI Profile|Profile|Reading View|Translated Only|Bilingual Stacked|Polishing Style|Technical Manuscript|Concise Key Points|Custom Prompt|Enter local-only custom system prompt (saved in ~/.gemini/config/, never in Git)…|OpenAI Endpoint Profiles|+ New|Delete|Profile Name|e.g. Primary Gateway / Local Ollama|Fetch Models|Save Config|Send Test Message|Clear Cache|API keys & custom prompts are stored locally in ~/.gemini/config/ (0600) and never touch Git.|Optional for local endpoint|Keyless OK|Clear|Pending clear|Fetching upstream /models…|Failed to fetch models|Saving configuration…|Save failed (daemon offline)|Testing endpoint latency…|Connection test failed|✓ Cleared translation cache|✓ Cleared local cache|Expand an English thinking block to view translations; blocks already in your target language keep the original text; free machine translation automatically follows your system proxy.|Prism background service is disconnected. Please make sure the plugin daemon is running.|Custom Proxy URL|Auto|Custom|Direct|Leave blank to auto-detect env & OS system proxy; supports http://, https://, socks5://, socks5h://|Direct mode enabled: env & OS system proxies are bypassed.|✓ Proxy URL valid (prioritized after save; credentials redacted)|✓ Saved proxy with redacted credentials (clear or overwrite to change)|✕ Invalid proxy URL: only http://, https://, socks5://, socks5h:// (port 1–65535, no control chars)|Clear|Translate "Exploring" Tool Summaries|Batch-translate short English prose in Exploring/tool lists (off by default); auto-protects filenames, paths, line refs & exit codes, and restores raw text when off.|On|Off',
      ['Saved {0} (leave blank to keep)', 'Cache: {0}', 'Frontend: {0} / Daemon: {1}', '▾ Quick-select from {0} models…', '✓ Loaded {0} models · {1}ms', '✓ Saved ({0} · {1})', '✓ Connected · {0}ms · Reply: "{2}"'],
      'Profile',
      'No model',
    ],
    ja: [
      'OpenAI 互換メインプロファイル|カスタム接続先|翻訳表示モード|翻訳のみ|翻訳＋原文対照|文体プリセット|技術ノート調|要点簡潔|カスタムプロンプト|ローカル専用システムプロンプトを入力（~/.gemini/config/ に保存され、Gitには含まれません）…|OpenAI 互換接続先プリセット|+ 追加|削除|接続先名|例: メインGW / ローカル Ollama|モデル一覧取得|設定を保存|接続テスト送信|キャッシュ消去|APIキーとカスタムプロンプトは ~/.gemini/config/ (0600) にローカル保存され、Gitには一切書き込まれません。|ローカル接続先は空欄可|キー不要|キー消去|保存時に消去|上流のモデル一覧を取得中…|モデル一覧の取得に失敗しました|設定を保存中…|保存失敗（デーモンオフライン）|保存して接続テストを送信中…|接続テストに失敗しました|✓ 翻訳キャッシュを消去しました|✓ ローカルキャッシュを消去しました|有効化後に英語の思考ブロックを展開すると訳文が表示されます。既に対象言語の思考ブロックは原文を保持し、無料機械翻訳はシステムプロキシに自動追従します。|Prism バックグラウンドサービスに接続されていません。プラグインのデーモンが起動しているか確認してください。|カスタムプロキシ URL|自動検出|カスタム|直接接続|空欄で環境変数とシステムプロキシを自動検出します（http://、https://、socks5://、socks5h:// 対応）|直接接続モード：環境変数およびシステムプロキシを無視します。|✓ プロキシ形式は有効です（保存後に優先適用・認証情報は自動マスク）|✓ 認証付きプロキシ保存済み（認証情報はマスク済・消去または上書きで変更可）|✕ 無効なプロキシ URL：http://、https://、socks5://、socks5h://（ポート 1–65535・制御文字不可）のみ対応|消去|「探索中」ツール要約の翻訳|探索・ツール一覧の自然言語短文を一括翻訳します（初期設定オフ）。ファイル名・パス・行番号・終了コードを自動保護し、オフ時に原文へ即時復元します。|オン|オフ',
      ['保存済み {0}（空欄で維持）', 'キャッシュ {0} 件', 'フロント {0} 件 / デーモン {1} 件', '▾ 取得した {0} 個のモデルから選択…', '✓ {0} 個のモデルを取得 · {1}ms', '✓ 保存完了（{0} · {1}）', '✓ 接続正常 · {0}ms · {1} 応答: 「{2}」'],
      'プロファイル',
      'モデル未設定',
    ],
  };
  const WORKBENCH_I18N = Object.fromEntries(
    Object.entries(WB_DATA).map(([lk, [strRow, fmts, f0, f1]]) => {
      const vals = strRow.split('|');
      const obj = {};
      for (let i = 0; i < WB_STR_KEYS.length; i++) obj[WB_STR_KEYS[i]] = vals[i];
      for (let i = 0; i < WB_FMT_SPECS.length; i++) {
        obj[WB_FMT_SPECS[i][0]] = WB_FMT_SPECS[i][1](fmts[i], f0, f1);
      }
      return [lk, obj];
    })
  );

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

  function isLocalKeylessUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return false;
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : 'http://' + raw;
    try {
      const u = new URL(withProto);
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        !host ||
        host === '0.0.0.0' ||
        host === '100.100.100.200' ||
        host === 'metadata.google.internal' ||
        host === 'metadata' ||
        host === 'instance-data' ||
        /^fd00:ec2::254$/i.test(host) ||
        /^169\.254(?:\.\d{1,3}){2}$/.test(host)
      ) {
        return false;
      }
      if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '::1' ||
        host === 'host.docker.internal' ||
        host === 'gateway.docker.internal'
      ) {
        return true;
      }
      if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
      if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;
      if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;
      if (/^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(host)) return true;
      if (/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(host)) return true;
      if (/^(?:fc|fd|fe80:)/i.test(host)) return true;
      if (/\.(?:local|lan|internal|home|arpa)$/i.test(host)) return true;
      if (!host.includes('.') && !host.includes(':')) return true;
      return false;
    } catch {
      return false;
    }
  }

  function validateCustomProxyInput(rawProxy, savedMaskedProxy = '') {
    const rawStr = String(rawProxy || '');
    if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawStr)) {
      return { ok: false, empty: false, reason: 'control-chars' };
    }
    const s = rawStr.trim();
    if (!s) return { ok: true, empty: true, savedAuth: false };
    if (s.includes('••••')) {
      if (savedMaskedProxy && s === savedMaskedProxy) {
        return { ok: true, empty: false, savedAuth: true };
      }
      return { ok: false, empty: false, reason: 'invalid-mask' };
    }
    if (/[\u0000-\u001f\u007f]/.test(s)) {
      return { ok: false, empty: false, reason: 'control-chars' };
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
      if (!/^(?:https?|socks5h?):\/\//i.test(s)) {
        return { ok: false, empty: false, reason: 'unsupported-protocol' };
      }
    } else if (s.includes('=') || /^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d+$)/.test(s)) {
      return { ok: false, empty: false, reason: 'invalid-format' };
    }
    const withScheme = /^(?:https?|socks5h?):\/\//i.test(s) ? s : `http://${s}`;
    try {
      const u = new URL(withScheme);
      if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol)) {
        return { ok: false, empty: false, reason: 'unsupported-protocol' };
      }
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        !host ||
        /[\u0000-\u001f\u007f\s=@/?#]/.test(host) ||
        host === '0.0.0.0' ||
        host === '100.100.100.200' ||
        host === 'metadata.google.internal' ||
        host === 'metadata' ||
        host === 'instance-data' ||
        /^fd00:ec2::254$/i.test(host) ||
        /^169\.254(?:\.\d{1,3}){2}$/.test(host)
      ) {
        return { ok: false, empty: false, reason: 'invalid-host' };
      }
      if (u.port) {
        if (!/^\d{1,5}$/.test(u.port)) return { ok: false, empty: false, reason: 'invalid-port' };
        const p = Number(u.port);
        if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, empty: false, reason: 'invalid-port' };
      }
      let user = '';
      let pass = '';
      try { user = decodeURIComponent(u.username || ''); } catch { user = u.username || ''; }
      try { pass = decodeURIComponent(u.password || ''); } catch { pass = u.password || ''; }
      if (/[\u0000-\u001f\u007f]/.test(user) || /[\u0000-\u001f\u007f]/.test(pass)) {
        return { ok: false, empty: false, reason: 'control-chars' };
      }
      return { ok: true, empty: false, savedAuth: false, protocol: u.protocol };
    } catch {
      return { ok: false, empty: false, reason: 'invalid-url' };
    }
  }

  function applyNoTranslateAttrs(el) {
    if (!el || !el.setAttribute) return el;
    el.setAttribute('data-ag-no-i18n', '');
    for (const s of 'translate=no,data-no-translate=true,data-ag-localization-skip=true,data-agy-no-translate=true,data-antigravity-zh-skip=1'.split(',')) {
      const p = s.split('=');
      el.setAttribute(p[0], p[1]);
    }
    return el;
  }

  function setToggleAttr(el, name, on) {
    if (!el) return;
    if (typeof el.toggleAttribute === 'function') {
      el.toggleAttribute(name, Boolean(on));
    } else if (on) {
      el.setAttribute(name, '');
    } else {
      el.removeAttribute(name);
    }
  }

  function resolveThoughtApi() {
    if (typeof window !== 'undefined' && window.__agPrismThought) return window.__agPrismThought;
    return G.__agPrismThought || null;
  }

  function resolveHostPrism() {
    if (typeof window !== 'undefined' && window.__agPrism) return window.__agPrism;
    return G.__agPrism || null;
  }

  function hasThoughtBridge() {
    const br =
      (typeof window !== 'undefined' && window.__agPrismThoughtBridge) || G.__agPrismThoughtBridge || null;
    return Boolean(br && typeof br === 'object');
  }

  // Strictly prioritize `__agPrismThoughtBridge` over raw V8 CDP binding `__agPrismThoughtCall(jsonStr) -> void`!
  function resolveThoughtRpcCall() {
    const br =
      (typeof window !== 'undefined' && window.__agPrismThoughtBridge) || G.__agPrismThoughtBridge || null;
    if (br) {
      return (payload) => {
        const act = payload && payload.action;
        if (act === 'cache-stats' && typeof br.cacheStats === 'function') return br.cacheStats();
        if (act === 'clear-cache' && typeof br.clearCache === 'function') return br.clearCache();
        if (act === 'cancel-translate' && typeof br.cancelTranslate === 'function') return br.cancelTranslate(payload);
        if (typeof br.call === 'function') return br.call(payload);
        return Promise.resolve({ ok: false, offline: true });
      };
    }
    const rawFn =
      (typeof window !== 'undefined' && typeof window.__agPrismThoughtCall === 'function' && window.__agPrismThoughtCall) ||
      (typeof G.__agPrismThoughtCall === 'function' && G.__agPrismThoughtCall) ||
      null;
    if (rawFn) {
      return (payload) => {
        const ret = rawFn(payload);
        return ret && typeof ret.then === 'function' ? ret : Promise.resolve({ ok: false, offline: true });
      };
    }
    return null;
  }

  function resolveWorkbenchLang(doc, explicitLang, getLangFn, isZhFn) {
    if (typeof getLangFn === 'function') {
      const fromFn = normalizeLangCode(getLangFn());
      if (fromFn) return fromFn;
    }
    const fromProp = normalizeLangCode(explicitLang);
    if (fromProp) return fromProp;
    try {
      const docEl = doc && doc.documentElement;
      if (docEl && docEl.getAttribute) {
        const csLang = normalizeLangCode(docEl.getAttribute('data-ag-cs-lang'));
        if (csLang) return csLang;
        const prismLang = normalizeLangCode(docEl.getAttribute('data-ag-prism-lang'));
        if (prismLang) return prismLang;
      }
      const hostLang = normalizeLangCode(resolveHostPrism()?.getState?.()?.cfg?.language);
      if (hostLang) return hostLang;
    } catch (_) {}
    if (typeof isZhFn === 'function') {
      return isZhFn() ? 'zh-CN' : 'en';
    }
    return 'zh-CN';
  }

  function createThoughtAiConfigBox({
    mkEl,
    btnClass,
    ui = {},
    lang,
    getLang,
    isZh,
    getMode,
    hideViewBar,
    runGuardedMut,
  }) {
    const doc = typeof document !== 'undefined' ? document : G.document || null;
    if (!doc) {
      return {
        box: null,
        onModeSwitched() {},
        onViewSwitched() {},
        onLanguageChanged() {},
        ensureLoaded() {},
        reloadConfig() {
          return Promise.resolve({ ok: false });
        },
      };
    }

    const guard = typeof runGuardedMut === 'function' ? runGuardedMut : (fn) => fn();
    const modeFn = typeof getMode === 'function' ? getMode : () => 'ai';
    let currentExplicitLang = lang || '';

    const getPack = () => {
      const code = resolveWorkbenchLang(doc, currentExplicitLang, getLang, isZh);
      return WORKBENCH_I18N[code] || WORKBENCH_I18N['zh-CN'];
    };

    const box = mkEl('div', 'ag-cs-thought-cfg-box');
    box.setAttribute('data-testid', 'prism-thought-ai-config');
    applyNoTranslateAttrs(box);
    box.hidden = modeFn() !== 'ai';

    const sharedMountSlot = mkEl('div', '');
    if (sharedMountSlot.style) {
      sharedMountSlot.style.display = 'flex';
      sharedMountSlot.style.flexDirection = 'column';
      sharedMountSlot.style.gap = '10px';
    }
    box.appendChild(sharedMountSlot);

    const hostCfgView = resolveHostPrism()?.getState?.()?.cfg?.thoughtView;
    const initialApi = resolveThoughtApi();
    const initialViewMode =
      hostCfgView === 'bilingual' || hostCfgView === 'immersive'
        ? hostCfgView
        : initialApi && typeof initialApi.getViewMode === 'function'
        ? initialApi.getViewMode()
        : 'immersive';

    const initialPack = getPack();
    const state = {
      loaded: false,
      busy: false,
      viewMode: initialViewMode === 'bilingual' ? 'bilingual' : 'immersive',
      stylePreset: 'technical',
      customPrompt: '',
      proxyMode: 'auto',
      customProxyUrl: '',
      savedMaskedProxy: '',
      hasProxyCredentials: false,
      translateToolSummaries: false,
      cacheCount: 0,
      cacheDetailText: '',
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: initialPack.defaultProfName,
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasApiKey: false,
          maskedKey: '',
          draftKey: '',
        },
      ],
      fetchedModels: [],
    };

    // -1) Usage Hint & Background Bridge Status Banner
    const usageBanner = mkEl('div', 'ag-cs-thought-hint');
    usageBanner.setAttribute('data-testid', 'thought-usage-banner');
    if (usageBanner.style) {
      usageBanner.style.display = 'flex';
      usageBanner.style.flexDirection = 'column';
      usageBanner.style.gap = '4px';
      usageBanner.style.padding = '7px 10px';
      usageBanner.style.borderRadius = 'var(--ag-cs-r-md, 8px)';
      usageBanner.style.border = '1px solid var(--ag-cs-border-1, rgba(128, 128, 128, 0.22))';
      usageBanner.style.background = 'var(--ag-cs-pill-bg, rgba(128, 128, 128, 0.06))';
    }
    const usageHintEl = mkEl('p', 'ag-cs-thought-hint');
    usageHintEl.setAttribute('data-testid', 'thought-usage-hint');
    usageHintEl.textContent = ui.thoughtUsageHint || initialPack.usageHint;

    const bridgeWarnEl = mkEl('p', 'ag-cs-thought-hint');
    bridgeWarnEl.setAttribute('data-testid', 'thought-bridge-warning');
    bridgeWarnEl.setAttribute('role', 'status');
    if (bridgeWarnEl.style) {
      bridgeWarnEl.style.color = 'var(--warning, #D97706)';
      bridgeWarnEl.style.fontWeight = '500';
      bridgeWarnEl.style.opacity = '1';
    }
    usageBanner.appendChild(usageHintEl);
    usageBanner.appendChild(bridgeWarnEl);
    sharedMountSlot.appendChild(usageBanner);

    const syncUsageBanner = () => {
      const pack = getPack();
      const offline = !hasThoughtBridge();
      guard(() => {
        usageHintEl.textContent = ui.thoughtUsageHint || pack.usageHint;
        usageBanner.setAttribute('data-bridge-state', offline ? 'offline' : 'online');
        bridgeWarnEl.textContent = offline ? ui.thoughtBridgeOfflineHint || pack.bridgeOfflineHint : '';
        bridgeWarnEl.hidden = !offline;
        if (bridgeWarnEl.style) bridgeWarnEl.style.display = offline ? '' : 'none';
      });
    };

    // 0) Reading View Bar: kept in DOM for standalone/test usage; auto-hidden when parent settings-panel already renders thoughtView row
    const viewBar = mkEl('div', 'ag-cs-thought-bar');
    const hasParentViewRow =
      hideViewBar === true || Boolean(ui && (ui.optThoughtImmersive || ui.optThoughtBilingual || ui.thoughtViewTitle));
    viewBar.hidden = hasParentViewRow;

    const viewLbl = mkEl('span', 'ag-cs-thought-label');
    viewLbl.textContent = ui.thoughtViewLabel || ui.thoughtViewTitle || initialPack.viewLabel;
    const viewGrp = mkEl(
      'div',
      'inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8'
    );
    viewGrp.setAttribute('role', 'group');
    viewGrp.setAttribute('data-testid', 'thought-view-mode-group');

    const getViewLabel = (vid, pack) => {
      if (vid === 'bilingual') {
        return ui.optThoughtBilingual || ui.optViewBilingual || pack.optBilingual;
      }
      return ui.optThoughtImmersive || ui.optViewImmersive || pack.optImmersive;
    };

    const viewBtns = new Map();

    const syncViewModeUi = () => {
      guard(() => {
        const pack = getPack();
        for (const [vid, btn] of viewBtns.entries()) {
          const on = state.viewMode === vid;
          btn.setAttribute('aria-pressed', String(on));
          setToggleAttr(btn, 'data-pressed', on);
          btn.textContent = getViewLabel(vid, pack);
        }
      });
    };

    for (const vid of ['immersive', 'bilingual']) {
      const vb = doc.createElement('button');
      vb.type = 'button';
      vb.className = btnClass;
      vb.textContent = getViewLabel(vid, initialPack);
      vb.setAttribute('data-thought-view', vid);
      vb.addEventListener('click', (ev) => {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        state.viewMode = vid;
        syncViewModeUi();
        const api = resolveThoughtApi();
        if (api && typeof api.setViewMode === 'function') {
          api.setViewMode(vid);
        }
        const prism = resolveHostPrism();
        if (prism && typeof prism.saveSettingsBatch === 'function') {
          prism.saveSettingsBatch({ thoughtView: vid });
        }
      });
      viewBtns.set(vid, vb);
      viewGrp.appendChild(vb);
    }
    viewBar.appendChild(viewLbl);
    viewBar.appendChild(viewGrp);
    sharedMountSlot.appendChild(viewBar);

    // 0b) Optional "Exploring" Tool Execution Summaries Batch Translation Toggle (default false)
    const toolSumWrap = mkEl('div', 'ag-cs-thought-field');
    toolSumWrap.setAttribute('data-testid', 'thought-tool-summaries-row');
    const toolSumBar = mkEl('div', 'ag-cs-thought-bar');
    const toolSumLbl = mkEl('span', 'ag-cs-thought-label');
    toolSumLbl.textContent = ui.thoughtToolSumLabel || initialPack.toolSumLabel;
    const toolSumBtn = doc.createElement('button');
    toolSumBtn.type = 'button';
    toolSumBtn.className = 'ag-cs-thought-btn';
    toolSumBtn.setAttribute('role', 'switch');
    toolSumBtn.setAttribute('aria-checked', 'false');
    toolSumBtn.setAttribute('data-testid', 'thought-tool-summaries-toggle');
    toolSumBtn.textContent = initialPack.toolSumOff;
    const toolSumDesc = mkEl('p', 'ag-cs-thought-hint');
    toolSumDesc.setAttribute('data-testid', 'thought-tool-summaries-desc');
    toolSumDesc.textContent = ui.thoughtToolSumDesc || initialPack.toolSumDesc;

    const syncToolSumUi = () => {
      const pack = getPack();
      const on = Boolean(state.translateToolSummaries);
      guard(() => {
        toolSumLbl.textContent = ui.thoughtToolSumLabel || pack.toolSumLabel;
        toolSumDesc.textContent = ui.thoughtToolSumDesc || pack.toolSumDesc;
        toolSumBtn.setAttribute('aria-checked', String(on));
        setToggleAttr(toolSumBtn, 'data-pressed', on);
        if (on) toolSumBtn.setAttribute('data-primary', '1');
        else toolSumBtn.removeAttribute('data-primary');
        toolSumBtn.textContent = on ? pack.toolSumOn : pack.toolSumOff;
      });
    };

    toolSumBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const next = !state.translateToolSummaries;
      state.translateToolSummaries = next;
      syncToolSumUi();
      const api = resolveThoughtApi();
      if (api && typeof api.setTranslateToolSummaries === 'function') {
        api.setTranslateToolSummaries(next, { persistDaemon: false });
      }
      if (api && typeof api.saveConfig === 'function' && !state.busy) {
        void api.saveConfig({ translateToolSummaries: next }).catch(() => {});
      }
    });

    toolSumBar.appendChild(toolSumLbl);
    toolSumBar.appendChild(toolSumBtn);
    toolSumWrap.appendChild(toolSumBar);
    toolSumWrap.appendChild(toolSumDesc);
    sharedMountSlot.appendChild(toolSumWrap);

    // 0c) Custom Proxy URL Setting (HTTP / HTTPS / SOCKS5 / SOCKS5H + Auto / Custom / Direct mode + live validation)
    const proxyWrap = mkEl('div', 'ag-cs-thought-field');
    proxyWrap.setAttribute('data-testid', 'thought-custom-proxy-section');
    const proxyHeaderBar = mkEl('div', 'ag-cs-thought-bar');
    const proxyLbl = mkEl('span', 'ag-cs-thought-label');
    proxyLbl.textContent = ui.thoughtProxyLabel || initialPack.proxyLabel;
    const proxyModeGrp = mkEl(
      'div',
      'inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8'
    );
    proxyModeGrp.setAttribute('role', 'group');
    proxyModeGrp.setAttribute('data-testid', 'thought-proxy-mode-group');

    const proxyModeBtns = new Map();
    const getProxyModeLabel = (mid, pack) => {
      if (mid === 'custom') return pack.proxyModeCustom;
      if (mid === 'direct') return pack.proxyModeDirect;
      return pack.proxyModeAuto;
    };

    const proxyInputRow = mkEl('div', 'ag-cs-thought-input-row');
    const proxyInput = doc.createElement('input');
    proxyInput.type = 'text';
    proxyInput.className = 'ag-cs-thought-input';
    proxyInput.setAttribute('data-mono', '1');
    proxyInput.setAttribute('data-testid', 'thought-custom-proxy-url');
    proxyInput.placeholder = 'http://127.0.0.1:7890 | socks5://127.0.0.1:1080';

    const clearProxyBtn = doc.createElement('button');
    clearProxyBtn.type = 'button';
    clearProxyBtn.className = 'ag-cs-thought-btn';
    clearProxyBtn.setAttribute('data-testid', 'thought-clear-proxy-btn');
    clearProxyBtn.textContent = initialPack.proxyClearBtn;
    clearProxyBtn.hidden = true;
    if (clearProxyBtn.style) clearProxyBtn.style.display = 'none';

    const proxyHintEl = mkEl('p', 'ag-cs-thought-hint');
    proxyHintEl.setAttribute('data-testid', 'thought-custom-proxy-hint');
    proxyHintEl.textContent = initialPack.proxyHintAuto;

    const syncProxyUi = () => {
      const pack = getPack();
      const rawVal = String(state.customProxyUrl || '').trim();
      const check = validateCustomProxyInput(rawVal, state.savedMaskedProxy);
      guard(() => {
        proxyLbl.textContent = ui.thoughtProxyLabel || pack.proxyLabel;
        clearProxyBtn.textContent = pack.proxyClearBtn;
        for (const [mid, btn] of proxyModeBtns.entries()) {
          const on = state.proxyMode === mid;
          btn.setAttribute('aria-pressed', String(on));
          setToggleAttr(btn, 'data-pressed', on);
          btn.textContent = getProxyModeLabel(mid, pack);
        }
        if (proxyInput.value !== state.customProxyUrl) proxyInput.value = state.customProxyUrl;
        const isDirect = state.proxyMode === 'direct';
        proxyInput.disabled = isDirect;
        const showClear = Boolean(rawVal && !isDirect);
        clearProxyBtn.hidden = !showClear;
        if (clearProxyBtn.style) clearProxyBtn.style.display = showClear ? '' : 'none';

        if (isDirect) {
          proxyHintEl.setAttribute('data-state', 'idle');
          proxyHintEl.textContent = pack.proxyHintDirect;
          if (proxyHintEl.style) proxyHintEl.style.color = '';
        } else if (!rawVal) {
          proxyHintEl.setAttribute('data-state', 'idle');
          proxyHintEl.textContent = pack.proxyHintAuto;
          if (proxyHintEl.style) proxyHintEl.style.color = '';
        } else if (check.ok) {
          proxyHintEl.setAttribute('data-state', 'ok');
          proxyHintEl.textContent = check.savedAuth || state.hasProxyCredentials ? pack.proxyHintSavedAuth : pack.proxyHintValid;
          if (proxyHintEl.style) proxyHintEl.style.color = 'var(--success, #50A37B)';
        } else {
          proxyHintEl.setAttribute('data-state', 'err');
          proxyHintEl.textContent = pack.proxyHintInvalid;
          if (proxyHintEl.style) proxyHintEl.style.color = 'var(--error, #E5534B)';
        }
      });
    };

    for (const mid of ['auto', 'custom', 'direct']) {
      const pb = doc.createElement('button');
      pb.type = 'button';
      pb.className = btnClass;
      pb.textContent = getProxyModeLabel(mid, initialPack);
      pb.setAttribute('data-proxy-mode', mid);
      pb.addEventListener('click', (ev) => {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        state.proxyMode = mid;
        syncProxyUi();
      });
      proxyModeBtns.set(mid, pb);
      proxyModeGrp.appendChild(pb);
    }

    proxyInput.addEventListener('input', () => {
      state.customProxyUrl = proxyInput.value;
      if (state.customProxyUrl.trim() && state.proxyMode === 'direct') {
        state.proxyMode = 'custom';
      }
      if (state.customProxyUrl.trim() !== state.savedMaskedProxy) {
        state.hasProxyCredentials = false;
      }
      syncProxyUi();
    });

    clearProxyBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      state.customProxyUrl = '';
      state.savedMaskedProxy = '';
      state.hasProxyCredentials = false;
      if (state.proxyMode === 'custom') state.proxyMode = 'auto';
      syncProxyUi();
    });

    proxyHeaderBar.appendChild(proxyLbl);
    proxyHeaderBar.appendChild(proxyModeGrp);
    proxyInputRow.appendChild(proxyInput);
    proxyInputRow.appendChild(clearProxyBtn);
    proxyWrap.appendChild(proxyHeaderBar);
    proxyWrap.appendChild(proxyInputRow);
    proxyWrap.appendChild(proxyHintEl);
    sharedMountSlot.appendChild(proxyWrap);

    // 1) Style Preset Bar + Conditional Local Custom Prompt Textarea
    const styleBar = mkEl('div', 'ag-cs-thought-bar');
    const styleLbl = mkEl('span', 'ag-cs-thought-label');
    styleLbl.textContent = ui.thoughtStyleLabel || initialPack.styleLabel;
    const styleGrp = mkEl(
      'div',
      'inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8'
    );
    styleGrp.setAttribute('role', 'group');

    const getStyleLabel = (sid, pack) => {
      if (sid === 'concise') return ui.optStyleConcise || pack.optConcise;
      if (sid === 'custom') return ui.optStyleCustom || pack.optCustom;
      return ui.optStyleTech || pack.optTech;
    };

    const styleBtns = new Map();

    const customField = mkEl('div', 'ag-cs-thought-field');
    const customTa = doc.createElement('textarea');
    customTa.className = 'ag-cs-thought-textarea';
    customTa.setAttribute('data-testid', 'thought-custom-prompt');
    customTa.placeholder = ui.thoughtCustomPromptPh || initialPack.customPromptPh;
    customTa.addEventListener('input', () => {
      state.customPrompt = customTa.value;
    });
    customField.appendChild(customTa);

    const syncStyleUi = () => {
      guard(() => {
        const pack = getPack();
        for (const [sid, btn] of styleBtns.entries()) {
          const on = state.stylePreset === sid;
          btn.setAttribute('aria-pressed', String(on));
          setToggleAttr(btn, 'data-pressed', on);
          btn.textContent = getStyleLabel(sid, pack);
        }
        customField.hidden = state.stylePreset !== 'custom';
        if (customTa.value !== state.customPrompt) customTa.value = state.customPrompt;
      });
    };

    for (const sid of ['technical', 'concise', 'custom']) {
      const sb = doc.createElement('button');
      sb.type = 'button';
      sb.className = btnClass;
      sb.textContent = getStyleLabel(sid, initialPack);
      sb.setAttribute('data-thought-style', sid);
      sb.addEventListener('click', (ev) => {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        state.stylePreset = sid;
        syncStyleUi();
      });
      styleBtns.set(sid, sb);
      styleGrp.appendChild(sb);
    }
    styleBar.appendChild(styleLbl);
    styleBar.appendChild(styleGrp);
    box.appendChild(styleBar);
    box.appendChild(customField);

    // 2) Multi-Profile Selector Pills + Add/Delete
    const profBar = mkEl('div', 'ag-cs-thought-bar');
    const profLbl = mkEl('span', 'ag-cs-thought-label');
    profLbl.textContent = ui.thoughtProfilesLabel || initialPack.profilesLabel;
    const profPills = mkEl('div', 'ag-cs-thought-profiles');
    profBar.appendChild(profLbl);
    profBar.appendChild(profPills);
    box.appendChild(profBar);

    // 3) 2x2 Form Grid: Name, Base URL, API Key, Model + Fetch Models
    const grid = mkEl('div', 'ag-cs-thought-grid');

    const mkField = (labelText, inputEl, extraRightEl) => {
      const wrap = mkEl('div', 'ag-cs-thought-field');
      const lbl = doc.createElement('label');
      const lblSpan = doc.createElement('span');
      lblSpan.textContent = labelText;
      lbl.appendChild(lblSpan);
      if (extraRightEl) lbl.appendChild(extraRightEl);
      wrap.appendChild(lbl);
      wrap.appendChild(inputEl);
      return { wrap, lblSpan };
    };

    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ag-cs-thought-input';
    nameInput.setAttribute('data-testid', 'thought-prof-name');
    nameInput.placeholder = initialPack.fieldNamePh;

    const urlInput = doc.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'ag-cs-thought-input';
    urlInput.setAttribute('data-mono', '1');
    urlInput.setAttribute('data-testid', 'thought-base-url');
    urlInput.placeholder = 'https://api.openai.com/v1';

    const keyRightWrap = mkEl('span', 'inline-flex items-center gap-1.5');
    const keyMetaBadge = mkEl('span', 'text-[11px] opacity-80');
    const clearKeyBtn = doc.createElement('button');
    clearKeyBtn.type = 'button';
    clearKeyBtn.className = 'ag-cs-thought-btn';
    clearKeyBtn.setAttribute('data-testid', 'thought-clear-key-btn');
    clearKeyBtn.hidden = true;
    if (clearKeyBtn.style) {
      clearKeyBtn.style.display = 'none';
      clearKeyBtn.style.fontSize = '10.5px';
      clearKeyBtn.style.padding = '0 5px';
      clearKeyBtn.style.minHeight = '18px';
      clearKeyBtn.style.lineHeight = '16px';
    }
    clearKeyBtn.textContent = initialPack.clearKeyBtn;
    keyRightWrap.appendChild(keyMetaBadge);
    keyRightWrap.appendChild(clearKeyBtn);

    const keyInput = doc.createElement('input');
    keyInput.type = 'password';
    keyInput.autocomplete = 'off';
    keyInput.className = 'ag-cs-thought-input';
    keyInput.setAttribute('data-mono', '1');
    keyInput.setAttribute('data-testid', 'thought-api-key');
    keyInput.placeholder = 'sk-...';

    const modelRow = mkEl('div', 'ag-cs-thought-input-row');
    const modelInput = doc.createElement('input');
    modelInput.type = 'text';
    modelInput.className = 'ag-cs-thought-input';
    modelInput.setAttribute('data-mono', '1');
    modelInput.setAttribute('data-testid', 'thought-model-input');
    modelInput.placeholder = 'gpt-4o-mini';

    const fetchModelsBtn = doc.createElement('button');
    fetchModelsBtn.type = 'button';
    fetchModelsBtn.className = 'ag-cs-thought-btn';
    fetchModelsBtn.setAttribute('data-testid', 'thought-fetch-models-btn');
    fetchModelsBtn.textContent = ui.thoughtFetchModelsBtn || initialPack.fetchModels;
    modelRow.appendChild(modelInput);
    modelRow.appendChild(fetchModelsBtn);

    const modelSelectWrap = mkEl('div', 'ag-cs-thought-field');
    modelSelectWrap.setAttribute('data-span', '2');
    modelSelectWrap.hidden = true;
    const modelSelect = doc.createElement('select');
    modelSelect.className = 'ag-cs-thought-select';
    modelSelect.setAttribute('data-testid', 'thought-model-select');
    modelSelectWrap.appendChild(modelSelect);

    const nameField = mkField(ui.thoughtFieldName || initialPack.fieldName, nameInput);
    const urlField = mkField(ui.thoughtFieldBaseUrl || 'Base URL', urlInput);
    const keyField = mkField(ui.thoughtFieldApiKey || 'API Key', keyInput, keyRightWrap);
    const modelField = mkField(ui.thoughtFieldModel || 'Model ID', modelRow);

    grid.appendChild(nameField.wrap);
    grid.appendChild(urlField.wrap);
    grid.appendChild(keyField.wrap);
    grid.appendChild(modelField.wrap);
    grid.appendChild(modelSelectWrap);
    box.appendChild(grid);

    // 4) Action Buttons + Dual-End Cache Stats / Clear + Live Status Badge
    const actRow = mkEl('div', 'ag-cs-thought-actions');
    const btnGrp = mkEl('div', 'ag-cs-thought-btn-group');

    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ag-cs-thought-btn';
    saveBtn.setAttribute('data-primary', '1');
    saveBtn.setAttribute('data-testid', 'thought-save-btn');
    saveBtn.textContent = ui.thoughtSaveBtn || initialPack.saveBtn;

    const testBtn = doc.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'ag-cs-thought-btn';
    testBtn.setAttribute('data-testid', 'thought-test-btn');
    testBtn.textContent = ui.thoughtTestBtn || initialPack.testBtn;

    const clearCacheBtn = doc.createElement('button');
    clearCacheBtn.type = 'button';
    clearCacheBtn.className = 'ag-cs-thought-btn';
    clearCacheBtn.setAttribute('data-testid', 'thought-clear-cache-btn');
    clearCacheBtn.textContent = ui.thoughtClearCacheBtn || initialPack.clearCacheBtn;

    const cacheStatsBadge = mkEl('span', 'ag-cs-thought-cache-badge');
    cacheStatsBadge.setAttribute('data-testid', 'thought-cache-stats');
    if (cacheStatsBadge.style) {
      cacheStatsBadge.style.fontSize = '11px';
      cacheStatsBadge.style.opacity = '0.75';
      cacheStatsBadge.style.alignSelf = 'center';
      cacheStatsBadge.style.padding = '0 4px';
    }
    cacheStatsBadge.textContent = initialPack.cacheBadge(0);

    btnGrp.appendChild(saveBtn);
    btnGrp.appendChild(testBtn);
    btnGrp.appendChild(clearCacheBtn);
    btnGrp.appendChild(cacheStatsBadge);

    const statusBadge = mkEl('span', 'ag-cs-thought-status');
    statusBadge.setAttribute('data-testid', 'thought-status-badge');
    statusBadge.hidden = true;

    actRow.appendChild(btnGrp);
    actRow.appendChild(statusBadge);
    box.appendChild(actRow);

    const privHint = mkEl('p', 'ag-cs-thought-hint');
    privHint.textContent = ui.thoughtPrivacyHint || initialPack.privacyHint;
    box.appendChild(privHint);

    const setStatus = (kind, msg) => {
      guard(() => {
        if (!msg) {
          statusBadge.hidden = true;
          statusBadge.textContent = '';
          return;
        }
        statusBadge.hidden = false;
        statusBadge.setAttribute('data-state', kind);
        statusBadge.textContent = msg;
        statusBadge.title = msg;
      });
    };

    const renderCacheBadge = (count, detailTitle = '') => {
      const n = Math.max(0, Number(count) || 0);
      state.cacheCount = n;
      state.cacheDetailText = detailTitle || '';
      const pack = getPack();
      guard(() => {
        cacheStatsBadge.textContent =
          typeof ui.thoughtCacheBadgeFmt === 'function' ? ui.thoughtCacheBadgeFmt(n) : pack.cacheBadge(n);
        cacheStatsBadge.title = state.cacheDetailText;
      });
    };

    const refreshCacheStats = () => {
      const api = resolveThoughtApi();
      const localStats =
        api && typeof api.getLocalCacheStats === 'function' ? api.getLocalCacheStats() : { memEntries: 0 };
      const localCount = Number(localStats?.memEntries) || 0;
      const rpcCall = resolveThoughtRpcCall();
      if (!rpcCall) {
        renderCacheBadge(localCount);
        return Promise.resolve({ ok: true, localOnly: true, count: localCount });
      }
      return Promise.resolve()
        .then(() => rpcCall({ action: 'cache-stats' }))
        .then((res) => {
          const daemonCount =
            res && res.ok && typeof (res.entries ?? res.count) === 'number'
              ? Number(res.entries ?? res.count)
              : null;
          if (daemonCount !== null) {
            const total = Math.max(localCount, daemonCount);
            const kb = res.diskBytes ? `${(res.diskBytes / 1024).toFixed(1)} KB` : '';
            const pack = getPack();
            const detail = pack.cacheDetail(localCount, daemonCount, kb);
            renderCacheBadge(total, detail);
            return { ok: true, localOnly: false, count: total };
          }
          renderCacheBadge(localCount);
          return { ok: true, localOnly: true, count: localCount };
        })
        .catch(() => {
          renderCacheBadge(localCount);
          return { ok: true, localOnly: true, count: localCount };
        });
    };

    const getActiveProfile = () => state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];

    const syncKeyHintForUrl = (cur) => {
      if (!cur) return;
      const pack = getPack();
      guard(() => {
        const showClearBtn = Boolean(cur.hasApiKey && !cur.draftKey && !cur.clearSavedKey);
        clearKeyBtn.hidden = !showClearBtn;
        if (clearKeyBtn.style) clearKeyBtn.style.display = showClearBtn ? '' : 'none';
        clearKeyBtn.textContent = ui.thoughtClearKeyBtn || pack.clearKeyBtn;

        if (cur.clearSavedKey && !cur.draftKey) {
          keyInput.placeholder = isLocalKeylessUrl(cur.baseUrl)
            ? ui.thoughtKeylessPh || pack.keylessPh
            : 'sk-...';
          keyMetaBadge.textContent = pack.keyClearedBadge;
        } else if (cur.hasApiKey && cur.maskedKey && !cur.draftKey) {
          keyInput.placeholder = pack.savedKeyPh(cur.maskedKey);
          keyMetaBadge.textContent = `✓ ${cur.maskedKey}`;
        } else if (!cur.draftKey && isLocalKeylessUrl(cur.baseUrl)) {
          keyInput.placeholder = ui.thoughtKeylessPh || pack.keylessPh;
          keyMetaBadge.textContent = ui.thoughtKeylessBadge || pack.keylessBadge;
        } else {
          keyInput.placeholder = 'sk-...';
          keyMetaBadge.textContent = '';
        }
      });
    };

    clearKeyBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const cur = getActiveProfile();
      if (!cur) return;
      cur.clearSavedKey = true;
      cur.draftKey = '';
      keyInput.value = '';
      syncKeyHintForUrl(cur);
    });

    const syncFormIntoProfile = () => {
      const cur = getActiveProfile();
      if (!cur) return;
      cur.name = nameInput.value.trim() || cur.name || 'Profile';
      cur.baseUrl = urlInput.value.trim() || 'https://api.openai.com/v1';
      cur.model = modelInput.value.trim();
      if (keyInput.value.trim()) {
        cur.draftKey = keyInput.value.trim();
      }
    };

    const renderProfilePillsAndForm = () => {
      const pack = getPack();
      guard(() => {
        while (profPills.firstChild) profPills.removeChild(profPills.firstChild);
        for (const p of state.profiles) {
          const chip = doc.createElement('button');
          chip.type = 'button';
          chip.className = 'ag-cs-thought-prof-chip';
          chip.setAttribute('data-profile-id', p.id);
          chip.setAttribute('data-active', p.id === state.activeProfileId ? '1' : '0');
          chip.textContent = p.name || p.id;
          chip.addEventListener('click', (ev) => {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            syncFormIntoProfile();
            state.activeProfileId = p.id;
            state.fetchedModels = [];
            modelSelectWrap.hidden = true;
            renderProfilePillsAndForm();
          });
          profPills.appendChild(chip);
        }

        const addBtn = doc.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'ag-cs-thought-btn';
        addBtn.setAttribute('data-testid', 'thought-add-profile-btn');
        addBtn.textContent = ui.thoughtAddProfileBtn || pack.addProfile;
        addBtn.addEventListener('click', (ev) => {
          if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
          syncFormIntoProfile();
          const curPack = getPack();
          const nextNum = state.profiles.length + 1;
          const newId = `prof_${Date.now().toString(36)}_${nextNum}`;
          state.profiles.push({
            id: newId,
            name: `${curPack.customProfPrefix} ${nextNum}`,
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            hasApiKey: false,
            maskedKey: '',
            draftKey: '',
          });
          state.activeProfileId = newId;
          state.fetchedModels = [];
          modelSelectWrap.hidden = true;
          renderProfilePillsAndForm();
        });
        profPills.appendChild(addBtn);

        if (state.profiles.length > 1) {
          const delBtn = doc.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'ag-cs-thought-btn';
          delBtn.setAttribute('data-danger', '1');
          delBtn.setAttribute('data-testid', 'thought-del-profile-btn');
          delBtn.textContent = ui.thoughtDelProfileBtn || pack.delProfile;
          delBtn.addEventListener('click', (ev) => {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            if (state.profiles.length <= 1) return;
            state.profiles = state.profiles.filter((item) => item.id !== state.activeProfileId);
            state.activeProfileId = state.profiles[0].id;
            renderProfilePillsAndForm();
          });
          profPills.appendChild(delBtn);
        }

        const cur = getActiveProfile();
        if (cur) {
          nameInput.value = cur.name || '';
          urlInput.value = cur.baseUrl || 'https://api.openai.com/v1';
          modelInput.value = cur.model || '';
          keyInput.value = cur.draftKey || '';
          syncKeyHintForUrl(cur);
        }
      });
    };

    const refreshStaticLabels = () => {
      const pack = getPack();
      guard(() => {
        viewLbl.textContent = ui.thoughtViewLabel || ui.thoughtViewTitle || pack.viewLabel;
        styleLbl.textContent = ui.thoughtStyleLabel || pack.styleLabel;
        customTa.placeholder = ui.thoughtCustomPromptPh || pack.customPromptPh;
        profLbl.textContent = ui.thoughtProfilesLabel || pack.profilesLabel;
        nameField.lblSpan.textContent = ui.thoughtFieldName || pack.fieldName;
        nameInput.placeholder = pack.fieldNamePh;
        fetchModelsBtn.textContent = ui.thoughtFetchModelsBtn || pack.fetchModels;
        saveBtn.textContent = ui.thoughtSaveBtn || pack.saveBtn;
        testBtn.textContent = ui.thoughtTestBtn || pack.testBtn;
        clearCacheBtn.textContent = ui.thoughtClearCacheBtn || pack.clearCacheBtn;
        privHint.textContent = ui.thoughtPrivacyHint || pack.privacyHint;
      });
      syncUsageBanner();
      syncViewModeUi();
      syncToolSumUi();
      syncProxyUi();
      syncStyleUi();
      renderProfilePillsAndForm();
      renderCacheBadge(state.cacheCount, state.cacheDetailText);
    };

    nameInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) {
        cur.name = nameInput.value;
        const activeChip =
          profPills.querySelector && profPills.querySelector(`[data-profile-id="${cur.id}"]`);
        if (activeChip) activeChip.textContent = cur.name.trim() || cur.id;
      }
    });
    urlInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) {
        cur.baseUrl = urlInput.value;
        syncKeyHintForUrl(cur);
      }
    });
    modelInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) cur.model = modelInput.value;
    });
    keyInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) {
        cur.draftKey = keyInput.value;
        if (cur.draftKey.trim()) cur.clearSavedKey = false;
        syncKeyHintForUrl(cur);
      }
    });
    modelSelect.addEventListener('change', () => {
      if (modelSelect.value) {
        modelInput.value = modelSelect.value;
        const cur = getActiveProfile();
        if (cur) cur.model = modelSelect.value;
      }
    });

    const applySanitizedConfig = (res) => {
      if (!res || !res.ok) return;
      state.loaded = true;
      const mappedPreset = res.stylePreset === 'tech' ? 'technical' : res.stylePreset;
      state.stylePreset = ['technical', 'concise', 'custom'].includes(mappedPreset) ? mappedPreset : 'technical';
      const hostView = resolveHostPrism()?.getState?.()?.cfg?.thoughtView;
      const api = resolveThoughtApi();
      const clientView = api && typeof api.getViewMode === 'function' ? api.getViewMode() : null;
      if (hostView === 'bilingual' || hostView === 'immersive') {
        state.viewMode = hostView;
      } else if (res.viewMode === 'bilingual' || res.viewMode === 'immersive') {
        state.viewMode = clientView || res.viewMode;
      }
      state.customPrompt = typeof res.customPrompt === 'string' ? res.customPrompt : '';
      if (['auto', 'custom', 'direct'].includes(res.proxyMode)) {
        state.proxyMode = res.proxyMode;
      }
      if (typeof res.customProxyUrl === 'string') {
        state.customProxyUrl = res.customProxyUrl;
        state.savedMaskedProxy = res.hasProxyCredentials ? res.customProxyUrl : '';
      }
      state.hasProxyCredentials = Boolean(res.hasProxyCredentials);
      if (typeof res.translateToolSummaries === 'boolean') {
        state.translateToolSummaries = res.translateToolSummaries;
      }
      if (Array.isArray(res.profiles) && res.profiles.length > 0) {
        state.profiles = res.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
          hasApiKey: Boolean(p.hasApiKey),
          maskedKey: p.maskedKey || '',
          draftKey: '',
          clearSavedKey: false,
        }));
      }
      state.activeProfileId = state.profiles.some((p) => p.id === res.activeProfileId)
        ? res.activeProfileId
        : state.profiles[0].id;
      syncViewModeUi();
      syncToolSumUi();
      syncProxyUi();
      syncStyleUi();
      renderProfilePillsAndForm();
    };

    const buildSavePayload = () => {
      syncFormIntoProfile();
      return {
        stylePreset: state.stylePreset,
        viewMode: state.viewMode,
        customPrompt: state.customPrompt,
        proxyMode: state.proxyMode,
        customProxyUrl: String(state.customProxyUrl || '').trim(),
        translateToolSummaries: Boolean(state.translateToolSummaries),
        activeProfileId: state.activeProfileId,
        profiles: state.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
          apiKey: p.draftKey || '',
          keepExistingKey: Boolean(!p.draftKey && !p.clearSavedKey),
        })),
      };
    };

    const reloadConfig = () => {
      state.loaded = false;
      syncUsageBanner();
      const hostView = resolveHostPrism()?.getState?.()?.cfg?.thoughtView;
      if (hostView === 'bilingual' || hostView === 'immersive') {
        state.viewMode = hostView;
        syncViewModeUi();
      }
      void refreshCacheStats();
      const api = resolveThoughtApi();
      if (!api || typeof api.getConfig !== 'function') {
        return Promise.resolve({ ok: false });
      }
      return api.getConfig().then((res) => {
        if (res && res.ok) applySanitizedConfig(res);
        return res;
      });
    };

    const ensureLoaded = () => {
      syncUsageBanner();
      const hostView = resolveHostPrism()?.getState?.()?.cfg?.thoughtView;
      if (hostView === 'bilingual' || hostView === 'immersive') {
        state.viewMode = hostView;
        syncViewModeUi();
      }
      void refreshCacheStats();
      if (state.loaded) return;
      const api = resolveThoughtApi();
      if (!api || typeof api.getConfig !== 'function') return;
      void api.getConfig().then((res) => {
        if (res && res.ok) applySanitizedConfig(res);
      });
    };

    fetchModelsBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = resolveThoughtApi();
      if (!api || typeof api.fetchModels !== 'function' || state.busy) return;
      syncFormIntoProfile();
      const cur = getActiveProfile();
      const pack = getPack();
      if (state.proxyMode !== 'direct' && !validateCustomProxyInput(state.customProxyUrl, state.savedMaskedProxy).ok) {
        setStatus('err', pack.proxyHintInvalid);
        return;
      }
      state.busy = true;
      fetchModelsBtn.disabled = true;
      setStatus('idle', pack.fetchingModels);
      void api
        .fetchModels({
          profileId: cur?.id,
          baseUrl: cur?.baseUrl,
          apiKey: cur?.draftKey || '',
          proxyMode: state.proxyMode,
          customProxyUrl: String(state.customProxyUrl || '').trim(),
        })
        .then((res) => {
          const curPack = getPack();
          if (res && res.ok && Array.isArray(res.models)) {
            state.fetchedModels = res.models;
            guard(() => {
              while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
              const placeholderOpt = doc.createElement('option');
              placeholderOpt.value = '';
              placeholderOpt.textContent = curPack.quickSelect(res.models.length);
              modelSelect.appendChild(placeholderOpt);
              for (const mid of res.models) {
                const opt = doc.createElement('option');
                opt.value = mid;
                opt.textContent = mid;
                if (cur && cur.model === mid) opt.selected = true;
                modelSelect.appendChild(opt);
              }
              modelSelectWrap.hidden = res.models.length === 0;
              if (
                res.models.length > 0 &&
                (!cur.model || cur.model === 'gpt-4o-mini') &&
                !res.models.includes(cur.model)
              ) {
                cur.model = res.models[0];
                modelInput.value = res.models[0];
              }
            });
            setStatus('ok', curPack.fetchOk(res.models.length, res.latencyMs || 0));
          } else {
            setStatus('err', `✕ ${res?.error || curPack.fetchErr}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (fetchModelsBtn.isConnected !== false) fetchModelsBtn.disabled = false;
        });
    });

    saveBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = resolveThoughtApi();
      if (!api || typeof api.saveConfig !== 'function' || state.busy) return;
      const pack = getPack();
      if (state.proxyMode !== 'direct' && !validateCustomProxyInput(state.customProxyUrl, state.savedMaskedProxy).ok) {
        setStatus('err', pack.proxyHintInvalid);
        return;
      }
      state.busy = true;
      saveBtn.disabled = true;
      setStatus('idle', pack.savingCfg);
      void api
        .saveConfig(buildSavePayload())
        .then((res) => {
          const curPack = getPack();
          if (res && res.ok) {
            applySanitizedConfig(res);
            const cur = getActiveProfile();
            setStatus('ok', curPack.saveOk(cur?.name, cur?.model));
            try {
              api.scan?.();
            } catch {}
          } else {
            setStatus('err', `✕ ${res?.error || curPack.saveErr}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (saveBtn.isConnected !== false) saveBtn.disabled = false;
        });
    });

    testBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = resolveThoughtApi();
      if (!api || typeof api.testConnection !== 'function' || state.busy) return;
      const pack = getPack();
      if (state.proxyMode !== 'direct' && !validateCustomProxyInput(state.customProxyUrl, state.savedMaskedProxy).ok) {
        setStatus('err', pack.proxyHintInvalid);
        return;
      }
      state.busy = true;
      testBtn.disabled = true;
      setStatus('idle', pack.testingConn);
      const payload = buildSavePayload();
      void api
        .saveConfig(payload)
        .then((savedRes) => {
          if (savedRes && savedRes.ok) applySanitizedConfig(savedRes);
          const cur = getActiveProfile();
          return api.testConnection({
            profileId: cur?.id,
            baseUrl: cur?.baseUrl,
            model: cur?.model,
            proxyMode: state.proxyMode,
            customProxyUrl: String(state.customProxyUrl || '').trim(),
          });
        })
        .then((res) => {
          const curPack = getPack();
          if (res && res.ok) {
            setStatus('ok', curPack.testOk(res.latencyMs, res.model, res.reply));
          } else {
            setStatus('err', `✕ ${res?.error || curPack.testErr}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (testBtn.isConnected !== false) testBtn.disabled = false;
        });
    });

    clearCacheBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      if (state.busy) return;
      state.busy = true;
      clearCacheBtn.disabled = true;

      const api = resolveThoughtApi();
      if (api && typeof api.clearLocalCache === 'function') {
        api.clearLocalCache();
      }

      const rpcCall = resolveThoughtRpcCall();
      const daemonClear = rpcCall
        ? Promise.resolve()
            .then(() => rpcCall({ action: 'clear-cache' }))
            .catch(() => ({ ok: false, offline: true }))
        : Promise.resolve({ ok: false, offline: true });

      void daemonClear
        .then((res) => {
          const curPack = getPack();
          renderCacheBadge(0);
          if (res && res.ok) {
            setStatus('ok', curPack.clearDualOk);
          } else {
            setStatus('ok', curPack.clearLocalOk);
          }
        })
        .finally(() => {
          state.busy = false;
          if (clearCacheBtn.isConnected !== false) clearCacheBtn.disabled = false;
        });
    });

    let machineBox = null;
    const syncModeLayout = (nextMode) => {
      guard(() => {
        box.hidden = nextMode !== 'ai';
        const hostParent = box.parentElement || null;
        if (nextMode === 'machine' && hostParent && typeof hostParent.appendChild === 'function') {
          if (!machineBox) {
            machineBox = mkEl('div', 'ag-cs-thought-cfg-box');
            machineBox.setAttribute('data-testid', 'prism-thought-general-config');
            applyNoTranslateAttrs(machineBox);
          }
          if (machineBox.parentElement !== hostParent) {
            hostParent.appendChild(machineBox);
          }
          machineBox.hidden = false;
          if (sharedMountSlot.parentElement !== machineBox) machineBox.appendChild(sharedMountSlot);
          if (actRow.parentElement !== machineBox) machineBox.appendChild(actRow);
          testBtn.hidden = true;
          if (testBtn.style) testBtn.style.display = 'none';
        } else {
          if (sharedMountSlot.parentElement !== box) {
            if (typeof box.insertBefore === 'function' && styleBar.parentElement === box) {
              box.insertBefore(sharedMountSlot, styleBar);
            } else {
              box.appendChild(sharedMountSlot);
            }
          }
          if (actRow.parentElement !== box) {
            if (typeof box.insertBefore === 'function' && privHint.parentElement === box) {
              box.insertBefore(actRow, privHint);
            } else {
              box.appendChild(actRow);
            }
          }
          testBtn.hidden = false;
          if (testBtn.style) testBtn.style.display = '';
          if (machineBox && machineBox.parentElement) {
            machineBox.remove();
          }
        }
      });
    };

    syncUsageBanner();
    syncViewModeUi();
    syncToolSumUi();
    syncProxyUi();
    syncStyleUi();
    renderProfilePillsAndForm();
    if (!box.hidden) ensureLoaded();

    return {
      box,
      ensureLoaded,
      reloadConfig,
      refreshCacheStats,
      onViewSwitched(nextView) {
        if (nextView !== 'bilingual' && nextView !== 'immersive') return;
        state.viewMode = nextView;
        syncViewModeUi();
      },
      onLanguageChanged(nextLang) {
        if (nextLang) currentExplicitLang = nextLang;
        refreshStaticLabels();
      },
      onModeSwitched(nextMode) {
        syncModeLayout(nextMode);
        syncUsageBanner();
        if (nextMode === 'ai' || nextMode === 'machine') ensureLoaded();
      },
    };
  }

  G.__agPrismThoughtSettingsUi = { createThoughtAiConfigBox, isLocalKeylessUrl, validateCustomProxyInput };
})(typeof globalThis !== 'undefined' ? globalThis : window);
