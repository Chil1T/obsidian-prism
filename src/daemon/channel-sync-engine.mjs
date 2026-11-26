// Obsidian Prism 全 16 通道表驱动挂载、增量同步、配置广播收敛与拆卸引擎（消费 CHANNEL_REGISTRY，无原型 Mixin）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  THOUGHT_BINDING,
  SIDEBAR_BINDING,
  INLINE_DIFF_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
} from './constants.mjs';
import {
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  recordEntryCh1Outcome,
  resetAllChannelCircuits,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';
import { CHANNEL_STATIC_SPECS, buildSidebarCleanupExpression } from './channel-coordinator.mjs';

const BINDING_BY_CHANNEL = Object.freeze({
  omni: { name: () => OMNI_BINDING, addedField: null },
  sidebar: { name: () => SIDEBAR_BINDING, addedField: 'sidebarBindingAdded' },
  thought: { name: () => THOUGHT_BINDING, addedField: null },
  inlineDiff: { name: () => INLINE_DIFF_BINDING, addedField: 'inlineDiffBindingAdded' },
  wallpaper: { name: (cdp) => cdp?.WALLPAPER_BINDING || WALLPAPER_BINDING, addedField: 'wallpaperBindingAdded' },
  suggester: { name: (cdp) => cdp?.SUGGESTER_BINDING || SUGGESTER_BINDING, addedField: 'suggesterBindingAdded' },
});

const PERSISTENT_SPECS = Object.freeze(
  CHANNEL_STATIC_SPECS.filter((s) => s.injectMode === 'main-page-persistent').sort((a, b) => a.order - b.order)
);

export async function ensureChannelBinding(orch, entry, channelId, timeoutMs = 2600, force = false) {
  const meta = BINDING_BY_CHANNEL[channelId];
  if (!meta || !entry || entry.session.closed) return false;
  if (meta.addedField && !force && entry[meta.addedField]) return true;
  const bindingName = meta.name(orch.getCdp());
  if (!bindingName) return false;
  const ok = await entry.session.send('Runtime.addBinding', { name: bindingName }, timeoutMs).then(() => true).catch(() => false);
  if (ok && meta.addedField) entry[meta.addedField] = true;
  return ok;
}

export async function removeChannelBinding(orch, entry, channelId, timeoutMs = 2000) {
  const meta = BINDING_BY_CHANNEL[channelId];
  if (!meta || !entry || entry.session.closed) return;
  if (channelId === 'sidebar' && !entry.sidebarBindingAdded) return;
  const bindingName = meta.name(orch.getCdp());
  if (bindingName) {
    await entry.session.send('Runtime.removeBinding', { name: bindingName }, timeoutMs).catch(() => {});
  }
  if (meta.addedField) entry[meta.addedField] = false;
}

export async function replaceEntryNewDocScript(entry, scriptProp, source) {
  if (!entry || !scriptProp || entry.session?.closed) return null;
  if (entry[scriptProp]) {
    await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] }).catch(() => {});
    entry[scriptProp] = null;
  }
  if (!source) return null;
  const addRes = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', { source }).catch(() => null);
  if (addRes && addRes.identifier) {
    entry[scriptProp] = addRes.identifier;
    return addRes.identifier;
  }
  return null;
}

export async function syncPersistentNewDocScript(entry, enabled, source, scriptProp, sigProp, targetSig) {
  if (!scriptProp) return;
  if (!enabled || !source) {
    if (entry[scriptProp]) {
      await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] }).catch(() => {});
      entry[scriptProp] = null;
    }
    if (sigProp) entry[sigProp] = '';
    return;
  }
  if (!entry.session.closed && (!entry[scriptProp] || (sigProp && entry[sigProp] !== targetSig))) {
    const id = await replaceEntryNewDocScript(entry, scriptProp, source);
    if (id && sigProp) entry[sigProp] = targetSig;
  }
}

