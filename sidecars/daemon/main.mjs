// Obsidian Prism Native Sidecar Daemon (sidecars/daemon/main.mjs)
// - Auto-discovers DevToolsActivePort across Windows/macOS/Linux + fast Target.setDiscoverTargets push
// - Registers Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate (survives Ctrl+Shift+R reloads with zero app.asar touch!)
// - Hot-upgrades legacy instances to Obsidian Prism v1.0.1
// - Lazily serves real MetricsStore + DesktopUsage snapshots over __agPrismMetricsCall only when requested (0 idle CPU)
// - Registers __agPrismRepoCall (paired with window.__agPrismRepoBridge) for live Git status & safe git pull --ff-only + hot-reload!

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OmniServer, OMNI_BINDING, isBlockedUncPath } from '../../vendor/omni-viewer/omni-server.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');
const defaultCdp = require(path.join(DEFAULT_ROOT_DIR, 'cdp.js'));

export const METRICS_BINDING = '__agPrismMetricsCall';
export const REPO_BINDING = '__agPrismRepoCall';
export const THOUGHT_BINDING = '__agPrismThoughtCall';
export const USAGE_BINDING = '__agPrismUsageCall';
export { OmniServer, OMNI_BINDING };
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function execGit(args, cwd, timeoutMs = 12000, extraConfigs = []) {
  const cfgFlags = ['-c', 'protocol.ext.allow=never', '-c', 'submodule.recurse=false'];
  for (const flag of extraConfigs) cfgFlags.push(flag);
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...cfgFlags, ...args],
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

