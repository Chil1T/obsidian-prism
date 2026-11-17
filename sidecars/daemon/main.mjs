// Obsidian Prism Native Sidecar Daemon (sidecars/daemon/main.mjs)
// - Auto-discovers DevToolsActivePort across Windows/macOS/Linux
// - Registers Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate (survives Ctrl+Shift+R reloads with zero app.asar touch!)
// - Hot-upgrades legacy instances to Obsidian Prism v1.0.0
// - Lazily serves real MetricsStore + DesktopUsage snapshots over __agPrismMetricsCall only when requested (0 idle CPU)
// - Registers __agPrismRepoCall (paired with window.__agPrismRepoBridge) for live Git status & safe git pull --ff-only + hot-reload!

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

export const METRICS_BINDING = '__agPrismMetricsCall';
export const REPO_BINDING = '__agPrismRepoCall';
export const THOUGHT_BINDING = '__agPrismThoughtCall';
export const USAGE_BINDING = '__agPrismUsageCall';
const SKIP_TARGET_RE = /Untitled|launchpad/i;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function execGit(args, cwd, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || 'git command failed').trim();
          reject(new Error(msg));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

const SECRET_TOKEN_RE =
  /(sk-[A-Za-z0-9_\-]{6,}|AIza[A-Za-z0-9_\-]{12,}|xai-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._\-]{8,})/gi;

function sanitizeSecretText(text) {
  return String(text || '')
    .replace(/https?:\/\/[^/\s:@]+:[^/\s@]+@/gi, 'https://***@')
    .replace(SECRET_TOKEN_RE, '***REDACTED***');
}

export function sanitizeGitRemoteUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      u.username = '';
      u.password = '';
      u.search = '';
      u.hash = '';
      return u.toString();
    }
  } catch {}
  return s.replace(/\/\/[^/\s:@]+:[^/\s@]+@/, '//');
}

function copyUpdatedRuntimeFromRepo(repoDir, pluginDir, syncFilesList) {
  if (!repoDir || !pluginDir) return 0;
  const normRepo = path.resolve(repoDir).toLowerCase();
  const normPlugin = path.resolve(pluginDir).toLowerCase();
  if (normRepo === normPlugin) return 0;

  let synced = 0;
  const files = Array.isArray(syncFilesList) && syncFilesList.length > 0 ? syncFilesList : ['cdp.js', 'style.css', 'ui-runtime.js'];
  for (const rel of files) {
    const src = path.join(repoDir, rel);
    const dst = path.join(pluginDir, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      synced += 1;
    }
  }
  const syncSubDir = (sub) => {
    const sDir = path.join(repoDir, sub);
    const dDir = path.join(pluginDir, sub);
    if (!fs.existsSync(sDir)) return;
    fs.mkdirSync(dDir, { recursive: true });
    for (const ent of fs.readdirSync(sDir, { withFileTypes: true })) {
      if (ent.name === '__pycache__' || ent.name === '.DS_Store') continue;
      if (ent.isDirectory()) syncSubDir(path.join(sub, ent.name));
      else if (ent.isFile()) {
        fs.copyFileSync(path.join(sDir, ent.name), path.join(dDir, ent.name));
        synced += 1;
      }
    }
  };
  syncSubDir('assets');
  syncSubDir('vendor');
  return synced;
}

export function resolvePortFileCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Antigravity', 'DevToolsActivePort'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    candidates.push(path.join(xdg, 'Antigravity', 'DevToolsActivePort'));
  }
  return candidates;
}

export function discoverActivePort(overridePort = null, customPortFile = null) {
  if (overridePort && Number.isInteger(Number(overridePort)) && Number(overridePort) > 0) {
    return Number(overridePort);
  }
  if (process.env.AG_CDP_PORT) {
    const p = parseInt(process.env.AG_CDP_PORT, 10);
    if (Number.isInteger(p) && p > 0 && p <= 65535) return p;
  }
  const files = customPortFile ? [customPortFile] : resolvePortFileCandidates();
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.length > 2048) continue;
      const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    } catch {}
  }
  return null;
}

export function isEligibleTarget(target) {
  if (!target || target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || '');
  if (url.startsWith('devtools://') || url.startsWith('data:')) return false;
  if (SKIP_TARGET_RE.test(`${target.title || ''} ${url}`)) return false;
  return true;
}

