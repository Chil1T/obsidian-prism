// Channel 18 独立 9 语种词典（全局 UI 字体 + custom.css 注入）
// 严格遵循 9 语种规范：zh-CN / zh-TW / en / ja / ko / es / fr / de / tr；非 CJK 语种 0 汉字、0 yue、0 禁用词
(function (root, factory) {
  const api = factory();
  if (root) root.__agPrismCustomStyleI18n = api;
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismCustomStyleI18n = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const LOCALES = Object.freeze(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr']);
  const LOCALE_INDEX = Object.freeze(Object.fromEntries(LOCALES.map((l, i) => [l, i])));

  const TABLE = Object.freeze({
    setUiFontTitle: [
      '全局界面字体',
      '全域介面字型',
      'Global UI Font',
      '全体 UI フォント',
      '전체 UI 글꼴',
      'Fuente global de interfaz',
      'Police globale de l’interface',
      'Globale UI-Schriftart',
      'Genel Arayüz Yazı Tipi',
    ],
    setUiFontDesc: [
      '统一修改宿主全局界面字体（侧栏、弹窗、菜单与按钮），自动保护图标字体与代码块；正文为「宿主默认」时自动继承此字体。',
      '統一修改宿主全域介面字型（側欄、彈窗、選單與按鈕），自動保護圖示字型與程式碼區塊；正文為「宿主預設」時自動繼承此字型。',
      'Applies across host UI chrome (sidebars, dialogs, menus, buttons) while protecting icon fonts and monospace code. Chat body inherits this when set to Host Default.',
      'サイドバー・ダイアログ・メニュー等の全体 UI フォントを変更します（アイコンとコードは保護）。チャット本文が既定の時は自動継承します。',
      '사이드바, 대화상자, 메뉴 등 전체 UI 글꼴을 변경합니다(아이콘 및 코드 보호). 채팅 본문이 기본값이면 이 글꼴을 자동 상속합니다.',
      'Cambia la fuente de toda la interfaz (barras, diálogos, menús) protegiendo iconos y código. El texto del chat la hereda si está en Predeterminada.',
      'Applique la police à toute l’interface (barres, dialogues, menus) tout en protégeant icônes et code. Le texte du chat en hérite par défaut.',
      'Passt die Schriftart der gesamten Oberfläche an und schützt Symbole sowie Codeblöcke. Der Chat-Text erbt sie bei Standardeinstellung automatisch.',
      'Simge yazı tiplerini ve kod bloklarını koruyarak tüm arayüz yazı tipini değiştirir. Sohbet metni varsayılan ayardayken bunu devralır.',
    ],
    uiFontCustomPlaceholder: [
      '输入全局 UI 字体名，逗号分隔（如 Inter, MiSans, PingFang SC）',
      '輸入全域 UI 字型名，逗號分隔（如 Inter, PingFang TC）',
      'UI font families, comma-separated (e.g. Inter, Segoe UI)',
      'UI フォント名を入力（カンマ区切り、例: Inter, BIZ UDPGothic）',
      'UI 글꼴 이름 입력, 쉼표 구분 (예: Pretendard, Inter)',
      'Fuentes de interfaz separadas por comas (ej. Inter, Segoe UI)',
      'Polices d’interface séparées par des virgules (ex. Inter, Segoe UI)',
      'UI-Schriftarten, kommagetrennt (z. B. Inter, Segoe UI)',
      'Virgülle ayrılmış arayüz yazı tipleri (örn. Inter, Segoe UI)',
    ],
    setCustomCssTitle: [
      '自定义 CSS (custom.css)',
      '自訂 CSS (custom.css)',
      'Custom CSS (custom.css)',
      'カスタム CSS (custom.css)',
      '사용자 지정 CSS (custom.css)',
      'CSS personalizado (custom.css)',
      'CSS personnalisé (custom.css)',
      'Benutzerdefiniertes CSS (custom.css)',
      'Özel CSS (custom.css)',
    ],
    setCustomCssDesc: [
      '加载插件目录中的本地 custom.css（最高优先级，支持保存后热重载与升级保留；上限 256 KB，自动拦截外部 @import）。',
      '載入外掛目錄中的本機 custom.css（最高優先級，支援儲存後熱重載與升級保留；上限 256 KB，自動攔截外部 @import）。',
      'Loads local custom.css from the plugin folder with highest cascade priority (live hot-reload, upgrade-safe, <= 256 KB, @import blocked).',
      'プラグイン内のローカル custom.css を最優先で読み込みます（保存時ホットリロード・更新保護・上限 256 KB・@import 遮断）。',
      '플러그인 폴더의 로컬 custom.css를 최우선으로 적용합니다(저장 시 즉시 반영, 업데이트 보존, 최대 256 KB, @import 차단).',
      'Carga el archivo local custom.css con máxima prioridad (recarga en caliente, conservado al actualizar, <= 256 KB, sin @import).',
      'Charge le fichier local custom.css avec priorité maximale (rechargement à chaud, préservé lors des mises à jour, <= 256 Ko, @import bloqué).',
      'Lädt die lokale custom.css mit höchster Priorität (Hot-Reload beim Speichern, update-sicher, <= 256 KB, @import blockiert).',
      'Eklenti klasöründeki yerel custom.css dosyasını en yüksek öncelikle yükler (anlık yenileme, güncellemede korunur, <= 256 KB, @import engelli).',
    ],
    btnCreateCustomCss: [
      '创建模板',
      '建立範本',
      'Create Template',
      'テンプレート作成',
      '템플릿 생성',
      'Crear plantilla',
      'Créer un modèle',
      'Vorlage erstellen',
      'Şablon Oluştur',
    ],
    btnReloadCustomCss: [
      '立即重载',
      '立即重載',
      'Reload',
      '再読込',
      '다시 불러오기',
      'Recargar',
      'Recharger',
      'Neu laden',
      'Yenile',
    ],
    cssStatusActive: [
      '已生效 ({kb} KB)',
      '已生效 ({kb} KB)',
      'Active ({kb} KB)',
      '適用中 ({kb} KB)',
      '적용됨 ({kb} KB)',
      'Activo ({kb} KB)',
      'Actif ({kb} Ko)',
      'Aktiv ({kb} KB)',
      'Etkin ({kb} KB)',
    ],
    cssStatusMissing: [
      '未检测到 custom.css（零开销待命）',
      '未偵測到 custom.css（零開銷待命）',
      'No custom.css found (0 overhead)',
      'custom.css 未検出（ゼロ負荷待機）',
      'custom.css 없음 (오버헤드 0)',
      'No se encontró custom.css (sin carga)',
      'Aucun custom.css détecté (0 surcharge)',
      'Keine custom.css gefunden (0 Aufwand)',
      'custom.css bulunamadı (0 yük)',
    ],
    cssStatusEmpty: [
      'custom.css 当前为空或仅含注释',
      'custom.css 目前為空或僅含註解',
      'custom.css is currently empty',
      'custom.css は空です',
      'custom.css 파일이 비어 있습니다',
      'custom.css está vacío',
      'custom.css est actuellement vide',
      'custom.css ist derzeit leer',
      'custom.css şu anda boş',
    ],
    cssStatusDisabled: [
      '已关闭（本地文件保留不受影响）',
      '已關閉（本機檔案保留不受影響）',
      'Disabled (local file preserved)',
      '無効（ローカルファイルは保持）',
      '비활성화됨 (로컬 파일 보존)',
      'Desactivado (archivo local conservado)',
      'Désactivé (fichier local conservé)',
      'Deaktiviert (lokale Datei bleibt erhalten)',
      'Devre dışı (yerel dosya korunur)',
    ],
    cssStatusTooLarge: [
      '已拒绝：文件超过 256 KB 安全上限',
      '已拒絕：檔案超過 256 KB 安全上限',
      'Rejected: exceeds 256 KB safety limit',
      '拒否：256 KB の安全上限を超過',
      '거부됨: 256 KB 안전 제한 초과',
      'Rechazado: supera el límite de 256 KB',
      'Refusé : dépasse la limite de 256 Ko',
      'Abgelehnt: überschreitet 256-KB-Limit',
      'Reddedildi: 256 KB güvenlik sınırını aşıyor',
    ],
    cssStatusSymlink: [
      '已拒绝：不允许符号链接或越界路径',
      '已拒絕：不允許符號連結或越界路徑',
      'Rejected: symlinks are not allowed',
      '拒否：シンボリックリンクは不可',
      '거부됨: 심볼릭 링크는 허용되지 않음',
      'Rechazado: no se permiten enlaces simbólicos',
      'Refusé : liens symboliques interdits',
      'Abgelehnt: Symlinks sind nicht zulässig',
      'Reddedildi: sembolik bağlantılara izin verilmez',
    ],
    cssStatusError: [
      '读取 custom.css 失败（请检查文件权限）',
      '讀取 custom.css 失敗（請檢查檔案權限）',
      'Failed to read custom.css (check permissions)',
      'custom.css の読み込みに失敗しました',
      'custom.css를 읽지 못했습니다 (권한 확인)',
      'Error al leer custom.css (revisa los permisos)',
      'Impossible de lire custom.css (vérifiez les droits)',
      'Fehler beim Lesen von custom.css (Rechte prüfen)',
      'custom.css okunamadı (izinleri kontrol edin)',
    ],
    cssBlockedImports: [
      '已安全拦截 {n} 条 @import 规则',
      '已安全攔截 {n} 條 @import 規則',
      'Blocked {n} @import rule(s) for safety',
      '安全のため @import を {n} 件ブロックしました',
      '안전을 위해 @import 규칙 {n}건을 차단했습니다',
      'Se bloquearon {n} reglas @import por seguridad',
      '{n} règle(s) @import bloquée(s) par sécurité',
      '{n} @import-Regel(n) aus Sicherheitsgründen blockiert',
      'Güvenlik için {n} @import kuralı engellendi',
    ],
    cssTemplateRequested: [
      '已请求创建 custom.css 模板，稍后自动热加载',
      '已請求建立 custom.css 範本，稍後自動熱載入',
      'Template requested; custom.css will hot-reload shortly',
      'テンプレート作成を要求しました',
      '템플릿 생성을 요청했습니다',
      'Plantilla solicitada; se recargará automáticamente',
      'Modèle demandé ; rechargement automatique imminent',
      'Vorlage angefordert; wird automatisch neu geladen',
      'Şablon istendi; yakında otomatik yüklenecek',
    ],
    cssReloadRequested: [
      '正在重新读取 custom.css…',
      '正在重新讀取 custom.css…',
      'Reloading custom.css...',
      'custom.css を再読み込み中…',
      'custom.css 다시 불러오는 중...',
      'Recargando custom.css...',
      'Rechargement de custom.css...',
      'custom.css wird neu geladen...',
      'custom.css yeniden yükleniyor...',
    ],
  });

  function normalizeLocale(lang) {
    const raw = typeof lang === 'string' ? lang.trim().toLowerCase().replace(/_/g, '-') : '';
    if (!raw || raw === 'auto') return 'en';
    if (raw === 'zh-tw' || raw === 'zh-hk' || raw.startsWith('zh-hk-') || raw === 'zh-mo' || raw === 'zh-hant' || raw.startsWith('zh-hant-')) return 'zh-TW';
    if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-') || raw === 'yue' || raw.startsWith('yue-') || raw === 'zh-yue' || raw.includes('cantonese')) return 'zh-CN';
    if (raw === 'ja' || raw.startsWith('ja-')) return 'ja';
    if (raw === 'ko' || raw.startsWith('ko-')) return 'ko';
    if (raw === 'es' || raw.startsWith('es-')) return 'es';
    if (raw === 'fr' || raw.startsWith('fr-')) return 'fr';
    if (raw === 'de' || raw.startsWith('de-')) return 'de';
    if (raw === 'tr' || raw.startsWith('tr-') || raw === 'turkish' || raw === 'türkçe' || raw === 'turkce') return 'tr';
    return 'en';
  }

  function getStrings(lang) {
    const idx = LOCALE_INDEX[normalizeLocale(lang)] ?? 2;
    const out = {};
    for (const key of Object.keys(TABLE)) {
      out[key] = TABLE[key][idx];
    }
    return out;
  }

  return {
    LOCALES,
    TABLE,
    normalizeLocale,
    getStrings,
  };
});
