// Obsidian Prism Browser 级 CDP 目标发现与防 25Hz 抖动过滤辅助（Tier 2，无原型 Mixin，由 SessionRegistry 组合调用）
import { extractScopeKeyFromTitle, extractScopeKeyFromUri } from './telemetry-scope.mjs';
import { evaluateTargetInfoChange, isSameSpaDocumentRoute } from './session-fsm.mjs';

function normalizeDocUrlWithoutHashOrTab(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const hashIdx = s.indexOf('#');
  const noHash = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  try {
    const u = new URL(noHash);
    const params = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (k.toLowerCase() === 'tab') continue;
      params.push([k, v]);
    }
    params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
    const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${q}`;
  } catch {
    return noHash;
  }
}

const SPA_CONV_PATH_RE = /^\/(?:c\/[0-9a-f-]{8,}\/?)?$/i;

function normalizeSwarmUrlKey(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const hashIdx = s.indexOf('#');
  return hashIdx >= 0 ? s.slice(0, hashIdx) : s;
}

/**
 * 判断两次 URL 变化是否属于同源 HTTP(S) SPA 内的普通对话切换（例如 /c/<id1> -> /c/<id2> 或 / <-> /c/<id>），
 * 仅在同协议、同 host、同 remoteAuthority 且同 scopeKey 时返回 true；跨 HTML 文档（如 vscode-file://）或跨源绝不放行。
 */
export function isSameSpaConversationRoute(prevUrl, nextUrl) {
  if (!prevUrl || !nextUrl || typeof prevUrl !== 'string' || typeof nextUrl !== 'string') return false;
  if (prevUrl === nextUrl) return true;
  try {
    const a = new URL(prevUrl);
    const b = new URL(nextUrl);
    if ((a.protocol !== 'http:' && a.protocol !== 'https:') || a.protocol !== b.protocol || a.host !== b.host) {
      return false;
    }
    const raA = a.searchParams.get('remoteAuthority') || '';
    const raB = b.searchParams.get('remoteAuthority') || '';
    if (raA !== raB) return false;
    if (extractScopeKeyFromUri(prevUrl) !== extractScopeKeyFromUri(nextUrl)) return false;
    return SPA_CONV_PATH_RE.test(a.pathname) && SPA_CONV_PATH_RE.test(b.pathname);
  } catch {
    return false;
  }
}

export function isSameDocumentIgnoringHashAndTab(prevUrl, nextUrl) {
  if (!prevUrl || !nextUrl || typeof prevUrl !== 'string' || typeof nextUrl !== 'string') return false;
  if (prevUrl === nextUrl) return true;
  if (normalizeDocUrlWithoutHashOrTab(prevUrl) !== normalizeDocUrlWithoutHashOrTab(nextUrl)) return false;
  return extractScopeKeyFromUri(prevUrl) === extractScopeKeyFromUri(nextUrl);
}

export function closeBrowserDiscovery(reg) {
  reg._browserDiscoverySubscribed = false;
  reg._lastListPagesAt = 0;
  if (reg._discoverTimer) {
    clearTimeout(reg._discoverTimer);
    reg._discoverTimer = null;
  }
  reg._discoverTimerTargetAt = 0;
  reg._swarmTargetUrls?.clear?.();
  reg._deps.onSwarmCloseAllLocal?.();
  if (reg.browserSession) {
    const bs = reg.browserSession;
    reg.browserSession = null;
    reg.browserPort = null;
    try {
      bs.close();
    } catch {}
  }
}

export function computeCoalescedTickDelay(reg, baseDelayMs = 45) {
  const base = Math.max(20, Number(baseDelayMs) || 45);
  const now = Date.now();
  const recent = reg._lastTickFinishedAt > 0 && now - reg._lastTickFinishedAt < 120;
  if (recent) {
    reg._reentrantTickStreak = Math.min(8, (reg._reentrantTickStreak || 0) + 1);
  } else {
    reg._reentrantTickStreak = 0;
  }
  if (reg._reentrantTickStreak <= 1) return base;
  return Math.min(1000, base * Math.pow(2, Math.min(4, reg._reentrantTickStreak - 1)));
}

export function scheduleImmediateTick(reg, delayMs = 45) {
  if (!reg._deps.isRunning()) return;
  if (reg._deps.isBusy()) {
    reg._deps.markPendingTick();
    return;
  }
  const effectiveDelay = computeCoalescedTickDelay(reg, delayMs);
  const targetAt = Date.now() + effectiveDelay;
  if (reg._discoverTimer && reg._discoverTimerTargetAt > 0 && reg._discoverTimerTargetAt <= targetAt + 15) {
    return;
  }
  if (reg._discoverTimer) clearTimeout(reg._discoverTimer);
  reg._discoverTimerTargetAt = targetAt;
  reg._discoverTimer = setTimeout(() => {
    reg._discoverTimer = null;
    reg._discoverTimerTargetAt = 0;
    if (reg._deps.isRunning()) void reg._deps.triggerTick();
  }, effectiveDelay);
  if (reg._discoverTimer && typeof reg._discoverTimer.unref === 'function') {
    reg._discoverTimer.unref();
  }
}

export function handleBrowserTargetEvent(reg, params) {
  const info = params?.targetInfo;
  if (!info) return { handled: false, dirty: false };
  const tid = info.targetId || info.id || '';
  const isSwarmInfo = Boolean(reg._deps.isSwarmTargetInfo?.(info));
  const hasSwarm = Boolean(tid && reg._deps.hasSwarmSession?.(tid));
  if (isSwarmInfo || hasSwarm) {
    if (!(reg._swarmTargetUrls instanceof Map)) reg._swarmTargetUrls = new Map();
    const normSwarmUrl = normalizeSwarmUrlKey(info.url);
    if (hasSwarm && isSwarmInfo && normSwarmUrl && reg._swarmTargetUrls.get(tid) === normSwarmUrl) {
      return { handled: true, dirty: false, swarm: true, skipped: true };
    }
    if (tid) {
      if (isSwarmInfo && normSwarmUrl) reg._swarmTargetUrls.set(tid, normSwarmUrl);
      else reg._swarmTargetUrls.delete(tid);
    }
    void reg._deps.onSwarmTargetEvent?.(info)?.catch?.(() => {});
    return { handled: true, dirty: false, swarm: true };
  }
  if (info.type !== 'page') return { handled: false, dirty: false };

  for (const existing of reg.sessions.values()) {
    if (tid && existing.pageId === tid) {
      const prevUrl = existing.url;
      const change = evaluateTargetInfoChange(existing, info);
      if (typeof info.title === 'string' && info.title && info.title !== existing.title) {
        existing.title = info.title;
        const titleScope = extractScopeKeyFromTitle(info.title);
        if (titleScope && titleScope !== existing.detectedScopeKey) {
          existing.detectedScopeKey = titleScope;
          existing._usageScopeVerified = false;
        }
      }
      const sameSpaRoute = Boolean(
        !change.stateTransition &&
          existing.healthyStreak > 0 &&
          typeof info.url === 'string' &&
          info.url &&
          info.url !== prevUrl &&
          (isSameSpaDocumentRoute(prevUrl, info.url) ||
            isSameDocumentIgnoringHashAndTab(prevUrl, info.url) ||
            isSameSpaConversationRoute(prevUrl, info.url))
      );
      if (typeof info.url === 'string' && info.url) {
        existing.url = info.url;
      }
      if (typeof info.attached === 'boolean') {
        existing.targetAttached = info.attached;
      }
      if (typeof info.type === 'string' && info.type) {
        existing.targetType = info.type;
      }
      const effectiveDirty = change.dirty && !sameSpaRoute;
      if (effectiveDirty) {
        existing.detectedScopeKey = '';
        existing._usageScopeVerified = false;
        existing.verifyDirty = true;
        existing.healthyStreak = 0;
        reg._deps.scheduleImmediateTick(45);
      }
      return { handled: true, dirty: effectiveDirty, existing: true, ...(sameSpaRoute ? { sameSpaRoute: true } : {}) };
    }
  }

  if (!reg.isEligibleDaemonTarget({ ...info, id: tid, webSocketDebuggerUrl: 'ws://check' })) {
    return { handled: false, dirty: false };
  }
  reg._forceListPagesNextTick = true;
  reg._deps.scheduleImmediateTick(45);
  return { handled: true, dirty: true, discovered: true };
}

export async function ensureBrowserDiscovery(reg, port) {
  const cdp = reg._deps.getCdp();
  if (!reg._deps.isRunning() || !port || typeof cdp?.getBrowserWsUrl !== 'function') return;
  if (reg.browserSession && !reg.browserSession.closed && reg.browserPort === port) return;
  closeBrowserDiscovery(reg);
  try {
    const browserWs = await cdp.getBrowserWsUrl(port);
    if (!browserWs || !reg._deps.isRunning()) return;
    const bSession = await cdp.CdpSession.connect(browserWs, 1800);
    if (!reg._deps.isRunning()) {
      bSession.close();
      return;
    }
    reg.browserSession = bSession;
    reg.browserPort = port;
    reg._browserDiscoverySubscribed = false;
    bSession.onClose = () => {
      if (reg.browserSession === bSession) {
        reg.browserSession = null;
        reg.browserPort = null;
        reg._browserDiscoverySubscribed = false;
        reg._lastListPagesAt = 0;
        reg._deps.onSwarmCloseAllLocal?.();
      }
    };
    const onTargetEvent = (params) => {
      reg.handleBrowserTargetEvent(params);
    };
    bSession.on('Target.targetCreated', onTargetEvent);
    bSession.on('Target.targetInfoChanged', onTargetEvent);
    bSession.on('Target.targetDestroyed', (params) => {
      const tid = String(params?.targetId || '').trim();
      if (tid) {
        reg._swarmTargetUrls?.delete?.(tid);
        reg._deps.onSwarmCleanupLocal?.(tid);
      }
    });
    bSession.on('Target.detachedFromTarget', (params) => {
      const tid = String(params?.targetId || '').trim();
      if (tid && reg._deps.hasSwarmSession?.(tid)) {
        reg._swarmTargetUrls?.delete?.(tid);
        reg._deps.onSwarmCleanupLocal?.(tid);
        return;
      }
      const sid = String(params?.sessionId || '').trim();
      if (sid) reg._deps.onSwarmCleanupBySessionId?.(sid);
    });
    const subOk = await bSession
      .send('Target.setDiscoverTargets', { discover: true }, 1500)
      .then(() => true)
      .catch(() => false);
    if (reg.browserSession === bSession && !bSession.closed && subOk) {
      reg._browserDiscoverySubscribed = true;
      void reg._deps.onScanExistingSwarmTargets?.(bSession)?.catch?.(() => {});
    }
  } catch {}
}