export function copyUpdatedRuntimeFromRepo(repoDir, pluginDir, syncFilesList) {
  if (!repoDir || !pluginDir) return 0;
  const normRepo = path.resolve(repoDir).toLowerCase();
  const normPlugin = path.resolve(pluginDir).toLowerCase();
  if (normRepo === normPlugin) return 0;

  let resolvedFiles = null;
  const repoCdpPath = path.join(repoDir, 'cdp.js');
  if (fs.existsSync(repoCdpPath)) {
    try {
      const reqKey = require.resolve(repoCdpPath);
      delete require.cache[reqKey];
      const freshRepoCdp = require(repoCdpPath);
      if (Array.isArray(freshRepoCdp?.SYNC_ROOT_FILES) && freshRepoCdp.SYNC_ROOT_FILES.length > 0) {
        resolvedFiles = freshRepoCdp.SYNC_ROOT_FILES;
      }
    } catch {}
  }

  let synced = 0;
  const files =
    resolvedFiles ||
    (Array.isArray(syncFilesList) && syncFilesList.length > 0 ? syncFilesList : ['cdp.js', 'style.css', 'ui-runtime.js']);
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
  syncSubDir('sidecars');
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
  return defaultCdp.isEligibleTarget(target);
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
    omniExecHooks = null,
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
    this._cdpFileSig = this._readCdpFileSig();
    this._selfConfigWriteUntil = 0;
    this._configSeq = 0;
    this._broadcastRunning = false;
    this._broadcastPending = false;
    this._broadcastWaiters = [];
    this.sessions = new Map();
    this.ignoredTargets = new Map();
    this.browserSession = null;
    this.browserPort = null;
    this._discoverTimer = null;
    this._pendingTick = false;
    this.running = false;
    this.busy = false;
    this.timer = null;
    this.fsw = null;
    this.injectExpr = '';
    this.omniExpr = '';
    this.codeHash = '';
    this.ownerToken = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.pidFile = path.join(this.rootDir, '.daemon.pid');
    this.logFile = path.join(this.rootDir, 'daemon.log');
    this._lazyStore = null;
    this._lazyUsage = null;
    this._customMetricsProvider = metricsProvider;
    this._lazyThoughtService = thoughtService;
    this.omniServer = null;
    this._omniServerPromise = null;
    this._omniExecHooks = omniExecHooks;
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

    let isNetworkRemote = false;
    try {
      const remotesRaw = await execGit(['remote'], repoDir, 4000);
      const remotes = remotesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (remotes.length > 0) {
        remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        const rawRemoteUrl = await execGit(['remote', 'get-url', remoteName], repoDir, 4000).catch(() => '');
        if (rawRemoteUrl && isBlockedUncPath(rawRemoteUrl)) {
          return {
            ok: false,
            action,
            isGitRepo: true,
            repoPath: path.basename(repoDir),
            branch,
            commit,
            shortHash: commit,
            dirty,
            error: 'Remote UNC Git paths are blocked',
            message: 'Remote UNC Git paths are blocked',
          };
        }
        isNetworkRemote = /^(?:https?|ssh|git):\/\/|^[^/\\:\s]+@[^/\\:\s]+:/i.test(rawRemoteUrl);
        remoteUrl = sanitizeGitRemoteUrl(rawRemoteUrl);
      }
    } catch {}

    const netGitCfg = isNetworkRemote ? ['-c', 'protocol.file.allow=never'] : [];

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
        await execGit(['fetch', '--quiet', '--no-recurse-submodules', remoteName], repoDir, 8000, netGitCfg);
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
      const pullArgs =
        branch && branch !== 'HEAD'
          ? ['pull', '--ff-only', '--no-recurse-submodules', remoteName, branch]
          : ['pull', '--ff-only', '--no-recurse-submodules'];
      const pullOut = await execGit(pullArgs, repoDir, 15000, netGitCfg);
      const nextCommit = await execGit(['rev-parse', '--short', 'HEAD'], repoDir, 5000).catch(() => prevCommit);
      const updated = Boolean(nextCommit && nextCommit !== prevCommit);

      let hotReloaded = false;
      if (updated) {
        copyUpdatedRuntimeFromRepo(repoDir, this.rootDir, this.cdp.SYNC_ROOT_FILES);
      }
      this.rebuildBundle({ forceReloadCdp: updated });
      const activeItems = [...this.sessions.values()].filter((item) => item && !item.session.closed);
      if (activeItems.length > 0) {
        await Promise.allSettled(activeItems.map((item) => this.applyToEntry(item)));
        hotReloaded = true;
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

  _readCdpFileSig() {
    try {
      const st = fs.statSync(path.join(this.rootDir, 'cdp.js'));
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  rebuildBundle({ forceReloadCdp = false } = {}) {
    const cdpPath = path.join(this.rootDir, 'cdp.js');
    const nextSig = this._readCdpFileSig();
    if (forceReloadCdp || !this.cdp || (nextSig && nextSig !== this._cdpFileSig)) {
      try {
        delete require.cache[require.resolve(cdpPath)];
      } catch {}
      this.cdp = require(cdpPath);
      this._cdpFileSig = nextSig;
    }
    this.injectExpr = this.cdp.buildInjectExpression();
    const m = this.injectExpr.match(/"codeHash":"([^"]+)"/);
    this.codeHash = m ? m[1] : '';
    if (typeof this.cdp.buildOmniClientExpression === 'function') {
      const meta = this.omniServer && this.omniServer.running ? this.omniServer.getServerInfo() : null;
      this.omniExpr = this.cdp.buildOmniClientExpression(meta);
    } else {
      this.omniExpr = '';
    }
    return this.injectExpr;
  }

  _hasOmniClientFile() {
    try {
      return fs.existsSync(path.join(this.rootDir, 'vendor', 'omni-viewer', 'omni-client.js'));
    } catch {
      return false;
    }
  }

  async ensureOmniServer() {
    if (this.omniServer && this.omniServer.running) return this.omniServer;
    if (this._omniServerPromise) return this._omniServerPromise;
    this._omniServerPromise = (async () => {
      const srv = new OmniServer({
        rootDir: this.rootDir,
        execHooks: this._omniExecHooks,
      });
      await srv.start();
      this.omniServer = srv;
      if (typeof this.cdp.buildOmniClientExpression === 'function') {
        this.omniExpr = this.cdp.buildOmniClientExpression(srv.getServerInfo());
      }
      return srv;
    })();
    try {
      return await this._omniServerPromise;
    } finally {
      this._omniServerPromise = null;
    }
  }

  resolveTelemetryDataDir() {
    if (this._telemetryDataDir) return this._telemetryDataDir;
    const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'obsidian-prism', 'telemetry');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this._telemetryDataDir = dir;
    return dir;
  }

  syncClientCdpPort(clientOrStore) {
    if (!clientOrStore) return null;
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    if (activePort) {
      if (typeof clientOrStore.setCdpPort === 'function') {
        clientOrStore.setCdpPort(activePort);
      } else {
        clientOrStore.cdpPort = activePort;
        if (clientOrStore.client) clientOrStore.client.cdpPort = activePort;
      }
    }
    return activePort;
  }

  async _ensureLazyDesktopUsage() {
    if (this._lazyUsage || !this._lazyStore) return this._lazyUsage;
    const telemetryDataDir = this.resolveTelemetryDataDir();
    const usageModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/usage.mjs', import.meta.url);
    const { DesktopUsage } = await import(usageModUrl.href);
    this._lazyUsage = new DesktopUsage(this._lazyStore, { dataDir: telemetryDataDir });
    this._lazyStore.onTrajectory = (scope, id, raw, options) =>
      typeof this._lazyUsage.ingestLive === 'function'
        ? this._lazyUsage.ingestLive(scope, id, raw, options)
        : this._lazyUsage.ingest(scope, id, raw);
    this._lazyStore.onBackgroundResult = (scope, id, jobDb, options) =>
      typeof this._lazyUsage.ingestDisk === 'function'
        ? this._lazyUsage.ingestDisk(scope, id, jobDb, options)
        : undefined;
    return this._lazyUsage;
  }

  async ensureMetricsCollector() {
    if (this._customMetricsProvider) return this._customMetricsProvider;
    if (this._lazyStore) {
      return async (input) => {
        this.syncClientCdpPort(this._lazyStore);
        const safeId = input?.conversationId && GUID_RE.test(input.conversationId) ? input.conversationId : null;
        const base = await this._lazyStore.snapshot({ conversationId: safeId, force: Boolean(input?.force) });
        let usageSnap = null;
        if (input?.includeUsage === true) {
          if (!this._lazyUsage) {
            await this._ensureLazyDesktopUsage().catch(() => null);
          }
          if (this._lazyUsage) {
            if (input?.force) void this._lazyUsage.sync(true);
            usageSnap = await this._lazyUsage
              .snapshot({ groups: Array.isArray(base?.groups) ? base.groups : null })
              .catch(() => null);
          }
        }
        return { ...base, usage: usageSnap };
      };
    }
    const telemetryDataDir = this.resolveTelemetryDataDir();
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    const storeModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/store.mjs', import.meta.url);
    const { MetricsStore } = await import(storeModUrl.href);
    this._lazyStore = new MetricsStore({
      dataDir: telemetryDataDir,
      ...(activePort ? { cdpPort: activePort } : {}),
    });
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
    if (this._lazyLsClient) {
      this.syncClientCdpPort(this._lazyLsClient);
      return this._lazyLsClient;
    }
    if (this._lazyStore && this._lazyStore.client) {
      this._lazyLsClient = this._lazyStore.client;
      this.syncClientCdpPort(this._lazyLsClient);
      return this._lazyLsClient;
    }
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    const clientModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/client.mjs', import.meta.url);
    const { AntigravityClient } = await import(clientModUrl.href);
    this._lazyLsClient = new AntigravityClient(activePort ? { cdpPort: activePort } : {});
    return this._lazyLsClient;
  }

  async _fetchFullGeneratorMetadata(client, id) {
    if (typeof client._fetchMetadataOnly === 'function') {
      return await client._fetchMetadataOnly(id);
    }
    const allItems = [];
    let curOffset = 0;
    let totalGm = null;
    let totalSteps = 0;
    while (true) {
      const page = await client.call('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        generatorMetadataOffset: curOffset,
      });
      const chunk = page?.generatorMetadata || page?.generatorMetadatas || [];
      if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
        totalGm = Number(page.numTotalGeneratorMetadata);
      }
      if (page?.numTotalSteps !== undefined && page?.numTotalSteps !== null) {
        totalSteps = Math.max(totalSteps, Number(page.numTotalSteps) || 0);
      }
      if (!chunk.length) break;
      allItems.push(...chunk);
      curOffset += chunk.length;
      if (totalGm !== null && curOffset >= totalGm) break;
    }
    return {
      numTotalSteps: totalSteps,
      numTotalGeneratorMetadata: totalGm !== null ? totalGm : allItems.length,
      trajectory: {
        cascadeId: id,
        steps: [],
        generatorMetadata: allItems,
      },
    };
  }

  async _fetchBackendTrajectorySummaries(client, usageCore, force = false) {
    const now = Date.now();
    if (!force && this._backendSummariesCache && now - this._backendSummariesAt < 8000) {
      return this._backendSummariesCache;
    }
    try {
      const raw = await client.call('GetAllCascadeTrajectories', {});
      const mapOrList = raw?.trajectorySummaries || {};
      const entries = Array.isArray(mapOrList)
        ? mapOrList.map((sum) => [sum?.cascadeId || sum?.id || '', sum])
        : Object.entries(mapOrList);
      const list = [];
      const byId = new Map();
      const toSec = (v) => {
        if (!v) return 0;
        if (typeof usageCore?.tsSec === 'function') {
          const n = Number(usageCore.tsSec(v) || 0);
          if (n > 0) return Math.floor(n);
        }
        if (typeof v === 'object' && v.seconds !== undefined) return Math.max(0, Math.floor(Number(v.seconds) || 0));
        if (typeof v === 'string') {
          const ms = Date.parse(v);
          if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
        }
        return 0;
      };
      const extractWs = (sum) => {
        const wsArr = sum?.workspaces || sum?.trajectoryMetadata?.workspaces;
        const out = [];
        if (Array.isArray(wsArr)) {
          for (const w of wsArr) {
            const uri = String(
              w?.workspaceFolderAbsoluteUri || w?.gitRootAbsoluteUri || w?.uri || w?.path || ''
            ).trim();
            if (uri) out.push(uri);
          }
        }
        const single = String(sum?.workspaceUri || sum?.workspacePath || sum?.trajectoryMetadata?.workspaceUri || '').trim();
        if (single && !out.includes(single)) out.push(single);
        let workspace = '';
        if (out.length > 0) {
          try {
            const decoded = decodeURIComponent(out[0].replace(/^file:\/\//i, '')).replace(/[\\/]+$/, '');
            workspace = decoded.split(/[\\/]/).filter(Boolean).pop() || '';
          } catch {
            workspace = out[0].replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || '';
          }
        }
        return { workspace, workspaces: out };
      };

      for (const [rawId, sum] of entries) {
        const id = String(rawId || sum?.cascadeId || sum?.id || '').trim();
        if (!GUID_RE.test(id) || !sum || typeof sum !== 'object') continue;
        const meta = sum.trajectoryMetadata && typeof sum.trajectoryMetadata === 'object' ? sum.trajectoryMetadata : {};
        const parentId = String(
          sum.parentConversationId ||
            meta.parentConversationId ||
            sum.parentCascadeId ||
            sum.parentTrajectoryId ||
            meta.parentCascadeId ||
            meta.parentTrajectoryId ||
            ''
        ).trim();
        const rootId = String(
          sum.rootConversationId || meta.rootConversationId || sum.rootCascadeId || meta.rootCascadeId || ''
        ).trim();
        const subagent = Boolean(
          (typeof usageCore?.isSubagentSummary === 'function' && usageCore.isSubagentSummary(sum)) ||
            parentId ||
            Number(meta.nestingDepth || sum.nestingDepth || 0) > 0 ||
            sum.isSubagent ||
            meta.isSubagent ||
            meta.subagentName
        );
        const stepCount = Math.max(0, Number(sum.stepCount ?? sum.numTotalSteps ?? 0) || 0);
        const lastModifiedSec = toSec(sum.lastModifiedTime || sum.modifiedAt || sum.updatedAt);
        const createdSec = toSec(sum.createdTime || sum.createdAt) || lastModifiedSec;
        const { workspace, workspaces } = extractWs(sum);
        const item = {
          id,
          stepCount,
          lastModifiedSec,
          createdSec,
          subagent,
          ...(parentId ? { parentId } : {}),
          ...(rootId ? { rootId } : {}),
          ...(workspace ? { workspace } : {}),
          ...(workspaces.length ? { workspaces } : {}),
          title: String(sum.summary || sum.title || '').slice(0, 140),
          status: String(sum.status || ''),
        };
        list.push(item);
        byId.set(id.toLowerCase(), item);
      }
      const pack = { list, byId };
      this._backendSummariesCache = pack;
      this._backendSummariesAt = now;
      return pack;
    } catch {
      return { list: [], byId: new Map() };
    }
  }

  async fetchUsageRollupBatch(rawItems, opts = {}) {
    const usageCore = require(path.join(this.rootDir, 'usage-core.js'));
    const client = await this.ensureLsClient();
    const action = opts?.action || 'fetch-batch';
    const wantSummaries = action === 'list-summaries' || Boolean(opts?.includeSummaries);
    const backendPack = await this._fetchBackendTrajectorySummaries(client, usageCore, action === 'list-summaries');

    if (action === 'list-summaries') {
      return { ok: true, records: [], summaries: backendPack.list };
    }

    const list = Array.isArray(rawItems) ? rawItems.slice(0, 16) : [];
    if (list.length === 0) {
      return wantSummaries ? { ok: true, records: [], summaries: backendPack.list } : { ok: true, records: [] };
    }

    const records = [];
    for (const item of list) {
      const id = String(item?.id || '');
      if (!GUID_RE.test(id)) continue;
      const backendSum = backendPack.byId.get(id.toLowerCase()) || null;
      const stepCount = Math.max(0, Number(item.stepCount || backendSum?.stepCount || 0));
      const lastModifiedSec = Math.max(0, Number(item.lastModifiedSec || backendSum?.lastModifiedSec || 0));
      const createdSec = Math.max(0, Number(item.createdSec || backendSum?.createdSec || lastModifiedSec || 0));
      const subagent = Boolean(item.subagent || backendSum?.subagent);
      const parentId = String(item.parentId || backendSum?.parentId || '').trim();
      const rootId = String(item.rootId || backendSum?.rootId || '').trim();
      const workspace = String(item.workspace || backendSum?.workspace || '');
      const workspaces = Array.isArray(item.workspaces) && item.workspaces.length
        ? item.workspaces
        : backendSum?.workspaces || [];
      const gmOffset = Math.max(0, Math.floor(Number(item.gmOffset || 0)));
      const wsMeta = workspaces.map((uri) => ({ workspaceFolderAbsoluteUri: uri }));
      const summaryStub = {
        stepCount,
        lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
        createdTime: createdSec > 0 ? { seconds: createdSec } : undefined,
        ...(parentId ? { parentConversationId: parentId, parentId } : {}),
        ...(rootId ? { rootConversationId: rootId, rootId } : {}),
        ...(wsMeta.length ? { workspaces: wsMeta } : {}),
        trajectoryMetadata: {
          ...(subagent ? { nestingDepth: 1 } : {}),
          ...(parentId ? { parentConversationId: parentId } : {}),
          ...(rootId ? { rootConversationId: rootId } : {}),
          ...(wsMeta.length ? { workspaces: wsMeta } : {}),
        },
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
            const fullMeta = await this._fetchFullGeneratorMetadata(client, id);
            const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, summaryStub, id);
            if (workspace && fullRec && typeof fullRec === 'object' && !fullRec.workspace) fullRec.workspace = workspace;
            if (parentId && fullRec && typeof fullRec === 'object' && !fullRec.parentId) fullRec.parentId = parentId;
            records.push({
              id,
              mode: 'full',
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              record: fullRec,
            });
          } else {
            const nextGmCount = totalGm !== null ? Math.max(gmOffset + deltaItems.length, totalGm) : gmOffset + deltaItems.length;
            const deltaSummary = {
              stepCount,
              lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : { seconds: Math.floor(Date.now() / 1000) },
              createdTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
              ...(parentId ? { parentConversationId: parentId, parentId } : {}),
              ...(rootId ? { rootConversationId: rootId, rootId } : {}),
              ...(wsMeta.length ? { workspaces: wsMeta } : {}),
              trajectoryMetadata: {
                ...(subagent ? { nestingDepth: 1 } : {}),
                ...(parentId ? { parentConversationId: parentId } : {}),
                ...(rootId ? { rootConversationId: rootId } : {}),
                ...(wsMeta.length ? { workspaces: wsMeta } : {}),
              },
            };
            const deltaRec = usageCore.analyzeTrajectoryForUsage(
              { numTotalSteps: stepCount, numTotalGeneratorMetadata: nextGmCount, trajectory: { cascadeId: id, steps: [], generatorMetadata: deltaItems } },
              deltaSummary,
              id
            );
            if (workspace && deltaRec && typeof deltaRec === 'object' && !deltaRec.workspace) deltaRec.workspace = workspace;
            if (parentId && deltaRec && typeof deltaRec === 'object' && !deltaRec.parentId) deltaRec.parentId = parentId;
            records.push({
              id,
              mode: 'delta',
              gmCount: nextGmCount,
              stepCount,
              lastModifiedSec,
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              delta: deltaRec,
            });
          }
        } else {
          const fullMeta = await this._fetchFullGeneratorMetadata(client, id);
          const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, summaryStub, id);
          if (workspace && fullRec && typeof fullRec === 'object' && !fullRec.workspace) fullRec.workspace = workspace;
          if (parentId && fullRec && typeof fullRec === 'object' && !fullRec.parentId) fullRec.parentId = parentId;
          records.push({
            id,
            mode: 'full',
            subagent,
            ...(parentId ? { parentId } : {}),
            ...(workspace ? { workspace } : {}),
            record: fullRec,
          });
        }
      } catch (err) {
        records.push({ id, mode: 'error', error: sanitizeSecretText(err?.message || 'fetch failed') });
      }
    }
    return wantSummaries ? { ok: true, records, summaries: backendPack.list } : { ok: true, records };
  }

  updateConfigBatch(entriesObj) {
    if (!entriesObj || typeof entriesObj !== 'object' || Array.isArray(entriesObj)) return false;
    const validPatch = {};
    let count = 0;
    for (const [k, v] of Object.entries(entriesObj)) {
      if (this.cdp.validateConfigEntry(k, v)) {
        validPatch[k] = v;
        count += 1;
      }
    }
    if (count === 0) return false;
    const cfgPath = path.join(this.rootDir, 'config.json');
    const current = this.cdp.readConfig();
    const expandedPatch =
      typeof this.cdp.reconcileConfigAliases === 'function' ? this.cdp.reconcileConfigAliases(validPatch) : validPatch;
    const next = { ...current, ...expandedPatch };
    this._configSeq += 1;
    this._selfConfigWriteUntil = Date.now() + 650;
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  }

  updateConfigSetting(key, value) {
    return this.updateConfigBatch({ [key]: value });
  }

  _runEntryExclusive(entry, fn) {
    if (!entry) return Promise.resolve();
    const prev = entry._opChain || Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    entry._opChain = next.catch(() => {});
    return next;
  }

  _isTrustedMainFrameBindingCall(entry, executionContextId) {
    if (!entry) return false;
    const hasCtxId = typeof executionContextId === 'number';
    if (hasCtxId && entry.contextFrames && entry.contextFrames.has(executionContextId)) {
      const meta = entry.contextFrames.get(executionContextId);
      if (!meta.isDefault) return false;
      if (meta.type && meta.type !== 'default') return false;
      if (entry.mainFrameId && meta.frameId && meta.frameId !== entry.mainFrameId) {
        return false;
      }
      return true;
    }
    if (entry.hasFrameTree) {
      if (!hasCtxId) return false;
      if (entry.contextFrames && entry.contextFrames.size > 0) return false;
    }
    return true;
  }

  async broadcastConfigRefresh() {
    this._broadcastPending = true;
    if (this._broadcastRunning) {
      return new Promise((resolve) => {
        this._broadcastWaiters.push(resolve);
      });
    }

    this._broadcastRunning = true;
    try {
      while (this._broadcastPending) {
        this._broadcastPending = false;
        const snapSeq = this._configSeq;
        const activeItems = [...this.sessions.values()].filter((item) => item && !item.session.closed);
        const perEntryAck = new Map();
        for (const item of activeItems) {
          const entryAck = Number.isSafeInteger(item.pendingAckEpoch) && item.pendingAckEpoch > 0 ? item.pendingAckEpoch : 0;
          item.pendingAckEpoch = 0;
          perEntryAck.set(item, entryAck);
        }

        await this.ensureOmniServer().catch(() => null);
        // Warm-cache rebuild updates `this.injectExpr` bootCfg in < 3ms without re-minifying modules!
        this.rebuildBundle();
        const injectSnap = this.injectExpr;
        const omniSnap = this.omniExpr;
        const canFastRefresh = typeof this.cdp.buildConfigRefreshExpression === 'function';
        const baseRefreshExpr = canFastRefresh ? this.cdp.buildConfigRefreshExpression() : null;
        if (activeItems.length === 0) continue;

        await Promise.allSettled(
          activeItems.map((entry) =>
            this._runEntryExclusive(entry, async () => {
              if (!entry || entry.session.closed) return;
              const entryAck = perEntryAck.get(entry) || 0;
              const refreshExpr =
                canFastRefresh && entryAck > 0
                  ? this.cdp.buildConfigRefreshExpression(null, { __ackEpoch: entryAck })
                  : baseRefreshExpr;
              // Fast live refresh first for immediate UI responsiveness
              let refreshedFast = false;
              let skippedStale = false;
              if (refreshExpr) {
                const fastRes = await entry.session.evaluate(refreshExpr).catch(() => null);
                if (fastRes && fastRes.refreshed) {
                  refreshedFast = true;
                  skippedStale = Boolean(fastRes.skippedStale);
                }
              }
              if (!refreshedFast && !entry.session.closed) {
                await entry.session.evaluate(injectSnap).catch(() => {});
              }
              if (omniSnap && !skippedStale && !entry.session.closed) {
                await entry.session.evaluate(omniSnap).catch(() => {});
              }

              // Coalesce persistent NewDocument script replacement if a newer mutation is already queued!
              if (this._broadcastPending || this._configSeq !== snapSeq || entry.session.closed) {
                return;
              }
              if (entry.scriptId) {
                await entry.session
                  .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId })
                  .catch(() => {});
                entry.scriptId = null;
              }
              const addRes = await entry.session
                .send('Page.addScriptToEvaluateOnNewDocument', { source: injectSnap })
                .catch(() => null);
              if (addRes && addRes.identifier) {
                entry.scriptId = addRes.identifier;
              }
              if (entry.omniScriptId) {
                await entry.session
                  .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId })
                  .catch(() => {});
                entry.omniScriptId = null;
              }
              if (omniSnap && !entry.session.closed) {
                const omniAdd = await entry.session
                  .send('Page.addScriptToEvaluateOnNewDocument', { source: omniSnap })
                  .catch(() => null);
                if (omniAdd && omniAdd.identifier) {
                  entry.omniScriptId = omniAdd.identifier;
                }
              }
            })
          )
        );
      }
    } finally {
      this._broadcastRunning = false;
      const waiters = this._broadcastWaiters.splice(0);
      for (const resolve of waiters) {
        try {
          resolve();
        } catch {}
      }
    }
  }

  _targetKey(target) {
    if (!target || typeof target !== 'object') return '';
    return String(target.id || target.targetId || target.webSocketDebuggerUrl || '').trim();
  }

  _normalizeIgnoreUrl(rawUrl) {
    const s = String(rawUrl || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`;
    } catch {
      return s.split(/[?#]/)[0].toLowerCase();
    }
  }

  _markTargetIgnored(target, urlOverride = '') {
    const key = this._targetKey(target);
    if (!key) return;
    const normUrl = this._normalizeIgnoreUrl(urlOverride || target?.url || '');
    if (this.ignoredTargets.has(key)) {
      this.ignoredTargets.delete(key);
    } else if (this.ignoredTargets.size >= 256) {
      const oldest = this.ignoredTargets.keys().next().value;
      if (oldest !== undefined) this.ignoredTargets.delete(oldest);
    }
    this.ignoredTargets.set(key, normUrl);
  }

  isTargetIgnored(target) {
    const key = this._targetKey(target);
    if (!key || !this.ignoredTargets.has(key)) return false;
    const prevNorm = this.ignoredTargets.get(key);
    const curNorm = this._normalizeIgnoreUrl(target?.url || '');
    if (curNorm && prevNorm && curNorm !== prevNorm) {
      this.ignoredTargets.delete(key);
      return false;
    }
    return true;
  }

  _isEligibleDaemonTarget(target) {
    const checkFn = typeof this.cdp?.isEligibleTarget === 'function' ? this.cdp.isEligibleTarget : isEligibleTarget;
    if (!checkFn(target)) return false;
    return !this.isTargetIgnored(target);
  }

  async applyToEntry(entry) {
    return this._runEntryExclusive(entry, async () => {
      if (!entry || entry.session.closed) return null;
      await this.ensureOmniServer().catch(() => null);
      if (!this.injectExpr) this.rebuildBundle();
      else if (this.omniServer && !this.omniExpr && typeof this.cdp.buildOmniClientExpression === 'function') {
        this.omniExpr = this.cdp.buildOmniClientExpression(this.omniServer.getServerInfo());
      }
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
      const mainRes = await entry.session.evaluate(this.injectExpr);

      if (mainRes && mainRes.status === 'skipped-non-host') {
        if (entry.scriptId) {
          await entry.session
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId })
            .catch(() => {});
          entry.scriptId = null;
        }
        if (entry.omniScriptId) {
          await entry.session
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId })
            .catch(() => {});
          entry.omniScriptId = null;
        }
        return mainRes;
      }

      if (entry.omniScriptId) {
        await entry.session
          .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId })
          .catch(() => {});
        entry.omniScriptId = null;
      }
      if (this.omniExpr) {
        const omniAdd = await entry.session
          .send('Page.addScriptToEvaluateOnNewDocument', { source: this.omniExpr })
          .catch(() => null);
        if (omniAdd && omniAdd.identifier) {
          entry.omniScriptId = omniAdd.identifier;
        }
        await entry.session.evaluate(this.omniExpr).catch(() => null);
      }
      return mainRes;
    });
  }

  async handleBindingCall(entry, { name, payload, executionContextId }) {
    if (!this._isTrustedMainFrameBindingCall(entry, executionContextId)) return;
    if (name === this.cdp.SETTING_BINDING || name === this.cdp.LEGACY_SETTING_BINDING) {
      if (typeof payload !== 'string' || payload.length > 8192) return;
      try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object') return;
        const updated =
          parsed.action === 'patch-batch' && parsed.entries && typeof parsed.entries === 'object'
            ? this.updateConfigBatch(parsed.entries)
            : this.updateConfigSetting(parsed.key, parsed.value);
        if (updated) {
          if (entry && Number.isSafeInteger(parsed.clientEpoch) && parsed.clientEpoch > 0) {
            entry.pendingAckEpoch = parsed.clientEpoch;
          }
          await this.broadcastConfigRefresh();
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
          result = svc.getWarmCacheSnapshot(
            Number(input.limit) > 0 ? Number(input.limit) : 40,
            Number(input.maxChars) > 0 ? Number(input.maxChars) : 80000
          );
        } else if (action === 'cache-stats') {
          result = svc.getCacheStats();
        } else if (action === 'clear-cache') {
          result = svc.clearCache();
        } else if (action === 'cancel-translate') {
          result = svc.cancelPending(
            input.requestId !== undefined || input.key !== undefined
              ? input
              : parsed?.requestId ?? parsed?.key ?? input
          );
        } else if (action === 'fetch-models') {
          result = await svc.fetchModels(input);
        } else if (action === 'test-connection') {
          result = await svc.testConnection(input);
        } else if (action === 'translate-stream') {
          result = await svc.translateThought({
            text: input.text || '',
            mode: input.mode || 'ai',
            priority: Number(input.priority || 0),
            requestId: input.requestId ? String(input.requestId) : '',
            force: Boolean(input.force),
            bypassCache: Boolean(input.bypassCache),
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
        const rawJson = JSON.stringify(result);
        const payloadExpr = rawJson && rawJson.length > 4096 ? `JSON.parse(${JSON.stringify(rawJson)})` : rawJson;
        const resolveExpr = `window.__agPrismThoughtResolve && window.__agPrismThoughtResolve(${reqId}, ${payloadExpr})`;
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
        result = await this.fetchUsageRollupBatch(parsed.items, {
          action: parsed.action || 'fetch-batch',
          includeSummaries: Boolean(parsed.includeSummaries),
        });
      } catch (err) {
        result = { ok: false, error: sanitizeSecretText(err?.message || err), records: [] };
      }
      if (!entry.session.closed) {
        const resolveExpr = `window.__agPrismUsageResolve && window.__agPrismUsageResolve(${reqId}, ${JSON.stringify(result)})`;
        const evalParams = { expression: resolveExpr, returnByValue: true };
        if (executionContextId) evalParams.contextId = executionContextId;
        await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      }
      return;
    }

    if (name === OMNI_BINDING) {
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
        const srv = await this.ensureOmniServer();
        result = await srv.handleRpcAction(action, mergedParams);
      } catch (err) {
        result = { ok: false, error: sanitizeSecretText(err?.message || err) };
      }
      if (!entry.session.closed) {
        const jsonRes = JSON.stringify(result);
        const resolveExpr = `(() => { const r = ${jsonRes}; const b = window.__agPrismOmniBridge; if (b && typeof b.resolve === 'function') b.resolve(${reqId}, r); if (typeof window.__agPrismOmniResolve === 'function' && (!b || window.__agPrismOmniResolve !== b.resolve)) window.__agPrismOmniResolve(${reqId}, r); })()`;
        const evalParams = { expression: resolveExpr, returnByValue: true };
        if (executionContextId) evalParams.contextId = executionContextId;
        await entry.session.send('Runtime.evaluate', evalParams).catch(() => {});
      }
    }
  }

  async attachTarget(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (this.isTargetIgnored(target)) return null;
    if (this.sessions.has(wsUrl)) return this.sessions.get(wsUrl);

    const session = await this.cdp.CdpSession.connect(wsUrl, 3500);
    const entry = {
      wsUrl,
      pageId: target.id,
      url: String(target.url || ''),
      title: target.title || target.url || 'Antigravity',
      session,
      scriptId: null,
      omniScriptId: null,
      mainFrameId: null,
      hasFrameTree: false,
      contextFrames: new Map(),
      pendingAckEpoch: 0,
      _opChain: Promise.resolve(),
    };
    this.sessions.set(wsUrl, entry);

    session.onClose = () => {
      if (this.sessions.get(wsUrl) === entry) {
        this.sessions.delete(wsUrl);
      }
    };

    try {
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
        if (typeof params?.executionContextId === 'number') {
          entry.contextFrames.delete(params.executionContextId);
        }
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
          if (typeof frame.url === 'string' && frame.url) {
            entry.url = frame.url;
          }
        }
      });
      await session.send('Page.enable');
      const ft = await session.send('Page.getFrameTree', {}, 2000).catch(() => null);
      const topFrameId = ft?.frameTree?.frame?.id;
      if (typeof topFrameId === 'string' && topFrameId) {
        entry.mainFrameId = topFrameId;
        entry.hasFrameTree = true;
      }
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
      await session.send('Runtime.addBinding', { name: OMNI_BINDING });

      const healOnNav = () => {
        setTimeout(() => {
          void this.verifyAndHealEntry(entry);
        }, 50);
      };
      session.on('Page.domContentLoadedEventFired', healOnNav);
      session.on('Page.loadEventFired', healOnNav);

      const res = await this.applyToEntry(entry);
      if (res && res.status === 'skipped-non-host') {
        this._markTargetIgnored(target, entry.url || target.url);
        session.close();
        this.sessions.delete(wsUrl);
        this.log(`[↷] Ignored non-host target: ${entry.title}`);
        return null;
      }
      this.log(`[✓] Attached & injected Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${entry.title} (${res?.status || 'ok'})`);
      return entry;
    } catch (err) {
      try {
        if (entry.scriptId) {
          await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId });
        }
        if (entry.omniScriptId) {
          await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId });
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
        const omniMode = st?.cfg?.omniModule || 'on';
        const hasModelBtn = Boolean(document.querySelector('[data-testid="model-selector-trigger"]'));
        const hasPulseBar = Boolean(
          document.querySelector(
            '[data-ag-prism-pulse-bar="true"], #ag-prism-pulse-bar, [data-ag-pulse-bar="true"], #ag-pulse-status-bar'
          )
        );
        return {
          ready: true,
          href: (typeof location !== 'undefined' && location && typeof location.href === 'string') ? location.href : '',
          prismAttr: root.getAttribute('data-ag-prism') || '',
          hasPrism: Boolean(api),
          hasRepoBridge: Boolean(window.__agPrismRepoBridge),
          hasThoughtBridge: Boolean(window.__agPrismThoughtBridge && typeof window.__agPrismThoughtBridge.cacheStats === 'function'),
          hasUsageBridge: Boolean(window.__agPrismUsageBridge && typeof window.__agPrismUsageBridge.listSummaries === 'function'),
          hasOmniBridge: Boolean(window.__agPrismOmniBridge && typeof window.__agPrismOmniBridge.call === 'function'),
          hasOmniServerMeta: Boolean(window.__agPrismOmniServerMeta && window.__agPrismOmniServerMeta.baseUrl && window.__agPrismOmniServerMeta.token),
          hasOmni: Boolean(window.__agPrismOmni),
          omniMode,
          codeHash: (api && api.codeHash) || '',
          hasLegacyCss: Boolean(document.getElementById('ag-claude-style-css')),
          needsDashboardSync: Boolean(api && telMode !== 'off' && hasModelBtn && !hasPulseBar),
        };
      })()`,
        false,
        2600
      );
      if (!probe || !probe.ready) return;
      if (probe.href) entry.url = probe.href;
      const hasClientOnDisk = this._hasOmniClientFile();
      const needsOmniHeal =
        !probe.hasOmniBridge ||
        !probe.hasOmniServerMeta ||
        (hasClientOnDisk && probe.omniMode !== 'off' && !probe.hasOmni);
      if (
        !probe.hasPrism ||
        !probe.hasRepoBridge ||
        !probe.hasThoughtBridge ||
        !probe.hasUsageBridge ||
        probe.prismAttr !== this.cdp.PLUGIN_VERSION ||
        probe.hasLegacyCss ||
        (this.codeHash && probe.codeHash && probe.codeHash !== this.codeHash)
      ) {
        await this.ensureOmniServer().catch(() => null);
        await entry.session.send('Runtime.addBinding', { name: this.cdp.SETTING_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: METRICS_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: REPO_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: USAGE_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }, 2600).catch(() => {});
        const healRes = await entry.session.evaluate(this.injectExpr, false, 4500);
        if (healRes && healRes.status === 'skipped-non-host') {
          if (entry.scriptId) {
            await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
            entry.scriptId = null;
          }
          if (entry.omniScriptId) {
            await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId }).catch(() => {});
            entry.omniScriptId = null;
          }
          this._markTargetIgnored({ id: entry.pageId, webSocketDebuggerUrl: entry.wsUrl }, probe.href || entry.url);
          entry.session.close();
          this.sessions.delete(entry.wsUrl);
          this.log(`[↷] Detached & ignored deferred non-host target: ${entry.title}`);
          return;
        }
        if (this.omniExpr) {
          await entry.session.evaluate(this.omniExpr, false, 3500).catch(() => {});
        }
        this.log(`[↻] Hot-healed window to Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${entry.title}`);
      } else {
        if (needsOmniHeal) {
          await this.ensureOmniServer().catch(() => null);
          await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }, 2600).catch(() => {});
          if (this.omniExpr) {
            await entry.session.evaluate(this.omniExpr, false, 3500).catch(() => {});
          }
        }
        if (probe.needsDashboardSync) {
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
      }
    } catch {
      entry.session.close();
      this.sessions.delete(entry.wsUrl);
    }
  }

  closeBrowserDiscovery() {
    if (this._discoverTimer) {
      clearTimeout(this._discoverTimer);
      this._discoverTimer = null;
    }
    if (this.browserSession) {
      const bs = this.browserSession;
      this.browserSession = null;
      this.browserPort = null;
      try {
        bs.close();
      } catch {}
    }
  }

  scheduleImmediateTick(delayMs = 45) {
    if (!this.running) return;
    if (this.busy) {
      this._pendingTick = true;
      return;
    }
    if (this._discoverTimer) clearTimeout(this._discoverTimer);
    this._discoverTimer = setTimeout(() => {
      this._discoverTimer = null;
      if (this.running) void this.tick();
    }, delayMs);
    if (this._discoverTimer && typeof this._discoverTimer.unref === 'function') {
      this._discoverTimer.unref();
    }
  }

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
      bSession.onClose = () => {
        if (this.browserSession === bSession) {
          this.browserSession = null;
          this.browserPort = null;
        }
      };
      const onTargetEvent = (params) => {
        const info = params?.targetInfo;
        if (!info || info.type !== 'page') return;
        if (!this._isEligibleDaemonTarget({ ...info, id: info.targetId || info.id, webSocketDebuggerUrl: 'ws://check' })) return;
        this.scheduleImmediateTick(45);
      };
      bSession.on('Target.targetCreated', onTargetEvent);
      bSession.on('Target.targetInfoChanged', onTargetEvent);
      await bSession.send('Target.setDiscoverTargets', { discover: true }, 1500).catch(() => {});
    } catch {}
  }

  async detachAll(cleanPageDom = false) {
    this.closeBrowserDiscovery();
    const entries = [...this.sessions.values()];
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          if (entry.scriptId && !entry.session.closed) {
            await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
          }
          if (entry.omniScriptId && !entry.session.closed) {
            await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId }).catch(() => {});
          }
          if (cleanPageDom && !entry.session.closed) {
            await entry.session.evaluate(this.cdp.REMOVE_EXPRESSION).catch(() => {});
          }
        } catch {}
        entry.session.close();
      })
    );
    this.sessions.clear();
  }

  async tick() {
    if (!this.running) return { attached: this.sessions.size };
    if (this.busy) {
      this._pendingTick = true;
      return { attached: this.sessions.size };
    }
    this.busy = true;
    this._pendingTick = false;
    try {
      if (!this.isCurrentOwner()) {
        await this.stop(false);
        return { attached: 0, superseded: true };
      }

      if (!this.enabledCheck()) {
        if (this.sessions.size > 0 || this.browserSession) {
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
        this.closeBrowserDiscovery();
        return { attached: this.sessions.size, port, unreachable: true };
      }

      // Subscribe to Browser-level Target.setDiscoverTargets when persistent daemon is running
      if (this.timer) {
        void this.ensureBrowserDiscovery(port);
      }

      const eligible = rawPages.filter((t) => this._isEligibleDaemonTarget(t));
      const activeUrls = new Set(eligible.map((t) => t.webSocketDebuggerUrl));

      for (const [wsUrl, entry] of this.sessions.entries()) {
        if (!activeUrls.has(wsUrl) || entry.session.closed) {
          if (!entry.session.closed) {
            if (entry.scriptId) {
              await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
            }
            if (entry.omniScriptId) {
              await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.omniScriptId }).catch(() => {});
            }
            await entry.session.evaluate(this.cdp.REMOVE_EXPRESSION).catch(() => {});
          }
          entry.session.close();
          this.sessions.delete(wsUrl);
        }
      }

      if (!this.injectExpr) this.rebuildBundle();

      await Promise.allSettled(
        eligible.map((target) => {
          if (!this.sessions.has(target.webSocketDebuggerUrl)) {
            return this.attachTarget(target);
          }
          return this.verifyAndHealEntry(this.sessions.get(target.webSocketDebuggerUrl));
        })
      );

      return { attached: this.sessions.size, port, pages: eligible.map((p) => p.title || p.url) };
    } finally {
      this.busy = false;
      if (this._pendingTick && this.running) {
        this._pendingTick = false;
        this.scheduleImmediateTick(40);
      }
    }
  }

  claimOwnership() {
    try {
      if (fs.existsSync(this.pidFile)) {
        const prevPid =
          typeof this.cdp.readPidFromLockFile === 'function'
            ? this.cdp.readPidFromLockFile(this.pidFile)
            : JSON.parse(fs.readFileSync(this.pidFile, 'utf8'))?.pid;
        if (prevPid && prevPid !== process.pid && isPidAlive(prevPid)) {
          const safeToKill =
            typeof this.cdp.isExpectedDaemonProcess === 'function' ? this.cdp.isExpectedDaemonProcess(prevPid) : true;
          if (safeToKill) {
            try { process.kill(prevPid); } catch {}
          }
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
      let pendingCodeChange = false;
      try {
        this.fsw = fs.watch(this.rootDir, { recursive: true }, (_, filename) => {
          const base = filename ? path.basename(filename) : '';
          if (!base || base.startsWith('.') || !/\.(css|c?js|mjs|json)$/i.test(base)) return;
          if (base === 'daemon.log' || base === 'watch.log' || base === 'repo-meta.json') return;
          if (base === 'config.json') {
            // Suppress duplicate rebuild right after SETTING_BINDING already broadcasted config refresh!
            if (Date.now() < this._selfConfigWriteUntil) return;
          } else {
            pendingCodeChange = true;
          }
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(async () => {
            const isCodeChange = pendingCodeChange;
            pendingCodeChange = false;
            try {
              if (!isCodeChange) {
                await this.broadcastConfigRefresh();
                return;
              }
              this.rebuildBundle();
              const activeItems = [...this.sessions.values()].filter((e) => e && !e.session.closed);
              await Promise.allSettled(activeItems.map((entry) => this.applyToEntry(entry)));
            } catch {}
          }, pendingCodeChange ? 180 : 120);
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
    for (const svc of [this._lazyUsage, this._lazyStore, this._lazyThoughtService]) {
      if (!svc) continue;
      try {
        if (typeof svc.dispose === 'function') await svc.dispose();
        else if (typeof svc.close === 'function') await svc.close();
        else if (typeof svc.stop === 'function') await svc.stop();
      } catch {}
    }
    this._lazyUsage = null;
    this._lazyStore = null;
    this._lazyThoughtService = null;
    if (this.omniServer) {
      const srv = this.omniServer;
      this.omniServer = null;
      this._omniServerPromise = null;
      await srv.stop().catch(() => {});
    }
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
        if (daemon.omniServer) await daemon.omniServer.stop().catch(() => {});
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
