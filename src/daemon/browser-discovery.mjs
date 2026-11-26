// Obsidian Prism Browser 级 CDP 目标发现与防 25Hz 抖动过滤（Tier 2）
import { extractScopeKeyFromTitle } from './telemetry-scope.mjs';
import { evaluateTargetInfoChange } from './session-fsm.mjs';

export const browserDiscoveryMethods = {
  closeBrowserDiscovery() {
    this._browserDiscoverySubscribed = false;
    this._lastListPagesAt = 0;
    if (this._discoverTimer) {
      clearTimeout(this._discoverTimer);
      this._discoverTimer = null;
    }
    this._discoverTimerTargetAt = 0;
    for (const tid of [...this.swarmSessions.keys()]) {
      this._cleanupSwarmSessionLocal(tid);
    }
    this.swarmSessions.clear();
    this._swarmAttaching.clear();
    if (this.browserSession) {
      const bs = this.browserSession;
      this.browserSession = null;
      this.browserPort = null;
      try {
        bs.close();
      } catch {}
    }
  },

  _computeCoalescedTickDelay(baseDelayMs = 45) {
    const base = Math.max(20, Number(baseDelayMs) || 45);
    const now = Date.now();
    const recent = this._lastTickFinishedAt > 0 && now - this._lastTickFinishedAt < 120;
    if (recent) {
      this._reentrantTickStreak = Math.min(8, (this._reentrantTickStreak || 0) + 1);
    } else {
      this._reentrantTickStreak = 0;
    }
    if (this._reentrantTickStreak <= 1) return base;
    return Math.min(1000, base * Math.pow(2, Math.min(4, this._reentrantTickStreak - 1)));
  },

  scheduleImmediateTick(delayMs = 45) {
    if (!this.running) return;
    if (this.busy) {
      this._pendingTick = true;
      return;
    }
    const effectiveDelay = this._computeCoalescedTickDelay(delayMs);
    const targetAt = Date.now() + effectiveDelay;
    // 合并重入调度：若已有更早或同窗口内的待执行 timer，直接复用以防 25Hz 空转与定时器饥饿
    if (this._discoverTimer && this._discoverTimerTargetAt > 0 && this._discoverTimerTargetAt <= targetAt + 15) {
      return;
    }
    if (this._discoverTimer) clearTimeout(this._discoverTimer);
    this._discoverTimerTargetAt = targetAt;
    this._discoverTimer = setTimeout(() => {
      this._discoverTimer = null;
      this._discoverTimerTargetAt = 0;
      if (this.running) void this.tick();
    }, effectiveDelay);
    if (this._discoverTimer && typeof this._discoverTimer.unref === 'function') {
      this._discoverTimer.unref();
    }
  },

  _handleBrowserTargetEvent(params) {
    const info = params?.targetInfo;
    if (!info) return { handled: false, dirty: false };
    const tid = info.targetId || info.id || '';
    // Issue #18 层 B：Swarm 独立侧栏 OOPIF (plugin://swarm--swarm_board-*) 走独立按需状态机
    if (this._isSwarmTargetInfo(info) || (tid && this.swarmSessions.has(tid))) {
      void this._handleSwarmTargetEvent(info).catch(() => {});
      return { handled: true, dirty: false, swarm: true };
    }
    if (info.type !== 'page') return { handled: false, dirty: false };

    // 已附着页面：仅在实质 origin/pathname/search 改变或目标状态跃迁时标脏，忽略 #hash 或 title 高频抖动
    for (const existing of this.sessions.values()) {
      if (tid && existing.pageId === tid) {
        const change = evaluateTargetInfoChange(existing, info);
        if (typeof info.title === 'string' && info.title && info.title !== existing.title) {
          existing.title = info.title;
          const titleScope = extractScopeKeyFromTitle(info.title);
          if (titleScope && titleScope !== existing.detectedScopeKey) {
            existing.detectedScopeKey = titleScope;
            existing._usageScopeVerified = false;
          }
        }
        if (typeof info.url === 'string' && info.url) {
          existing.url = info.url;
        }
        if (typeof info.attached === 'boolean') {
          existing.targetAttached = info.attached;
        }
        if (typeof info.type === 'string' && info.type) {
          existing.targetType = info.type;
        }
        if (change.dirty) {
          existing.detectedScopeKey = '';
          existing._usageScopeVerified = false;
          existing.verifyDirty = true;
          existing.healthyStreak = 0;
          this.scheduleImmediateTick(45);
        }
        return { handled: true, dirty: change.dirty, existing: true };
      }
    }

    if (!this._isEligibleDaemonTarget({ ...info, id: tid, webSocketDebuggerUrl: 'ws://check' })) {
      return { handled: false, dirty: false };
    }
    this._forceListPagesNextTick = true;
    this.scheduleImmediateTick(45);
    return { handled: true, dirty: true, discovered: true };
  },

  async ensureBrowserDiscovery(port) {
    if (!this.running || !port || typeof this.cdp.getBrowserWsUrl !== 'function') return;
    if (this.browserSession && !this.browserSession.closed && this.browserPort === port) return;
    this.closeBrowserDiscovery();
    try {
      const browserWs = await this.cdp.getBrowserWsUrl(port);
      if (!browserWs || !this.running) return;
      const bSession = await this.cdp.CdpSession.connect(browserWs, 1800);
      if (!this.running) {
        bSession.close();
        return;
      }
      this.browserSession = bSession;
      this.browserPort = port;
      this._browserDiscoverySubscribed = false;
      bSession.onClose = () => {
        if (this.browserSession === bSession) {
          this.browserSession = null;
          this.browserPort = null;
          this._browserDiscoverySubscribed = false;
          this._lastListPagesAt = 0;
          for (const tid of [...this.swarmSessions.keys()]) {
            this._cleanupSwarmSessionLocal(tid);
          }
          this.swarmSessions.clear();
          this._swarmAttaching.clear();
        }
      };
      const onTargetEvent = (params) => {
        this._handleBrowserTargetEvent(params);
      };
      bSession.on('Target.targetCreated', onTargetEvent);
      bSession.on('Target.targetInfoChanged', onTargetEvent);
      bSession.on('Target.targetDestroyed', (params) => {
        const tid = String(params?.targetId || '').trim();
        if (tid) this._cleanupSwarmSessionLocal(tid);
      });
      bSession.on('Target.detachedFromTarget', (params) => {
        const tid = String(params?.targetId || '').trim();
        if (tid && this.swarmSessions.has(tid)) {
          this._cleanupSwarmSessionLocal(tid);
          return;
        }
        const sid = String(params?.sessionId || '').trim();
        if (sid) {
          for (const [k, ent] of this.swarmSessions.entries()) {
            if (ent && ent.sessionId === sid) {
              this._cleanupSwarmSessionLocal(k);
              break;
            }
          }
        }
      });
      const subOk = await bSession
        .send('Target.setDiscoverTargets', { discover: true }, 1500)
        .then(() => true)
        .catch(() => false);
      if (this.browserSession === bSession && !bSession.closed && subOk) {
        this._browserDiscoverySubscribed = true;
        // 立即补扫已打开的 Swarm OOPIF，避免 tick() 早退导致已有面板漏接管
        void this._scanExistingSwarmTargets(bSession).catch(() => {});
      }
    } catch {}
  },
};
