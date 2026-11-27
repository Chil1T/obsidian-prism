// Obsidian Prism - Project Partitions Host Bridge (React/Redux catalog, conversations & navigation)
(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
  if (!G) return;

  const CHANGE_THROTTLE_MS = 160;
  const safe = (fn) => { try { return fn(); } catch { return undefined; } };
  const cssEsc = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const findFiber = (node, prefix = '__reactFiber$') => {
    if (!node) return null;
    const fk = Object.keys(node).find((k) => k.startsWith(prefix) || (prefix === '__reactContainer$' && k.startsWith('__reactFiber$')));
    return fk ? node[fk] : null;
  };

  function normalizeUriKey(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    if (!s) return '';
    if (/^file:\/\//i.test(s)) {
      s = s.replace(/^file:\/\//i, '');
      try { s = decodeURIComponent(s); } catch {}
      if (/^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
    }
    if (s.startsWith('\\\\?\\')) s = s.slice(4);
    const wsl = s.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
    if (wsl) {
      const rest = String(wsl[2] || '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
      return rest ? `${wsl[1].toLowerCase()}:/${rest.toLowerCase()}` : `${wsl[1].toLowerCase()}:/`;
    }
    s = s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
    if (/^[a-zA-Z]:$/.test(s)) return `${s.toLowerCase()}/`;
    if (/^[a-zA-Z]:\//.test(s)) return s.toLowerCase();
    return s || '/';
  }

  function parseTsMs(raw) {
    if (raw === null || raw === undefined || raw === '') return 0;
    if (typeof raw === 'bigint' || typeof raw === 'number') {
      const n = Number(raw);
      return !Number.isFinite(n) || n <= 0 ? 0 : n < 1e11 ? Math.floor(n * 1000) : Math.floor(n);
    }
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return 0;
      if (/^\d+(?:\.\d+)?$/.test(s)) return parseTsMs(Number(s));
      const p = Date.parse(s);
      return Number.isFinite(p) && p > 0 ? p : 0;
    }
    if (typeof raw === 'object') {
      const sec = Number(raw.seconds ?? raw.sec);
      if (Number.isFinite(sec) && sec > 0) {
        const nanos = Number(raw.nanos || 0);
        return Math.floor(sec * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0));
      }
    }
    return 0;
  }

  function isVisibleConversation(s) {
    if (!s || typeof s !== 'object') return false;
    if (s.killed || s.archived || s.annotations?.archived || s.annotations?.hidden || s.forkParentConversationId) return false;
    const meta = s.trajectoryMetadata || {};
    if (meta.parentConversationId || meta.isBattleModeFork || meta.sourceMetadata?.hideFromConversationList) return false;
    const tt = s.trajectoryType;
    return tt !== 'SIDE_QUESTION' && tt !== 'COMMIT_MESSAGE_GENERATION' && tt !== 2 && tt !== 3;
  }

  function isRunningConversation(s) {
    if (!s || typeof s !== 'object') return false;
    const st = s.status;
    return st === 2 || st === 'RUNNING' || st === 'CASCADE_RUN_STATUS_RUNNING' || Boolean(s.notFullyIdle || s.hasRunningSubagents || s.hasActiveChildren);
  }

  function extractProjectCallbacksFromRow(rowEl) {
    let f = findFiber(rowEl?.querySelector?.('button[aria-haspopup="menu"]'));
    for (let d = 0; d < 22 && f; d++, f = f.return) {
      const mp = f.memoizedProps;
      if (mp && ('onSettingsClick' in mp || 'onRevealClick' in mp || 'onDeleteClick' in mp || 'onCopyClick' in mp)) {
        return {
          onCopyClick: typeof mp.onCopyClick === 'function' ? mp.onCopyClick : null,
          onSettingsClick: typeof mp.onSettingsClick === 'function' ? mp.onSettingsClick : null,
          onRevealClick: typeof mp.onRevealClick === 'function' ? mp.onRevealClick : null,
          onDeleteClick: typeof mp.onDeleteClick === 'function' ? mp.onDeleteClick : null,
        };
      }
    }
    return null;
  }

  function createHostBridge({ win, doc, hostStore = null, hostServices = null, hostRouter = null, onHostChange = null }) {
    let store = hostStore;
    let services = hostServices;
    let router = hostRouter;
    let storeUnsub = null;
    let pmsUnsub = null;
    let disposed = false;
    let snapInitialized = false;
    let lastSummariesRef = null;
    let lastProjectsRef = null;
    let lastPathname = '';
    let changeTimer = 0;
    let changePending = false;
    let lastNotifyAt = 0;
    const nativeCallbacksByProject = new Map();

    function readSnapshotRefs() {
      const st = safe(() => store?.getState?.());
      const summariesRef = st?.trajectorySummaries?.summaries || st?.conversation?.summaries || null;
      const projectsRef = safe(() => services?.core?.projectManagementService?.projectsStateProvider?.getState?.()) || null;
      const pathname = String(win?.location?.pathname || '');
      return { summariesRef, projectsRef, pathname };
    }

    function syncSnapshotRefs() {
      const cur = readSnapshotRefs();
      lastSummariesRef = cur.summariesRef;
      lastProjectsRef = cur.projectsRef;
      lastPathname = cur.pathname;
      snapInitialized = true;
    }

    function emitHostChangeThrottled(force = false) {
      if (disposed || typeof onHostChange !== 'function') return;
      const cur = readSnapshotRefs();
      if (
        !force &&
        snapInitialized &&
        cur.summariesRef === lastSummariesRef &&
        cur.projectsRef === lastProjectsRef &&
        cur.pathname === lastPathname
      ) {
        return;
      }
      lastSummariesRef = cur.summariesRef;
      lastProjectsRef = cur.projectsRef;
      lastPathname = cur.pathname;
      snapInitialized = true;

      const now = Date.now();
      const elapsed = lastNotifyAt > 0 ? now - lastNotifyAt : CHANGE_THROTTLE_MS;
      if (elapsed >= CHANGE_THROTTLE_MS && !changeTimer) {
        lastNotifyAt = now;
        onHostChange();
        return;
      }
      changePending = true;
      if (!changeTimer) {
        const waitMs = Math.max(16, CHANGE_THROTTLE_MS - Math.max(0, elapsed));
        changeTimer = setTimeout(() => {
          changeTimer = 0;
          if (disposed || !changePending) return;
          changePending = false;
          lastNotifyAt = Date.now();
          onHostChange();
        }, waitMs);
        if (changeTimer && typeof changeTimer.unref === 'function') changeTimer.unref();
      }
    }

    function bindSubscriptions() {
      if (disposed) return;
      if (!snapInitialized && (store || services)) syncSnapshotRefs();
      if (store && !storeUnsub && typeof store.subscribe === 'function') {
        storeUnsub = store.subscribe(() => emitHostChangeThrottled(false));
      }
      const pms = services?.core?.projectManagementService;
      if (pms && !pmsUnsub && typeof pms.onDidAnyProjectChange === 'function') {
        const disp = safe(() => pms.onDidAnyProjectChange(() => emitHostChangeThrottled(false)));
        if (disp && typeof disp.dispose === 'function') pmsUnsub = () => safe(() => disp.dispose());
        else if (typeof disp === 'function') pmsUnsub = disp;
      }
    }

    function probe() {
      if (store && services && router) {
        bindSubscriptions();
        return true;
      }
      const rootEl = doc?.getElementById?.('root') || doc?.body?.firstElementChild;
      const rawFiber = findFiber(rootEl, '__reactContainer$');
      const start = rawFiber?.current || rawFiber?.stateNode?.current || rawFiber;
      if (!start) {
        bindSubscriptions();
        return Boolean(store && services);
      }
      const seen = new Set();
      const q = [start];
      for (let i = 0; i < q.length && i < 9000; i++) {
        const f = q[i];
        if (!f || typeof f !== 'object' || seen.has(f)) continue;
        seen.add(f);
        const mp = f.memoizedProps;
        if (!store && mp?.value?.store?.getState) store = mp.value.store;
        if (!services && mp?.value?.core?.projectManagementService) services = mp.value;
        if (!router && mp?.value?.navigate && mp?.value?.state?.location) router = mp.value;
        if (!router && mp?.router?.navigate) router = mp.router;
        if (store && services && router) break;
        if (f.child) q.push(f.child);
        if (f.sibling) q.push(f.sibling);
      }
      bindSubscriptions();
      return Boolean(store && services);
    }

    function readNativeProjectOrder() {
      const order = new Map();
      let f = findFiber(doc?.querySelector?.('[data-testid="conversation-list-sidebar"]'));
      for (let d = 0; d < 10 && f; d++, f = f.return) {
        const items = f.memoizedProps?.items;
        if (Array.isArray(items) && 'onToggleCollapseSection' in f.memoizedProps) {
          let idx = 0;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it?.type === 'header' && typeof it.id === 'string' && it.id.startsWith('header-')) order.set(it.id.slice(7), idx++);
          }
          return order;
        }
      }
      return order;
    }

    function readProjects() {
      probe();
      const result = [];
      const seen = new Set();
      const provider = services?.core?.projectManagementService?.projectsStateProvider;
      const fromHostCatalog = Boolean(provider && typeof provider.getState === 'function');
      const list = safe(() => provider?.getState?.()) || [];
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          const proj = entry.project && typeof entry.project === 'object' ? entry.project : entry;
          const id = typeof proj.id === 'string' && proj.id.trim() ? proj.id.trim() : '';
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const pathKeys = [];
          const addKey = (rawUri) => {
            const k = rawUri ? normalizeUriKey(rawUri) : '';
            if (k && !pathKeys.includes(k)) pathKeys.push(k);
          };
          addKey(proj.path || proj.rootPath || proj.uri?.fsPath || '');
          const resources = proj?.projectResources?.resources;
          if (Array.isArray(resources)) {
            for (const res of resources) {
              const v = res?.type?.value;
              addKey(typeof v === 'string' ? v : v?.folderUri || v?.uri || v?.path || '');
            }
          }
          result.push({ id, name: String(proj.name || proj.label || id).trim(), pathKeys, raw: proj });
        }
      }
      const nativeOrder = readNativeProjectOrder();
      if (nativeOrder.size > 0) {
        result.sort((a, b) => (nativeOrder.get(a.id) ?? 1e9) - (nativeOrder.get(b.id) ?? 1e9) || a.name.localeCompare(b.name));
      }
      return { projects: result, seenIds: seen, fromHostCatalog };
    }

    function readConversationsByProject(projects, untitledLabel) {
      probe();
      const map = new Map();
      const pathToProjectIds = new Map();
      for (const p of projects) {
        map.set(p.id, []);
        for (const k of p.pathKeys) {
          if (!pathToProjectIds.has(k)) pathToProjectIds.set(k, []);
          pathToProjectIds.get(k).push(p.id);
        }
      }
      const st = safe(() => store?.getState?.());
      const summaries = st?.trajectorySummaries?.summaries || st?.conversation?.summaries || {};
      for (const [cid, s] of Object.entries(summaries)) {
        if (!cid || !isVisibleConversation(s)) continue;
        const matched = new Set();
        const directPid = s.projectId || s.workspaceId || '';
        if (directPid && map.has(directPid)) matched.add(directPid);
        for (const ws of Array.isArray(s.workspaces) ? s.workspaces : []) {
          const uris = typeof ws === 'string'
            ? [ws]
            : [ws?.workspaceFolderAbsoluteUri, ws?.gitRootAbsoluteUri, ws?.uri, ws?.path].filter(Boolean);
          for (const rawUri of uris) {
            const pids = pathToProjectIds.get(normalizeUriKey(rawUri));
            if (pids) for (const pid of pids) matched.add(pid);
          }
        }
        if (matched.size === 0) continue;
        const item = {
          cascadeId: cid,
          title: String(s.annotations?.title || s.summary || s.title || '').trim() || untitledLabel,
          updatedAt: parseTsMs(s.lastModifiedTime) || parseTsMs(s.updatedAt) || parseTsMs(s.createdTime) || 0,
          pinned: Boolean(s.annotations?.pinned),
          running: isRunningConversation(s),
        };
        for (const pid of matched) map.get(pid).push(item);
      }
      for (const arr of map.values()) arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
      return map;
    }

    function getActiveCascadeId() {
      const m = String(win?.location?.pathname || '').match(/\/c\/([^/?#]+)/);
      if (m && m[1]) return safe(() => decodeURIComponent(m[1])) || m[1];
      const sel = doc?.querySelector?.('[data-testid="conversation-row-sidebar"][data-selected="true"]');
      return String(sel?.getAttribute?.('data-cascade-id') || '').trim();
    }

    function navigateViaHost(routerArgs, fallbackHref) {
      probe();
      if (router && typeof router.navigate === 'function') {
        for (const arg of routerArgs) {
          if (safe(() => router.navigate(arg)) !== undefined) return;
        }
      }
      const existing = doc?.querySelector?.(`a[href="${cssEsc(fallbackHref)}"]`);
      if (existing) { existing.click(); return; }
      if (win?.history?.pushState) {
        win.history.pushState({}, '', fallbackHref);
        if (typeof win.PopStateEvent === 'function') win.dispatchEvent(new win.PopStateEvent('popstate'));
      }
    }

    function captureCallbacksFromRow(projectId, rowEl) {
      const cbs = extractProjectCallbacksFromRow(rowEl);
      if (cbs && projectId) nativeCallbacksByProject.set(projectId, cbs);
      return cbs;
    }

    function captureAllNativeProjectCallbacks() {
      const list = doc?.querySelector?.('[data-testid="conversation-list-sidebar"]');
      if (!list) return;
      for (const r of list.querySelectorAll('[data-sidebar-section-drop-id]')) {
        const pid = r.getAttribute('data-sidebar-section-drop-id');
        if (!pid || pid === 'main-section-header' || pid === 'standalone' || !r.querySelector('[data-testid="project-header"]')) continue;
        captureCallbacksFromRow(pid, r);
      }
    }

    function getNativeProjectCallbacks(projectId) {
      const row = doc?.querySelector?.(`[data-testid="conversation-list-sidebar"] [data-sidebar-section-drop-id="${cssEsc(projectId)}"]`);
      const fresh = row ? captureCallbacksFromRow(projectId, row) : null;
      return fresh || nativeCallbacksByProject.get(projectId) || null;
    }

    function dispose() {
      disposed = true;
      if (changeTimer) { clearTimeout(changeTimer); changeTimer = 0; }
      changePending = false;
      if (storeUnsub) { safe(storeUnsub); storeUnsub = null; }
      if (pmsUnsub) { safe(pmsUnsub); pmsUnsub = null; }
      nativeCallbacksByProject.clear();
    }

    return {
      probe,
      readProjects,
      readConversationsByProject,
      getActiveCascadeId,
      navigateToConversation: (cascadeId) => {
        if (!cascadeId) return;
        const href = `/c/${encodeURIComponent(cascadeId)}`;
        navigateViaHost([{ to: '/c/$cascadeId', params: { cascadeId } }, { to: href }], href);
      },
      navigateToNewConversation: (projectId) => {
        if (!projectId) return;
        navigateViaHost([{ to: '/', search: { project: projectId } }], `/?project=${encodeURIComponent(projectId)}`);
      },
      captureCallbacksFromRow,
      captureAllNativeProjectCallbacks,
      getNativeProjectCallbacks,
      dispose,
    };
  }

  const FORBIDDEN_PARTITION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const hasOwn = Object.prototype.hasOwnProperty;
  const isSafeMapKey = (k) => typeof k === 'string' && k.length > 0 && !FORBIDDEN_PARTITION_KEYS.has(k);

  function normalizePartitionsState(parsed) {
    const def = { version: 1, partitions: [], projectToPartition: Object.create(null), expandedProjects: Object.create(null) };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return def;
    const partitions = [];
    const validIds = new Set();
    if (Array.isArray(parsed.partitions)) {
      for (const p of parsed.partitions) {
        if (partitions.length >= 100) break;
        if (!p || typeof p !== 'object') continue;
        const id = typeof p.id === 'string' ? p.id.trim().slice(0, 80) : '';
        const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
        if (!id || !name || validIds.has(id)) continue;
        validIds.add(id);
        partitions.push({ id, name, collapsed: Boolean(p.collapsed) });
      }
    }
    const p2p = Object.create(null);
    if (parsed.projectToPartition && typeof parsed.projectToPartition === 'object' && !Array.isArray(parsed.projectToPartition)) {
      let count = 0;
      for (const k of Object.keys(parsed.projectToPartition)) {
        if (count >= 500) break;
        if (!hasOwn.call(parsed.projectToPartition, k)) continue;
        const pid = typeof k === 'string' ? k.trim().slice(0, 128) : '';
        const v = parsed.projectToPartition[k];
        const partId = typeof v === 'string' ? v.trim().slice(0, 80) : '';
        if (!isSafeMapKey(pid) || !validIds.has(partId)) continue;
        if (!hasOwn.call(p2p, pid)) count += 1;
        p2p[pid] = partId;
      }
    }
    const exp = Object.create(null);
    if (parsed.expandedProjects && typeof parsed.expandedProjects === 'object' && !Array.isArray(parsed.expandedProjects)) {
      let count = 0;
      for (const k of Object.keys(parsed.expandedProjects)) {
        if (count >= 500) break;
        if (!hasOwn.call(parsed.expandedProjects, k)) continue;
        const pid = typeof k === 'string' ? k.trim().slice(0, 128) : '';
        if (!isSafeMapKey(pid) || !parsed.expandedProjects[k]) continue;
        if (!hasOwn.call(exp, pid)) count += 1;
        exp[pid] = true;
      }
    }
    return { version: 1, partitions, projectToPartition: p2p, expandedProjects: exp };
  }

  function buildPartitionsRenderSig({ enabled, lang, nowLabel, state, activeCid, projects, projectsByPart, convsByProject, showAllConvsFor, maxVisibleConvs, formatRelativeTime }) {
    const parts = [enabled ? '1' : '0', lang, activeCid || ''];
    for (const p of state.partitions) {
      parts.push(`P:${p.id}:${p.name}:${p.collapsed ? 1 : 0}`);
      if (p.collapsed) continue;
      for (const proj of projectsByPart.get(p.id) || []) {
        const exp = Boolean(state.expandedProjects && hasOwn.call(state.expandedProjects, proj.id) && state.expandedProjects[proj.id]);
        const sa = showAllConvsFor.has(proj.id);
        parts.push(`J:${proj.id}:${proj.name}:${exp ? 1 : 0}:${sa ? 1 : 0}`);
        if (!exp) continue;
        const convs = convsByProject.get(proj.id) || [];
        const lim = sa ? convs.length : Math.min(convs.length, maxVisibleConvs);
        parts.push(`N:${convs.length}`);
        for (let i = 0; i < lim; i++) {
          const c = convs[i];
          parts.push(`C:${c.cascadeId}:${c.title}:${c.pinned ? 1 : 0}:${c.running ? 1 : 0}:${c.running ? '' : formatRelativeTime(c.updatedAt, nowLabel)}`);
        }
      }
    }
    parts.push(`K:${projects.length}`);
    return parts.join('\x1f');
  }

  const hostApi = {
    CHANGE_THROTTLE_MS,
    normalizeUriKey,
    parseTsMs,
    isVisibleConversation,
    isRunningConversation,
    extractProjectCallbacksFromRow,
    normalizePartitionsState,
    buildPartitionsRenderSig,
    createHostBridge,
  };
  G.__agPrismProjectPartitionsHost = hostApi;
  if (typeof window !== 'undefined') window.__agPrismProjectPartitionsHost = hostApi;
  if (typeof module === 'object' && module.exports) module.exports = hostApi;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
