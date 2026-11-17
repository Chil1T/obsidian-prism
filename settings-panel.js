// Obsidian Prism — Collapsible Settings Panel, Git Sync & Open-Source Credits Module
// Extracted from ui-runtime.js to enforce modular separation of concerns.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const SETTINGS_SEC_ID = 'ag-cs-settings-sec';
  const STORAGE_SETTINGS_OPEN_KEY = 'ag-prism:settings-open';

  const UPSTREAM_CREDITS = [
    {
      repo: '0DNANCY/agy-claude-style',
      url: 'https://github.com/0DNANCY/agy-claude-style',
      meta: 'MIT · 0DNANCY',
    },
    {
      repo: 'YOU-SHOULD-KNOW-ME/antigrative-dashboard',
      url: 'https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard',
      meta: 'MIT · AG Pulse',
    },
    {
      repo: 'LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider',
      url: 'https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider',
      meta: 'MIT · 月上寒',
    },
    {
      repo: 'Nwflower/dsh-claude-style',
      url: 'https://github.com/Nwflower/dsh-claude-style',
      meta: 'Inspiration',
    },
    {
      repo: 'Microqian2th/dsh-codex-effort-slider',
      url: 'https://github.com/Microqian2th/dsh-codex-effort-slider',
      meta: 'Upstream',
    },
    {
      repo: 'mobius/dsh-performance-slider',
      url: 'https://github.com/mobius/dsh-performance-slider',
      meta: 'Upstream',
    },
    {
      repo: 'claudenoshujin/claude-web',
      url: 'https://github.com/claudenoshujin/claude-web',
      meta: 'Mascot Pile & Micro-Ecology Interaction Inspiration',
    },
  ];

  const LICENSE_SUMMARY_TEXT = [
    'GNU General Public License v3.0 (GPL-3.0-only)',
    'Copyright (C) 2026 RMvdesi (https://github.com/RMvdesi/obsidian-prism)',
    '',
    'Obsidian Prism is free and open-source software licensed under GPL-3.0.',
    'Per GPL-3.0 Sections 4–7 and NOTICE, any modified version, fork, or derivative',
    'distribution MUST:',
    '  1. Remain open-source as a whole under GPL-3.0 with complete source code;',
    '  2. Preserve RMvdesi / Obsidian Prism copyright, NOTICE, and UI credits;',
    '  3. Clearly mark modifications and not misrepresent derived builds as official.',
    '',
    'Preserved Upstream Component Notices (MIT License — GPL-3.0 Compatible):',
    '  - Copyright (c) 2026 0DNANCY (agy-claude-style)',
    '  - Copyright (c) 2026 AG Pulse contributors (antigrative-dashboard)',
    '  - Copyright (c) 2026 月上寒 / LLYSH-HANNARI (antigravity-Codex-Claude-effort-slider)',
    '',
    'See LICENSE, NOTICE, CITATION.cff, and THIRD_PARTY_NOTICES.md in the repository.',
  ].join('\n');

  let localRepoSeq = 0;
  const localRepoPending = new Map();

  function invokePrismRepoAction(action, versionStr) {
    const act = action === 'pull' ? 'pull' : 'status';
    const win = typeof window !== 'undefined' ? window : G;
    try {
      const bridge = win.__agPrismRepoBridge;
      if (typeof bridge === 'function') {
        return Promise.resolve(bridge({ action: act }));
      }
      if (bridge && typeof bridge[act] === 'function') {
        return Promise.resolve(bridge[act]());
      }
      if (bridge && typeof bridge.call === 'function') {
        return Promise.resolve(bridge.call({ action: act }));
      }
      if (typeof win.__agPrismRepoCall === 'function') {
        if (typeof win.__agPrismRepoResolve !== 'function') {
          win.__agPrismRepoResolve = (id, res) => {
            const item = localRepoPending.get(id);
            if (!item) return;
            clearTimeout(item.timer);
            localRepoPending.delete(id);
            item.resolve(res);
          };
        }
        return new Promise((resolve) => {
          const id = ++localRepoSeq;
          const timer = setTimeout(() => {
            localRepoPending.delete(id);
            resolve({ ok: false, timeout: true, action: act, noRemote: true, hasRemote: false });
          }, 12000);
          localRepoPending.set(id, { resolve, timer });
          try {
            win.__agPrismRepoCall(JSON.stringify({ id, action: act, input: { action: act } }));
          } catch (err) {
            clearTimeout(timer);
            localRepoPending.delete(id);
            resolve({ ok: false, action: act, error: String(err?.message || err) });
          }
        });
      }
    } catch (err) {
      return Promise.resolve({ ok: false, action: act, error: String(err?.message || err) });
    }
    return Promise.resolve({
      ok: false,
      offline: true,
      action: act,
      noRemote: true,
      hasRemote: false,
      branch: 'local',
      shortHash: versionStr,
    });
  }

  function readSettingsFoldOpen() {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(STORAGE_SETTINGS_OPEN_KEY) : '';
      return raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  }

  function writeSettingsFoldOpen(open) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(STORAGE_SETTINGS_OPEN_KEY, open ? '1' : '0');
      }
    } catch {}
  }

  function renderObsidianPrismBrandSvg(size = 20) {
    try {
      const ext = G.__agPrismBrandLogoSvg || (typeof window !== 'undefined' && window.__agPrismBrandLogoSvg);
      if (typeof ext === 'function') {
        const out = ext(size);
        if (typeof out === 'string' && out.includes('<svg')) return out;
      } else if (typeof ext === 'string' && ext.includes('<svg')) {
        return ext;
      }
    } catch {}
    return `<svg class="ag-cs-settings-brand-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#12151E" stroke="rgba(255,255,255,0.14)" stroke-width="1"/><path d="M12 4.8L18.4 16.6H5.6L12 4.8Z" fill="rgba(255,255,255,0.08)" stroke="#E6ECF8" stroke-width="1.35" stroke-linejoin="round"/><path d="M12 4.8L14.7 16.6" stroke="#9B72CB" stroke-width="1.15" stroke-linecap="round" opacity="0.9"/><path d="M14.9 10.6L20.2 8.9" stroke="#4285F4" stroke-width="1.4" stroke-linecap="round"/><path d="M15.6 12.1L20.6 11.8" stroke="#9B72CB" stroke-width="1.4" stroke-linecap="round"/><path d="M16.3 13.6L20.4 14.5" stroke="#EA4335" stroke-width="1.4" stroke-linecap="round"/><path d="M16.9 15.0L19.8 16.9" stroke="#FBBC04" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }

  function mascotLabels(lang, ui) {
    if (lang === 'zh-TW' || lang === 'yue') return ['雙寵', '雙寵+三蟹', ui.offLabel || '關閉'];
    if (lang === 'ja') return ['ペア', 'ペア+ミニ蟹', ui.offLabel || 'オフ'];
    if (lang === 'en') return ['Dual', 'Dual+Crabs', ui.offLabel || 'Off'];
    return ['双宠', '双宠+三蟹', ui.offLabel || '关闭'];
  }

  function resolveSectionBrandTitle(lang, ui) {
    if (ui.sectionTitle && /Obsidian Prism/i.test(ui.sectionTitle)) return ui.sectionTitle;
    if (lang === 'zh-TW' || lang === 'yue') return 'Obsidian Prism · 黑曜稜鏡';
    if (lang === 'ja') return 'Obsidian Prism · 黒曜プリズム';
    if (lang === 'en') return 'Obsidian Prism';
    return 'Obsidian Prism · 黑曜棱镜';
  }

  function mountOrSyncSettingsSection(ctx) {
    const {
      version,
      getLang,
      uiText,
      isZh,
      i18nCore,
      formatSettingsSummary,
      resolveSettingRowActiveValue,
      isSettingButtonMatch,
      saveSetting,
      getThoughtTranslateMode,
      handledGroupClicks,
      runSettingsGroupGlide,
      runGuardedMut,
    } = ctx;

    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;

    const lang = getLang();
    const ui = uiText(lang);
    const targetTitles = ['Appearance', '外观', '外觀', '外観'];
    let panel = null;
    for (const h2 of doc.querySelectorAll('[role="dialog"] h2')) {
      if (targetTitles.includes((h2.textContent || '').trim())) {
        panel = h2.closest('div.p-6') || h2.parentElement?.parentElement;
        if (panel) break;
      }
    }
    if (!panel) return;

    runGuardedMut(() => {
      const existing = doc.getElementById(SETTINGS_SEC_ID);
      if (existing) {
        if (panel.querySelector('#' + SETTINGS_SEC_ID) === existing && existing.getAttribute('data-ag-cs-lang') === lang) {
          existing.querySelectorAll('button[data-ag-cs-key]').forEach((btn) => {
            const k = btn.getAttribute('data-ag-cs-key');
            const v = btn.getAttribute('data-ag-cs-val');
            const curVal = resolveSettingRowActiveValue(k, lang);
            const on = isSettingButtonMatch(k, v, curVal);
            if (btn.getAttribute('aria-pressed') !== String(on)) {
              btn.setAttribute('aria-pressed', String(on));
              btn.toggleAttribute('data-pressed', on);
            }
          });
          const thoughtBox = existing.querySelector('[data-testid="prism-thought-ai-config"]');
          if (thoughtBox) thoughtBox.hidden = getThoughtTranslateMode() !== 'ai';
          const sumEl = existing.querySelector('[data-ag-cs-fold-summary]');
          if (sumEl) {
            const nextSum = formatSettingsSummary(lang, ui);
            if (sumEl.textContent !== nextSum) sumEl.textContent = nextSum;
          }
          return;
        }
        existing.remove();
      }

      const sections = Array.from(panel.querySelectorAll('div.space-y-2')).filter(
        (s) => !s.id.startsWith('ag-cs-') && !(s.parentElement && s.parentElement.closest('div.space-y-2'))
      );
      const anchor = sections[sections.length - 1];
      if (!anchor || !anchor.parentElement) return;

      const BTN =
        'inline-flex items-center justify-center transition-colors text-secondary-foreground outline-none cursor-pointer border-none shrink-0 select-none h-full hover:text-foreground data-[pressed]:bg-secondary data-[pressed]:text-foreground text-sm px-2 rounded-md gap-1.5';

      const initOpen = readSettingsFoldOpen();
      const sec = doc.createElement('div');
      sec.id = SETTINGS_SEC_ID;
      sec.className = initOpen ? 'space-y-2 is-open' : 'space-y-2';
      sec.setAttribute('data-ag-no-i18n', '');
      sec.setAttribute('data-ag-cs-lang', lang);
      sec.setAttribute('data-open', initOpen ? '1' : '0');
      sec.setAttribute('data-ag-cs-open', initOpen ? '1' : '0');

      const langOpts = (
        i18nCore?.LANG_OPTIONS || [
          { id: 'zh-CN', label: '简体中文' },
          { id: 'zh-TW', label: '繁體中文' },
          { id: 'yue', label: '粵語' },
          { id: 'en', label: 'English' },
          { id: 'ja', label: '日本語' },
        ]
      ).map((o) => [o.id, o.label]);

      const [mDual, mMinis, mOff] = mascotLabels(lang, ui);
      const autoCoexistLbl = ui.optAutoCoexist || (isZh() ? '智能共存' : lang === 'ja' ? '自動共存' : 'Auto Coexist');
      const warmPaletteLbl =
        ui.optWarm ||
        (ui.optClaude && !/claude/i.test(ui.optClaude) ? ui.optClaude : '') ||
        (isZh() ? 'Alabaster 暖岩' : lang === 'ja' ? 'Alabaster ウォーム' : 'Alabaster');

      const rowDefs = {
        palette: {
          key: 'palette',
          title: ui.setPaletteTitle || (isZh() ? '主题配色方案' : 'Color Palette'),
          desc:
            ui.setPaletteDesc ||
            (isZh()
              ? '默认 Obsidian 深空黑灰钛；可选跟随当前主题或 Alabaster 暖岩画册色调。'
              : 'Follow host theme, or switch to Obsidian / Alabaster palettes.'),
          opts: [
            ['host', ui.optHost || 'Follow Host'],
            ['warm', warmPaletteLbl],
            ['obsidian', ui.optObsidian || 'Obsidian'],
          ],
        },
        lightPreset: {
          key: 'lightPreset',
          title: ui.setLightPresetTitle || (isZh() ? '浅色白昼质感' : 'Daylight Surface Preset'),
          desc:
            ui.setLightPresetDesc ||
            (isZh()
              ? '调校浅色模式下的冷瓷表面层次、彩墨折射光晕与玻璃对比度。'
              : 'Tune daylight ceramic elevation, dichroic aura, and glass contrast.'),
          opts: [
            ['crystal', ui.optLightCrystal || (isZh() ? '白昼冷晶' : 'Daylight Crystal')],
            ['alabaster', ui.optLightAlabaster || (isZh() ? '暖白画册' : 'Warm Alabaster')],
          ],
        },
        motionLevel: {
          key: 'motionLevel',
          title: ui.setMotionLevelTitle || (isZh() ? '动效档位' : 'Motion Tier'),
          desc:
            ui.setMotionLevelDesc ||
            (isZh()
              ? '控制系统弹簧交互、流式吐字与光学场景转场的丰富程度。'
              : 'Control spring physics, streaming reveal, and optical hero transitions.'),
          opts: [
            ['off', ui.optMotionOff || (isZh() ? '关闭' : 'Off')],
            ['subtle', ui.optMotionSubtle || (isZh() ? '克制' : 'Subtle')],
            ['standard', ui.optMotionStandard || (isZh() ? '标准' : 'Standard')],
            ['ultra', ui.optMotionUltra || (isZh() ? '旗舰光学' : 'Ultra')],
          ],
        },
        homeLayout: {
          key: 'homeLayout',
          title: ui.setHomeLayoutTitle || 'Home Layout',
          desc: ui.setHomeLayoutDesc || 'Switch new-conversation home layout.',
          opts: [
            ['studio', ui.optStudio || 'Studio'],
            ['classic', ui.optClassic || 'Classic'],
            ['off', ui.optNativeOff || 'Off'],
          ],
        },
        homeRipple: {
          key: 'homeRipple',
          title: ui.setRippleTitle || 'Home Matrix Ripple',
          desc: ui.setRippleDesc || 'Interactive character matrix ripple field on home view.',
          opts: [
            [true, ui.onLabel || 'On'],
            [false, ui.offLabel || 'Off'],
          ],
        },
        logoInk: {
          key: 'logoInk',
          title: ui.setLogoInkTitle || 'Logo Color',
          desc: ui.setLogoInkDesc || 'Tint of the home greeting mark.',
          opts: [
            ['accent', ui.optAccent || 'Accent'],
            ['foreground', ui.optForeground || 'Ink'],
          ],
        },
        language: {
          key: 'language',
          title: ui.setLanguageTitle || 'Plugin UI Language',
          desc: ui.setLanguageDesc || 'Switch language for Obsidian Prism home dashboard and settings UI.',
          opts: langOpts,
        },
        composerRestyle: {
          key: 'composerRestyle',
          title: ui.setComposerTitle || 'Composer Restyle',
          desc: ui.setComposerDesc || 'Minimalist input box + clean canvas footer.',
          opts: [
            [true, ui.onLabel || 'On'],
            [false, ui.offLabel || 'Off'],
          ],
        },
        placeholderStyle: {
          key: 'placeholderStyle',
          title: ui.setPlaceholderTitle || 'Placeholder Style',
          desc: ui.setPlaceholderDesc || 'Switch between Studio placeholder copy and host default.',
          opts: [
            ['studio', 'Studio'],
            ['host', ui.optPlaceholderHost || 'Host'],
          ],
        },
        smoothCaret: {
          key: 'smoothCaret',
          title: ui.setSmoothCaretTitle || 'Smooth Typing Caret',
          desc: ui.setSmoothCaretDesc || 'Enable smooth gliding caret interpolation in composer input.',
          opts: [
            [true, ui.onLabel || 'On'],
            [false, ui.offLabel || 'Off'],
          ],
        },
        mascot: {
          key: 'mascot',
          title: ui.setMascotTitle || 'Pixel Mascot Stage',
          desc: ui.setMascotDesc || 'Show interactive Clawd & Gemini Cat on composer.',
          opts: [
            ['crab', mDual],
            ['minis', mMinis],
            ['off', mOff],
          ],
        },
        sidebarRestyle: {
          key: 'sidebarRestyle',
          title: ui.setSidebarTitle || 'Sidebar Restyle',
          desc: ui.setSidebarDesc || 'Apply refined row height and hover plates to sidebar.',
          opts: [
            [true, ui.onLabel || 'On'],
            [false, ui.offLabel || 'Off'],
          ],
        },
        sidebarCompact: {
          key: 'sidebarCompact',
          title: ui.setSidebarCompactTitle || 'Compact Sidebar',
          desc: ui.setSidebarCompactDesc || 'Tighten sidebar row height from 28px to 24px.',
          opts: [
            [true, ui.onLabel || 'On'],
            [false, ui.offLabel || 'Off'],
          ],
        },
        thoughtTranslate: {
          key: 'thoughtTranslate',
          title: ui.setThoughtModeTitle || (isZh() ? '思考过程转译模式' : 'Thought Translation Mode'),
          desc:
            ui.setThoughtModeDesc ||
            (isZh()
              ? '支持免配密钥极速机翻，或接入任意 OpenAI 兼容接口流式润色为中文工程手稿。'
              : 'Translate English reasoning chains via zero-config Machine Translate or OpenAI-compatible AI polish.'),
          opts: [
            ['off', ui.optThoughtOff || (isZh() ? '关闭' : 'Off')],
            ['machine', ui.optThoughtMachine || (isZh() ? '极速机翻' : 'Machine')],
            ['ai', ui.optThoughtAi || (isZh() ? 'AI 翻译润色' : 'AI Polish')],
          ],
        },
        thoughtTrigger: {
          key: 'thoughtTrigger',
          title: ui.setThoughtTriggerTitle || (isZh() ? '自动转译触发时机' : 'Translation Trigger Timing'),
          desc:
            ui.setThoughtTriggerDesc ||
            (isZh()
              ? '「完结预译」在最新思考块输出结束后后台静默预热缓存；「点开按需」仅在展开思考折叠块时请求。'
              : 'Preload latest finished thought in background, or translate strictly on expand.'),
          opts: [
            ['preload', ui.optTriggerPreload || (isZh() ? '完结预译' : 'Preload')],
            ['expand', ui.optTriggerExpand || (isZh() ? '点开按需' : 'On Expand')],
          ],
        },
        telemetryModule: {
          key: 'telemetryModule',
          title: ui.setTelemetryTitle || (isZh() ? '底部遥测与 512K 光学试管' : 'Telemetry & 512K Optical Vial'),
          desc:
            ui.setTelemetryDesc ||
            (isZh()
              ? '内置吸收 Dashboard 吞吐与配额采样；检测到外部同名插件时自动让位免冲突。'
              : 'Built-in throughput & quota sampling; automatically yields when external Pulse plugin is present.'),
          opts: [
            ['auto', autoCoexistLbl],
            ['on', ui.onLabel || 'On'],
            ['off', ui.offLabel || 'Off'],
          ],
        },
        effortSliderModule: {
          key: 'effortSliderModule',
          title: ui.setEffortSliderTitle || (isZh() ? '模型推理等级滑块' : 'Model Reasoning Effort Slider'),
          desc:
            ui.setEffortSliderDesc ||
            (isZh()
              ? '内置吸收模型菜单星空推理滑块；检测到外部滑块实例时自动让位免重复监听。'
              : 'Built-in starry effort slider in model selector; automatically yields to external slider instances.'),
          opts: [
            ['auto', autoCoexistLbl],
            ['on', ui.onLabel || 'On'],
            ['off', ui.offLabel || 'Off'],
          ],
        },
      };

      const groups = [
        {
          id: 'appearance',
          title: ui.grpAppearance || (isZh() ? '外观与版面' : 'Appearance & Layout'),
          keys: ['palette', 'lightPreset', 'motionLevel', 'homeLayout', 'homeRipple', 'logoInk', 'language'],
        },
        {
          id: 'interaction',
          title: ui.grpInteraction || (isZh() ? '输入、侧栏与小螃蟹' : 'Composer, Sidebar & Mascot'),
          keys: ['composerRestyle', 'placeholderStyle', 'smoothCaret', 'mascot', 'sidebarRestyle', 'sidebarCompact'],
        },
        {
          id: 'thought',
          title: ui.grpThought || (isZh() ? '思考链转译与润色' : 'Thought Translation & Polishing'),
          keys: ['thoughtTranslate', 'thoughtTrigger'],
        },
        {
          id: 'modules',
          title: ui.groupModules || (isZh() ? '吸收集成模块（智能共存让位）' : 'Integrated Modules (Smart Coexistence)'),
          keys: ['telemetryModule', 'effortSliderModule'],
        },
      ];

      const mkEl = (tag, cls) => {
        const el = doc.createElement(tag);
        if (cls) el.className = cls;
        return el;
      };

      const foldSummaryEl = mkEl('span', 'ag-cs-settings-fold-summary');
      foldSummaryEl.setAttribute('data-ag-cs-fold-summary', '');
      foldSummaryEl.textContent = formatSettingsSummary(lang, ui);

      let thoughtUiHandle = null;

      const buildRow = (r) => {
        const row = mkEl('div', 'w-full');
        row.setAttribute('data-ag-cs-row', r.key);
        const inner = mkEl('div', 'py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center');
        const textCol = mkEl('div', 'flex-1 flex flex-col gap-0.5');
        const titleLine = mkEl('div', 'ag-cs-settings-title-line');
        const tSpan = mkEl('span', 'text-sm');
        tSpan.setAttribute('data-k', 't');
        tSpan.textContent = r.title;
        titleLine.appendChild(tSpan);
        const dSpan = mkEl('span', 'text-xs text-muted-foreground whitespace-pre-wrap');
        dSpan.setAttribute('data-k', 'd');
        dSpan.textContent = r.desc;
        textCol.appendChild(titleLine);
        textCol.appendChild(dSpan);

        const ctlWrap = mkEl('div', 'shrink-0');
        const group = mkEl(
          'div',
          'inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8'
        );
        group.setAttribute('role', 'group');
        const curVal = resolveSettingRowActiveValue(r.key, lang);
        for (const [val, lbl] of r.opts) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.className = BTN;
          b.textContent = lbl;
          const valJson = JSON.stringify(val);
          b.setAttribute('data-ag-cs-key', r.key);
          b.setAttribute('data-ag-cs-val', valJson);
          const on = isSettingButtonMatch(r.key, valJson, curVal);
          b.setAttribute('aria-pressed', String(on));
          if (on) b.setAttribute('data-pressed', '');
          b.addEventListener('click', (ev) => {
            if (ev && typeof ev === 'object') handledGroupClicks.add(ev);
            const prevBtn = Array.from(group.children).find(
              (sib) => sib.getAttribute('aria-pressed') === 'true' || sib.hasAttribute('data-pressed')
            );
            const prevRect =
              prevBtn && typeof prevBtn.getBoundingClientRect === 'function' ? prevBtn.getBoundingClientRect() : null;
            for (const sib of group.children) {
              sib.setAttribute('aria-pressed', String(sib === b));
              sib.toggleAttribute('data-pressed', sib === b);
            }
            saveSetting(r.key, val);
            if (r.key === 'thoughtTranslate' && thoughtUiHandle) {
              thoughtUiHandle.onModeSwitched(val);
            }
            foldSummaryEl.textContent = formatSettingsSummary(getLang(), uiText(getLang()));
            if (prevBtn && prevBtn !== b) {
              runSettingsGroupGlide(group, prevBtn, b, prevRect);
            }
          });
          group.appendChild(b);
        }
        ctlWrap.appendChild(group);
        inner.appendChild(textCol);
        inner.appendChild(ctlWrap);
        row.appendChild(inner);
        return row;
      };

      const foldHead = doc.createElement('button');
      foldHead.type = 'button';
      foldHead.className = 'ag-cs-settings-fold-head';
      foldHead.setAttribute('data-ag-cs-fold-toggle', '1');
      foldHead.setAttribute('aria-expanded', String(initOpen));
      foldHead.title = initOpen
        ? ui.foldCollapseHint || (isZh() ? '点击收起设置面板' : 'Click to collapse settings panel')
        : ui.foldExpandHint || (isZh() ? '点击展开光学与模块设置' : 'Click to expand optical & module settings');

      const foldLeft = mkEl('span', 'ag-cs-settings-fold-left');
      const brandMark = mkEl('span', 'ag-cs-settings-brand-mark inline-flex items-center shrink-0');
      brandMark.setAttribute('aria-hidden', 'true');
      brandMark.innerHTML = renderObsidianPrismBrandSvg(20);
      foldLeft.appendChild(brandMark);

      const h3 = mkEl('h3', 'm-0 text-sm font-medium');
      h3.textContent = resolveSectionBrandTitle(lang, ui);
      foldLeft.appendChild(h3);

      const verBadge = mkEl('span', 'ag-cs-settings-ver');
      verBadge.textContent = `v${version}`;
      foldLeft.appendChild(verBadge);

      const foldRight = mkEl('span', 'ag-cs-settings-fold-right');
      foldRight.appendChild(foldSummaryEl);

      const chevron = mkEl('span', 'ag-cs-settings-fold-chevron');
      chevron.setAttribute('data-ag-cs-chevron', '');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
      foldRight.appendChild(chevron);

      foldHead.appendChild(foldLeft);
      foldHead.appendChild(foldRight);
      sec.appendChild(foldHead);

      const foldBody = mkEl('div', initOpen ? 'ag-cs-settings-fold-body is-open' : 'ag-cs-settings-fold-body');
      foldBody.setAttribute('data-open', initOpen ? '1' : '0');
      foldBody.setAttribute('aria-hidden', String(!initOpen));

      const groupsWrap = mkEl('div', 'ag-cs-settings-groups');
      for (const grp of groups) {
        const grpEl = mkEl('div', 'ag-cs-settings-group');
        grpEl.setAttribute('data-ag-cs-group', grp.id);
        const subHead = mkEl('div', 'ag-cs-settings-subhead');
        subHead.textContent = grp.title;
        grpEl.appendChild(subHead);

        const list = mkEl('div', 'bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border');
        for (const k of grp.keys) {
          if (rowDefs[k]) list.appendChild(buildRow(rowDefs[k]));
        }
        if (grp.id === 'thought' && G.__agPrismThoughtSettingsUi?.createThoughtAiConfigBox) {
          thoughtUiHandle = G.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
            mkEl,
            btnClass: BTN,
            ui,
            isZh,
            getMode: getThoughtTranslateMode,
            runGuardedMut,
          });
          if (thoughtUiHandle && thoughtUiHandle.box) {
            list.appendChild(thoughtUiHandle.box);
          }
        }
        grpEl.appendChild(list);
        groupsWrap.appendChild(grpEl);
      }

      // About, Repo Sync & Open-Source Credits section
      const aboutGrp = mkEl('div', 'ag-cs-settings-group');
      aboutGrp.setAttribute('data-ag-cs-group', 'about');
      const aboutSubHead = mkEl('div', 'ag-cs-settings-subhead');
      aboutSubHead.textContent =
        ui.aboutGroupTitle || (isZh() ? '关于、更新与开源致谢' : 'About, Updates & Open-Source Credits');
      aboutGrp.appendChild(aboutSubHead);

      const aboutBox = mkEl('div', 'ag-cs-about-box');
      aboutBox.setAttribute('data-ag-cs-about', '1');

      const repoRow = mkEl('div', 'ag-cs-about-repo-row');
      const repoInfo = mkEl('div', 'ag-cs-about-repo-info');
      const repoBrandTag = mkEl('span', 'font-medium text-foreground');
      repoBrandTag.textContent = `Obsidian Prism v${version}`;
      repoInfo.appendChild(repoBrandTag);

      const repoChip = mkEl('span', 'ag-cs-repo-chip');
      repoChip.setAttribute('data-ag-cs-repo-status', '');
      repoChip.setAttribute('data-status', 'idle');
      repoChip.textContent =
        ui.aboutRepoSyncTitle || (isZh() ? '本地 Git 仓库状态与更新' : 'Git Repository Status & Sync');
      repoInfo.appendChild(repoChip);

      const syncBtn = doc.createElement('button');
      syncBtn.type = 'button';
      syncBtn.className = 'ag-cs-repo-sync-btn';
      syncBtn.setAttribute('data-ag-cs-repo-sync', '1');
      syncBtn.textContent = ui.aboutRepoSyncBtn || (isZh() ? '检查 / 同步 Git 更新' : 'Check / Sync Git Updates');

      let repoProbedOnce = false;
      let repoSyncBusy = false;

      const applyRepoStatusView = (res, isPullResult) => {
        if (!repoChip.isConnected) return;
        runGuardedMut(() => {
          const branch = res?.branch || 'local';
          const hash = res?.shortHash || (res?.commit ? String(res.commit).slice(0, 7) : '');
          const refLabel = hash && hash !== branch ? `${branch} @ ${hash}` : branch;
          const hasRemote = Boolean(res && !res.noRemote && res.hasRemote !== false && res.remoteUrl);
          if (!hasRemote) {
            repoChip.setAttribute('data-status', 'warn');
            repoChip.textContent = `${refLabel} · ${
              ui.aboutRepoNoRemote ||
              (isZh() ? '本地独立 Git 仓库（尚未配置远端 origin）' : 'Local Git repository (no remote configured)')
            }`;
          } else if (isPullResult && res?.updated) {
            repoChip.setAttribute('data-status', 'updated');
            repoChip.textContent = `${refLabel} · ${
              ui.aboutRepoUpdated || (isZh() ? '已同步最新提交并热更新界面' : 'Pulled latest commits & hot-reloaded UI')
            }`;
          } else if (res?.ok === false && res?.error) {
            repoChip.setAttribute('data-status', 'error');
            repoChip.textContent = `${refLabel} · ${res.error}`;
          } else {
            repoChip.setAttribute('data-status', 'ok');
            repoChip.textContent = `${refLabel} · ${
              ui.aboutRepoUpToDate || (isZh() ? '当前已是最新版本' : 'Repository is already up to date')
            }`;
          }
        });
      };

      const probeRepoStatusSilently = () => {
        if (repoProbedOnce || repoSyncBusy) return;
        repoProbedOnce = true;
        void invokePrismRepoAction('status', version).then((st) => {
          if (st) applyRepoStatusView(st, false);
        });
      };

      syncBtn.addEventListener('click', (ev) => {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        if (repoSyncBusy) return;
        repoSyncBusy = true;
        repoProbedOnce = true;
        runGuardedMut(() => {
          syncBtn.disabled = true;
          repoChip.setAttribute('data-status', 'idle');
          repoChip.textContent =
            ui.aboutRepoChecking || (isZh() ? '正在检查 Git 状态…' : 'Checking Git repository status…');
        });

        void invokePrismRepoAction('status', version)
          .then((st) => {
            const hasRemote = Boolean(st && !st.noRemote && st.hasRemote !== false && st.remoteUrl);
            if (!hasRemote) {
              applyRepoStatusView(st || { noRemote: true, branch: 'local' }, false);
              return null;
            }
            return invokePrismRepoAction('pull', version).then((pullRes) => {
              applyRepoStatusView({ ...st, ...pullRes }, true);
              return pullRes;
            });
          })
          .finally(() => {
            repoSyncBusy = false;
            runGuardedMut(() => {
              if (syncBtn.isConnected) syncBtn.disabled = false;
            });
          });
      });

      repoRow.appendChild(repoInfo);
      repoRow.appendChild(syncBtn);
      aboutBox.appendChild(repoRow);

      const creditsTitle = mkEl('div', 'ag-cs-about-credits-title');
      creditsTitle.textContent =
        ui.aboutCreditsTitle || (isZh() ? '上游开源项目与灵感致谢' : 'Upstream Open-Source & Inspiration Credits');
      aboutBox.appendChild(creditsTitle);

      const creditsGrid = mkEl('div', 'ag-cs-about-credits');
      for (const item of UPSTREAM_CREDITS) {
        const a = doc.createElement('a');
        a.setAttribute('href', item.url);
        a.href = item.url;
        a.setAttribute('target', '_blank');
        a.target = '_blank';
        a.setAttribute('rel', 'noopener noreferrer');
        a.rel = 'noopener noreferrer';
        a.setAttribute('data-ag-cs-credit', item.repo);
        const nameSpan = mkEl('span', 'truncate');
        nameSpan.textContent = item.repo;
        const metaSpan = mkEl('span', 'opacity-75 text-[10px] shrink-0');
        metaSpan.textContent = `${item.meta} ↗`;
        a.appendChild(nameSpan);
        a.appendChild(metaSpan);
        creditsGrid.appendChild(a);
      }
      aboutBox.appendChild(creditsGrid);

      const licDetails = doc.createElement('details');
      licDetails.className = 'ag-cs-about-license';
      const licSummary = doc.createElement('summary');
      licSummary.textContent = ui.aboutLicenseTitle || (isZh() ? 'GPL-3.0 开源与署名协议' : 'GPL-3.0 License & Attribution Notice');
      const licPre = mkEl('pre', 'ag-cs-license-pre');
      licPre.textContent = LICENSE_SUMMARY_TEXT;
      licDetails.appendChild(licSummary);
      licDetails.appendChild(licPre);
      aboutBox.appendChild(licDetails);

      const disclaimer = mkEl('p', 'ag-cs-about-disclaimer');
      disclaimer.textContent =
        ui.aboutDisclaimer ||
        'Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.';
      aboutBox.appendChild(disclaimer);

      aboutGrp.appendChild(aboutBox);
      groupsWrap.appendChild(aboutGrp);
      foldBody.appendChild(groupsWrap);
      sec.appendChild(foldBody);

      foldHead.addEventListener('click', (ev) => {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        const nextOpen = sec.getAttribute('data-open') !== '1';
        writeSettingsFoldOpen(nextOpen);
        runGuardedMut(() => {
          sec.setAttribute('data-open', nextOpen ? '1' : '0');
          sec.setAttribute('data-ag-cs-open', nextOpen ? '1' : '0');
          if (nextOpen) sec.classList?.add?.('is-open');
          else sec.classList?.remove?.('is-open');
          foldHead.setAttribute('aria-expanded', String(nextOpen));
          foldHead.title = nextOpen
            ? ui.foldCollapseHint || (isZh() ? '点击收起设置面板' : 'Click to collapse settings panel')
            : ui.foldExpandHint || (isZh() ? '点击展开光学与模块设置' : 'Click to expand optical & module settings');
          foldBody.setAttribute('data-open', nextOpen ? '1' : '0');
          foldBody.setAttribute('aria-hidden', String(!nextOpen));
          if (nextOpen) foldBody.classList?.add?.('is-open');
          else foldBody.classList?.remove?.('is-open');
        });
        if (nextOpen) probeRepoStatusSilently();
      });

      anchor.parentElement.appendChild(sec);
      if (initOpen) probeRepoStatusSilently();
    });
  }

  G.__agPrismSettingsPanel = {
    SETTINGS_SEC_ID,
    UPSTREAM_CREDITS,
    mountOrSyncSettingsSection,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
