// Inject Obsidian Prism (obsidian-prism) into every open Antigravity window over CDP.
//
//   node inject.js           one-shot: inject now and exit
//   node inject.js --watch   daemon mode: auto-inject into new/reloaded windows
//                            and hot-reload style.css / *.js / config.json
const fs = require('fs');
const path = require('path');
const {
  PORT_FILE,
  PID_FILE,
  CONFIG_FILE,
  SETTING_BINDING,
  LEGACY_SETTING_BINDING,
  OMNI_BINDING,
  validateConfigEntry,
  reconcileConfigAliases,
  isEligibleTarget,
  readConfig,
  readPidFromLockFile,
  isExpectedDaemonProcess,
  readPort,
  listPages,
  CdpSession,
  buildInjectExpression,
  buildConfigRefreshExpression,
  buildOmniClientExpression,
} = require('./cdp');

const WATCH = process.argv.includes('--watch');
const LOG_FILE = path.join(__dirname, 'watch.log');

function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  if (WATCH) {
    try {
      fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
  }
}

function shortTitle(page) {
  const t = page.title || page.url;
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

function updateConfigBatch(entriesObj) {
  if (!entriesObj || typeof entriesObj !== 'object' || Array.isArray(entriesObj)) return false;
  const patch = {};
  let count = 0;
  for (const [k, v] of Object.entries(entriesObj)) {
    if (validateConfigEntry(k, v)) {
      patch[k] = v;
      count += 1;
    }
  }
  if (count === 0) return false;
  const reconciledPatch = typeof reconcileConfigAliases === 'function' ? reconcileConfigAliases(patch) : patch;
  const next = { ...readConfig(), ...reconciledPatch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return true;
}

function updateConfigSetting(key, value) {
  return updateConfigBatch({ [key]: value });
}

async function injectOnce() {
  const port = readPort();
  if (!port) {
    throw new Error(`未找到调试端口文件，Antigravity 可能未运行: ${PORT_FILE}`);
  }
  let pages;
  try {
    pages = await listPages(port);
  } catch {
    throw new Error(`端口 ${port} 无响应：请确认 Antigravity 正在运行`);
  }
  const targets = pages.filter(isEligibleTarget);
  if (targets.length === 0) throw new Error('未找到 Antigravity 窗口页面');

  log(`[+] 调试端口 ${port}，发现 ${targets.length} 个窗口`);
  const expr = buildInjectExpression();
  const omniExpr = typeof buildOmniClientExpression === 'function' ? buildOmniClientExpression(null) : '';
  for (const page of targets) {
    const session = await CdpSession.connect(page.webSocketDebuggerUrl);
    try {
      const res = await session.evaluate(expr);
      if (omniExpr) {
        await session.evaluate(omniExpr).catch(() => {});
      }
      log(`[✓] ${shortTitle(page)} (obsidian-prism ${res.version} · 状态: ${res.status})`);
    } finally {
      session.close();
    }
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    const pid =
      typeof readPidFromLockFile === 'function'
        ? readPidFromLockFile(PID_FILE)
        : parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    if (pid && pid !== process.pid && isAlive(pid)) {
      const isDaemon = typeof isExpectedDaemonProcess === 'function' ? isExpectedDaemonProcess(pid) : true;
      if (isDaemon) {
        console.error(`[!] 守护进程已在运行 (PID ${pid})。如需重启请先运行 remove.js`);
        process.exit(1);
      }
    }
  } catch {}
  fs.writeFileSync(PID_FILE, String(process.pid));
  const release = () => {
    try {
      if (readPidFromLockFile(PID_FILE) === process.pid) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {}
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(sig, () => process.exit(0));
  }
}

async function watch() {
  acquireLock();
  try {
    fs.writeFileSync(LOG_FILE, '');
  } catch {}
  log(`[*] Obsidian Prism 守护模式启动 (PID ${process.pid})，每 2 秒检查一次窗口`);

  const attached = new Map();
  let omniServer = null;
  try {
    const omniMod = await import('./vendor/omni-viewer/omni-server.mjs');
    if (omniMod && typeof omniMod.OmniServer === 'function') {
      omniServer = new omniMod.OmniServer({ rootDir: __dirname });
      await omniServer.start();
      process.on('exit', () => {
        try {
          void omniServer.stop();
        } catch {}
      });
    }
  } catch (err) {
    log(`[!] Omni 流式网关启动跳过: ${err.message}`);
  }

  let expr = buildInjectExpression();
  let omniExpr =
    typeof buildOmniClientExpression === 'function'
      ? buildOmniClientExpression(omniServer ? omniServer.getServerInfo() : null)
      : '';

  let selfConfigWriteUntil = 0;

  function isTrustedMainFrameContext(entry, executionContextId) {
    if (!entry) return false;
    const hasCtxId = typeof executionContextId === 'number';
    if (hasCtxId && entry.contextFrames && entry.contextFrames.has(executionContextId)) {
      const meta = entry.contextFrames.get(executionContextId);
      if (!meta.isDefault || (meta.type && meta.type !== 'default')) return false;
      if (entry.mainFrameId && meta.frameId && meta.frameId !== entry.mainFrameId) return false;
      return true;
    }
    if (entry.hasFrameTree) {
      if (!hasCtxId) return false;
      if (entry.contextFrames && entry.contextFrames.size > 0) return false;
    }
    return true;
  }

  async function broadcastFastConfigRefresh() {
    const perEntryAck = new Map();
    for (const entry of attached.values()) {
      if (!entry || entry.session.closed) continue;
      const ack = Number.isSafeInteger(entry.pendingAckEpoch) && entry.pendingAckEpoch > 0 ? entry.pendingAckEpoch : 0;
      entry.pendingAckEpoch = 0;
      perEntryAck.set(entry, ack);
    }
    expr = buildInjectExpression();
    omniExpr =
      typeof buildOmniClientExpression === 'function'
        ? buildOmniClientExpression(omniServer ? omniServer.getServerInfo() : null)
        : '';
    const canFastRefresh = typeof buildConfigRefreshExpression === 'function';
    const baseRefreshExpr = canFastRefresh ? buildConfigRefreshExpression() : null;
    for (const entry of attached.values()) {
      if (!entry || entry.session.closed) continue;
      try {
        const entryAck = perEntryAck.get(entry) || 0;
        const refreshExpr =
          canFastRefresh && entryAck > 0
            ? buildConfigRefreshExpression(null, { __ackEpoch: entryAck })
            : baseRefreshExpr;
        if (refreshExpr) {
          const fast = await entry.session.evaluate(refreshExpr).catch(() => null);
          if (fast && fast.refreshed) {
            if (omniExpr && !fast.skippedStale) await entry.session.evaluate(omniExpr).catch(() => {});
          } else {
            await entry.session.evaluate(expr).catch(() => {});
            if (omniExpr) await entry.session.evaluate(omniExpr).catch(() => {});
          }
        }
        if (entry.scriptId) {
          await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
        }
        const addRes = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', { source: expr }).catch(() => null);
        entry.scriptId = addRes && addRes.identifier ? addRes.identifier : null;
        if (entry.omniScriptId) {
          await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId }).catch(() => {});
        }
        if (omniExpr) {
          const omniAdd = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', { source: omniExpr }).catch(() => null);
          entry.omniScriptId = omniAdd && omniAdd.identifier ? omniAdd.identifier : null;
        }
      } catch {}
    }
  }

  async function apply(entry) {
    if (entry.scriptId) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId })
        .catch(() => {});
      entry.scriptId = null;
    }
    const { identifier } = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: expr,
    });
    entry.scriptId = identifier;
    const res = await entry.session.evaluate(expr);

    if (entry.omniScriptId) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId })
        .catch(() => {});
      entry.omniScriptId = null;
    }
    if (omniExpr) {
      const omniAdd = await entry.session
        .send('Page.addScriptToEvaluateOnNewDocument', { source: omniExpr })
        .catch(() => null);
      if (omniAdd && omniAdd.identifier) entry.omniScriptId = omniAdd.identifier;
      await entry.session.evaluate(omniExpr).catch(() => {});
    }
    return res;
  }

  async function attach(page) {
    if (!isEligibleTarget(page)) return;
    attached.set(page.id, null);
    try {
      const session = await CdpSession.connect(page.webSocketDebuggerUrl);
      const entry = {
        session,
        scriptId: null,
        omniScriptId: null,
        mainFrameId: null,
        hasFrameTree: false,
        contextFrames: new Map(),
        pendingAckEpoch: 0,
      };
      attached.set(page.id, entry);
      session.onClose = () => {
        attached.delete(page.id);
        log(`[-] 窗口已关闭: ${shortTitle(page)}`);
      };
      session.on('Runtime.executionContextCreated', (params) => {
        const ctx = params?.context;
        if (!ctx || typeof ctx.id !== 'number') return;
        const aux = ctx.auxData && typeof ctx.auxData === 'object' ? ctx.auxData : {};
        entry.contextFrames.set(ctx.id, {
          frameId: typeof aux.frameId === 'string' ? aux.frameId : '',
          isDefault: aux.isDefault !== false,
          type: typeof aux.type === 'string' ? aux.type : 'default',
        });
      });
      session.on('Runtime.executionContextDestroyed', (params) => {
        if (typeof params?.executionContextId === 'number') entry.contextFrames.delete(params.executionContextId);
      });
      session.on('Runtime.executionContextsCleared', () => {
        entry.contextFrames.clear();
        entry.pendingAckEpoch = 0;
      });
      session.on('Page.frameNavigated', (params) => {
        const frame = params?.frame;
        if (frame && !frame.parentId && typeof frame.id === 'string' && frame.id) {
          entry.mainFrameId = frame.id;
          entry.hasFrameTree = true;
          entry.pendingAckEpoch = 0;
        }
      });
      await session.send('Page.enable');
      const ft = await session.send('Page.getFrameTree', {}, 2000).catch(() => null);
      const topFrameId = ft?.frameTree?.frame?.id;
      if (typeof topFrameId === 'string' && topFrameId) {
        entry.mainFrameId = topFrameId;
        entry.hasFrameTree = true;
      }
      session.on('Runtime.bindingCalled', async ({ name, payload, executionContextId }) => {
        if (!isTrustedMainFrameContext(entry, executionContextId)) return;
        if (name === OMNI_BINDING && omniServer) {
          if (typeof payload !== 'string' || payload.length > 65536) return;
          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            return;
          }
          const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
          if (reqId === null) return;
          const action = typeof parsed.action === 'string' ? parsed.action : '';
          const mergedParams = {
            ...parsed,
            ...(parsed.params && typeof parsed.params === 'object' ? parsed.params : {}),
            ...(parsed.input && typeof parsed.input === 'object' ? parsed.input : {}),
            ...(parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {}),
          };
          let result;
          try {
            result = await omniServer.handleRpcAction(action, mergedParams);
          } catch (err) {
            result = { ok: false, error: String(err && err.message ? err.message : err) };
          }
          if (!session.closed) {
            const jsonRes = JSON.stringify(result);
            const resolveExpr = `(() => { const r = ${jsonRes}; const b = window.__agPrismOmniBridge; if (b && typeof b.resolve === 'function') b.resolve(${reqId}, r); if (typeof window.__agPrismOmniResolve === 'function' && (!b || window.__agPrismOmniResolve !== b.resolve)) window.__agPrismOmniResolve(${reqId}, r); })()`;
            const evalParams = { expression: resolveExpr, returnByValue: true };
            if (executionContextId) evalParams.contextId = executionContextId;
            await session.send('Runtime.evaluate', evalParams).catch(() => {});
          }
          return;
        }
        if (name !== SETTING_BINDING && name !== LEGACY_SETTING_BINDING) return;
        try {
          const parsed = JSON.parse(payload);
          let changed = false;
          if (parsed && parsed.action === 'patch-batch' && parsed.entries && typeof parsed.entries === 'object') {
            selfConfigWriteUntil = Date.now() + 650;
            if (updateConfigBatch(parsed.entries)) {
              changed = true;
              log(`[⚙] 批量设置已保存: ${Object.keys(parsed.entries).join(', ')}`);
            }
          } else if (parsed) {
            selfConfigWriteUntil = Date.now() + 650;
            if (updateConfigSetting(parsed.key, parsed.value)) {
              changed = true;
              log(`[⚙] 设置已保存: ${parsed.key} = ${JSON.stringify(parsed.value)}`);
            }
          }
          if (changed) {
            if (parsed && Number.isSafeInteger(parsed.clientEpoch) && parsed.clientEpoch > 0) {
              entry.pendingAckEpoch = parsed.clientEpoch;
            }
            await broadcastFastConfigRefresh();
          }
        } catch {}
      });
      await session.send('Runtime.enable');
      await session.send('Runtime.addBinding', { name: SETTING_BINDING });
      await session.send('Runtime.addBinding', { name: LEGACY_SETTING_BINDING }).catch(() => {});
      if (OMNI_BINDING) {
        await session.send('Runtime.addBinding', { name: OMNI_BINDING }).catch(() => {});
      }
      const res = await apply(entry);
      log(`[✓] 已注入 obsidian-prism: ${shortTitle(page)} (${res.status})`);
    } catch (err) {
      const entry = attached.get(page.id);
      if (entry) {
        try {
          if (entry.scriptId) await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId });
          if (entry.omniScriptId) await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId });
        } catch {}
        entry.session.close();
      }
      attached.delete(page.id);
      log(`[!] 注入失败，稍后重试: ${shortTitle(page)} — ${err.message}`);
    }
  }

  let busy = false;
  let lastPort = null;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const port = readPort();
      if (!port) return;
      let pages;
      try {
        pages = await listPages(port);
      } catch {
        return;
      }
      if (port !== lastPort) {
        log(`[+] 连接到调试端口 ${port}`);
        lastPort = port;
      }
      await Promise.all(pages.filter((p) => !attached.has(p.id)).map(attach));
    } finally {
      busy = false;
    }
  }

  let reloadTimer = null;
  fs.watch(__dirname, { recursive: true }, (_, filename) => {
    const base = filename ? path.basename(filename) : '';
    if (!base || !/\.(css|c?js|mjs|json)$/i.test(base) || base.startsWith('.')) return;
    if (base === 'watch.log' || base === 'daemon.log') return;
    if (base === 'config.json' && Date.now() < selfConfigWriteUntil) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        delete require.cache[require.resolve('./cdp')];
        const freshCdp = require('./cdp');
        expr = freshCdp.buildInjectExpression();
        omniExpr =
          typeof freshCdp.buildOmniClientExpression === 'function'
            ? freshCdp.buildOmniClientExpression(omniServer ? omniServer.getServerInfo() : null)
            : '';
      } catch (err) {
        log(`[!] 读取文件失败: ${err.message}`);
        return;
      }
      let n = 0;
      for (const entry of attached.values()) {
        if (!entry) continue;
        try {
          await apply(entry);
          n++;
        } catch {}
      }
      log(`[↻] ${filename} 已变更，已热更新 ${n} 个窗口`);
    }, 180);
  });

  if (WATCH) {
    process.on('uncaughtException', (err) => {
      log(`[!] 未捕获异常: ${err && err.stack ? err.stack : err}`);
    });
    process.on('unhandledRejection', (err) => {
      log(`[!] 未处理 Promise 拒绝: ${err && err.stack ? err.stack : err}`);
    });
  }

  await tick();
  setInterval(tick, 2000);
}

(WATCH ? watch() : injectOnce()).catch((err) => {
  console.error(`[✗] ${err.message}`);
  process.exit(1);
});
