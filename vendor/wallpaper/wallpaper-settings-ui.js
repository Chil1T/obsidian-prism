// Obsidian Prism — Channel 7 Local Static/Dynamic Wallpaper Settings Card UI (v1.0.7-beta.4 · Beta, Five-Locale, 0 innerHTML)
// Exposes globalThis.__prismMountWallpaperUi(slotEl, ctx) and window.__prismMountWallpaperUi(slotEl, ctx)

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
  if (!G) return;

  const NO_TR_ATTRS = [
    ['translate', 'no'],
    ['data-no-translate', 'true'],
    ['data-ag-localization-skip', 'true'],
    ['data-agy-no-translate', 'true'],
    ['data-antigravity-zh-skip', '1'],
    ['data-ag-no-i18n', ''],
  ];

  const I18N_KEYS =
    'title|desc|enableLabel|on|off|pickBtn|applyBtn|clearBtn|pathPh|opacityLabel|blurLabel|dimLabel|fitLabel|fitCover|fitContain|pauseBlurLabel|pauseBlurDesc|stIdle|stOffline|stActiveImg|stActiveVid|stBlobFallback|stVideoBlocked|stManualLinux|stCanceled|stPicking|stSaving|stCleared|errUnsupportedExt|errSensitivePath|errSymlink|errUncDevice|errNotFound|errInvalidMagic|errTooLarge|errBlobTooLarge|errGeneric'.split(
      '|'
    );

  const I18N_ROWS = {
    'zh-CN':
      '自定义静态 / 动态背景壁纸 (Beta)|Beta 占位功能（尚未成熟，目前不太能正常稳定使用）：纯本机读取图片与 MP4/WebM，零外网请求，支持失焦或进入对话自动 0fps 休眠。|启用背景壁纸 (Beta)|开启|关闭|选择图片 / 视频|应用|清除|输入本地图片或 MP4/WebM 视频绝对路径…|壁纸透明度|高斯模糊|护眼遮罩|铺满模式|铺满裁切|完整居中|失焦自动暂停视频|窗口失焦或最小化时立即暂停动态视频，减少 GPU 占用。|未启用壁纸（Beta · 零资源占用）。|Prism 后台守护进程未连接，壁纸服务暂不可用。|已启用静态图片壁纸（Beta · 本机只读流）。|已启用动态视频壁纸（Beta · 失焦/隐藏自动 0fps 休眠）。|宿主 CSP 拦截了本机端口，已自动切换至安全小图 Blob 回退渲染。|动态视频流被宿主 CSP 拦截或无法解码，请改用静态图片（<= 8 MB）或放宽本机媒体策略。|Linux 环境请直接在上方输入框粘贴本地媒体文件绝对路径后点击「应用」。|已取消文件选择。|正在打开系统文件选择器…|正在校验并保存壁纸配置…|已清除壁纸并释放本机端口。|文件格式不支持：仅允许 JPG/PNG/WebP/GIF/AVIF/MP4/WebM（严禁 SVG/HTML/脚本）。|安全拦截：禁止读取系统目录或凭据目录（如 .ssh/.aws/.gemini/Windows）。|安全拦截：禁止使用符号链接（Symlink）作为壁纸文件。|安全拦截：禁止使用 UNC 网络路径或系统设备路径。|文件不存在或无法访问，请检查路径是否正确。|文件头校验未通过：文件实际内容与扩展名不匹配。|文件体积超出允许上限，请更换较小素材。|图片超过 8 MB 的 Blob 回退上限，请压缩图片或放宽本机端口访问。|操作失败，请检查文件路径与权限。',
    'zh-TW':
      '自訂靜態 / 動態背景桌布 (Beta)|Beta 佔位功能（尚未成熟，目前不太能正常穩定使用）：純本機讀取圖片與 MP4/WebM，零外網請求，支援失焦或進入對話自動 0fps 休眠。|啟用背景桌布 (Beta)|開啟|關閉|選擇圖片 / 影片|套用|清除|輸入本機圖片或 MP4/WebM 影片絕對路徑…|桌布透明度|高斯模糊|護眼遮罩|鋪滿模式|鋪滿裁切|完整置中|失焦自動暫停影片|視窗失焦或最小化時立即暫停動態影片，降低 GPU 負載。|未啟用桌布（Beta · 零資源佔用）。|Prism 背景守護行程未連線，桌布服務暫時不可用。|已啟用靜態圖片桌布（Beta · 本機唯讀串流）。|已啟用動態影片桌布（Beta · 失焦/隱藏自動 0fps 休眠）。|宿主 CSP 攔截了本機連接埠，已自動切換至安全小圖 Blob 回退算繪。|動態影片串流遭宿主 CSP 攔截或無法解碼，請改用靜態圖片（<= 8 MB）。|Linux 環境請直接在上方輸入框貼上本機媒體絕對路徑後點擊「套用」。|已取消檔案選擇。|正在開啟系統檔案選擇器…|正在驗證並儲存桌布設定…|已清除桌布並釋放本機連接埠。|檔案格式不支援：僅允許 JPG/PNG/WebP/GIF/AVIF/MP4/WebM（嚴禁 SVG/HTML/腳本）。|安全攔截：禁止讀取系統目錄或憑證目錄（如 .ssh/.aws/.gemini/Windows）。|安全攔截：禁止使用符號連結（Symlink）作為桌布檔案。|安全攔截：禁止使用 UNC 網路路徑或系統裝置路徑。|檔案不存在或無法存取，請檢查路徑是否正確。|檔案標頭驗證未通過：檔案內容與副檔名不符。|檔案體積超出上限，請更換較小素材。|圖片超過 8 MB 的 Blob 回退上限，請壓縮圖片或放寬本機存取限制。|操作失敗，請檢查檔案路徑與權限。',
    yue:
      '自訂靜態 / 動態背景牆紙 (Beta)|Beta 佔位功能（未算成熟，目前唔太可以正常穩定使用）：純本機讀取圖片同 MP4/WebM，零外網請求，支援失焦或入對話自動 0fps 休眠。|啟用背景牆紙 (Beta)|開啟|關閉|揀選圖片 / 影片|套用|清除|輸入本機圖片或 MP4/WebM 影片絕對路徑…|牆紙透明度|高斯模糊|護眼遮罩|鋪滿模式|鋪滿裁切|完整置中|失焦自動暫停影片|視窗失焦或縮小嗰陣即刻暫停動態影片，減少 GPU 佔用。|未啟用牆紙（Beta · 零資源佔用）。|Prism 後台守護進程未連接，牆紙服務暫時用唔到。|已啟用靜態圖片牆紙（Beta · 本機唯讀串流）。|已啟用動態影片牆紙（Beta · 失焦/隱藏自動 0fps 休眠）。|宿主 CSP 攔截咗本機端口，已自動切換去安全細圖 Blob 後備渲染。|動態影片串流俾宿主 CSP 攔截或者解唔到碼，請改用靜態圖片（<= 8 MB）。|Linux 環境請直接喺上面輸入框貼上本機檔案絕對路徑再撳「套用」。|已取消揀選檔案。|正在打開系統檔案選擇器…|正在檢查並保存牆紙設定…|已清除牆紙並釋放本機端口。|檔案格式唔支援：只容許 JPG/PNG/WebP/GIF/AVIF/MP4/WebM（嚴禁 SVG/HTML/腳本）。|安全攔截：禁止讀取系統目錄或憑證目錄（例如 .ssh/.aws/.gemini/Windows）。|安全攔截：禁止用符號連結（Symlink）做牆紙檔案。|安全攔截：禁止用 UNC 網絡路徑或系統裝置路徑。|搵唔到檔案或者讀唔到，請檢查路徑啱唔啱。|檔案頭校驗唔通過：檔案實際內容同副檔名唔相符。|檔案大過上限，請換細啲嘅素材。|圖片超過 8 MB 嘅 Blob 後備上限，請壓縮圖片或放寬本機端口權限。|操作失敗，請檢查檔案路徑同權限。',
    en:
      'Custom Static / Live Wallpaper (Beta)|Beta placeholder feature (not yet ready for normal reliable use): 100% local images & MP4/WebM, zero external network requests, auto 0fps sleep on blur or chat.|Enable Wallpaper (Beta)|On|Off|Choose Image / Video|Apply|Clear|Enter absolute path to local image or MP4/WebM video…|Opacity|Gaussian Blur|Eye-Care Dim|Fit Mode|Cover|Contain|Pause Video on Blur|Automatically pauses video wallpaper when window loses focus or minimizes.|Wallpaper disabled (Beta · 0 resource usage).|Prism background daemon is offline; wallpaper service unavailable.|Static image wallpaper active (Beta · local read-only stream).|Live video wallpaper active (Beta · auto 0fps sleep on blur/hide).|Host CSP blocked local port; safely switched to <= 8 MB Blob image fallback.|Video stream blocked by host CSP or failed to decode. Try a static image (<= 8 MB) instead.|On Linux, paste the absolute local media file path above and click Apply.|File selection canceled.|Opening native file picker…|Validating and saving wallpaper settings…|Wallpaper cleared and local port released.|Unsupported format: only JPG/PNG/WebP/GIF/AVIF/MP4/WebM allowed (no SVG/HTML/scripts).|Blocked for security: system and credential directories (.ssh/.aws/.gemini/Windows) are forbidden.|Blocked for security: symbolic links are not allowed as wallpaper files.|Blocked for security: UNC network paths and NT device paths are forbidden.|File not found or unreadable. Check the path and try again.|Magic-byte check failed: file contents do not match its extension.|File size exceeds the maximum allowed limit.|Image exceeds the 8 MB Blob fallback limit. Compress the image or allow local loopback stream.|Action failed. Check file path and permissions.',
    ja:
      'カスタム静止画 / 動画壁紙 (Beta)|Beta プレースホルダー機能（まだ通常の安定した利用には適していません）：完全ローカルで静止画・MP4/WebM を読み込み、外部通信ゼロ・非アクティブ時は 0fps 休止。|背景壁紙を有効化 (Beta)|オン|オフ|画像 / 動画を選択|適用|クリア|ローカル画像または MP4/WebM 動画の絶対パスを入力…|不透明度|ぼかし量|保護オーバーレイ|表示モード|画面いっぱいに覆う|全体を表示|フォーカス喪失時に動画を一時停止|ウィンドウが非アクティブ・最小化時に動画再生を自動停止し GPU 負荷を抑えます。|壁紙は無効です（Beta · リソース消費ゼロ）。|Prism バックグラウンドデーモン未接続のため壁紙機能を利用できません。|静止画壁紙が有効です（Beta · ローカル読取専用ストリーム）。|動画壁紙が有効です（Beta · 非表示・非アクティブ時は自動 0fps 休止）。|ホスト CSP によりローカルポートが制限されたため、安全な Blob 画像フォールバックに自動切替しました。|動画ストリームが CSP で制限されたかデコードに失敗しました。8 MB 以下の静止画をお試しください。|Linux では上の入力欄へメディアの絶対パスを貼り付けて「適用」を押してください。|ファイル選択をキャンセルしました。|システムファイル選択ダイアログを開いています…|壁紙設定を検証して保存中…|壁紙をクリアしてローカルポートを解放しました。|未対応の形式です：JPG/PNG/WebP/GIF/AVIF/MP4/WebM のみ許可（SVG/HTML/スクリプト禁止）。|セキュリティ保護：システムおよび認証情報ディレクトリ（.ssh/.aws/.gemini/Windows 等）は読取不可です。|セキュリティ保護：シンボリックリンクは壁紙ファイルとして使用できません。|セキュリティ保護：UNC ネットワークパスおよびデバイスパスは使用できません。|ファイルが見つからないか読み取れません。パスを確認してください。|マジックバイト検証に失敗：ファイル実体が拡張子と一致しません。|ファイルサイズが上限を超えています。より小さい素材を選択してください。|画像が 8 MB の Blob フォールバック上限を超えています。画像を圧縮してください。|操作に失敗しました。ファイルパスと権限を確認してください。',
  };

  const WALLPAPER_I18N = Object.fromEntries(
    Object.entries(I18N_ROWS).map(([lang, row]) => {
      const vals = row.split('|');
      const map = {};
      for (let i = 0; i < I18N_KEYS.length; i++) map[I18N_KEYS[i]] = vals[i] || '';
      return [lang, map];
    })
  );

  function normalizeLang(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^zh[-_](?:TW|HK|MO|Hant)/i.test(s)) return 'zh-TW';
    if (/^(?:yue|zh[-_]yue)/i.test(s)) return 'yue';
    if (/^ja\b/i.test(s)) return 'ja';
    if (/^en\b/i.test(s)) return 'en';
    if (/^zh\b/i.test(s)) return 'zh-CN';
    return '';
  }

  function resolveLang(doc, ctx) {
    if (ctx && ctx.lang) {
      const l = normalizeLang(ctx.lang);
      if (l) return l;
    }
    if (ctx && typeof ctx.getLang === 'function') {
      const l = normalizeLang(ctx.getLang());
      if (l) return l;
    }
    try {
      const de = doc && doc.documentElement;
      if (de && typeof de.getAttribute === 'function') {
        const l1 = normalizeLang(de.getAttribute('data-ag-cs-lang'));
        if (l1) return l1;
        const l2 = normalizeLang(de.getAttribute('data-ag-prism-lang'));
        if (l2) return l2;
      }
    } catch {}
    return 'zh-CN';
  }

  function markNoTrOwned(el) {
    if (el && typeof el.setAttribute === 'function') {
      for (let i = 0; i < NO_TR_ATTRS.length; i++) {
        el.setAttribute(NO_TR_ATTRS[i][0], NO_TR_ATTRS[i][1]);
      }
      el.setAttribute('data-ag-owned', '1');
    }
    return el;
  }

  function mapErrorCode(code, pack) {
    switch (code) {
      case 'unsupported-extension':
        return pack.errUnsupportedExt;
      case 'blocked-sensitive-path':
        return pack.errSensitivePath;
      case 'symlink-not-allowed':
        return pack.errSymlink;
      case 'blocked-unc-or-device':
      case 'invalid-scheme':
        return pack.errUncDevice;
      case 'file-not-found':
      case 'not-a-regular-file':
      case 'file-unreadable':
      case 'empty-file':
        return pack.errNotFound;
      case 'invalid-magic-bytes':
        return pack.errInvalidMagic;
      case 'file-too-large':
        return pack.errTooLarge;
      case 'blob-size-limit-exceeded':
        return pack.errBlobTooLarge;
      case 'blob-image-only':
      case 'video-stream-blocked':
        return pack.stVideoBlocked;
      case 'manual-input-required':
        return pack.stManualLinux;
      case 'bridge-offline':
      case 'bridge-disposed':
        return pack.stOffline;
      default:
        return pack.errGeneric;
    }
  }

  function mountWallpaperUi(slotEl, ctx = {}) {
    if (!slotEl) return null;
    const win = (ctx && ctx.window) || (typeof window !== 'undefined' ? window : G);
    const doc = (ctx && ctx.document) || slotEl.ownerDocument || (win && win.document) || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    const guard = typeof ctx.runGuardedMut === 'function' ? ctx.runGuardedMut : (fn) => fn();
    const resolveClient = () => (win && win.__agPrismWallpaper) || G.__agPrismWallpaper || null;
    const resolveBridge = () =>
      (win && win.__agPrismWallpaperBridge) ||
      G.__agPrismWallpaperBridge ||
      resolveClient()?.bridge ||
      null;

    // 幂等复用：已挂载实例仅刷新语言与状态，不重建 DOM 避免打断输入/滑块拖动
    const existingHandle = slotEl.__agPrismWpUiHandle;
    if (existingHandle && existingHandle.root && existingHandle.root.parentElement === slotEl) {
      const nextLang = resolveLang(doc, ctx);
      existingHandle.updateLang(nextLang);
      const client = resolveClient();
      if (client && typeof client.getState === 'function') {
        existingHandle.syncState(client.getState());
      }
      return existingHandle;
    }

    const mk = (tag, cls, txt) => {
      const el = doc.createElement(tag);
      if (cls) el.className = cls;
      if (txt !== undefined) el.textContent = String(txt);
      return el;
    };
    const mkBtn = (cls, txt, testId) => {
      const b = mk('button', cls, txt);
      b.type = 'button';
      if (testId) b.setAttribute('data-testid', testId);
      return b;
    };

    const segBtnCls = (ctx && ctx.btnClass) || 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground';
    let curLang = resolveLang(doc, ctx);
    let pack = WALLPAPER_I18N[curLang] || WALLPAPER_I18N['zh-CN'];
    let busy = false;
    let customStatus = null; // { tone, text } | null
    let lastState = {
      enabled: false,
      mediaPath: '',
      mediaType: '',
      opacity: 0.28,
      blurPx: 4,
      dimOverlay: 0.45,
      fit: 'cover',
      pauseOnBlur: true,
      renderMode: 'idle',
      lastError: '',
      bridgeOnline: Boolean(resolveBridge()?.isOnline?.()),
    };

    const card = mk('div', 'ag-prism-wp-card');
    card.setAttribute('data-testid', 'prism-wallpaper-card');
    card.setAttribute('data-ag-cs-lang', curLang);
    markNoTrOwned(card);

    // 1) Header + Enable switch
    const headRow = mk('div', 'ag-prism-wp-row');
    const headMeta = mk('div', 'ag-prism-wp-meta');
    const titleEl = mk('span', 'ag-prism-wp-title', pack.title);
    const descEl = mk('span', 'ag-prism-wp-desc', pack.desc);
    headMeta.appendChild(titleEl);
    headMeta.appendChild(descEl);

    const enableGrp = mk('div', 'ag-cs-seg-group');
    enableGrp.setAttribute('role', 'group');
    enableGrp.setAttribute('data-ui-kind', 'switch');
    enableGrp.setAttribute('data-switch-on', '0');
    const enableThumb = mk('span', 'ag-cs-switch-thumb');
    enableThumb.setAttribute('aria-hidden', 'true');
    const enableOnBtn = mkBtn(segBtnCls, pack.on, 'prism-wp-enable-on');
    const enableOffBtn = mkBtn(segBtnCls, pack.off, 'prism-wp-enable-off');
    enableGrp.appendChild(enableThumb);
    enableGrp.appendChild(enableOnBtn);
    enableGrp.appendChild(enableOffBtn);
    headRow.appendChild(headMeta);
    headRow.appendChild(enableGrp);

    // 2) Path input + Pick / Apply / Clear buttons
    const pathRow = mk('div', 'ag-prism-wp-path-row');
    const pathInput = mk('input', 'ag-prism-wp-path-input');
    pathInput.type = 'text';
    pathInput.setAttribute('data-testid', 'prism-wp-path-input');
    pathInput.setAttribute('placeholder', pack.pathPh);
    pathInput.setAttribute('autocomplete', 'off');
    pathInput.setAttribute('spellcheck', 'false');

    const pickBtn = mkBtn('ag-cs-thought-btn', pack.pickBtn, 'prism-wp-pick-btn');
    const applyBtn = mkBtn('ag-cs-thought-btn', pack.applyBtn, 'prism-wp-apply-btn');
    const clearBtn = mkBtn('ag-cs-thought-btn', pack.clearBtn, 'prism-wp-clear-btn');
    pathRow.appendChild(pathInput);
    pathRow.appendChild(pickBtn);
    pathRow.appendChild(applyBtn);
    pathRow.appendChild(clearBtn);

    // 3) Sliders: Opacity / Blur / Dim Overlay
    const slidersGrid = mk('div', 'ag-prism-wp-sliders');
    const mkSlider = (testId, labelText, min, max, step, valText) => {
      const wrap = mk('div', 'ag-prism-wp-slider-item');
      const head = mk('div', 'ag-prism-wp-slider-head');
      const lbl = mk('span', '', labelText);
      const val = mk('span', 'ag-prism-wp-slider-val', valText);
      head.appendChild(lbl);
      head.appendChild(val);
      const inp = mk('input', 'ag-prism-wp-range');
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.setAttribute('data-testid', testId);
      wrap.appendChild(head);
      wrap.appendChild(inp);
      slidersGrid.appendChild(wrap);
      return { lbl, val, inp };
    };

    const opacityCtrl = mkSlider('prism-wp-opacity', pack.opacityLabel, 0.05, 0.85, 0.01, '28%');
    const blurCtrl = mkSlider('prism-wp-blur', pack.blurLabel, 0, 24, 1, '4 px');
    const dimCtrl = mkSlider('prism-wp-dim', pack.dimLabel, 0, 0.85, 0.01, '45%');

    // 4) Fit Mode (cover / contain)
    const fitRow = mk('div', 'ag-prism-wp-row');
    const fitMeta = mk('div', 'ag-prism-wp-meta');
    const fitLbl = mk('span', 'ag-prism-wp-title', pack.fitLabel);
    fitMeta.appendChild(fitLbl);
    const fitGrp = mk('div', 'ag-cs-seg-group');
    fitGrp.setAttribute('role', 'group');
    const fitCoverBtn = mkBtn(segBtnCls, pack.fitCover, 'prism-wp-fit-cover');
    const fitContainBtn = mkBtn(segBtnCls, pack.fitContain, 'prism-wp-fit-contain');
    fitGrp.appendChild(fitCoverBtn);
    fitGrp.appendChild(fitContainBtn);
    fitRow.appendChild(fitMeta);
    fitRow.appendChild(fitGrp);

    // 5) Pause Video on Blur switch
    const pauseRow = mk('div', 'ag-prism-wp-row');
    const pauseMeta = mk('div', 'ag-prism-wp-meta');
    const pauseLbl = mk('span', 'ag-prism-wp-title', pack.pauseBlurLabel);
    const pauseDesc = mk('span', 'ag-prism-wp-desc', pack.pauseBlurDesc);
    pauseMeta.appendChild(pauseLbl);
    pauseMeta.appendChild(pauseDesc);
    const pauseGrp = mk('div', 'ag-cs-seg-group');
    pauseGrp.setAttribute('role', 'group');
    pauseGrp.setAttribute('data-ui-kind', 'switch');
    pauseGrp.setAttribute('data-switch-on', '1');
    const pauseThumb = mk('span', 'ag-cs-switch-thumb');
    pauseThumb.setAttribute('aria-hidden', 'true');
    const pauseOnBtn = mkBtn(segBtnCls, pack.on, 'prism-wp-pause-blur-on');
    const pauseOffBtn = mkBtn(segBtnCls, pack.off, 'prism-wp-pause-blur-off');
    pauseGrp.appendChild(pauseThumb);
    pauseGrp.appendChild(pauseOnBtn);
    pauseGrp.appendChild(pauseOffBtn);
    pauseRow.appendChild(pauseMeta);
    pauseRow.appendChild(pauseGrp);

    // 6) Status banner
    const statusEl = mk('div', 'ag-prism-wp-status', pack.stIdle);
    statusEl.setAttribute('data-testid', 'prism-wp-status');
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('data-tone', 'idle');

    card.appendChild(headRow);
    card.appendChild(pathRow);
    card.appendChild(slidersGrid);
    card.appendChild(fitRow);
    card.appendChild(pauseRow);
    card.appendChild(statusEl);

    function setBtnPressed(btn, on) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) btn.setAttribute('data-pressed', '');
      else btn.removeAttribute('data-pressed');
    }

    function computeStatusView(st) {
      if (customStatus) return customStatus;
      const bridge = resolveBridge();
      const online = st.bridgeOnline !== undefined ? st.bridgeOnline : Boolean(bridge?.isOnline?.());
      if (!online) return { tone: 'warn', text: pack.stOffline };
      if (st.lastError) return { tone: 'error', text: mapErrorCode(st.lastError, pack) };
      if (st.mediaError) return { tone: 'error', text: mapErrorCode(st.mediaError, pack) };
      if (!st.enabled) return { tone: 'idle', text: pack.stIdle };
      if (st.renderMode === 'blob-fallback') return { tone: 'warn', text: pack.stBlobFallback };
      if (st.mediaType === 'video') return { tone: 'ok', text: pack.stActiveVid };
      if (st.mediaType === 'image') return { tone: 'ok', text: pack.stActiveImg };
      return { tone: 'idle', text: pack.stIdle };
    }

    function renderUiFromState() {
      guard(() => {
        enableGrp.setAttribute('data-switch-on', lastState.enabled ? '1' : '0');
        setBtnPressed(enableOnBtn, lastState.enabled);
        setBtnPressed(enableOffBtn, !lastState.enabled);

        // 仅当输入框未聚焦时同步后端路径，防止打断用户输入
        if (doc.activeElement !== pathInput && pathInput.value !== (lastState.mediaPath || '')) {
          pathInput.value = lastState.mediaPath || '';
        }

        const op = Number.isFinite(Number(lastState.opacity)) ? Number(lastState.opacity) : 0.28;
        const bl = Number.isFinite(Number(lastState.blurPx)) ? Number(lastState.blurPx) : 4;
        const dm = Number.isFinite(Number(lastState.dimOverlay)) ? Number(lastState.dimOverlay) : 0.45;

        opacityCtrl.inp.value = String(op);
        opacityCtrl.val.textContent = `${Math.round(op * 100)}%`;
        blurCtrl.inp.value = String(bl);
        blurCtrl.val.textContent = `${Math.round(bl)} px`;
        dimCtrl.inp.value = String(dm);
        dimCtrl.val.textContent = `${Math.round(dm * 100)}%`;

        const isContain = lastState.fit === 'contain';
        setBtnPressed(fitCoverBtn, !isContain);
        setBtnPressed(fitContainBtn, isContain);

        const pBlur = lastState.pauseOnBlur !== false;
        pauseGrp.setAttribute('data-switch-on', pBlur ? '1' : '0');
        setBtnPressed(pauseOnBtn, pBlur);
        setBtnPressed(pauseOffBtn, !pBlur);

        pickBtn.disabled = busy;
        applyBtn.disabled = busy;
        clearBtn.disabled = busy;

        const sv = computeStatusView(lastState);
        statusEl.setAttribute('data-tone', sv.tone);
        statusEl.textContent = sv.text;
      });
    }

    function updateLang(nextLangRaw) {
      const nextCode = normalizeLang(nextLangRaw) || 'zh-CN';
      if (nextCode === curLang) return;
      curLang = nextCode;
      pack = WALLPAPER_I18N[curLang] || WALLPAPER_I18N['zh-CN'];
      customStatus = null;
      guard(() => {
        card.setAttribute('data-ag-cs-lang', curLang);
        titleEl.textContent = pack.title;
        descEl.textContent = pack.desc;
        enableOnBtn.textContent = pack.on;
        enableOffBtn.textContent = pack.off;
        pathInput.setAttribute('placeholder', pack.pathPh);
        pickBtn.textContent = pack.pickBtn;
        applyBtn.textContent = pack.applyBtn;
        clearBtn.textContent = pack.clearBtn;
        opacityCtrl.lbl.textContent = pack.opacityLabel;
        blurCtrl.lbl.textContent = pack.blurLabel;
        dimCtrl.lbl.textContent = pack.dimLabel;
        fitLbl.textContent = pack.fitLabel;
        fitCoverBtn.textContent = pack.fitCover;
        fitContainBtn.textContent = pack.fitContain;
        pauseLbl.textContent = pack.pauseBlurLabel;
        pauseDesc.textContent = pack.pauseBlurDesc;
        pauseOnBtn.textContent = pack.on;
        pauseOffBtn.textContent = pack.off;
      });
      renderUiFromState();
    }

    function syncState(next) {
      if (!next || typeof next !== 'object') return;
      lastState = { ...lastState, ...next };
      renderUiFromState();
    }

    async function saveConfigPatch(patch, opts = {}) {
      const bridge = resolveBridge();
      if (!bridge || !bridge.isOnline()) {
        customStatus = { tone: 'warn', text: pack.stOffline };
        renderUiFromState();
        return { ok: false, offline: true };
      }
      if (!opts.silentBusy) {
        busy = true;
        customStatus = { tone: 'idle', text: pack.stSaving };
        renderUiFromState();
      }
      try {
        const res = await bridge.saveConfig(patch);
        if (res && res.ok && res.config) {
          customStatus = null;
          const client = resolveClient();
          if (client && typeof client.applyConfig === 'function') {
            lastState = client.applyConfig(res.config);
          } else {
            lastState = { ...lastState, ...res.config, lastError: '' };
          }
        } else {
          customStatus = {
            tone: 'error',
            text: mapErrorCode(res && res.code, pack),
          };
          if (res && res.config) {
            lastState = { ...lastState, ...res.config };
          }
        }
        return res;
      } finally {
        busy = false;
        renderUiFromState();
      }
    }

    enableOnBtn.addEventListener('click', () => {
      const typed = String(pathInput.value || '').trim();
      const patch = typed && typed !== lastState.mediaPath ? { enabled: true, mediaPath: typed } : { enabled: true };
      void saveConfigPatch(patch);
    });
    enableOffBtn.addEventListener('click', () => {
      void saveConfigPatch({ enabled: false });
    });

    pickBtn.addEventListener('click', async () => {
      if (busy) return;
      const bridge = resolveBridge();
      if (!bridge || !bridge.isOnline()) {
        customStatus = { tone: 'warn', text: pack.stOffline };
        renderUiFromState();
        return;
      }
      busy = true;
      customStatus = { tone: 'idle', text: pack.stPicking };
      renderUiFromState();
      try {
        const res = await bridge.pickMedia({ autoEnable: true });
        if (res && res.canceled) {
          customStatus = { tone: 'idle', text: pack.stCanceled };
        } else if (res && res.manualRequired) {
          customStatus = { tone: 'warn', text: pack.stManualLinux };
          try {
            pathInput.focus?.();
          } catch {}
        } else if (res && res.ok && res.config) {
          customStatus = null;
          pathInput.value = res.config.mediaPath || '';
          const client = resolveClient();
          if (client && typeof client.applyConfig === 'function') {
            lastState = client.applyConfig(res.config);
          } else {
            lastState = { ...lastState, ...res.config, lastError: '' };
          }
        } else {
          customStatus = { tone: 'error', text: mapErrorCode(res && res.code, pack) };
        }
      } finally {
        busy = false;
        renderUiFromState();
      }
    });

    applyBtn.addEventListener('click', () => {
      const typed = String(pathInput.value || '').trim();
      if (!typed) {
        void saveConfigPatch({ mediaPath: '', enabled: false });
        return;
      }
      void saveConfigPatch({ mediaPath: typed, enabled: true });
    });

    pathInput.addEventListener('keydown', (ev) => {
      if (ev && ev.key === 'Enter') {
        ev.preventDefault?.();
        applyBtn.click?.();
      }
    });

    clearBtn.addEventListener('click', async () => {
      if (busy) return;
      const bridge = resolveBridge();
      if (!bridge || !bridge.isOnline()) {
        customStatus = { tone: 'warn', text: pack.stOffline };
        renderUiFromState();
        return;
      }
      busy = true;
      renderUiFromState();
      try {
        const res = await bridge.clearMedia();
        if (res && res.ok && res.config) {
          pathInput.value = '';
          customStatus = { tone: 'idle', text: pack.stCleared };
          const client = resolveClient();
          if (client && typeof client.applyConfig === 'function') {
            lastState = client.applyConfig(res.config);
          } else {
            lastState = { ...lastState, ...res.config, lastError: '' };
          }
        } else {
          customStatus = { tone: 'error', text: mapErrorCode(res && res.code, pack) };
        }
      } finally {
        busy = false;
        renderUiFromState();
      }
    });

    const bindSlider = (ctrl, key, fmt) => {
      ctrl.inp.addEventListener('input', () => {
        const v = Number(ctrl.inp.value);
        if (!Number.isFinite(v)) return;
        lastState[key] = v;
        ctrl.val.textContent = fmt(v);
        resolveClient()?.previewVisualVars?.({ [key]: v });
      });
      ctrl.inp.addEventListener('change', () => {
        const v = Number(ctrl.inp.value);
        if (!Number.isFinite(v)) return;
        void saveConfigPatch({ [key]: v }, { silentBusy: true });
      });
    };

    bindSlider(opacityCtrl, 'opacity', (v) => `${Math.round(v * 100)}%`);
    bindSlider(blurCtrl, 'blurPx', (v) => `${Math.round(v)} px`);
    bindSlider(dimCtrl, 'dimOverlay', (v) => `${Math.round(v * 100)}%`);

    fitCoverBtn.addEventListener('click', () => {
      resolveClient()?.previewVisualVars?.({ fit: 'cover' });
      void saveConfigPatch({ fit: 'cover' }, { silentBusy: true });
    });
    fitContainBtn.addEventListener('click', () => {
      resolveClient()?.previewVisualVars?.({ fit: 'contain' });
      void saveConfigPatch({ fit: 'contain' }, { silentBusy: true });
    });

    pauseOnBtn.addEventListener('click', () => {
      void saveConfigPatch({ pauseOnBlur: true }, { silentBusy: true });
    });
    pauseOffBtn.addEventListener('click', () => {
      void saveConfigPatch({ pauseOnBlur: false }, { silentBusy: true });
    });

    let unsub = null;
    const client = resolveClient();
    if (client) {
      if (typeof client.getState === 'function') {
        lastState = { ...lastState, ...client.getState() };
      }
      if (typeof client.subscribe === 'function') {
        unsub = client.subscribe((st) => {
          if (card.isConnected === false) {
            try {
              unsub?.();
            } catch {}
            unsub = null;
            return;
          }
          syncState(st);
        });
      }
    }

    guard(() => {
      while (slotEl.firstChild) slotEl.removeChild(slotEl.firstChild);
      slotEl.hidden = false;
      slotEl.removeAttribute?.('hidden');
      slotEl.appendChild(card);
    });
    renderUiFromState();

    // 初次挂载时若在线且尚未拉过配置，静默同步一次后端配置
    const bridge = resolveBridge();
    if (bridge && bridge.isOnline() && !lastState.mediaPath && !lastState.enabled) {
      void bridge.getConfig().then((res) => {
        if (res && res.ok && res.config) {
          const liveClient = resolveClient();
          if (liveClient && typeof liveClient.applyConfig === 'function') {
            syncState(liveClient.applyConfig(res.config));
          } else {
            syncState({ ...res.config, bridgeOnline: true });
          }
        }
      });
    }

    const handle = {
      root: card,
      updateLang,
      syncState,
      destroy() {
        try {
          unsub?.();
        } catch {}
        unsub = null;
        try {
          card.remove?.();
        } catch {}
        if (slotEl.__agPrismWpUiHandle === handle) {
          slotEl.__agPrismWpUiHandle = null;
        }
      },
    };
    slotEl.__agPrismWpUiHandle = handle;
    return handle;
  }

  const exported = {
    WALLPAPER_I18N,
    mountWallpaperUi,
  };

  G.__prismMountWallpaperUi = mountWallpaperUi;
  G.__agPrismWallpaperSettingsUi = exported;
  if (typeof window !== 'undefined') {
    window.__prismMountWallpaperUi = mountWallpaperUi;
    window.__agPrismWallpaperSettingsUi = exported;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