export async function recordTrackableSkipOutcome(orch, entry, spec, evalRes, hash, now = Date.now()) {
  const f = spec.fields;
  const isSkipped = Boolean(evalRes && typeof evalRes.status === 'string' && evalRes.status.startsWith('skipped-'));
  if (evalRes && evalRes.ok) {
    entry[f.mountedField] = true;
    entry[f.skippedField] = false;
    entry[f.sigField] = hash;
    recordChannelSuccess(entry, spec.id, { codeHash: hash, scriptId: entry[f.scriptField] });
  } else if (isSkipped) {
    entry[f.mountedField] = false;
    entry[f.skippedField] = true;
    entry[f.sigField] = hash;
    recordChannelSkipped(entry, spec.id, { codeHash: hash });
    if (evalRes.status === 'skipped-non-host') await removeChannelBinding(orch, entry, spec.id);
  } else {
    entry[f.mountedField] = false;
    entry[f.skippedField] = false;
    entry[f.sigField] = '';
    recordChannelFailure(entry, spec.id, { now });
  }
}

export async function cleanupChannelOnEntry(orch, entry, spec, { forceSidebarCleanup = false, timeoutMs = 3500 } = {}) {
  if (!entry || !spec) return;
  const f = spec.fields;
  if (f.scriptField) {
    await replaceEntryNewDocScript(entry, f.scriptField, '');
  }
  if (spec.id === 'sidebar' || spec.id === 'wallpaper' || spec.id === 'suggester') {
    await removeChannelBinding(orch, entry, spec.id);
  }
  if (!entry.session.closed) {
    const cleanupExpr = spec.id === 'sidebar' ? buildSidebarCleanupExpression(forceSidebarCleanup) : orch.getChannelCleanupExpression(spec);
    if (cleanupExpr) {
      if (timeoutMs > 0) await entry.session.evaluate(cleanupExpr, false, timeoutMs).catch(() => null);
      else await entry.session.evaluate(cleanupExpr).catch(() => null);
    }
  }
  if (f.mountedField) entry[f.mountedField] = false;
  if (f.sigField) entry[f.sigField] = '';
  if (f.scriptSigField) entry[f.scriptSigField] = '';
  if (f.skippedField) entry[f.skippedField] = false;
  if (spec.id === 'hostI18n') entry.hostI18nSkippedByLiveCfg = false;
  recordChannelOff(entry, spec.id);
}

export async function teardownAllEntryChannelScripts(
  orch,
  entry,
  session = entry?.session,
  { markSkippedNonHost = false, removeBindings = true, resetMascot = true, resetHomeStudio = true } = {}
) {
  if (!entry) return;
  if (entry.scriptId && session && !session.closed) {
    await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
  }
  entry.scriptId = null;

  for (const spec of PERSISTENT_SPECS) {
    if (spec.id === 'mascot' && !resetMascot) continue;
    if (spec.id === 'homeStudio' && !resetHomeStudio) continue;
    const f = spec.fields;
    if (f.scriptField) {
      if (entry[f.scriptField] && session && !session.closed) {
        await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[f.scriptField] }).catch(() => {});
      }
      entry[f.scriptField] = null;
    }
    if (f.mountedField) entry[f.mountedField] = false;
    if (f.sigField) entry[f.sigField] = '';
    if (f.scriptSigField) entry[f.scriptSigField] = '';
    if (f.skippedField) entry[f.skippedField] = Boolean(markSkippedNonHost);
    if (spec.id === 'hostI18n') entry.hostI18nSkippedByLiveCfg = false;
    recordChannelOff(entry, spec.id);
  }

  if (removeBindings) {
    for (const id of ['sidebar', 'inlineDiff', 'wallpaper', 'suggester']) {
      await removeChannelBinding(orch, entry, id);
    }
  }
}

