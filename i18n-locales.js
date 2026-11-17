(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsLocales = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const LANG_INDEX = {
    'zh-CN': 0,
    'zh-TW': 1,
    yue: 2,
    en: 3,
    ja: 4,
  };

  function pick(lang, arr) {
    const idx = Object.prototype.hasOwnProperty.call(LANG_INDEX, lang) ? LANG_INDEX[lang] : 0;
    return arr[idx] !== undefined ? arr[idx] : arr[0];
  }

  // Unified 5-language table for Obsidian Prism UI [zh-CN, zh-TW, yue, en, ja]
  const UI_TABLE = {
    // ── Brand Header & Collapsible Banner ────────────────────────────────────
    sectionTitle: [
      'Obsidian Prism · 黑曜棱镜',
      'Obsidian Prism · 黑曜稜鏡',
      'Obsidian Prism · 黑曜稜鏡',
      'Obsidian Prism',
      'Obsidian Prism · 黒曜プリズム',
    ],
    sectionSubtitle: [
      'Optical UI & Motion Suite for Antigravity',
      'Optical UI & Motion Suite for Antigravity',
      'Optical UI & Motion Suite for Antigravity',
      'Optical UI & Motion Suite for Antigravity',
      'Optical UI & Motion Suite for Antigravity',
    ],
    foldExpandHint: [
      '点击展开光学与模块设置',
      '點擊展開光學與模組設定',
      '撳呢度展開光學同模組設定',
      'Click to expand optical & module settings',
      'クリックして光学・モジュール設定を展開',
    ],
    foldCollapseHint: [
      '点击收起设置面板',
      '點擊收合設定面板',
      '撳呢度收埋設定面板',
      'Click to collapse settings panel',
      'クリックして設定パネルを折りたたむ',
    ],
    settingsFoldHint: [
      '点击展开或收起配置项',
      '點擊展開或收合設定項',
      '撳呢度展開或者收埋設定項',
      'Click to expand or collapse settings',
      'クリックして設定を展開・折りたたみ',
    ],

    // ── About, Repo Sync & Open-Source Credits ───────────────────────────────
    aboutGroupTitle: [
      '关于、更新与开源致谢',
      '關於、更新與開源致謝',
      '關於、更新同開源致謝',
      'About, Updates & Open-Source Credits',
      '概要・アップデート・OSS謝辞',
    ],
    aboutRepoSyncTitle: [
      '本地 Git 仓库状态与更新',
      '本機 Git 儲存庫狀態與更新',
      '本地 Git 倉庫狀態同更新',
      'Git Repository Status & Sync',
      'Git リポジトリ状態と同期',
    ],
    aboutRepoSyncBtn: [
      '检查 / 同步 Git 更新',
      '檢查 / 同步 Git 更新',
      '檢查 / 同步 Git 更新',
      'Check / Sync Git Updates',
      'Git 更新を確認・同期',
    ],
    aboutRepoChecking: [
      '正在检查 Git 状态…',
      '正在檢查 Git 狀態…',
      '檢查緊 Git 狀態…',
      'Checking Git repository status…',
      'Git リポジトリ状態を確認中…',
    ],
    aboutRepoUpToDate: [
      '当前已是最新版本',
      '目前已是最新版本',
      '而家已經係最新版本',
      'Repository is already up to date',
      '最新バージョンです',
    ],
    aboutRepoUpdated: [
      '已同步最新提交并热更新界面',
      '已同步最新提交並熱更新介面',
      '已經同步最新提交同熱更新介面',
      'Pulled latest commits & hot-reloaded UI',
      '最新コミットを同期し UI をホット更新しました',
    ],
    aboutRepoNoRemote: [
      '本地独立 Git 仓库（尚未配置远端 origin）',
      '本機獨立 Git 儲存庫（尚未設定遠端 origin）',
      '本地獨立 Git 倉庫（未設定遠端 origin）',
      'Local Git repository (no remote configured)',
      'ローカル Git リポジトリ（リモート未設定）',
    ],
    aboutCreditsTitle: [
      '上游开源项目与灵感致谢',
      '上游開源專案與靈感致謝',
      '上游開源項目同靈感致謝',
      'Upstream Open-Source & Inspiration Credits',
      '上流 OSS プロジェクト・謝辞',
    ],
    aboutLicenseTitle: [
      'GPL-3.0 开源与署名协议',
      'GPL-3.0 開源與署名協議',
      'GPL-3.0 開源與署名協議',
      'GPL-3.0 License & Attribution Notice',
      'GPL-3.0 オープンソース＆帰属ライセンス',
    ],
    aboutDisclaimer: [
      'Obsidian Prism 是独立的社区开源项目，与 Google LLC 无隶属、赞助或官方背书关系。Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.',
      'Obsidian Prism 是獨立的社群開源專案，與 Google LLC 無隸屬、贊助或官方背書關係。Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.',
      'Obsidian Prism 係獨立嘅社區開源項目，同 Google LLC 冇隸屬或者官方背書關係。Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.',
      'Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.',
      'Obsidian Prism は独立したオープンソースプロジェクトであり、Google LLC とは提携・承認関係にありません。Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.',
    ],

    // ── Studio Placeholder & Home Dashboard ──────────────────────────────────
    studioPlaceholder: [
      '描述任务或提出问题',
      '描述任務或提出問題',
      '寫低你想做嘅任務或者問題',
      'How can I help you today?',
      'タスクの説明や質問を入力してください',
    ],
    tabOverview: ['概览', '概覽', '概覽', 'Overview', '概要'],
    tabModels: ['模型', '模型', '模型', 'Models', 'モデル'],
    kpiSessions: ['会话数', '工作階段數', '對話數', 'Sessions', 'セッション'],
    kpiCalls: ['消息数', '訊息數', '訊息數', 'Messages', 'メッセージ'],
    kpiTokens: ['Token 总量', 'Token 總量', 'Token 總量', 'Total tokens', '総トークン'],
    kpiDays: ['活跃天数', '活躍天數', '活躍日數', 'Active days', 'アクティブ日数'],
    kpiPeak: ['高峰时段', '尖峰時段', '高峰時段', 'Peak hour', 'ピーク時間帯'],
    kpiFavModel: ['最常用模型', '最常用模型', '最常用模型', 'Favorite model', 'よく使うモデル'],
    noModelUsage: ['暂无模型用量记录', '尚無模型用量紀錄', '暫時冇模型用量紀錄', 'No model usage data yet', 'モデル使用データは未記録です'],
    sessionsUnit: ['个会话', '個工作階段', '個對話', 'sessions', 'セッション'],
    tokenUnit: ['Token', 'Token', 'Token', 'tokens', 'トークン'],
    toolsShort: ['工具', '工具', '工具', 'Tools', 'ツール'],
    showLess: ['收起', '收合', '收埋', 'Show less', '折りたたむ'],

    // ── Context Popover & Telemetry ──────────────────────────────────────────
    activeModelFallback: ['当前模型', '目前模型', '而家個模型', 'Active Model', '使用中モデル'],
    quotaRemShort: ['配额剩余', '配額剩餘', '剩餘配額', 'Quota Rem', '残クォータ'],
    thinkingEllipsis: ['思考中…', '思考中…', '諗緊…', 'Thinking…', '思考中…'],
    streamingEllipsis: ['输出中…', '輸出中…', '出緊字…', 'Streaming…', '生成中…'],
    segSystemRules: ['系统提示与规则', '系統提示與規則', '系統提示同規則', 'System & Rules', 'システムとルール'],
    segChatMessages: ['对话历史消息', '對話歷史訊息', '對話歷史訊息', 'Chat Messages', 'チャット履歴'],
    segToolResults: ['工具执行结果', '工具執行結果', '工具執行結果', 'Tool Results', 'ツール実行結果'],
    segOverhead: ['其他上下文开销', '其他上下文開銷', '其他上下文開銷', 'Context Overhead', 'その他オーバーヘッド'],
    segRemaining: ['剩余可用容量', '剩餘可用容量', '剩低可用容量', 'Remaining Free Capacity', '残り利用可能容量'],
    kpiRemaining: ['剩余可用容量', '剩餘可用容量', '剩低可用容量', 'Remaining Free', '残り容量'],
    usedWord: ['已用', '已用', '用咗', 'Used', '使用済み'],
    kpiCacheHit: ['缓存命中率', '快取命中率', '快取命中率', 'Cache Hit Rate', 'キャッシュ率'],
    cacheReadShort: ['读', '讀', '讀', 'Read', '読込'],
    cacheFreshShort: ['新', '新', '新', 'Fresh', '新規'],
    kpiSpeed: ['生成吞吐速度', '生成吞吐速度', '生成速度', 'Output Speed', '生成速度'],
    speedAvgShort: ['均值', '平均', '平均', 'Avg', '平均'],
    kpiSessionTotal: ['会话累计消耗', '工作階段累計消耗', '對話累計用量', 'Session Total', 'セッション合計'],
    turnsUnit: ['轮', '輪', '輪', 'turns', 'ターン'],
    callsUnit: ['次调用', '次呼叫', '次呼叫', 'calls', '回呼出'],
    callsShortUnit: ['轮', '輪', '輪', 'calls', '回'],
    stepsUnit: ['步', '步', '步', 'steps', 'ステップ'],
    outShort: ['输出', '輸出', '輸出', 'Out', '出力'],
    ctxBreakdownTitle: ['上下文窗口构成明细', '上下文視窗構成明細', '上下文視窗明細', 'Context Window Breakdown', 'コンテキスト内訳'],
    rulesBudget: ['规则预算', '規則預算', '規則預算', 'Rules Budget', 'ルール上限'],
    customBudget: ['自定义预算', '自訂預算', '自訂預算', 'Custom Budget', 'カスタム上限'],
    maxWindow: ['窗口上限', '視窗上限', '視窗上限', 'Max Window', '最大ウィンドウ'],
    latestCallTitle: ['最近一次调用指标', '最近一次呼叫指標', '最近一次呼叫數據', 'Latest Model Call', '最新モデル呼び出し'],
    freshIn: ['新输入', '新輸入', '新輸入', 'Fresh In', '新規入力'],
    cacheRead: ['缓存读取', '快取讀取', '快取讀取', 'Cache Read', 'キャッシュ読込'],
    replyOutput: ['回复输出', '回覆輸出', '回覆輸出', 'Output', '応答出力'],
    thinkingTokens: ['思考 Token', '思考 Token', '思考 Token', 'Thinking', '思考トークン'],
    turnsEmpty: ['当前会话暂无轮次记录', '目前對話尚無輪次紀錄', '呢段對話暫時未有輪次紀錄', 'No turn records in active conversation yet.', 'この会話のターン記録はまだありません。'],
    ctxShort: ['上下文', '上下文', '上下文', 'Ctx', 'Ctx'],
    thinkShort: ['思考', '思考', '思考', 'Think', '思考'],
    cacheShort: ['缓存', '快取', '快取', 'Cache', 'キャッシュ'],
    noSubagents: ['本轮对话暂未调用子代理', '本對話尚未呼叫子代理', '呢段對話暫時未用子代理', 'No subagents invoked in this session.', 'このセッションではサブエージェント未使用です。'],
    runningTag: ['运行中', '執行中', '行緊', 'Running', '実行中'],
    noToolOutputs: ['暂无工具执行输出数据', '尚無工具執行輸出資料', '暫時冇工具輸出資料', 'No tool output data yet.', 'ツール出力データはまだありません。'],
    quotaPoolsTitle: ['模型配额池剩余 (Model Quotas)', '模型配額池剩餘 (Model Quotas)', '模型配額剩餘 (Model Quotas)', 'Model Quota Pools Remaining', 'モデルクォータ残量'],
    quotaLoading: ['正在读取模型配额状态…', '正在讀取模型配額狀態…', '讀取緊模型配額狀態…', 'Loading model quota status…', 'モデルクォータを読み込み中…'],
    activeTag: ['当前', '目前', '而家', 'Active', '使用中'],
    remShort: ['剩余', '剩餘', '剩餘', 'Rem', '残り'],
    weeklyLabel: ['周配额', '週配額', '週配額', 'Weekly', '週間'],
    popoverTitle: ['上下文窗口与 Token 监控', '上下文視窗與 Token 監控', '上下文視窗同 Token 監控', 'Context & Token HUD', 'コンテキスト＆Token HUD'],
    compactBtnTitle: ['向输入框填入 /compact 压缩上下文', '向輸入框填入 /compact 壓縮上下文', '填入 /compact 到輸入框壓縮上下文', 'Fill /compact into composer', '入力欄に /compact を入力して圧縮'],
    copyBtnTitle: ['复制完整遥测报告', '複製完整遙測報告', '複製完整遙測報告', 'Copy telemetry report', 'テレメトリレポートをコピー'],
    copyBtnLabel: ['复制报告', '複製報告', '複製報告', 'Copy', 'コピー'],
    copiedBtnLabel: ['✓ 已复制', '✓ 已複製', '✓ 複製咗', '✓ Copied', '✓ コピー済み'],
    refreshBtnTitle: ['立即刷新遥测与配额', '立即重新整理遙測與配額', '即刻重新整理數據同配額', 'Refresh telemetry', 'データを更新'],
    closeBtnTitle: ['关闭', '關閉', '關閉', 'Close', '閉じる'],
    remAvailLabel: ['剩余可用', '剩餘可用', '剩低可用', 'Remaining', '残り利用可能'],
    draftWord: ['草稿', '草稿', '草稿', 'Draft', '下書き'],
    tabBreakdown: ['上下文拆分', '上下文拆分', '上下文明細', 'Breakdown', '内訳'],
    tabQuotas: ['模型配额', '模型配額', '模型配額', 'Quotas', 'クォータ'],
    sessionThroughput: ['累计吞吐', '累計吞吐', '累計用量', 'Session', 'セッション合計'],
    modelQuotaRem: ['模型配额剩余', '模型配額剩餘', '模型剩餘配額', 'Quota Rem', 'モデル残クォータ'],
    quotaRemWord: ['配额剩余', '配額剩餘', '剩餘配額', 'Quota Rem', 'クォータ残量'],

    // ── Effort Slider Popovers ───────────────────────────────────────────────
    effortTitle: ['推理等级', '推理等級', '推理等級', 'Reasoning effort', '推論レベル'],
    effortFaster: ['更快', '更快', '更快', 'Faster', '高速'],
    effortSmarter: ['更强', '更強', '更強', 'Smarter', '高精度'],
    perfKicker: ['性能 · PERFORMANCE', '效能 · PERFORMANCE', '效能 · PERFORMANCE', 'PERFORMANCE', 'パフォーマンス'],
    perfSliderAria: ['性能滑块', '效能滑桿', '效能滑桿', 'Performance slider', 'パフォーマンススライダー'],

    // ── Settings Panel ───────────────────────────────────────────────────────
    grpAppearance: ['外观与版面', '外觀與版面', '外觀同版面', 'Appearance & Layout', '外観とレイアウト'],
    grpInteraction: ['输入、侧栏与桌面双宠', '輸入、側邊欄與桌面雙寵', '輸入、側欄同桌面雙寵', 'Composer, Sidebar & Mascots', '入力欄・サイドバー・マスコット'],
    groupModules: [
      '吸收集成模块（智能共存让位）',
      '吸收整合模組（智慧共存讓位）',
      '吸收集成模組（智能共存讓位）',
      'Integrated Modules (Smart Coexistence)',
      '統合モジュール（スマート共存）',
    ],
    grpModules: [
      '吸收集成模块（智能共存让位）',
      '吸收整合模組（智慧共存讓位）',
      '吸收集成模組（智能共存讓位）',
      'Integrated Modules (Smart Coexistence)',
      '統合モジュール（スマート共存）',
    ],
    onLabel: ['开启', '開啟', '開啟', 'On', 'オン'],
    offLabel: ['关闭', '關閉', '關閉', 'Off', 'オフ'],
    optAutoCoexist: ['智能共存', '智慧共存', '智能共存', 'Auto Coexist', '自動共存'],

    setLanguageTitle: ['插件看板语言', '外掛看板語言', '插件看板語言', 'Plugin UI Language', 'プラグイン表示言語'],
    setLanguageDesc: [
      '仅切换首页热力图看板与设置面板文案，不影响底层系统中文汉化。',
      '僅切換首頁熱力圖看板與設定面板文案，不影響底層系統中文化。',
      '只切換首頁熱力圖看板同設定面板文字，唔會影響底層系統漢化。',
      'Switch language for Obsidian Prism home dashboard and settings UI.',
      'ホームダッシュボードと設定パネルの表示言語を切り替えます。',
    ],
    setHomeLayoutTitle: ['首页版面', '首頁版面', '首頁版面', 'Home Layout', 'ホームレイアウト'],
    setHomeLayoutDesc: [
      '切换新对话首页为「Studio 极简编程看板」，或居中 / 原生。',
      '切換新對話首頁為「Studio 極簡程式看板」，或置中 / 原生。',
      '切換開新對話首頁做「Studio 極簡編程看板」，或者置中 / 原生。',
      'Switch new-conversation home layout.',
      '新しい会話ホームのレイアウトを切り替えます。',
    ],
    optStudio: ['Studio 看板', 'Studio 看板', 'Studio 看板', 'Studio', 'スタジオ'],
    optClassic: ['居中', '置中', '置中', 'Classic', 'クラシック'],
    optNativeOff: ['原生', '原生', '原生', 'Off', '標準'],
    setPaletteTitle: ['主题配色方案', '主題配色方案', '主題配色方案', 'Color Palette', 'カラーパレット'],
    setPaletteDesc: [
      '支持「跟随当前主题」、Obsidian 深空或 Alabaster 暖岩精调配色。',
      '支援「跟隨目前主題」、Obsidian 深空或 Alabaster 暖岩精調配色。',
      '支援「跟隨而家主題」、Obsidian 深空或 Alabaster 暖岩精調配色。',
      'Follow host theme, or switch to refined Obsidian / Alabaster Warm palettes.',
      '現在のテーマに追従、または精調整された Obsidian / Alabaster 暖岩を選択します。',
    ],
    optObsidian: ['Obsidian 深空', 'Obsidian 深空', 'Obsidian 深空', 'Obsidian', 'オブシディアン'],
    optWarm: ['Alabaster 暖岩', 'Alabaster 暖岩', 'Alabaster 暖岩', 'Alabaster Warm', 'アラバスター暖岩'],
    optClaude: ['Alabaster 暖岩', 'Alabaster 暖岩', 'Alabaster 暖岩', 'Alabaster Warm', 'アラバスター暖岩'],
    optHost: ['跟随当前主题', '跟隨目前主題', '跟隨而家主題', 'Follow Host', 'ホスト連動'],

    setLightPresetTitle: ['浅色白昼质感', '淺色白晝質感', '淺色白晝質感', 'Daylight Surface Preset', 'ライトモード質感'],
    setLightPresetDesc: [
      '调校浅色模式下的冷瓷表面层次、彩墨折射光晕与玻璃对比度。',
      '調校淺色模式下的冷瓷表面層次、彩墨折射光暈與玻璃對比度。',
      '調校淺色模式下嘅冷瓷表面層次、彩墨折射光暈同玻璃對比度。',
      'Tune porcelain surface hierarchy, dichroic aura, and glass contrast in light mode.',
      'ライトモードの磁器レイヤー階層、プリズム光彩、ガラスコントラストを調整します。',
    ],
    optLightCrystal: ['白昼冷晶', '白晝冷晶', '白晝冷晶', 'Daylight Crystal', '白昼クリスタル'],
    optLightAlabaster: ['暖白画册', '暖白畫冊', '暖白畫冊', 'Warm Alabaster', 'ウォーム画集'],

    setTelemetryTitle: ['底部遥测与 512K 光学试管', '底部遙測與 512K 光學試管', '底部遙測同 512K 光學試管', 'Bottom Telemetry & 512K Optical Vial', '下部テレメトリ＆512K光学バイアル'],
    setTelemetryDesc: [
      '内置吸收 Dashboard 吞吐与配额采样；检测到外部同名插件时自动让位免冲突。',
      '內建吸收 Dashboard 吞吐與配額取樣；偵測到外部同名外掛時自動讓位免衝突。',
      '內置吸收 Dashboard 吞吐同配額採樣；偵測到外部同名插件時自動讓位免衝突。',
      'Built-in throughput & quota telemetry; yields automatically when external plugin is detected.',
      'スループットとクォータ計測を内蔵。外部同名プラグイン検出時は自動で譲歩し競合を防ぎます。',
    ],
    setEffortSliderTitle: ['模型推理等级滑块', '模型推理等級滑桿', '模型推理等級滑桿', 'Model Reasoning Effort Slider', 'モデル推論レベルスライダー'],
    setEffortSliderDesc: [
      '内置吸收模型菜单星空推理滑块；检测到外部滑块实例时自动让位免重复监听。',
      '內建吸收模型選單星空推理滑桿；偵測到外部滑桿實例時自動讓位免重複監聽。',
      '內置吸收模型選單星空推理滑桿；偵測到外部滑桿實例時自動讓位免重複監聽。',
      'Built-in starfield effort slider in model menu; yields automatically to external slider instances.',
      'モデルメニューの星空推論スライダーを内蔵。外部インスタンス検出時は自動で譲歩し重複監視を防ぎます。',
    ],

    setLogoInkTitle: ['问候标志着色', '問候標誌著色', '問候標誌顏色', 'Logo Color', 'ロゴカラー'],
    setLogoInkDesc: [
      '设置新会话首页问候星标的色彩风格。',
      '設定新對話首頁問候星標的色彩風格。',
      '設定開新對話首頁問候星標嘅顏色風格。',
      'Tint of the home greeting mark.',
      'ホーム挨拶マークの色調を選択します。',
    ],
    optAccent: ['主题色', '主題色', '主題色', 'Accent', 'アクセント'],
    optForeground: ['前景色', '前景色', '前景色', 'Ink', '前景色'],
    setSidebarTitle: ['侧栏精致排版', '側邊欄精緻排版', '側欄精緻排版', 'Sidebar Restyle', 'サイドバー調整'],
    setSidebarDesc: [
      '对左侧对话与项目列表应用棱镜高对比紧凑行距与悬停高亮。',
      '對左側對話與專案清單套用稜鏡高對比緊湊行距與懸停高亮。',
      '幫左邊對話同專案清單套用稜鏡高對比緊湊行距同高亮效果。',
      'Apply refined row height and hover plates to sidebar.',
      '左サイドバーの行間とホバー表示を調整します。',
    ],
    setSidebarCompactTitle: ['紧凑侧栏间距', '緊湊側邊欄間距', '緊湊側欄間距', 'Compact Sidebar', 'コンパクトサイドバー'],
    setSidebarCompactDesc: [
      '进一步收紧侧栏对话行高，一屏展示更多历史会话。',
      '進一步收緊側邊欄對話行高，一屏顯示更多歷史對話。',
      '再收緊少少側欄對話行距，一個畫面睇到更多歷史對話。',
      'Tighten sidebar row height from 28px to 24px.',
      'サイドバーの行高をさらに詰めて表示件数を増やします。',
    ],
    setComposerTitle: ['极简输入框重排', '極簡輸入框重排', '極簡輸入框重排', 'Composer Restyle', '入力欄リスタイル'],
    setComposerDesc: [
      '重排输入区与底部无边框控制栏（兼容模型菜单内嵌滑条与遥测胶囊）。',
      '重排輸入區與底部無邊框控制列（相容模型選單內嵌滑桿與遙測膠囊）。',
      '重排輸入區同底部無邊框控制欄（兼容模型選單內嵌滑桿同遙測膠囊）。',
      'Minimalist input box + clean canvas footer.',
      'シンプルな入力欄とフッターに再構成します。',
    ],
    setPlaceholderTitle: ['输入框提示语风格', '輸入框提示語風格', '輸入框提示字風格', 'Placeholder Style', 'プレースホルダー'],
    setPlaceholderDesc: [
      '在极简 Studio 文案与宿主原生提示语之间切换。',
      '在極簡 Studio 文案與宿主原生提示語之間切換。',
      '喺極簡 Studio 提示字同原本系統提示字之間切換。',
      'Switch between Studio placeholder copy and host default.',
      'Studio スタイルのヒント文と標準を切り替えます。',
    ],
    optPlaceholderHost: ['原生提示', '原生提示', '原生提示', 'Host', '標準'],
    setSmoothCaretTitle: ['丝滑打字光标动画', '絲滑打字游標動畫', '順滑打字游標動畫', 'Smooth Typing Caret', 'スムーズ入力カーソル'],
    setSmoothCaretDesc: [
      '为输入框启用丝滑光标位移插值动画。',
      '為輸入框啟用絲滑游標位移插值動畫。',
      '為輸入框開啟順滑游標移動動畫。',
      'Enable smooth gliding caret interpolation in composer input.',
      '入力欄のテキストカーソル移動を滑らかにアニメーション化します。',
    ],
    setMotionLevelTitle: ['动效档位', '動效檔位', '動效級別', 'Motion Level', 'モーション強度'],
    setMotionLevelDesc: [
      '控制系统弹簧交互、流式吐字与光学场景转场的丰富程度。',
      '控制系統彈簧互動、流式吐字與光學場景轉場的豐富程度。',
      '控制系統彈簧互動、流式出字同光學場景轉場嘅豐富程度。',
      'Control spring micro-interactions, streaming text reveal, and optical scene transitions.',
      'スプリング操作、ストリーミング表示、光学トランジションの演出強度を調整します。',
    ],
    optMotionOff: ['关闭', '關閉', '關閉', 'Off', 'オフ'],
    optMotionSubtle: ['克制', '克制', '克制', 'Subtle', '控えめ'],
    optMotionStandard: ['标准', '標準', '標準', 'Standard', '標準'],
    optMotionUltra: ['旗舰光学', '旗艦光學', '旗艦光學', 'Ultra', 'ウルトラ光学'],
    setMascotTitle: ['像素桌面双宠舞台', '像素桌面雙寵舞台', '像素桌面雙寵舞台', 'Pixel Mascot Stage', 'ピクセルマスコットステージ'],
    setMascotDesc: [
      '在输入框右上角显示互动小螃蟹与小紫猫（支持点击、拖拽与静置帧缓存休眠）。',
      '在輸入框右上角顯示互動小螃蟹與小紫貓（支援點擊、拖曳與靜置影格快取休眠）。',
      '喺輸入框右上角顯示互動小螃蟹同小紫貓（支援撳、拖拉同靜置快取休眠）。',
      'Show interactive Clawd & Gemini Cat on composer.',
      '入力欄右上にインタラクティブなマスコットを表示します。',
    ],
    setRippleTitle: ['首页字符水波纹海', '首頁字元水波紋海', '首頁字元水波紋海', 'Home Matrix Ripple', 'ホーム文字リップル'],
    setRippleDesc: [
      '在首页铺设呼吸感字符点阵，点击空白处触发交互水波纹扩散。',
      '在首頁鋪設呼吸感字元點陣，點擊空白處觸發互動水波紋擴散。',
      '喺首頁鋪設呼吸感字元矩陣，撳空白位觸發水波紋擴散。',
      'Interactive character matrix ripple field on home view.',
      'ホーム背景クリックで文字グリッドの波紋アニメーションを再生します。',
    ],

    // ── Thought Translator & OpenAI Polisher ─────────────────────────────────
    grpThought: [
      '思考链转译与润色',
      '思考鏈轉譯與潤色',
      '思考鏈轉譯同潤色',
      'Thought Translation & Polishing',
      '思考チェーン翻訳・推敲',
    ],
    setThoughtModeTitle: [
      '思考过程转译模式',
      '思考過程轉譯模式',
      '思考過程轉譯模式',
      'Thought Translation Mode',
      '思考プロセス翻訳モード',
    ],
    setThoughtModeDesc: [
      '支持免配密钥极速机翻，或接入任意 OpenAI 兼容接口流式润色为中文工程手稿。',
      '支援免設定金鑰極速機翻，或接入任意 OpenAI 相容介面流式潤色為中文工程手稿。',
      '支援免填 Key 極速機翻，或者接駁 OpenAI 兼容介面流式潤色做中文工程手稿。',
      'Translate English reasoning chains via zero-config Machine Translate or streaming OpenAI-compatible AI polish.',
      'キー不要の高速機械翻訳、または OpenAI 互換 API によるストリーミング推敲を選択します。',
    ],
    optThoughtOff: ['关闭', '關閉', '關閉', 'Off', 'オフ'],
    optThoughtMachine: ['极速机翻', '極速機翻', '極速機翻', 'Machine', '高速機械翻訳'],
    optThoughtAi: ['AI 翻译润色', 'AI 翻譯潤色', 'AI 翻譯潤色', 'AI Polish', 'AI 翻訳・推敲'],
    setThoughtTriggerTitle: [
      '自动转译触发时机',
      '自動轉譯觸發時機',
      '自動轉譯觸發時機',
      'Translation Trigger Timing',
      '自動翻訳タイミング',
    ],
    setThoughtTriggerDesc: [
      '「完结预译」在最新思考块输出结束后后台静默预热缓存；「点开按需」仅在展开思考折叠块时请求。',
      '「完結預譯」在最新思考區塊輸出結束後背景靜默預熱快取；「點開按需」僅在展開思考摺疊區塊時請求。',
      '「完結預譯」喺最新思考塊出完字後背景預熱快取；「撳開按需」淨係展開思考塊時先至請求。',
      'Preload latest finished thought in background, or translate strictly on expand to save tokens.',
      '完了時にバックグラウンドで事前翻訳するか、展開時のみオンデマンド翻訳するかを選択します。',
    ],
    optTriggerPreload: ['完结预译', '完結預譯', '完結預譯', 'Preload', '完了時プリロード'],
    optTriggerExpand: ['点开按需', '點開按需', '撳開按需', 'On Expand', '展開時のみ'],
    thoughtStyleLabel: ['润色文风预设', '潤色文風預設', '潤色文風預設', 'Polishing Style', '推敲スタイル'],
    optStyleTech: ['专业工程手稿', '專業工程手稿', '專業工程手稿', 'Technical Manuscript', '技術エンジニアリング'],
    optStyleConcise: ['精炼核心要点', '精煉核心要點', '精煉核心要點', 'Concise Key Points', '要点サマリー'],
    optStyleCustom: ['自定义提示词', '自訂提示詞', '自訂提示詞', 'Custom Prompt', 'カスタムプロンプト'],
    thoughtCustomPromptPh: [
      '在此输入仅保存在本机私密配置 (~/.gemini/config/) 的自定义系统提示词，绝不写入 Git 仓库…',
      '在此輸入僅儲存在本機私密設定 (~/.gemini/config/) 的自訂系統提示詞，絕不寫入 Git 儲存庫…',
      '喺度輸入淨係存喺本機私密設定 (~/.gemini/config/) 嘅自訂系統提示詞，絕唔會寫入 Git 倉庫…',
      'Enter local-only custom system prompt (saved privately in ~/.gemini/config/, never in Git)…',
      'ローカル専用カスタムシステムプロンプトを入力（~/.gemini/config/ に保存され Git には含まれません）…',
    ],
    thoughtProfilesLabel: ['OpenAI 兼容渠道预设', 'OpenAI 相容渠道預設', 'OpenAI 兼容渠道預設', 'OpenAI Endpoint Profiles', 'OpenAI 互換プロファイル'],
    thoughtAddProfileBtn: ['+ 新增渠道', '+ 新增渠道', '+ 新增渠道', '+ New Profile', '+ 追加'],
    thoughtDelProfileBtn: ['删除当前', '刪除目前', '刪除而家呢個', 'Delete', '削除'],
    thoughtFieldName: ['渠道名称', '渠道名稱', '渠道名稱', 'Profile Name', 'プロファイル名'],
    thoughtFieldBaseUrl: ['接口地址 (Base URL)', '介面位址 (Base URL)', '介面位址 (Base URL)', 'Base URL', 'Base URL'],
    thoughtFieldApiKey: ['接口密钥 (API Key)', '介面金鑰 (API Key)', '介面密鑰 (API Key)', 'API Key', 'API Key'],
    thoughtFieldModel: ['模型 ID (Model)', '模型 ID (Model)', '模型 ID (Model)', 'Model ID', 'モデル ID'],
    thoughtFetchModelsBtn: ['拉取模型列表', '拉取模型清單', '拉取模型清單', 'Fetch Models', 'モデル一覧取得'],
    thoughtSaveBtn: ['保存渠道配置', '儲存渠道設定', '儲存渠道設定', 'Save Config', '設定を保存'],
    thoughtTestBtn: ['发送测试消息', '發送測試訊息', '發送測試訊息', 'Send Test Message', '接続テスト送信'],
    thoughtPrivacyHint: [
      '密钥与自定义提示词以 0600 权限独立保存在本机 ~/.gemini/config/，脱敏回显，不进入公开 Git 仓库。',
      '金鑰與自訂提示詞以 0600 權限獨立儲存在本機 ~/.gemini/config/，脫敏回顯，不進入公開 Git 儲存庫。',
      '密鑰同自訂提示詞以 0600 權限獨立存喺本機 ~/.gemini/config/，脫敏顯示，唔會寫入公開 Git 倉庫。',
      'API keys & custom prompts are stored locally in ~/.gemini/config/ (0600) and never touch Git.',
      'APIキーとカスタムプロンプトは ~/.gemini/config/ (0600) にのみ保存され、Git には一切含まれません。',
    ],
  };

  function getUiStrings(lang) {
    const out = {};
    for (const key in UI_TABLE) {
      out[key] = pick(lang, UI_TABLE[key]);
    }
    out.showMoreN = (n) =>
      lang === 'zh-CN'
        ? `再显示 ${n} 个`
        : lang === 'zh-TW'
        ? `再顯示 ${n} 個`
        : lang === 'yue'
        ? `再睇多 ${n} 個`
        : lang === 'ja'
        ? `さらに ${n} 件表示`
        : `Show ${n} more`;
    out.hudSummaryMeta = (n) =>
      lang === 'zh-CN'
        ? `${n} 项`
        : lang === 'zh-TW'
        ? `${n} 項`
        : lang === 'yue'
        ? `${n} 項`
        : lang === 'ja'
        ? `${n} 項目`
        : `${n} options`;
    out.tabTurnsN = (n) =>
      lang === 'zh-CN'
        ? `对话轮次 (${n})`
        : lang === 'zh-TW'
        ? `對話輪次 (${n})`
        : lang === 'yue'
        ? `對話輪次 (${n})`
        : lang === 'ja'
        ? `ターン (${n})`
        : `Turns (${n})`;
    out.tabToolsN = (n) =>
      lang === 'zh-CN'
        ? `工具/代理 (${n})`
        : lang === 'zh-TW'
        ? `工具/代理 (${n})`
        : lang === 'yue'
        ? `工具/代理 (${n})`
        : lang === 'ja'
        ? `ツール (${n})`
        : `Tools (${n})`;
    out.toolDeclarationsN = (n) =>
      lang === 'zh-CN'
        ? `工具定义声明 (${n})`
        : lang === 'zh-TW'
        ? `工具定義宣告 (${n})`
        : lang === 'yue'
        ? `工具定義聲明 (${n})`
        : lang === 'ja'
        ? `ツール定義 (${n})`
        : `Tool Declarations (${n})`;
    out.liveDraftN = (n) =>
      lang === 'zh-CN'
        ? `当前输入草稿 (${n} 字)`
        : lang === 'zh-TW'
        ? `目前輸入草稿 (${n} 字)`
        : lang === 'yue'
        ? `而家草稿 (${n} 字)`
        : lang === 'ja'
        ? `入力中の下書き (${n} 文字)`
        : `Live Draft (${n} chars)`;
    out.subagentsHeading = (cnt, calls, tokFmt) =>
      lang === 'zh-CN'
        ? `子代理消耗 (${cnt} 个 · ${calls} 次调用 · 累计 ${tokFmt})`
        : lang === 'zh-TW'
        ? `子代理消耗 (${cnt} 個 · ${calls} 次呼叫 · 累計 ${tokFmt})`
        : lang === 'yue'
        ? `子代理用量 (${cnt} 個 · ${calls} 次呼叫 · 累計 ${tokFmt})`
        : lang === 'ja'
        ? `サブエージェント (${cnt} 体 · ${calls} 回呼出 · 合計 ${tokFmt})`
        : `Subagents (${cnt} · ${calls} calls · Total ${tokFmt})`;
    out.toolResultsHeading = (tokFmt) =>
      lang === 'zh-CN'
        ? `工具输出体积排行 (共 ${tokFmt} tok)`
        : lang === 'zh-TW'
        ? `工具輸出大小排行 (共 ${tokFmt} tok)`
        : lang === 'yue'
        ? `工具輸出大細排行 (共 ${tokFmt} tok)`
        : lang === 'ja'
        ? `ツール結果サイズ順 (${tokFmt} tok)`
        : `Tool Results Leaderboard (${tokFmt} tok)`;
    out.ringTooltip = (remStr, maxStr, remPctStr, usedStr, usedPctStr, quotaPct) => {
      const qTip =
        quotaPct != null
          ? lang === 'zh-CN'
            ? ` · 配额剩余 ${quotaPct.toFixed(1)}%`
            : lang === 'zh-TW'
            ? ` · 配額剩餘 ${quotaPct.toFixed(1)}%`
            : lang === 'yue'
            ? ` · 剩餘配額 ${quotaPct.toFixed(1)}%`
            : lang === 'ja'
            ? ` · クォータ残 ${quotaPct.toFixed(1)}%`
            : ` · Quota Rem ${quotaPct.toFixed(1)}%`
          : '';
      if (lang === 'zh-CN') return `剩余可用 ${remStr} / ${maxStr} (${remPctStr}%) · 已用 ${usedStr} (${usedPctStr}%)${qTip}`;
      if (lang === 'zh-TW') return `剩餘可用 ${remStr} / ${maxStr} (${remPctStr}%) · 已用 ${usedStr} (${usedPctStr}%)${qTip}`;
      if (lang === 'yue') return `剩低可用 ${remStr} / ${maxStr} (${remPctStr}%) · 用咗 ${usedStr} (${usedPctStr}%)${qTip}`;
      if (lang === 'ja') return `残り ${remStr} / ${maxStr} (${remPctStr}%) · 使用済 ${usedStr} (${usedPctStr}%)${qTip}`;
      return `Remaining ${remStr} / ${maxStr} (${remPctStr}%) · Used ${usedStr} (${usedPctStr}%)${qTip}`;
    };
    out.perfPreviewStatus = (frameStr, modelShort, subTitle, fullLabel) => {
      if (lang === 'zh-CN') return `预览帧 ${frameStr} · 松手吸附到 ${modelShort} ${subTitle}`;
      if (lang === 'zh-TW') return `預覽影格 ${frameStr} · 放開吸附至 ${modelShort} ${subTitle}`;
      if (lang === 'yue') return `預覽第 ${frameStr} 格 · 放手揀 ${modelShort} ${subTitle}`;
      if (lang === 'ja') return `フレーム ${frameStr} · 離して ${fullLabel} を選択`;
      return `Frame ${frameStr} · Release to select ${fullLabel}`;
    };
    out.perfCommittedStatus = (num, fullLabel) => {
      if (lang === 'zh-CN') return `已落到档位 ${num}：${fullLabel}`;
      if (lang === 'zh-TW') return `已切換至檔位 ${num}：${fullLabel}`;
      if (lang === 'yue') return `已揀第 ${num} 級：${fullLabel}`;
      if (lang === 'ja') return `プリセット ${num}：${fullLabel}`;
      return `Preset ${num}: ${fullLabel}`;
    };
    out.perfHoverStatus = (num, fullLabel) => {
      if (lang === 'zh-CN') return `切换到档位 ${num}：${fullLabel}`;
      if (lang === 'zh-TW') return `切換到檔位 ${num}：${fullLabel}`;
      if (lang === 'yue') return `轉去第 ${num} 級：${fullLabel}`;
      if (lang === 'ja') return `プリセット ${num} に切替：${fullLabel}`;
      return `Select preset ${num}: ${fullLabel}`;
    };
    return out;
  }

  // 全局宿主 DOM 词典覆盖默认置空（不干涉宿主原生语言与界面文案）
  const DICT_ROWS = [];

  function resolveLocaleBundle(lang) {
    const key = lang === 'zh-CN' || lang === 'zh-TW' || lang === 'yue' || lang === 'ja' ? lang : 'en';
    if (key === 'en') return null;
    return {
      lang: key,
      cjkLatinSpacing: key !== 'ja',
      units: null,
      dict: Object.create(null),
      rules: [],
      timeRules: [],
      sentences: [],
    };
  }

  return {
    UI_TABLE,
    getUiStrings,
    DICT_ROWS,
    resolveLocaleBundle,
  };
});
