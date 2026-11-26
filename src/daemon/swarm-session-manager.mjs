// Obsidian Prism Swarm 汉化独立生命周期管理器（OOPIF + 同进程子 Frame + 隔离世界 host-i18n 协调，Tier 1）

export const swarmSessionMethods = {
  _isSwarmI18nEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnableSwarmI18n === 'function') {
        return Boolean(this.cdp.shouldEnableSwarmI18n(cfg));
      }
      return false;
    } catch {
      return false;
    }
  },

  _isSwarmTargetInfo(info) {
    if (!info || typeof info !== 'object') return false;
    if (info.type !== 'iframe' && info.type !== 'page') return false;
    if (typeof this.cdp?.isSwarmSidecarUrl !== 'function') return false;
    return Boolean(this.cdp.isSwarmSidecarUrl(info.url));
  },

  _getSwarmI18nCleanupExpression() {
    return (
      this.cdp?.SWARM_I18N_REMOVE_EXPRESSION ||
      "(() => { try { window.__agPrismSwarmI18n?.destroy?.(); } catch {} try { document.documentElement?.removeAttribute?.('data-ag-prism-swarm-i18n'); } catch {} return { ok: true, status: 'off' }; })()"
    );
  },

  _ensureSwarmI18nExpr(cfgOverride = null) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (!this._isSwarmI18nEnabled(cfg) || typeof this.cdp?.buildSwarmI18nExpression !== 'function') {
      this.swarmI18nExpr = '';
      this.swarmI18nCodeHash = '';
      return '';
    }
    if (this.swarmI18nExpr) return this.swarmI18nExpr;
    const chOpts = this._getChannelCacheOpts(true);
    const expr = chOpts
      ? this.cdp.buildSwarmI18nExpression(cfg, null, chOpts)
      : this.cdp.buildSwarmI18nExpression(cfg);
    if (chOpts && this.running) this._scheduleBundleCacheFlush();
    this.swarmI18nExpr = expr || '';
    const hm = this.swarmI18nExpr.match(/targetHash\s*=\s*"([^"]+)"/);
    this.swarmI18nCodeHash = hm ? hm[1] : '';
    return this.swarmI18nExpr;
  },

  _cleanupSwarmSessionLocal(targetId) {
    if (!targetId) return;
    this._swarmAttaching.delete(targetId);
    const entry = this.swarmSessions.get(targetId);
    if (!entry) return;
    this.swarmSessions.delete(targetId);
    if (entry._reloadTimer) {
      clearTimeout(entry._reloadTimer);
      this._managedTimers?.delete(entry._reloadTimer);
      entry._reloadTimer = null;
    }
    try {
      if (typeof entry.session?.detachLocal === 'function') {
        entry.session.detachLocal();
      } else if (typeof this.browserSession?.offSession === 'function' && entry.sessionId) {
        this.browserSession.offSession(entry.sessionId);
      }
    } catch {}
  },

  async _detachSwarmSession(targetId, cleanDom = true) {
    if (!targetId) return;
    this._swarmAttaching.delete(targetId);
    const entry = this.swarmSessions.get(targetId);
    if (!entry) return;
    this.swarmSessions.delete(targetId);
    if (entry._reloadTimer) {
      clearTimeout(entry._reloadTimer);
      this._managedTimers?.delete(entry._reloadTimer);
      entry._reloadTimer = null;
    }
    const child = entry.session;
    const parent = entry.parentSession || this.browserSession;
    try {
      if (child && !child.closed) {
        if (entry.scriptId) {
          await child
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }, 1800)
            .catch(() => {});
          entry.scriptId = null;
        }
        if (cleanDom) {
          await child.evaluate(this._getSwarmI18nCleanupExpression(), false, 2500).catch(() => {});
        }
      }
    } catch {}
    try {
      if (typeof child?.detachLocal === 'function') {
        child.detachLocal();
      } else if (typeof parent?.offSession === 'function' && entry.sessionId) {
        parent.offSession(entry.sessionId);
      }
    } catch {}
    try {
      if (parent && !parent.closed && entry.sessionId) {
        await parent.send('Target.detachFromTarget', { sessionId: entry.sessionId }, 1500).catch(() => {});
      }
    } catch {}
  },

  async _detachAllSwarmSessions(cleanDom = false) {
    const ids = [...this.swarmSessions.keys()];
    this._swarmAttaching.clear();
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((tid) => this._detachSwarmSession(tid, cleanDom)));
    this.swarmSessions.clear();
  },

  _createSwarmChildSession(bSession, sessionId, targetId) {
    if (typeof bSession.createChildSession === 'function') {
      return bSession.createChildSession(sessionId, targetId);
    }
    let closed = false;
    return {
      sessionId,
      targetId,
      onClose: null,
      get closed() {
        return closed || Boolean(bSession.closed);
      },
      send(method, params = {}, timeoutMs = 5000) {
        if (closed || bSession.closed) return Promise.reject(new Error('CDP child session closed'));
        return bSession.send(method, params, timeoutMs, sessionId);
      },
      on(method, cb) {
        if (typeof bSession.onSessionEvent === 'function') {
          bSession.onSessionEvent(sessionId, method, cb);
        }
      },
      async evaluate(expression, awaitPromise = false, timeoutMs = 4000) {
        const res = await this.send(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise },
          timeoutMs
        );
        if (res && res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        }
        return res && res.result ? res.result.value : undefined;
      },
      detachLocal() {
        closed = true;
        if (typeof bSession.offSession === 'function') bSession.offSession(sessionId);
      },
      close() {
        if (closed) return;
        this.detachLocal();
        if (!bSession.closed) {
          bSession.send('Target.detachFromTarget', { sessionId }, 1500).catch(() => {});
        }
      },
    };
  },

  async _attachSwarmTarget(info, cfgOverride = null) {
    const bSession = this.browserSession;
    if (!bSession || bSession.closed || !this.running) return null;
    const targetId = String(info?.targetId || info?.id || '').trim();
    if (!targetId || !this._isSwarmTargetInfo(info)) return null;

    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (!this._isSwarmI18nEnabled(cfg)) {
      if (this.swarmSessions.has(targetId)) {
        await this._detachSwarmSession(targetId, true);
      }
      return null;
    }

    const safeUrl = this._redactSensitiveText(info.url || '');
    const safeTitle = this._redactSensitiveText(info.title || info.url || 'Swarm');

    const existing = this.swarmSessions.get(targetId);
    if (existing && !existing.session.closed) {
      existing.url = safeUrl;
      existing.title = safeTitle;
      const swarmExpr = this._ensureSwarmI18nExpr(cfg);
      if (swarmExpr && existing.codeHash !== this.swarmI18nCodeHash) {
        if (existing.scriptId) {
          await existing.session
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: existing.scriptId }, 1800)
            .catch(() => {});
          existing.scriptId = null;
        }
        const addRes = await existing.session
          .send('Page.addScriptToEvaluateOnNewDocument', { source: swarmExpr }, 2000)
          .catch(() => null);
        if (addRes && addRes.identifier) existing.scriptId = addRes.identifier;
        await existing.session.evaluate(swarmExpr, false, 3500).catch(() => null);
        existing.codeHash = this.swarmI18nCodeHash;
      }
      return existing;
    }

    if (this._swarmAttaching.has(targetId)) return null;
    this._swarmAttaching.add(targetId);
    let sessionId = '';
    let child = null;
    try {
      const swarmExpr = this._ensureSwarmI18nExpr(cfg);
      if (!swarmExpr) return null;

      const attached = await bSession.send('Target.attachToTarget', { targetId, flatten: true }, 2500);
      sessionId = String(attached?.sessionId || '').trim();
      if (!sessionId || !this.running || bSession.closed) {
        if (sessionId && !bSession.closed) {
          await bSession.send('Target.detachFromTarget', { sessionId }, 1500).catch(() => {});
        }
        return null;
      }

      const liveCfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : cfg;
      if (!this._isSwarmI18nEnabled(liveCfg)) {
        await bSession.send('Target.detachFromTarget', { sessionId }, 1500).catch(() => {});
        return null;
      }

      child = this._createSwarmChildSession(bSession, sessionId, targetId);
      // 严格仅启用 Page 域：0 Runtime.addBinding、0 主包注入
      await child.send('Page.enable', {}, 2000).catch(() => {});
      const addRes = await child
        .send('Page.addScriptToEvaluateOnNewDocument', { source: swarmExpr }, 2200)
        .catch(() => null);

      const entry = {
        targetId,
        sessionId,
        parentSession: bSession,
        session: child,
        url: safeUrl,
        title: safeTitle,
        scriptId: addRes && addRes.identifier ? addRes.identifier : null,
        codeHash: this.swarmI18nCodeHash,
        _reloadTimer: null,
      };
      this.swarmSessions.set(targetId, entry);

      const reapplyOnReload = () => {
        if (!this.running || child.closed || this.swarmSessions.get(targetId) !== entry) return;
        if (entry._reloadTimer) {
          clearTimeout(entry._reloadTimer);
          this._managedTimers?.delete(entry._reloadTimer);
          entry._reloadTimer = null;
        }
        const t = setTimeout(() => {
          entry._reloadTimer = null;
          this._managedTimers?.delete(t);
          if (!this.running || child.closed || this.swarmSessions.get(targetId) !== entry) return;
          const reloadCfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
          if (!this._isSwarmI18nEnabled(reloadCfg)) {
            void this._detachSwarmSession(targetId, true).catch(() => {});
            return;
          }
          const exprNow = this._ensureSwarmI18nExpr(reloadCfg);
          if (exprNow) {
            void child.evaluate(exprNow, false, 3500).catch(() => {});
          }
        }, 60);
        if (typeof t.unref === 'function') t.unref();
        entry._reloadTimer = t;
        this._managedTimers?.add(t);
      };
      child.on('Page.domContentLoadedEventFired', reapplyOnReload);
      child.on('Page.loadEventFired', reapplyOnReload);

      const evalRes = await child.evaluate(swarmExpr, false, 3500).catch(() => null);
      this.log(`[✓] Attached Swarm board i18n: ${safeTitle} (${evalRes?.status || 'ok'})`);
      return entry;
    } catch {
      if (child) {
        try { child.detachLocal(); } catch {}
      }
      if (sessionId && !bSession.closed && !this.swarmSessions.has(targetId)) {
        await bSession.send('Target.detachFromTarget', { sessionId }, 1500).catch(() => {});
      }
      return null;
    } finally {
      this._swarmAttaching.delete(targetId);
    }
  },

  async _handleSwarmTargetEvent(info) {
    if (!info || typeof info !== 'object') return;
    const tid = String(info.targetId || info.id || '').trim();
    if (!tid) return;
    if (!this._isSwarmTargetInfo(info)) {
      if (this.swarmSessions.has(tid)) {
        await this._detachSwarmSession(tid, true);
      }
      return;
    }
    const cfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
    if (!this._isSwarmI18nEnabled(cfg)) {
      if (this.swarmSessions.has(tid)) {
        await this._detachSwarmSession(tid, true);
      }
      return;
    }
    await this._attachSwarmTarget(info, cfg);
  },

  async _scanExistingSwarmTargets(bSession = null) {
    const bs = bSession || this.browserSession;
    if (!bs || bs.closed || !this.running) return 0;
    const cfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
    if (!this._isSwarmI18nEnabled(cfg)) return 0;
    const res = await bs.send('Target.getTargets', {}, 2000).catch(() => null);
    const infos = Array.isArray(res?.targetInfos) ? res.targetInfos : [];
    const swarmInfos = infos.filter((info) => this._isSwarmTargetInfo(info));
    if (swarmInfos.length === 0) return 0;
    await Promise.allSettled(swarmInfos.map((info) => this._attachSwarmTarget(info, cfg)));
    return swarmInfos.length;
  },

  async _injectSwarmIntoSubFrame(entry, frameId, ctxId, cfgOverride = null) {
    if (!entry || entry.session.closed || !frameId || typeof ctxId !== 'number') return;
    if (frameId === entry.mainFrameId) return;
    if (this.swarmSessions.has(frameId)) return;
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (!this._isSwarmI18nEnabled(cfg)) return;
    const expr = this._ensureSwarmI18nExpr(cfg);
    if (!expr) return;
    const sub = entry.swarmSubFrames?.get(frameId);
    const evalRes = await entry.session
      .send('Runtime.evaluate', { contextId: ctxId, expression: expr, returnByValue: true }, 3500)
      .catch(() => null);
    if (sub && evalRes && evalRes.result && evalRes.result.value && evalRes.result.value.ok) {
      sub.mounted = true;
      sub.codeHash = this.swarmI18nCodeHash;
    }
  },

  async _cleanupSwarmSubFrames(entry, cleanDom = true) {
    if (!entry || !(entry.swarmSubFrames instanceof Map) || entry.swarmSubFrames.size === 0) return;
    if (cleanDom && !entry.session.closed) {
      const cleanupExpr = this._getSwarmI18nCleanupExpression();
      for (const sub of entry.swarmSubFrames.values()) {
        if (sub && typeof sub.contextId === 'number') {
          await entry.session
            .send('Runtime.evaluate', { contextId: sub.contextId, expression: cleanupExpr, returnByValue: true }, 2500)
            .catch(() => {});
          sub.mounted = false;
        }
      }
    }
  },

  async _syncSwarmSessionsForConfig(cfgOverride = null) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    const enabled = this._isSwarmI18nEnabled(cfg);
    if (!enabled) {
      this.swarmI18nExpr = '';
      this.swarmI18nCodeHash = '';
      await this._detachAllSwarmSessions(true);
      for (const entry of this.sessions.values()) {
        await this._cleanupSwarmSubFrames(entry, true).catch(() => {});
      }
      return;
    }
    if (this.swarmSessions.size > 0) {
      const swarmExpr = this._ensureSwarmI18nExpr(cfg);
      if (swarmExpr) {
        const entries = [...this.swarmSessions.values()];
        await Promise.allSettled(
          entries.map(async (entry) => {
            if (!entry || entry.session.closed) return;
            if (entry.scriptId) {
              await entry.session
                .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }, 1800)
                .catch(() => {});
              entry.scriptId = null;
            }
            const addRes = await entry.session
              .send('Page.addScriptToEvaluateOnNewDocument', { source: swarmExpr }, 2000)
              .catch(() => null);
            if (addRes && addRes.identifier) entry.scriptId = addRes.identifier;
            await entry.session.evaluate(swarmExpr, false, 3500).catch(() => {});
            entry.codeHash = this.swarmI18nCodeHash;
          })
        );
      }
    } else if (this.browserSession && !this.browserSession.closed) {
      await this._scanExistingSwarmTargets(this.browserSession).catch(() => {});
    }
    for (const entry of this.sessions.values()) {
      if (!entry || entry.session.closed || !(entry.swarmSubFrames instanceof Map)) continue;
      for (const [fid, sub] of entry.swarmSubFrames.entries()) {
        if (sub && typeof sub.contextId === 'number') {
          await this._injectSwarmIntoSubFrame(entry, fid, sub.contextId, cfg).catch(() => {});
        }
      }
    }
  },

  _getMainFrameIsolatedContextIds(entry, filterIds = null) {
    if (!entry || !(entry.contextFrames instanceof Map) || !entry.mainFrameId) return [];
    const allowSet = Array.isArray(filterIds) ? new Set(filterIds) : null;
    const ids = [];
    for (const [ctxId, meta] of entry.contextFrames.entries()) {
      if (typeof ctxId !== 'number' || !meta) continue;
      if (allowSet && !allowSet.has(ctxId)) continue;
      if (meta.frameId !== entry.mainFrameId) continue;
      if (meta.isDefault === true) continue;
      if (meta.type !== 'isolated') continue;
      ids.push(ctxId);
    }
    return ids;
  },

  async _syncIsolatedHostI18n(entry, shouldPause, opts = null) {
    const empty = { attempted: 0, pausedAny: false, newlyPaused: false, resumedAny: false };
    if (!entry || !entry.session || entry.session.closed) return empty;
    const pauseExpr = this.cdp?.ISOLATED_HOST_I18N_PAUSE_EXPRESSION || '';
    const resumeExpr = this.cdp?.ISOLATED_HOST_I18N_RESUME_EXPRESSION || '';
    const expr = shouldPause ? pauseExpr : resumeExpr;
    if (!expr) return empty;
    if (!shouldPause && !entry.isolatedHostI18nPaused && !(opts && opts.force)) return empty;
    const ctxIds = this._getMainFrameIsolatedContextIds(entry, opts && opts.contextIds);
    if (ctxIds.length === 0) {
      if (!shouldPause) entry.isolatedHostI18nPaused = false;
      return empty;
    }
    if (!(entry.isolatedHostI18nNoExtCtxs instanceof Set)) {
      entry.isolatedHostI18nNoExtCtxs = new Set();
    }
    const skipCheckedNoExt = Boolean(shouldPause && opts && opts.skipNoExt);
    let attempted = 0;
    let pausedAny = false;
    let newlyPaused = false;
    let resumedAny = false;
    for (const ctxId of ctxIds) {
      if (entry.session.closed) break;
      if (skipCheckedNoExt && entry.isolatedHostI18nNoExtCtxs.has(ctxId)) continue;
      attempted += 1;
      const res = await entry.session
        .send('Runtime.evaluate', { contextId: ctxId, expression: expr, returnByValue: true }, 1800)
        .catch(() => null);
      const val = res && res.result ? res.result.value : null;
      if (shouldPause) {
        if (val && val.ok && val.paused) {
          pausedAny = true;
          entry.isolatedHostI18nNoExtCtxs.delete(ctxId);
          if (!val.alreadyPaused) newlyPaused = true;
        } else if (val && val.ok && val.detected === false) {
          entry.isolatedHostI18nNoExtCtxs.add(ctxId);
        }
      } else if (val && val.ok && val.resumed) {
        resumedAny = true;
      }
    }
    if (shouldPause) {
      if (pausedAny) entry.isolatedHostI18nPaused = true;
    } else {
      entry.isolatedHostI18nPaused = false;
    }
    return { attempted, pausedAny, newlyPaused, resumedAny };
  },

  async _forceMainWorldHostI18nOffRescan(entry) {
    if (!entry || !entry.session || entry.session.closed) return;
    await entry.session
      .evaluate(
        "(() => { try { window.__agPrismHostI18n?.setMode?.('off', true); (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {} return true; })()",
        false,
        2500
      )
      .catch(() => {});
  },
};