export async function healSingleChannelOnEntry(orch, entry, spec, cfg, probe, { afterCh1Heal = false, hashMismatch = false, forceEval = false, now = Date.now() } = {}) {
  const id = spec.id;
  const f = spec.fields;

  // 1) 服务/绑定前置钩子
  if (id === 'omni' && !afterCh1Heal) {
    await orch.ensureOmniServer().catch(() => null);
    await ensureChannelBinding(orch, entry, 'omni', 2600, true);
  } else if (id === 'sidebar' && !afterCh1Heal) {
    await orch.ensureSidebarService().catch(() => null);
    await ensureChannelBinding(orch, entry, 'sidebar', 2600, true);
  } else if (id === 'thought' && !afterCh1Heal) {
    await ensureChannelBinding(orch, entry, 'thought', 2600, true);
  } else if (id === 'inlineDiff' && !afterCh1Heal) {
    await ensureChannelBinding(orch, entry, 'inlineDiff', 2600, true);
  } else if (id === 'wallpaper' || id === 'suggester') {
    await ensureChannelBinding(orch, entry, id, 2600, true);
  }

  // 2) 确保编译表达式就绪
  const activeExpr = orch.ensureChannelExpr(spec, cfg);
  if (!activeExpr || entry.session.closed) return;

  const chHash = orch.getChannelExprHash(spec, activeExpr);
  const chSig = id === 'omni' ? activeExpr : orch.getChannelCfgSig(spec, cfg, activeExpr);

  // 3) 同步持久化 NewDocument 脚本
  if (f.scriptField && id !== 'sidebar') {
    const needScriptReplace =
      !entry[f.scriptField] ||
      (id === 'wallpaper' && Boolean(chHash && entry[f.scriptSigField] !== chHash)) ||
      (id !== 'omni' && id !== 'thought' && !spec.tracksSkippedNonHost && Boolean(chSig && entry[f.scriptSigField] !== chSig));
    if (needScriptReplace) {
      const addedId = await replaceEntryNewDocScript(entry, f.scriptField, activeExpr);
      if (f.scriptSigField) entry[f.scriptSigField] = addedId ? chSig : '';
    }
  }

  // 4) 判定是否需要立即 evaluate 挂载/更新
  let needsEval = forceEval || afterCh1Heal || !probe;
  if (!needsEval) {
    if (id === 'omni' || id === 'sidebar') {
      needsEval = true;
    } else if (id === 'thought') {
      needsEval = !probe.hasThought || !probe.hasThoughtSettingsUi || !entry.thoughtMounted;
    } else if (id === 'inlineDiff') {
      needsEval = !probe.hasInlineDiff || !entry.inlineDiffMounted;
    } else if (id === 'wallpaper') {
      needsEval = !probe.hasWallpaper || !probe.hasWallpaperUi || hashMismatch || !entry.wallpaperMounted;
    } else if (id === 'suggester') {
      needsEval = probe.hasSuggester === false || probe.hasSuggesterUi === false || !entry.suggesterMounted;
    } else {
      needsEval = !probe[f.probeHasField] || Boolean(chHash && f.probeHashField && probe[f.probeHashField] !== chHash);
    }
  }
  if (!needsEval || entry.session.closed) return;

  const evalTimeoutMs = id === 'omni' || id === 'sidebar' ? 3500 : 4500;
  const evalRes = await entry.session.evaluate(activeExpr, false, evalTimeoutMs).catch(() => null);

  // 5) 统一结果记录与 Per-Channel 熔断状态更新
  if (spec.tracksSkippedNonHost) {
    await recordTrackableSkipOutcome(orch, entry, spec, evalRes, chHash, now);
  } else if (id === 'omni') {
    if (evalRes && evalRes.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: entry.omniScriptId });
    else recordChannelFailure(entry, 'omni', { now });
  } else if (id === 'sidebar') {
    if (evalRes === null) recordChannelFailure(entry, 'sidebar', { now });
    else {
      entry.sidebarMounted = true;
      recordChannelSuccess(entry, 'sidebar', { scriptId: entry.sidebarScriptId });
    }
  } else if (evalRes && evalRes.ok) {
    if (spec.respectSkippedByLiveCfg && evalRes.skippedByLiveCfg) {
      entry[f.mountedField] = false;
      if (f.sigField) entry[f.sigField] = chSig;
      recordChannelSkipped(entry, id, { codeHash: chHash || chSig });
    } else {
      if (f.mountedField) entry[f.mountedField] = true;
      if (f.sigField) entry[f.sigField] = chSig;
      recordChannelSuccess(entry, id, { codeHash: chHash || chSig, scriptId: entry[f.scriptField] });
    }
  } else {
    if (id === 'thought' && afterCh1Heal) {
      entry.thoughtMounted = false;
      entry.lastThoughtSig = '';
    }
    recordChannelFailure(entry, id, { now });
  }
}