export function isPluginEnabledInHostConfig(customConfigPath = null) {
  try {
    const cfgPath = customConfigPath || path.join(os.homedir(), '.gemini', 'config', 'config.json');
    if (!fs.existsSync(cfgPath)) return true;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    if (raw?.plugins?.['obsidian-prism']?.enabled === false) return false;
    if (raw?.plugins?.['antigravity-prism']?.enabled === false && !raw?.plugins?.['obsidian-prism']) return false;
    return true;
  } catch {
    return true;
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export class PrismDaemon {
  constructor({
    rootDir = DEFAULT_ROOT_DIR,
    gitRepoDir = null,
    overridePort = null,
    portFile = null,
    pollIntervalMs = 2200,
    enabledCheck = () => isPluginEnabledInHostConfig(),
    metricsProvider = null,
    thoughtService = null,
    silent = false,
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.gitRepoDir = gitRepoDir ? path.resolve(gitRepoDir) : null;
    this.overridePort = overridePort;
    this.portFile = portFile;
    this.pollIntervalMs = Math.max(200, Number(pollIntervalMs) || 2200);
    this.enabledCheck = enabledCheck;
    this.silent = Boolean(silent);
    this.cdp = require(path.join(this.rootDir, 'cdp.js'));
    this.sessions = new Map();
    this.running = false;
    this.busy = false;
    this.timer = null;
    this.fsw = null;
    this.injectExpr = '';
    this.codeHash = '';
    this.ownerToken = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.pidFile = path.join(this.rootDir, '.daemon.pid');
    this.logFile = path.join(this.rootDir, 'daemon.log');
    this._lazyStore = null;
    this._lazyUsage = null;
    this._customMetricsProvider = metricsProvider;
    this._lazyThoughtService = thoughtService;
  }

  log(msg) {
    if (!this.silent) {
      try {
        const fi = fs.existsSync(this.logFile) ? fs.statSync(this.logFile) : null;
        if (fi && fi.size > 512 * 1024) fs.writeFileSync(this.logFile, '', 'utf8');
        fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
      } catch {}
    }
  }

  resolveGitRepoDir() {
    const candidates = [];
    if (this.gitRepoDir) candidates.push(this.gitRepoDir);
    candidates.push(this.rootDir);

    const repoMetaPath = path.join(this.rootDir, 'repo-meta.json');
    if (fs.existsSync(repoMetaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(repoMetaPath, 'utf8'));
        if (meta && meta.sourceRepoDir) {
          const src = path.resolve(meta.sourceRepoDir);
          candidates.push(src);
          const parent = path.dirname(src);
          candidates.push(path.join(parent, 'obsidian-prism'));
        }
      } catch {}
    }

    for (const cand of candidates) {
      try {
        if (cand && fs.existsSync(path.join(cand, '.git'))) {
          return cand;
        }
      } catch {}
    }
    return null;
  }

  async executeRepoAction(rawInput = {}) {
    const action = rawInput?.action === 'pull' || rawInput?.action === 'sync' ? 'pull' : 'status';
    const repoDir = this.resolveGitRepoDir();
    if (!repoDir) {
      return {
        ok: true,
        action,
        isGitRepo: false,
        repoPath: path.basename(this.rootDir),
        branch: 'standalone',
        commit: this.cdp.PLUGIN_VERSION,
        shortHash: this.cdp.PLUGIN_VERSION,
        dirty: false,
        remoteUrl: '',
        hasRemote: false,
        noRemote: true,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: 'Installed standalone plugin (no linked Git repository)',
      };
    }

    let branch = 'HEAD';
    let commit = '';
    let dirty = false;
    let remoteName = '';
    let remoteUrl = '';

    try {
      branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir, 5000)) || 'HEAD';
    } catch {
      branch = 'main';
    }
    try {
      commit = await execGit(['rev-parse', '--short', 'HEAD'], repoDir, 5000);
    } catch {
      commit = 'uncommitted';
    }
    try {
      const porcelain = await execGit(['status', '--porcelain'], repoDir, 5000);
      dirty = Boolean(porcelain.trim());
    } catch {}

    try {
      const remotesRaw = await execGit(['remote'], repoDir, 4000);
      const remotes = remotesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (remotes.length > 0) {
        remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        const rawRemoteUrl = await execGit(['remote', 'get-url', remoteName], repoDir, 4000).catch(() => '');
        remoteUrl = sanitizeGitRemoteUrl(rawRemoteUrl);
      }
    } catch {}

    const safeRepoName = path.basename(repoDir);
    const hasRemote = Boolean(remoteName && remoteUrl);

    if (!hasRemote) {
      return {
        ok: true,
        action,
        isGitRepo: true,
        repoPath: safeRepoName,
        branch,
        commit,
        shortHash: commit,
        dirty,
        remoteName: '',
        remoteUrl: '',
        hasRemote: false,
        noRemote: true,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: 'Local Git repository (no remote configured)',
      };
    }

    if (action === 'status') {
      let ahead = 0;
      let behind = 0;
      try {
        await execGit(['fetch', '--quiet', remoteName], repoDir, 8000);
      } catch {
        // Offline or unreachable remote: fall back to local tracking refs
      }
      try {
        const targetRef = branch && branch !== 'HEAD' ? `${remoteName}/${branch}` : '@{u}';
        const counts = await execGit(['rev-list', '--left-right', '--count', `HEAD...${targetRef}`], repoDir, 5000);
        const parts = counts.split(/\s+/).map((x) => parseInt(x, 10));
        if (Number.isInteger(parts[0])) ahead = parts[0];
        if (Number.isInteger(parts[1])) behind = parts[1];
      } catch {}

      return {
        ok: true,
        action: 'status',
        isGitRepo: true,
        repoPath: safeRepoName,
        branch,
        commit,
        shortHash: commit,
        dirty,
        remoteName,
        remoteUrl,
        hasRemote: true,
        noRemote: false,
        ahead,
        behind,
        hasUpdates: behind > 0,
        upToDate: behind === 0,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: behind > 0 ? `${behind} commit(s) available from ${remoteName}` : 'Already up to date',
      };
    }

    // action === 'pull': safe fast-forward pull + hot-push updated bundle!
    const prevCommit = commit;
    try {
      const pullArgs = branch && branch !== 'HEAD' ? ['pull', '--ff-only', remoteName, branch] : ['pull', '--ff-only'];
      const pullOut = await execGit(pullArgs, repoDir, 15000);
      const nextCommit = await execGit(['rev-parse', '--short', 'HEAD'], repoDir, 5000).catch(() => prevCommit);
      const updated = Boolean(nextCommit && nextCommit !== prevCommit);

      let hotReloaded = false;
      if (updated) {
        copyUpdatedRuntimeFromRepo(repoDir, this.rootDir, this.cdp.SYNC_ROOT_FILES);
      }
      this.rebuildBundle();
      for (const item of this.sessions.values()) {
        if (item && !item.session.closed) {
          await this.applyToEntry(item).catch(() => {});
          hotReloaded = true;
        }
      }

      return {
        ok: true,
        action: 'pull',
        isGitRepo: true,
        repoPath: safeRepoName,
        branch,
        prevCommit,
        commit: nextCommit,
        shortHash: nextCommit,
        dirty,
        remoteName,
        remoteUrl,
        hasRemote: true,
        noRemote: false,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated,
        hotReloaded,
        version: this.cdp.PLUGIN_VERSION,
        message: sanitizeSecretText(pullOut || (updated ? `Updated ${prevCommit} -> ${nextCommit}` : 'Already up to date')),
      };
    } catch (err) {
      const safeErr = sanitizeSecretText(err?.message || 'git pull --ff-only failed');
      return {
        ok: false,
        action: 'pull',
        isGitRepo: true,
        repoPath: safeRepoName,
        branch,
        commit,
        shortHash: commit,
        dirty,
        remoteName,
        remoteUrl,
        hasRemote: true,
        noRemote: false,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        error: safeErr,
        message: safeErr,
      };
    }
  }

  rebuildBundle() {
    delete require.cache[require.resolve(path.join(this.rootDir, 'cdp.js'))];
    this.cdp = require(path.join(this.rootDir, 'cdp.js'));
    this.injectExpr = this.cdp.buildInjectExpression();
    const m = this.injectExpr.match(/"codeHash":"([^"]+)"/);
    this.codeHash = m ? m[1] : '';
    return this.injectExpr;
  }

  async ensureMetricsCollector() {
    if (this._customMetricsProvider) return this._customMetricsProvider;
    if (this._lazyStore) {
      return async (input) => {
        const safeId = input?.conversationId && GUID_RE.test(input.conversationId) ? input.conversationId : null;
        const base = await this._lazyStore.snapshot({ conversationId: safeId, force: Boolean(input?.force) });
        let usageSnap = null;
        if (this._lazyUsage) {
          if (input?.force) void this._lazyUsage.sync();
          usageSnap = await this._lazyUsage.snapshot().catch(() => null);
        }
        return { ...base, usage: usageSnap };
      };
    }
    const storeModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/store.mjs', import.meta.url);
    const usageModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/usage.mjs', import.meta.url);
    const { MetricsStore } = await import(storeModUrl.href);
    const { DesktopUsage } = await import(usageModUrl.href);
    this._lazyStore = new MetricsStore();
    this._lazyUsage = new DesktopUsage(this._lazyStore);
    this._lazyStore.onTrajectory = (scope, id, raw) => this._lazyUsage.ingest(scope, id, raw);
    return this.ensureMetricsCollector();
  }

  async ensureThoughtService() {
    if (this._lazyThoughtService) return this._lazyThoughtService;
    const modUrl = new URL('../../vendor/thought-translator/translator-service.mjs', import.meta.url);
    const { ThoughtTranslatorService } = await import(modUrl.href);
    this._lazyThoughtService = new ThoughtTranslatorService();
    return this._lazyThoughtService;
  }

  async ensureLsClient() {
    if (this._lazyLsClient) return this._lazyLsClient;
    if (this._lazyStore && this._lazyStore.client) {
      this._lazyLsClient = this._lazyStore.client;
      return this._lazyLsClient;
    }
    const clientModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/client.mjs', import.meta.url);
    const { AntigravityClient } = await import(clientModUrl.href);
    this._lazyLsClient = new AntigravityClient();
    return this._lazyLsClient;
  }

  async fetchUsageRollupBatch(rawItems) {
    const list = Array.isArray(rawItems) ? rawItems.slice(0, 12) : [];
    if (list.length === 0) return { ok: true, records: [] };
    const usageCore = require(path.join(this.rootDir, 'usage-core.js'));
    const client = await this.ensureLsClient();
    const records = [];
    for (const item of list) {
      const id = String(item?.id || '');
      if (!GUID_RE.test(id)) continue;
      const stepCount = Math.max(0, Number(item.stepCount || 0));
      const lastModifiedSec = Math.max(0, Number(item.lastModifiedSec || 0));
      const createdSec = Math.max(0, Number(item.createdSec || lastModifiedSec || 0));
      const subagent = Boolean(item.subagent);
      const gmOffset = Math.max(0, Math.floor(Number(item.gmOffset || 0)));
      const summaryStub = {
        stepCount,
        lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
        createdTime: createdSec > 0 ? { seconds: createdSec } : undefined,
        trajectoryMetadata: subagent ? { nestingDepth: 1 } : {},
      };
      try {
        if (gmOffset > 0) {
          const deltaItems = [];
          let curOffset = gmOffset;
          let totalGm = null;
          while (true) {
            const page = await client.call('GetCascadeTrajectoryGeneratorMetadata', {
              cascadeId: id,
              generatorMetadataOffset: curOffset,
            });
            const chunk = page?.generatorMetadata || page?.generatorMetadatas || [];
            if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
              totalGm = Number(page.numTotalGeneratorMetadata);
            }
            if (!chunk.length) break;
            deltaItems.push(...chunk);
            curOffset += chunk.length;
            if (totalGm !== null && curOffset >= totalGm) break;
          }
          if (totalGm !== null && totalGm < gmOffset) {
            // Rewound/reverted conversation: rebuild cleanly from offset 0
            const fullMeta = await client._fetchMetadataOnly(id);
            const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, summaryStub, id);
            records.push({ id, mode: 'full', record: fullRec });
          } else {
            const nextGmCount = totalGm !== null ? Math.max(gmOffset + deltaItems.length, totalGm) : gmOffset + deltaItems.length;
            const deltaSummary = {
              stepCount,
              lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : { seconds: Math.floor(Date.now() / 1000) },
              createdTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
              trajectoryMetadata: subagent ? { nestingDepth: 1 } : {},
            };
            const deltaRec = usageCore.analyzeTrajectoryForUsage(
              { numTotalSteps: stepCount, numTotalGeneratorMetadata: nextGmCount, trajectory: { cascadeId: id, steps: [], generatorMetadata: deltaItems } },
              deltaSummary,
              id
            );
            records.push({
              id,
              mode: 'delta',
              gmCount: nextGmCount,
              stepCount,
              lastModifiedSec,
              subagent,
              delta: deltaRec,
            });
          }
        } else {
          const fullMeta = await client._fetchMetadataOnly(id);
          const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, summaryStub, id);
          records.push({ id, mode: 'full', record: fullRec });
        }
      } catch (err) {
        records.push({ id, mode: 'error', error: sanitizeSecretText(err?.message || 'fetch failed') });
      }
    }
    return { ok: true, records };
  }

  updateConfigSetting(key, value) {
    if (!this.cdp.validateConfigEntry(key, value)) return false;
    const cfgPath = path.join(this.rootDir, 'config.json');
    const current = this.cdp.readConfig();
    const next = { ...current, [key]: value };
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  }

  async applyToEntry(entry) {
    if (!this.injectExpr) this.rebuildBundle();
    if (entry.scriptId) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId })
        .catch(() => {});
      entry.scriptId = null;
    }
    const addRes = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: this.injectExpr,
    });
    if (addRes && addRes.identifier) {
      entry.scriptId = addRes.identifier;
    }
    return await entry.session.evaluate(this.injectExpr);
  }

  async handleBindingCall(entry, { name, payload, executionContextId }) {
    if (name === this.cdp.SETTING_BINDING || name === this.cdp.LEGACY_SETTING_BINDING) {
      if (typeof payload !== 'string' || payload.length > 2048) return;
      try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object') return;
        const { key, value } = parsed;
        if (this.updateConfigSetting(key, value)) {
          this.rebuildBundle();
          for (const item of this.sessions.values()) {
            if (item && !item.session.closed) {
              await this.applyToEntry(item).catch(() => {});
            }
          }
        }
      } catch {}
      return;
    }

    if (name === REPO_BINDING) {
      if (typeof payload !== 'string' || payload.length > 4096) return;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
      const action =
        parsed?.action ||
        parsed?.type ||
        parsed?.input?.action ||
        parsed?.payload?.action ||
        'status';

      const result = await this.executeRepoAction({ ...parsed?.input, action });
      if (reqId !== null) {
        const jsonRes = JSON.stringify(result);
        const expr = `(() => {
          if (window.__agPrismRepoBridge && typeof window.__agPrismRepoBridge.resolve === 'function') {
            window.__agPrismRepoBridge.resolve(${reqId}, ${jsonRes});
          } else if (typeof window.__agPrismRepoResolve === 'function') {
            window.__agPrismRepoResolve(${reqId}, ${jsonRes});
          }
        })()`;
        const evalParams = { expression: expr, returnByValue: true };
        if (executionContextId) evalParams.contextId = executionContextId;
        await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      }
      return;
    }

    if (name === METRICS_BINDING) {
      if (typeof payload !== 'string' || payload.length > 4096) return;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
      if (!reqId) return;

      let result;
      try {
        const collector = await this.ensureMetricsCollector();
        result = await collector(parsed.input || {});
      } catch (err) {
        result = {
          connection: 'offline',
          error: err?.message || 'Metrics unavailable',
          speed: null,
          groups: [],
        };
      }
      const expr = `window.__agPrismMetricsResolve && window.__agPrismMetricsResolve(${reqId}, ${JSON.stringify(result)})`;
      const evalParams = { expression: expr, returnByValue: true };
      if (executionContextId) evalParams.contextId = executionContextId;
      await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      return;
    }

    if (name === THOUGHT_BINDING) {
      if (typeof payload !== 'string' || payload.length > 131072) return;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
      if (reqId === null) return;
      const input = parsed?.input && typeof parsed.input === 'object' ? parsed.input : {};
      const action = parsed?.action || input.action || 'get-config';

      let result;
      try {
        const svc = await this.ensureThoughtService();
        if (action === 'get-config') {
          result = svc.getSanitizedConfig();
        } else if (action === 'save-config') {
          result = svc.saveConfig(input);
        } else if (action === 'get-cache') {
          result = svc.getWarmCacheSnapshot(400);
        } else if (action === 'fetch-models') {
          result = await svc.fetchModels(input);
        } else if (action === 'test-connection') {
          result = await svc.testConnection(input);
        } else if (action === 'translate-stream') {
          result = await svc.translateThought({
            text: input.text || '',
            mode: input.mode || 'ai',
            onPartial: (partialText) => {
              if (!entry || entry.session.closed) return;
              const chunkExpr = `window.__agPrismThoughtOnChunk && window.__agPrismThoughtOnChunk(${reqId}, ${JSON.stringify(partialText)})`;
              const chunkParams = { expression: chunkExpr, returnByValue: true };
              if (executionContextId) chunkParams.contextId = executionContextId;
              void entry.session.send('Runtime.evaluate', chunkParams).catch(() => {});
            },
          });
        } else {
          result = { ok: false, error: `Unknown thought action: ${action}` };
        }
      } catch (err) {
        result = { ok: false, error: sanitizeSecretText(err?.message || err) };
      }

      if (!entry.session.closed) {
        const resolveExpr = `window.__agPrismThoughtResolve && window.__agPrismThoughtResolve(${reqId}, ${JSON.stringify(result)})`;
        const evalParams = { expression: resolveExpr, returnByValue: true };
        if (executionContextId) evalParams.contextId = executionContextId;
        await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      }
      return;
    }

    if (name === USAGE_BINDING) {
      if (typeof payload !== 'string' || payload.length > 65536) return;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
      if (reqId === null) return;
      let result;
      try {
        result = await this.fetchUsageRollupBatch(parsed.items);
      } catch (err) {
        result = { ok: false, error: sanitizeSecretText(err?.message || err), records: [] };
      }
      if (!entry.session.closed) {
        const resolveExpr = `window.__agPrismUsageResolve && window.__agPrismUsageResolve(${reqId}, ${JSON.stringify(result)})`;
        const evalParams = { expression: resolveExpr, returnByValue: true };
        if (executionContextId) evalParams.contextId = executionContextId;
        await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      }
    }
  }

  async attachTarget(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (this.sessions.has(wsUrl)) return this.sessions.get(wsUrl);

    const session = await this.cdp.CdpSession.connect(wsUrl, 3500);
    const entry = {
      wsUrl,
      pageId: target.id,
      title: target.title || target.url || 'Antigravity',
      session,
      scriptId: null,
    };
    this.sessions.set(wsUrl, entry);

    session.onClose = () => {
      if (this.sessions.get(wsUrl) === entry) {
        this.sessions.delete(wsUrl);
      }
    };

    try {
      await session.send('Page.enable');
      await session.send('Runtime.enable');
      session.on('Runtime.bindingCalled', (params) => {
        void this.handleBindingCall(entry, params || {});
      });
      await session.send('Runtime.addBinding', { name: this.cdp.SETTING_BINDING });
      await session.send('Runtime.addBinding', { name: this.cdp.LEGACY_SETTING_BINDING }).catch(() => {});
      await session.send('Runtime.addBinding', { name: METRICS_BINDING });
      await session.send('Runtime.addBinding', { name: REPO_BINDING });
      await session.send('Runtime.addBinding', { name: THOUGHT_BINDING });
      await session.send('Runtime.addBinding', { name: USAGE_BINDING });

      const healOnNav = () => {
        setTimeout(() => {
          void this.verifyAndHealEntry(entry);
        }, 50);
      };
      session.on('Page.domContentLoadedEventFired', healOnNav);
      session.on('Page.loadEventFired', healOnNav);

      const res = await this.applyToEntry(entry);
      this.log(`[✓] Attached & injected Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${entry.title} (${res?.status || 'ok'})`);
      return entry;
    } catch (err) {
      try {
        if (entry.scriptId) {
          await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId });
        }
      } catch {}
      session.close();
      this.sessions.delete(wsUrl);
      throw err;
    }
  }

  async verifyAndHealEntry(entry) {
    if (!entry || entry.session.closed) return;
    try {
      const probe = await entry.session.evaluate(
        `(() => {
        const root = typeof document !== 'undefined' && document.documentElement;
        if (!root || document.readyState === 'loading') return { ready: false };
        const api = window.__agPrism;
        const st = api && typeof api.getState === 'function' ? api.getState() : null;
        const telMode = st?.cfg?.telemetryModule || 'auto';
        const hasModelBtn = Boolean(document.querySelector('[data-testid="model-selector-trigger"]'));
        const hasPulseBar = Boolean(document.getElementById('ag-pulse-status-bar'));
        return {
          ready: true,
          prismAttr: root.getAttribute('data-ag-prism') || '',
          hasPrism: Boolean(api),
          hasRepoBridge: Boolean(window.__agPrismRepoBridge),
          hasThoughtBridge: Boolean(window.__agPrismThoughtBridge),
          hasUsageBridge: Boolean(window.__agPrismUsageBridge),
          codeHash: (api && api.codeHash) || '',
          hasLegacyCss: Boolean(document.getElementById('ag-claude-style-css')),
          needsDashboardSync: Boolean(api && telMode !== 'off' && hasModelBtn && !hasPulseBar),
        };
      })()`,
        false,
        2600
      );
      if (!probe || !probe.ready) return;
      if (
        !probe.hasPrism ||
        !probe.hasRepoBridge ||
        !probe.hasThoughtBridge ||
        !probe.hasUsageBridge ||
        probe.prismAttr !== this.cdp.PLUGIN_VERSION ||
        probe.hasLegacyCss ||
        (this.codeHash && probe.codeHash && probe.codeHash !== this.codeHash)
      ) {
        await entry.session.send('Runtime.addBinding', { name: this.cdp.SETTING_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: METRICS_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: REPO_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: USAGE_BINDING }, 2600).catch(() => {});
        await entry.session.evaluate(this.injectExpr, false, 4500);
        this.log(`[↻] Hot-healed window to Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${entry.title}`);
      } else if (probe.needsDashboardSync) {
        await entry.session
          .evaluate(
            `(() => {
              const cfg = window.__agPrism?.getState?.()?.cfg || {};
              window.__agPrismTelemetry?.sync?.(cfg);
              window.__agPrism?.sync?.();
              return true;
            })()`,
            false,
            2200
          )
          .catch(() => {});
      }
    } catch {
      entry.session.close();
      this.sessions.delete(entry.wsUrl);
    }
  }

  async detachAll(cleanPageDom = false) {
    for (const entry of this.sessions.values()) {
      try {
        if (entry.scriptId && !entry.session.closed) {
          await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
        }
        if (cleanPageDom && !entry.session.closed) {
          await entry.session.evaluate(this.cdp.REMOVE_EXPRESSION).catch(() => {});
        }
      } catch {}
      entry.session.close();
    }
    this.sessions.clear();
  }

  async tick() {
    if (this.busy || !this.running) return { attached: this.sessions.size };
    this.busy = true;
    try {
      if (!this.isCurrentOwner()) {
        await this.stop(false);
        return { attached: 0, superseded: true };
      }

      if (!this.enabledCheck()) {
        if (this.sessions.size > 0) {
          await this.detachAll(true);
        }
        return { attached: 0, disabled: true };
      }

      const port = discoverActivePort(this.overridePort, this.portFile);
      if (!port) return { attached: 0, port: null };

      let rawPages = [];
      try {
        rawPages = await this.cdp.listPages(port);
      } catch {
        return { attached: this.sessions.size, port, unreachable: true };
      }

      const eligible = rawPages.filter(isEligibleTarget);
      const activeUrls = new Set(eligible.map((t) => t.webSocketDebuggerUrl));

      for (const [wsUrl, entry] of this.sessions.entries()) {
        if (!activeUrls.has(wsUrl) || entry.session.closed) {
          entry.session.close();
          this.sessions.delete(wsUrl);
        }
      }

      if (!this.injectExpr) this.rebuildBundle();

      for (const target of eligible) {
        if (!this.sessions.has(target.webSocketDebuggerUrl)) {
          await this.attachTarget(target).catch(() => {});
        } else {
          await this.verifyAndHealEntry(this.sessions.get(target.webSocketDebuggerUrl));
        }
      }

      return { attached: this.sessions.size, port, pages: eligible.map((p) => p.title || p.url) };
    } finally {
      this.busy = false;
    }
  }

  claimOwnership() {
    try {
      if (fs.existsSync(this.pidFile)) {
        const prev = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
        if (prev && prev.pid && prev.pid !== process.pid && isPidAlive(prev.pid)) {
          try { process.kill(prev.pid); } catch {}
        }
      }
    } catch {}
    try {
      fs.writeFileSync(
        this.pidFile,
        JSON.stringify({ pid: process.pid, token: this.ownerToken, startedAt: Date.now() }),
        'utf8'
      );
    } catch {}
  }

  isCurrentOwner() {
    try {
      if (!fs.existsSync(this.pidFile)) return true;
      const cur = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
      return !cur || !cur.token || cur.token === this.ownerToken;
    } catch {
      return true;
    }
  }

  releaseOwnership() {
    try {
      if (fs.existsSync(this.pidFile)) {
        const cur = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
        if (cur && cur.token === this.ownerToken) {
          fs.unlinkSync(this.pidFile);
        }
      }
    } catch {}
  }

  start({ claimPid = true, watchFiles = true } = {}) {
    if (this.running) return;
    this.running = true;
    if (claimPid) this.claimOwnership();
    this.rebuildBundle();

    if (watchFiles) {
      let reloadTimer = null;
      try {
        this.fsw = fs.watch(this.rootDir, { recursive: true }, (_, filename) => {
          const base = filename ? path.basename(filename) : '';
          if (!base || base.startsWith('.') || !/\.(css|js|json)$/i.test(base)) return;
          if (base === 'daemon.log' || base === 'watch.log' || base === 'repo-meta.json') return;
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(async () => {
            try {
              this.rebuildBundle();
              for (const entry of this.sessions.values()) {
                if (entry && !entry.session.closed) {
                  await this.applyToEntry(entry).catch(() => {});
                }
              }
            } catch {}
          }, 180);
        });
        if (this.fsw && typeof this.fsw.unref === 'function') this.fsw.unref();
      } catch {}
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  async stop(cleanPageDom = false) {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.fsw) {
      try { this.fsw.close(); } catch {}
      this.fsw = null;
    }
    await this.detachAll(cleanPageDom);
    this.releaseOwnership();
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let once = false;
  let port = null;
  let rootDir = DEFAULT_ROOT_DIR;
  let gitRepoDir = null;
  let outFile = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--once') once = true;
    else if (a === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    else if (a === '--root' && args[i + 1]) rootDir = path.resolve(args[++i]);
    else if (a === '--repo' && args[i + 1]) gitRepoDir = path.resolve(args[++i]);
    else if (a === '--out' && args[i + 1]) outFile = path.resolve(args[++i]);
  }
  return { once, port, rootDir, gitRepoDir, outFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const cli = parseArgs(process.argv);
  const daemon = new PrismDaemon({
    rootDir: cli.rootDir,
    gitRepoDir: cli.gitRepoDir,
    overridePort: cli.port,
  });

  if (cli.once) {
    daemon.running = true;
    daemon.rebuildBundle();
    daemon
      .tick()
      .then(async (res) => {
        if (cli.outFile) {
          fs.writeFileSync(cli.outFile, JSON.stringify({ ok: true, ...res }, null, 2), 'utf8');
        } else {
          console.log(JSON.stringify({ ok: true, ...res }, null, 2));
        }
        for (const e of daemon.sessions.values()) e.session.close();
        process.exit(0);
      })
      .catch((err) => {
        console.error('[obsidian-prism daemon] error:', err.message);
        process.exit(1);
      });
  } else {
    daemon.start({ claimPid: true, watchFiles: true });
    const shutdown = async () => {
      await daemon.stop(false);
      process.exit(0);
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
      process.on(sig, () => {
        void shutdown();
      });
    }
    process.on('uncaughtException', (err) => {
      daemon.log(`[!] uncaughtException: ${err?.stack || err}`);
    });
    process.on('unhandledRejection', (err) => {
      daemon.log(`[!] unhandledRejection: ${err?.stack || err}`);
    });
  }
}
