// Obsidian Prism — OpenAI-Compatible Thought Translator Settings Workbench UI
// Extracted modular UI component mounted on globalThis.__agPrismThoughtSettingsUi

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  function createThoughtAiConfigBox({ mkEl, btnClass, ui, isZh, getMode, runGuardedMut }) {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return { box: null, onModeSwitched() {}, ensureLoaded() {} };

    const box = mkEl('div', 'ag-cs-thought-cfg-box');
    box.setAttribute('data-testid', 'prism-thought-ai-config');
    box.hidden = getMode() !== 'ai';

    const state = {
      loaded: false,
      busy: false,
      stylePreset: 'technical',
      customPrompt: '',
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: isZh() ? 'OpenAI 兼容主力渠道' : 'Primary OpenAI Profile',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasApiKey: false,
          maskedKey: '',
          draftKey: '',
        },
      ],
      fetchedModels: [],
    };

    // 1) Style Preset Bar + Conditional Local Custom Prompt Textarea
    const styleBar = mkEl('div', 'ag-cs-thought-bar');
    const styleLbl = mkEl('span', 'ag-cs-thought-label');
    styleLbl.textContent = ui.thoughtStyleLabel || (isZh() ? '润色文风预设' : 'Polishing Style');
    const styleGrp = mkEl(
      'div',
      'inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8'
    );
    styleGrp.setAttribute('role', 'group');

    const styleOpts = [
      ['technical', ui.optStyleTech || (isZh() ? '专业工程手稿' : 'Technical Manuscript')],
      ['concise', ui.optStyleConcise || (isZh() ? '精炼核心要点' : 'Concise Key Points')],
      ['custom', ui.optStyleCustom || (isZh() ? '自定义提示词' : 'Custom Prompt')],
    ];
    const styleBtns = new Map();

    const customField = mkEl('div', 'ag-cs-thought-field');
    const customTa = doc.createElement('textarea');
    customTa.className = 'ag-cs-thought-textarea';
    customTa.setAttribute('data-testid', 'thought-custom-prompt');
    customTa.placeholder =
      ui.thoughtCustomPromptPh ||
      (isZh()
        ? '在此输入仅保存在本机私密配置 (~/.gemini/config/) 的自定义系统提示词，绝不写入 Git 仓库…'
        : 'Enter local-only custom system prompt (saved in ~/.gemini/config/, never in Git)…');
    customTa.addEventListener('input', () => {
      state.customPrompt = customTa.value;
    });
    customField.appendChild(customTa);

    const syncStyleUi = () => {
      runGuardedMut(() => {
        for (const [sid, btn] of styleBtns.entries()) {
          const on = state.stylePreset === sid;
          btn.setAttribute('aria-pressed', String(on));
          btn.toggleAttribute('data-pressed', on);
        }
        customField.hidden = state.stylePreset !== 'custom';
        if (customTa.value !== state.customPrompt) customTa.value = state.customPrompt;
      });
    };

    for (const [sid, slbl] of styleOpts) {
      const sb = doc.createElement('button');
      sb.type = 'button';
      sb.className = btnClass;
      sb.textContent = slbl;
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
    profLbl.textContent = ui.thoughtProfilesLabel || (isZh() ? 'OpenAI 兼容渠道预设' : 'OpenAI Endpoint Profiles');
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
      return wrap;
    };

    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ag-cs-thought-input';
    nameInput.setAttribute('data-testid', 'thought-prof-name');
    nameInput.placeholder = isZh() ? '例如：主力网关 / DeepSeek' : 'e.g. Primary Gateway';

    const urlInput = doc.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'ag-cs-thought-input';
    urlInput.setAttribute('data-mono', '1');
    urlInput.setAttribute('data-testid', 'thought-base-url');
    urlInput.placeholder = 'https://api.openai.com/v1';

    const keyMetaBadge = mkEl('span', 'text-[11px] opacity-80');
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
    fetchModelsBtn.textContent = ui.thoughtFetchModelsBtn || (isZh() ? '拉取模型列表' : 'Fetch Models');
    modelRow.appendChild(modelInput);
    modelRow.appendChild(fetchModelsBtn);

    const modelSelectWrap = mkEl('div', 'ag-cs-thought-field');
    modelSelectWrap.setAttribute('data-span', '2');
    modelSelectWrap.hidden = true;
    const modelSelect = doc.createElement('select');
    modelSelect.className = 'ag-cs-thought-select';
    modelSelect.setAttribute('data-testid', 'thought-model-select');
    modelSelectWrap.appendChild(modelSelect);

    grid.appendChild(mkField(ui.thoughtFieldName || (isZh() ? '渠道名称' : 'Profile Name'), nameInput));
    grid.appendChild(mkField(ui.thoughtFieldBaseUrl || 'Base URL', urlInput));
    grid.appendChild(mkField(ui.thoughtFieldApiKey || 'API Key', keyInput, keyMetaBadge));
    grid.appendChild(mkField(ui.thoughtFieldModel || 'Model ID', modelRow));
    grid.appendChild(modelSelectWrap);
    box.appendChild(grid);

    // 4) Action Buttons + Live Status Badge
    const actRow = mkEl('div', 'ag-cs-thought-actions');
    const btnGrp = mkEl('div', 'ag-cs-thought-btn-group');

    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ag-cs-thought-btn';
    saveBtn.setAttribute('data-primary', '1');
    saveBtn.setAttribute('data-testid', 'thought-save-btn');
    saveBtn.textContent = ui.thoughtSaveBtn || (isZh() ? '保存渠道配置' : 'Save Config');

    const testBtn = doc.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'ag-cs-thought-btn';
    testBtn.setAttribute('data-testid', 'thought-test-btn');
    testBtn.textContent = ui.thoughtTestBtn || (isZh() ? '发送测试消息' : 'Send Test Message');

    btnGrp.appendChild(saveBtn);
    btnGrp.appendChild(testBtn);

    const statusBadge = mkEl('span', 'ag-cs-thought-status');
    statusBadge.setAttribute('data-testid', 'thought-status-badge');
    statusBadge.hidden = true;

    actRow.appendChild(btnGrp);
    actRow.appendChild(statusBadge);
    box.appendChild(actRow);

    const privHint = mkEl('p', 'ag-cs-thought-hint');
    privHint.textContent =
      ui.thoughtPrivacyHint ||
      (isZh()
        ? '密钥与自定义提示词以 0600 权限独立保存在本机 ~/.gemini/config/，脱敏回显，不进入公开 Git 仓库。'
        : 'API keys & custom prompts are stored locally in ~/.gemini/config/ (0600) and never touch Git.');
    box.appendChild(privHint);

    const setStatus = (kind, msg) => {
      runGuardedMut(() => {
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

    const getActiveProfile = () => state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];

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
      runGuardedMut(() => {
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
        addBtn.textContent = ui.thoughtAddProfileBtn || (isZh() ? '+ 新增渠道' : '+ New');
        addBtn.addEventListener('click', (ev) => {
          if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
          syncFormIntoProfile();
          const nextNum = state.profiles.length + 1;
          const newId = `prof_${Date.now().toString(36)}_${nextNum}`;
          state.profiles.push({
            id: newId,
            name: isZh() ? `自定义渠道 ${nextNum}` : `Profile ${nextNum}`,
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
          delBtn.textContent = ui.thoughtDelProfileBtn || (isZh() ? '删除当前' : 'Delete');
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
          if (cur.hasApiKey && cur.maskedKey && !cur.draftKey) {
            keyInput.placeholder = isZh()
              ? `已保存 ${cur.maskedKey}（留空保持不变）`
              : `Saved ${cur.maskedKey} (leave blank to keep)`;
            keyMetaBadge.textContent = `✓ ${cur.maskedKey}`;
          } else {
            keyInput.placeholder = 'sk-...';
            keyMetaBadge.textContent = '';
          }
        }
      });
    };

    nameInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) {
        cur.name = nameInput.value;
        const activeChip = profPills.querySelector(`[data-profile-id="${cur.id}"]`);
        if (activeChip) activeChip.textContent = cur.name.trim() || cur.id;
      }
    });
    urlInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) cur.baseUrl = urlInput.value;
    });
    modelInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) cur.model = modelInput.value;
    });
    keyInput.addEventListener('input', () => {
      const cur = getActiveProfile();
      if (cur) cur.draftKey = keyInput.value;
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
      state.stylePreset = ['technical', 'concise', 'custom'].includes(res.stylePreset) ? res.stylePreset : 'technical';
      state.customPrompt = typeof res.customPrompt === 'string' ? res.customPrompt : '';
      if (Array.isArray(res.profiles) && res.profiles.length > 0) {
        state.profiles = res.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
          hasApiKey: Boolean(p.hasApiKey),
          maskedKey: p.maskedKey || '',
          draftKey: '',
        }));
      }
      state.activeProfileId = state.profiles.some((p) => p.id === res.activeProfileId)
        ? res.activeProfileId
        : state.profiles[0].id;
      syncStyleUi();
      renderProfilePillsAndForm();
    };

    const buildSavePayload = () => {
      syncFormIntoProfile();
      return {
        stylePreset: state.stylePreset,
        customPrompt: state.customPrompt,
        activeProfileId: state.activeProfileId,
        profiles: state.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
          apiKey: p.draftKey || '',
          keepExistingKey: !p.draftKey,
        })),
      };
    };

    const ensureLoaded = () => {
      if (state.loaded) return;
      const api = typeof window !== 'undefined' ? window.__agPrismThought : G.__agPrismThought;
      if (!api || typeof api.getConfig !== 'function') return;
      void api.getConfig().then((res) => {
        if (res && res.ok) applySanitizedConfig(res);
      });
    };

    fetchModelsBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = typeof window !== 'undefined' ? window.__agPrismThought : G.__agPrismThought;
      if (!api || typeof api.fetchModels !== 'function' || state.busy) return;
      syncFormIntoProfile();
      const cur = getActiveProfile();
      state.busy = true;
      fetchModelsBtn.disabled = true;
      setStatus('idle', isZh() ? '正在拉取上游模型列表…' : 'Fetching upstream /models…');
      void api
        .fetchModels({
          profileId: cur?.id,
          baseUrl: cur?.baseUrl,
          apiKey: cur?.draftKey || '',
        })
        .then((res) => {
          if (res && res.ok && Array.isArray(res.models)) {
            state.fetchedModels = res.models;
            runGuardedMut(() => {
              while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
              const placeholderOpt = doc.createElement('option');
              placeholderOpt.value = '';
              placeholderOpt.textContent = isZh()
                ? `▾ 从已拉取的 ${res.models.length} 个上游模型中快速选择…`
                : `▾ Quick-select from ${res.models.length} models…`;
              modelSelect.appendChild(placeholderOpt);
              for (const mid of res.models) {
                const opt = doc.createElement('option');
                opt.value = mid;
                opt.textContent = mid;
                if (cur && cur.model === mid) opt.selected = true;
                modelSelect.appendChild(opt);
              }
              modelSelectWrap.hidden = res.models.length === 0;
              if (res.models.length > 0 && (!cur.model || cur.model === 'gpt-4o-mini') && !res.models.includes(cur.model)) {
                cur.model = res.models[0];
                modelInput.value = res.models[0];
              }
            });
            setStatus(
              'ok',
              isZh()
                ? `✓ 成功拉取 ${res.models.length} 个模型 · ${res.latencyMs || 0}ms`
                : `✓ Loaded ${res.models.length} models · ${res.latencyMs || 0}ms`
            );
          } else {
            setStatus('err', `✕ ${res?.error || (isZh() ? '拉取模型失败' : 'Failed to fetch models')}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (fetchModelsBtn.isConnected) fetchModelsBtn.disabled = false;
        });
    });

    saveBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = typeof window !== 'undefined' ? window.__agPrismThought : G.__agPrismThought;
      if (!api || typeof api.saveConfig !== 'function' || state.busy) return;
      state.busy = true;
      saveBtn.disabled = true;
      setStatus('idle', isZh() ? '正在保存配置…' : 'Saving configuration…');
      void api
        .saveConfig(buildSavePayload())
        .then((res) => {
          if (res && res.ok) {
            applySanitizedConfig(res);
            const cur = getActiveProfile();
            setStatus(
              'ok',
              isZh()
                ? `✓ 已保存（${cur?.name || '渠道'} · ${cur?.model || '未设模型'}）`
                : `✓ Saved (${cur?.name || 'Profile'} · ${cur?.model || ''})`
            );
            try {
              api.scan?.();
            } catch {}
          } else {
            setStatus('err', `✕ ${res?.error || (isZh() ? '保存失败（守护进程离线）' : 'Save failed')}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (saveBtn.isConnected) saveBtn.disabled = false;
        });
    });

    testBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const api = typeof window !== 'undefined' ? window.__agPrismThought : G.__agPrismThought;
      if (!api || typeof api.testConnection !== 'function' || state.busy) return;
      state.busy = true;
      testBtn.disabled = true;
      setStatus('idle', isZh() ? '正在保存并发送测试消息…' : 'Testing endpoint latency…');
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
          });
        })
        .then((res) => {
          if (res && res.ok) {
            setStatus(
              'ok',
              isZh()
                ? `✓ 连通正常 · ${res.latencyMs}ms · ${res.model} 回复: 「${res.reply}」`
                : `✓ Connected · ${res.latencyMs}ms · Reply: "${res.reply}"`
            );
          } else {
            setStatus('err', `✕ ${res?.error || (isZh() ? '测试连接失败' : 'Connection test failed')}`);
          }
        })
        .finally(() => {
          state.busy = false;
          if (testBtn.isConnected) testBtn.disabled = false;
        });
    });

    syncStyleUi();
    renderProfilePillsAndForm();
    if (!box.hidden) ensureLoaded();

    return {
      box,
      ensureLoaded,
      onModeSwitched(nextMode) {
        runGuardedMut(() => {
          box.hidden = nextMode !== 'ai';
        });
        if (nextMode === 'ai') ensureLoaded();
      },
    };
  }

  G.__agPrismThoughtSettingsUi = { createThoughtAiConfigBox };
})(typeof globalThis !== 'undefined' ? globalThis : window);