export async function applyAllChannelsToEntry(orch, entry) {
  return orch.sessionRegistry.runExclusive(entry, async () => {
    if (!entry || entry.session.closed) return null;
    ensureEntryFsm(entry);
    transitionEntryState(entry, ENTRY_FSM_STATES.INJECTING_CH1, 'applyToEntry');
    const cdp = orch.getCdp();
    const readCfg = () => (typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null);
    let cfgSeq = orch._configSeq;
    let cfg = readCfg();
    const getCurrentCfg = () => {
      if (orch._configSeq !== cfgSeq) {
        cfgSeq = orch._configSeq;
        cfg = readCfg();
      }
      return cfg;
    };

    const omniSpec = orch.getRegisteredChannel('omni');
    const sidebarSpec = orch.getRegisteredChannel('sidebar');
    const omniEnabledInit = orch.isChannelEnabled(omniSpec, cfg);
    if (omniEnabledInit) await orch.ensureOmniServer().catch(() => null);
    const sidebarEnabledInit = orch.isChannelEnabled(sidebarSpec, cfg);
    if (sidebarEnabledInit) await orch.ensureSidebarService().catch(() => null);

    if (!orch.injectExpr) {
      orch.rebuildBundle();
    } else {
      const curCfg = getCurrentCfg();
      const chOpts = orch.getChannelCacheOpts(true);
      let usedChCache = false;
      for (const spec of PERSISTENT_SPECS) {
        if (spec.id === 'omni' && !omniEnabledInit) {
          orch.setChannelExpr('omni', '');
          continue;
        }
        if (orch.getChannelExpr(spec.id)) continue;
        if (spec.id === 'omni' && !orch.services.omniServer) continue;
        const canBuild = spec.tracksSkippedNonHost
          ? true
          : orch.isChannelEnabled(spec, curCfg) && (spec.id === 'omni' || spec.id === 'sidebar' || spec.id === 'hostI18n' || spec.id === 'thought' || orch.hasChannelFile(spec));
        if (!canBuild) continue;
        const built = orch.buildChannelExpr(spec, curCfg, chOpts);
        if (chOpts && built) usedChCache = true;
      }
      if (usedChCache && orch.isRunning()) orch.scheduleBundleCacheFlush();
    }

    await replaceEntryNewDocScript(entry, 'scriptId', orch.injectExpr);
    const sidebarDocument = entry.sidebarDocument;
    const mainRes = await entry.session.evaluate(orch.injectExpr);
    orch.sessionRegistry.markSidebarHostVerified(entry, sidebarDocument, mainRes?.status === 'ok');
    const ch1Outcome = recordEntryCh1Outcome(entry, mainRes, sidebarDocument);

    if (mainRes && mainRes.status === 'skipped-non-host') {
      await teardownAllEntryChannelScripts(orch, entry, entry.session, {
        markSkippedNonHost: true,
        resetMascot: false,
        resetHomeStudio: true,
      });
      return mainRes;
    }

    if (ch1Outcome.deferred) {
      entry.lastVerifyAt = Date.now();
      entry.verifyDirty = false;
      entry.lastVerifiedCodeHash = orch.codeHash || '';
      return mainRes;
    }

    // 统一表驱动挂载/清理全部持久通道（Ch2~Ch8, Ch10~Ch16）
    for (const spec of PERSISTENT_SPECS) {
      if (entry.session.closed) break;
      const cfgNow = getCurrentCfg();
      const id = spec.id;
      const f = spec.fields;
      const hadBefore = Boolean((f.scriptField && entry[f.scriptField]) || (f.mountedField && entry[f.mountedField]) || (id === 'omni' && entry.lastOmniExpr));

      if (id === 'hostI18n' && cfgNow?.hostLocalization === 'off' && !entry.session.closed) {
        await orch.swarmManager.syncIsolatedHostI18n(entry, true);
      }

      if (f.scriptField) await replaceEntryNewDocScript(entry, f.scriptField, '');

      const enabledNow = spec.tracksSkippedNonHost
        ? true
        : orch.isChannelEnabled(spec, cfgNow) && (id === 'omni' || id === 'sidebar' || id === 'hostI18n' || id === 'thought' || orch.hasChannelFile(spec));

      if (enabledNow) {
        if (id === 'sidebar' && !orch.services.sidebarService) await orch.ensureSidebarService().catch(() => null);
        if (BINDING_BY_CHANNEL[id]) await ensureChannelBinding(orch, entry, id);
        const activeExpr = id === 'omni' ? orch.getChannelExpr('omni') : orch.ensureChannelExpr(spec, cfgNow);
        if (activeExpr) {
          const chHash = orch.getChannelExprHash(spec, activeExpr);
          const chSig = id === 'omni' ? activeExpr : orch.getChannelCfgSig(spec, cfgNow, activeExpr);
          const addedId = f.scriptField ? await replaceEntryNewDocScript(entry, f.scriptField, activeExpr) : null;
          if (f.scriptSigField) entry[f.scriptSigField] = addedId ? chSig : '';
          const evalRes = await entry.session.evaluate(activeExpr).catch(() => null);

          if (spec.tracksSkippedNonHost) {
            await recordTrackableSkipOutcome(orch, entry, spec, evalRes, chHash);
          } else if (id === 'omni') {
            if (evalRes && evalRes.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: addedId });
            else recordChannelFailure(entry, 'omni');
          } else if (id === 'sidebar') {
            entry.sidebarMounted = true;
            recordChannelSuccess(entry, 'sidebar', { scriptId: addedId });
          } else if (id === 'hostI18n') {
            if (evalRes?.skippedByLiveCfg) {
              entry.hostI18nMounted = false;
              entry.hostI18nSkippedByLiveCfg = true;
              entry.lastHostI18nSig = chSig;
              recordChannelSkipped(entry, 'hostI18n', { codeHash: chSig });
            } else if (evalRes && evalRes.ok) {
              entry.hostI18nMounted = true;
              entry.hostI18nSkippedByLiveCfg = false;
              entry.lastHostI18nSig = chSig;
              recordChannelSuccess(entry, 'hostI18n', { codeHash: chSig, scriptId: addedId });
            } else {
              recordChannelFailure(entry, 'hostI18n');
            }
          } else if (evalRes && evalRes.ok) {
            if (spec.respectSkippedByLiveCfg && evalRes.skippedByLiveCfg) {
              entry[f.mountedField] = false;
              if (f.sigField) entry[f.sigField] = chSig;
              recordChannelSkipped(entry, id, { codeHash: chHash || chSig });
            } else {
              if (f.mountedField) entry[f.mountedField] = true;
              if (f.sigField) entry[f.sigField] = chSig;
              recordChannelSuccess(entry, id, { codeHash: chHash || chSig, scriptId: addedId });
            }
          } else {
            if (id === 'thought') {
              entry.thoughtMounted = false;
              entry.lastThoughtSig = '';
            }
            recordChannelFailure(entry, id);
          }
        } else {
          if (hadBefore) await cleanupChannelOnEntry(orch, entry, spec, { forceSidebarCleanup: hadBefore, timeoutMs: 0 });
          else {
            if (f.mountedField) entry[f.mountedField] = false;
            if (f.sigField) entry[f.sigField] = '';
            if (f.scriptSigField) entry[f.scriptSigField] = '';
            if (f.skippedField) entry[f.skippedField] = false;
            recordChannelOff(entry, id);
          }
        }
      } else {
        if (id === 'sidebar') {
          await removeChannelBinding(orch, entry, 'sidebar');
          await entry.session.evaluate(buildSidebarCleanupExpression(hadBefore)).catch(() => null);
          entry.sidebarMounted = false;
          recordChannelOff(entry, 'sidebar');
        } else if (hadBefore) {
          await cleanupChannelOnEntry(orch, entry, spec, { timeoutMs: 0 });
        } else {
          if (f.mountedField) entry[f.mountedField] = false;
          if (f.sigField) entry[f.sigField] = '';
          if (f.scriptSigField) entry[f.scriptSigField] = '';
          if (f.skippedField) entry[f.skippedField] = false;
          if (id === 'hostI18n') entry.hostI18nSkippedByLiveCfg = false;
          recordChannelOff(entry, id);
        }
      }

      if (id === 'hostI18n' && cfgNow?.hostLocalization !== 'off' && entry.isolatedHostI18nPaused && !entry.session.closed) {
        await orch.swarmManager.syncIsolatedHostI18n(entry, false);
      }
    }

    entry.lastVerifyAt = Date.now();
    entry.healthyStreak = 1;
    entry.verifyDirty = false;
    entry.lastVerifiedCodeHash = orch.codeHash || '';
    entry.appliedConfigSeq = orch._configSeq;
    if (entry.fsmState === ENTRY_FSM_STATES.INJECTING_CH1) {
      transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'apply-complete');
    }
    return mainRes;
  });
}

export async function runBroadcastConfigRefresh(orch) {
  orch._broadcastPending = true;
  if (orch._broadcastRunning) {
    return new Promise((resolve) => {
      orch._broadcastWaiters.push(resolve);
    });
  }

  orch._broadcastRunning = true;
  try {
    while (orch._broadcastPending) {
      orch._broadcastPending = false;
      const snapSeq = orch._configSeq;
      const sessions = orch.sessionRegistry.sessions;
      const activeItems = [...sessions.values()].filter((item) => item && !item.session.closed);
      const perEntryAck = new Map();
      for (const item of activeItems) {
        resetAllChannelCircuits(item);
        const entryAck = Number.isSafeInteger(item.pendingAckEpoch) && item.pendingAckEpoch > 0 ? item.pendingAckEpoch : 0;
        item.pendingAckEpoch = 0;
        perEntryAck.set(item, entryAck);
      }

      const restoreAllAcks = () => {
        for (const [item, ack] of perEntryAck.entries()) {
          if (ack > 0) item.pendingAckEpoch = Math.max(Number(item.pendingAckEpoch || 0), ack);
        }
      };

      const cdpPre = orch.getCdp();
      const preCfg = typeof cdpPre?.readConfig === 'function' ? cdpPre.readConfig() : {};
      if (orch.isChannelEnabled(orch.getRegisteredChannel('omni'), preCfg)) {
        await orch.ensureOmniServer().catch(() => null);
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      } else if (orch.services.omniServer) {
        orch.setChannelExpr('omni', '');
        await orch.services.stopOmniServer();
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      }
      if (preCfg?.sidebarStudio === 'on') {
        await orch.ensureSidebarService().catch(() => null);
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      }

      orch.invokeRebuildBundle({ deferDiskCacheWrite: true });
      const cdp = orch.getCdp();
      const injectSnap = orch.injectExpr;
      const currentCfg = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : {};
      orch._configFingerprintTracker?.recordApplied(currentCfg);
      if (currentCfg?.telemetryModule === 'off') orch.onTelemetryDisabled?.();
      orch.onConfigRefreshed?.(currentCfg);

      // 表驱动构建全部持久通道快照
      const channelSnaps = PERSISTENT_SPECS.map((spec) => {
        const id = spec.id;
        const enabled = spec.tracksSkippedNonHost
          ? true
          : orch.isChannelEnabled(spec, currentCfg) &&
            (id === 'omni' || id === 'sidebar' || id === 'hostI18n' || id === 'thought' || orch.hasChannelFile(spec));
        let snap = orch.getChannelExpr(id);
        if (enabled && !snap && id !== 'omni' && id !== 'sidebar' && id !== 'hostI18n') {
          snap = orch.buildChannelExpr(spec, currentCfg);
        }
        const hash = snap ? orch.getChannelExprHash(spec, snap) : '';
        const sig = enabled ? (id === 'omni' ? snap : orch.getChannelCfgSig(spec, currentCfg, snap)) : '';
        return { spec, enabled: spec.tracksSkippedNonHost ? Boolean(snap) : enabled, snap, hash, sig };
      });

      const canFastRefresh = typeof cdp?.buildConfigRefreshExpression === 'function';
      const baseRefreshExpr = canFastRefresh ? cdp.buildConfigRefreshExpression() : null;
      await orch.swarmManager.syncSwarmSessionsForConfig(currentCfg).catch(() => {});
      if (activeItems.length === 0) continue;

      await Promise.allSettled(
        activeItems.map((entry) =>
          orch.sessionRegistry.runExclusive(entry, async () => {
            if (!entry || entry.session.closed) return;
            const entryAck = perEntryAck.get(entry) || 0;
            const forceFullConvergence = Boolean(entry._configConvergenceDirty);
            const abortIfStale = () => {
              if (orch._configSeq !== snapSeq) {
                if (entryAck > 0) entry.pendingAckEpoch = Math.max(Number(entry.pendingAckEpoch || 0), entryAck);
                entry._configConvergenceDirty = true;
                orch._broadcastPending = true;
                return true;
              }
              return entry.session.closed;
            };
            if (abortIfStale()) return;

            const hostI18nOffNow = currentCfg?.hostLocalization === 'off';
            let isoPauseRes = null;
            if (hostI18nOffNow && !entry.session.closed) isoPauseRes = await orch.swarmManager.syncIsolatedHostI18n(entry, true);
            if (abortIfStale()) return;

            const refreshExpr =
              canFastRefresh && entryAck > 0
                ? cdp.buildConfigRefreshExpression(null, { __ackEpoch: entryAck })
                : baseRefreshExpr;
            let refreshedFast = false;
            let skippedStale = false;
            if (refreshExpr) {
              if (abortIfStale()) return;
              const fastRes = await entry.session.evaluate(refreshExpr).catch(() => null);
              if (fastRes && fastRes.refreshed) {
                refreshedFast = true;
                skippedStale = Boolean(fastRes.skippedStale);
              }
            }
            if (abortIfStale()) return;
            if (!refreshedFast && !entry.session.closed) {
              await entry.session.evaluate(injectSnap).catch(() => {});
            }

            // 单循环表驱动广播更新全部持久通道（Ch2~Ch16）
            for (const cs of channelSnaps) {
              if (abortIfStale()) return;
              const { spec, enabled, snap, hash, sig } = cs;
              const id = spec.id;
              const f = spec.fields;
              const hadBefore = Boolean(
                (f.scriptField && entry[f.scriptField]) ||
                  (f.mountedField && entry[f.mountedField]) ||
                  (id === 'omni' && entry.lastOmniExpr) ||
                  (id === 'sidebar' && entry.sidebarBindingAdded)
              );

              if (id === 'sidebar') {
                if (enabled) {
                  if (!skippedStale && !entry.session.closed) {
                    await ensureChannelBinding(orch, entry, 'sidebar');
                    if (snap && !entry.session.closed) {
                      await entry.session.evaluate(snap).catch(() => {});
                      entry.sidebarMounted = true;
                      recordChannelSuccess(entry, 'sidebar', { scriptId: entry.sidebarScriptId });
                    }
                  }
                } else {
                  await removeChannelBinding(orch, entry, 'sidebar');
                  if (hadBefore && !skippedStale && !entry.session.closed) {
                    await entry.session.evaluate(buildSidebarCleanupExpression(true)).catch(() => {});
                  }
                  entry.sidebarMounted = false;
                  recordChannelOff(entry, 'sidebar');
                }
                continue;
              }

              if (id === 'hostI18n') {
                const skippedSameSig = Boolean(entry.hostI18nSkippedByLiveCfg && entry.lastHostI18nSig === sig);
                const changed = Boolean(
                  enabled && snap && !skippedSameSig &&
                    (forceFullConvergence || entry.lastHostI18nSig !== sig || !entry.hostI18nScriptId || !entry.hostI18nMounted)
                );
                if (enabled && snap) {
                  let evaluatedFresh = false;
                  if (!skippedStale && !entry.session.closed && (!refreshedFast || changed)) {
                    const evalRes = await entry.session.evaluate(snap).catch(() => null);
                    if (evalRes?.skippedByLiveCfg) {
                      entry.hostI18nMounted = false;
                      entry.hostI18nSkippedByLiveCfg = true;
                      entry.lastHostI18nSig = sig;
                      recordChannelSkipped(entry, 'hostI18n', { codeHash: sig });
                    } else if (evalRes && evalRes.ok) {
                      entry.hostI18nMounted = true;
                      entry.hostI18nSkippedByLiveCfg = false;
                      entry.lastHostI18nSig = sig;
                      evaluatedFresh = !evalRes.reused;
                      recordChannelSuccess(entry, 'hostI18n', { codeHash: sig, scriptId: entry.hostI18nScriptId });
                    } else {
                      recordChannelFailure(entry, 'hostI18n');
                    }
                  }
                  if (hostI18nOffNow && isoPauseRes && isoPauseRes.newlyPaused && !evaluatedFresh && !skippedStale && !entry.session.closed) {
                    await orch.swarmManager.forceMainWorldHostI18nOffRescan(entry);
                  }
                } else if (hadBefore && !skippedStale && !entry.session.closed) {
                  await entry.session.evaluate(orch.getChannelCleanupExpression(spec)).catch(() => {});
                  entry.hostI18nMounted = false;
                  entry.hostI18nSkippedByLiveCfg = false;
                  entry.lastHostI18nSig = '';
                  recordChannelOff(entry, 'hostI18n');
                }
                if (!hostI18nOffNow && entry.isolatedHostI18nPaused && !skippedStale && !entry.session.closed) {
                  await orch.swarmManager.syncIsolatedHostI18n(entry, false);
                }
                continue;
              }

              const isSkipped = Boolean(spec.tracksSkippedNonHost && f.skippedField && entry[f.skippedField]);
              const changed = Boolean(
                enabled &&
                  snap &&
                  !isSkipped &&
                  (forceFullConvergence ||
                    (f.sigField && entry[f.sigField] !== sig) ||
                    (f.scriptField && !entry[f.scriptField]) ||
                    (f.mountedField && !entry[f.mountedField]))
              );

              if (enabled && snap) {
                if (!skippedStale && !entry.session.closed && !isSkipped && (!refreshedFast || changed)) {
                  if (BINDING_BY_CHANNEL[id]) await ensureChannelBinding(orch, entry, id);
                  const evalRes = await entry.session.evaluate(snap).catch(() => null);
                  if (spec.tracksSkippedNonHost) {
                    await recordTrackableSkipOutcome(orch, entry, spec, evalRes, hash);
                  } else if (id === 'omni') {
                    if (evalRes && evalRes.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: entry.omniScriptId });
                    else recordChannelFailure(entry, 'omni');
                  } else if (evalRes && evalRes.ok) {
                    if (spec.respectSkippedByLiveCfg && evalRes.skippedByLiveCfg) {
                      entry[f.mountedField] = false;
                      if (f.sigField) entry[f.sigField] = sig;
                      recordChannelSkipped(entry, id, { codeHash: hash || sig });
                    } else {
                      if (f.mountedField) entry[f.mountedField] = true;
                      if (f.sigField) entry[f.sigField] = sig;
                      recordChannelSuccess(entry, id, { codeHash: hash || sig, scriptId: entry[f.scriptField] });
                    }
                  } else {
                    recordChannelFailure(entry, id);
                  }
                }
              } else if ((hadBefore || (!spec.tracksSkippedNonHost && id !== 'omni' && id !== 'thought' && !orch.isChannelEnabled(spec, currentCfg))) && !skippedStale && !entry.session.closed) {
                if (id === 'wallpaper' || id === 'suggester') await removeChannelBinding(orch, entry, id);
                if (hadBefore) await entry.session.evaluate(orch.getChannelCleanupExpression(spec)).catch(() => {});
                if (f.mountedField) entry[f.mountedField] = false;
                if (f.sigField) entry[f.sigField] = '';
                if (f.skippedField) entry[f.skippedField] = false;
                recordChannelOff(entry, id);
              }
            }

            // 合并收敛所有持久 NewDocument 脚本，若中途被新配置序号打断则标脏确保下一轮完整收敛
            if (orch._broadcastPending || orch._configSeq !== snapSeq || entry.session.closed) {
              entry._configConvergenceDirty = true;
              orch._broadcastPending = true;
              return;
            }

            await replaceEntryNewDocScript(entry, 'scriptId', injectSnap);
            for (const cs of channelSnaps) {
              const f = cs.spec.fields;
              if (!f.scriptField) continue;
              if (cs.spec.id === 'sidebar') {
                await replaceEntryNewDocScript(entry, 'sidebarScriptId', cs.enabled && cs.snap ? cs.snap : '');
              } else {
                await syncPersistentNewDocScript(entry, Boolean(cs.enabled && cs.snap), cs.snap, f.scriptField, f.scriptSigField, cs.sig);
              }
            }

            entry.appliedConfigSeq = snapSeq;
            entry._configConvergenceDirty = false;
          })
        )
      );
    }
  } finally {
    orch._broadcastRunning = false;
    const waiters = orch._broadcastWaiters.splice(0);
    for (const resolve of waiters) {
      try { resolve(); } catch {}
    }
  }
}
