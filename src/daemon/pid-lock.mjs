// Obsidian Prism .daemon.pid 锁抢占、存活检测、释放与优雅关闭既有 daemon（Tier 0）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT_DIR, defaultCdp } from './constants.mjs';
import { writeFileAtomicSync, canonicalRealpathSync } from './fs-atomic.mjs';

export const WINDOWS_DAEMON_IMAGE_RE =
  /^(?:node|nodejs|obsidian-prism(?:-watcher)?|watcher|agy-claude-style|antigravity|electron|agy)(?:\.exe)?$/i;

export const DAEMON_SHUTDOWN_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']);

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export function isAutomatedTestRuntime() {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.NODE_TEST_CONTEXT) return true;
  return Array.isArray(process.execArgv) && process.execArgv.some((a) => a === '--test' || a.startsWith('--test-'));
}

/**
 * 解析 Windows `tasklist /FO CSV /NH` 输出中的目标 PID 映像名。
 */
export function parseTasklistCsvImageName(csvOutput, expectedPid) {
  const targetPid = Number(expectedPid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) return '';
  const lines = String(csvOutput || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('"')) continue;
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    if (fields.length >= 2 && Number(fields[1].trim()) === targetPid) {
      return String(fields[0] || '').trim();
    }
  }
  return '';
}

/**
 * 通过原生 `tasklist /FO CSV /NH` 查询指定 Windows PID 的进程映像名。
 */
export function queryWindowsProcessImageNameSync(pid, execFn = execFileSync) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return '';
  try {
    const out = execFn('tasklist', ['/FI', `PID eq ${n}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseTasklistCsvImageName(out, n);
  } catch {
    return '';
  }
}

/**
 * 校验 .daemon.pid 锁文件中的 PID 与 ownerToken 是否有效且指向旧守护实例。
 */
export function verifyDaemonPidLockToken(pidFile, expectedPid, currentOwnerToken = '') {
  const targetPid = Number(expectedPid);
  if (!pidFile || !Number.isInteger(targetPid) || targetPid <= 0) return false;
  try {
    const st = fs.lstatSync(pidFile);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    if (!raw || !raw.startsWith('{')) return false;
    const parsed = JSON.parse(raw);
    if (Number(parsed?.pid) !== targetPid) return false;
    const token = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
    if (!token) return false;
    if (currentOwnerToken && token === currentOwnerToken) return false;
    return true;
  } catch {
    return false;
  }
}

export function queryProcessCommandLineSync(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    if (process.platform === 'linux') {
      const raw = fs.readFileSync(`/proc/${n}/cmdline`);
      if (!raw || raw.length === 0) return '';
      return raw.toString('utf8').replace(/\0+/g, ' ').trim();
    }
    if (process.platform === 'win32') {
      return null;
    }
    const out = execFileSync('ps', ['-p', String(n), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').trim();
  } catch {
    return null;
  }
}

export function isObsidianPrismDaemonCommandLine(commandLine) {
  const cmd = String(commandLine || '').replace(/\\/g, '/').trim().toLowerCase();
  if (!cmd) return false;
  if (/--type=/.test(cmd)) return false;
  const hasPrismBrand = /(?:obsidian-prism|antigravity-prism|agy-claude-style)/.test(cmd);
  const hasDaemonScript = /(?:sidecars\/daemon\/main\.mjs|\/daemon\/main\.mjs|\/watch\.js)\b/.test(cmd);
  if (hasPrismBrand && hasDaemonScript) return true;
  // 宿主以 sidecars/daemon 为工作目录拉起时，命令行为 node main.mjs 或 Antigravity --import=.../sidecar_sdk/register_loader.js main.mjs
  const hasRelativeMain = /(?:^|[\s"'=])main\.mjs(?:$|[\s"'])/.test(cmd);
  if (
    hasRelativeMain &&
    /(?:^|\s|\/)(?:node|nodejs)(?:\.exe)?(?:\s|"|'|$)|sidecar_sdk\/register_loader\.js\b/.test(cmd)
  ) {
    return true;
  }
  return false;
}

export function parseArgs(argv) {
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

/**
 * 判断当前模块是否作为 CLI 主入口启动。
 * 复用 canonicalRealpathSync() 解析符号链接与 Windows Junction（例如 ~/.gemini 迁至其他盘符），
 * 并在 Win32 下统一规范化盘符大小写与长路径前缀。
 */
export function isMainEntry(argv1, moduleFilename) {
  if (!argv1 || !moduleFilename) return false;
  let selfPath = String(moduleFilename);
  if (selfPath.startsWith('file://')) {
    try {
      selfPath = fileURLToPath(selfPath);
    } catch {
      return false;
    }
  }
  let resolvedArgv;
  let resolvedSelf;
  try {
    resolvedArgv = canonicalRealpathSync(argv1);
  } catch {
    resolvedArgv = path.resolve(argv1);
  }
  try {
    resolvedSelf = canonicalRealpathSync(selfPath);
  } catch {
    resolvedSelf = path.resolve(selfPath);
  }
  if (process.platform === 'win32') {
    return (
      resolvedArgv.replace(/^\\\\\?\\/, '').toLowerCase() ===
      resolvedSelf.replace(/^\\\\\?\\/, '').toLowerCase()
    );
  }
  return resolvedArgv === resolvedSelf;
}

export function registerDaemonShutdownSignals(daemon, opts = {}) {
  const proc = opts.proc || process;
  const exitFn = typeof opts.exit === 'function' ? opts.exit : (code) => proc.exit(code);
  let shuttingDown = false;
  let shutdownPromise = null;
  const shutdown = () => {
    if (shuttingDown) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = Promise.resolve()
      .then(() => daemon.stop(false))
      .catch(() => {})
      .finally(() => {
        exitFn(0);
      });
    return shutdownPromise;
  };
  const listeners = [];
  for (const sig of DAEMON_SHUTDOWN_SIGNALS) {
    const handler = () => {
      void shutdown();
    };
    proc.on(sig, handler);
    listeners.push({ sig, handler });
  }
  return {
    shutdown,
    dispose() {
      if (typeof proc.off === 'function') {
        for (const { sig, handler } of listeners) {
          proc.off(sig, handler);
        }
      }
    },
  };
}

export const pidLockMethods = {
  stopExistingDaemon({
    verifyPid = null,
    inspectCommandLine = null,
    inspectProcess = null,
    queryTasklist = null,
    killProcess = null,
  } = {}) {
    try {
      if (!this.pidFile) return false;
      let pidStat;
      try {
        pidStat = fs.lstatSync(this.pidFile);
      } catch {
        return false;
      }
      if (pidStat.isSymbolicLink() || !pidStat.isFile()) return false;

      const prevPid =
        typeof this.cdp?.readPidFromLockFile === 'function'
          ? this.cdp.readPidFromLockFile(this.pidFile)
          : (() => {
              const raw = fs.readFileSync(this.pidFile, 'utf8').trim();
              if (/^\d+$/.test(raw)) return parseInt(raw, 10);
              return Number(JSON.parse(raw)?.pid);
            })();
      if (!Number.isInteger(prevPid) || prevPid <= 0 || prevPid === process.pid || !isPidAlive(prevPid)) {
        return false;
      }

      const customVerifier =
        typeof verifyPid === 'function'
          ? verifyPid
          : typeof this._daemonPidVerifier === 'function'
          ? this._daemonPidVerifier
          : null;

      let safeToKill = false;
      if (customVerifier) {
        safeToKill = Boolean(customVerifier(prevPid, this.pidFile));
      } else if (typeof this.cdp?.isExpectedDaemonProcess === 'function') {
        const isDefaultVerifier =
          this.cdp.isExpectedDaemonProcess === this._loadedCdpVerifier ||
          this.cdp.isExpectedDaemonProcess === defaultCdp.isExpectedDaemonProcess;
        if (!isDefaultVerifier) {
          // 兼容单测显式覆写 this.cdp.isExpectedDaemonProcess 注入校验钩子
          safeToKill = Boolean(this.cdp.isExpectedDaemonProcess(prevPid, this.pidFile));
        } else {
          // P2-5: 复用 cdp.js 单次进程探针，避免 Windows 启动抢锁重复拉起外部进程探针
          const hasUnifiedProbe =
            typeof inspectProcess === 'function' || typeof this.cdp.inspectProcessSync === 'function';
          const procInfo =
            typeof inspectProcess === 'function'
              ? inspectProcess(prevPid)
              : typeof this.cdp.inspectProcessSync === 'function'
              ? this.cdp.inspectProcessSync(prevPid)
              : null;
          const cdpVerified = hasUnifiedProbe
            ? Boolean(this.cdp.isExpectedDaemonProcess(prevPid, { procInfo, lockFile: this.pidFile }))
            : Boolean(this.cdp.isExpectedDaemonProcess(prevPid, this.pidFile));
          if (!cdpVerified) {
            safeToKill = false;
          } else if (typeof inspectCommandLine === 'function') {
            safeToKill = isObsidianPrismDaemonCommandLine(inspectCommandLine(prevPid));
          } else if (hasUnifiedProbe && typeof procInfo?.commandLine === 'string' && procInfo.commandLine.trim()) {
            // 存在命令行信息时执行命令行身份复核，防误杀无关 node 进程
            safeToKill = isObsidianPrismDaemonCommandLine(procInfo.commandLine);
          } else if (process.platform === 'win32') {
            // Windows 无命令行探针时使用原生 tasklist /FO CSV /NH 映像名 + .daemon.pid 锁文件 token 双重校验
            const imgName =
              (procInfo && typeof procInfo.imageName === 'string' && procInfo.imageName.trim()) ||
              (typeof queryTasklist === 'function'
                ? queryTasklist(prevPid)
                : queryWindowsProcessImageNameSync(prevPid));
            safeToKill =
              Boolean(imgName) &&
              WINDOWS_DAEMON_IMAGE_RE.test(imgName.trim()) &&
              verifyDaemonPidLockToken(this.pidFile, prevPid, this.ownerToken);
          } else {
            const cmd = hasUnifiedProbe ? procInfo?.commandLine || '' : queryProcessCommandLineSync(prevPid);
            safeToKill = isObsidianPrismDaemonCommandLine(cmd);
          }
        }
      } else {
        // 无有效身份校验钩子时严格 fail-closed，绝不盲杀无关 PID
        safeToKill = false;
      }

      if (!safeToKill) return false;
      const killer = typeof killProcess === 'function' ? killProcess : (pid) => process.kill(pid);
      try {
        killer(prevPid);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  },

  claimOwnership() {
    this.stopExistingDaemon();
    this._ownerFileCache = null;
    try {
      try {
        const st = fs.lstatSync(this.pidFile);
        if (st.isSymbolicLink()) return;
      } catch (err) {
        if (err && err.code !== 'ENOENT') return;
      }
      writeFileAtomicSync(
        this.pidFile,
        JSON.stringify({ pid: process.pid, token: this.ownerToken, startedAt: Date.now() }),
        { mode: 0o600 }
      );
      this._ownerFileCache = null;
    } catch {}
  },

  isCurrentOwner() {
    try {
      let st;
      try {
        st = fs.statSync(this.pidFile);
      } catch {
        this._ownerFileCache = null;
        return true;
      }
      if (!st.isFile()) {
        this._ownerFileCache = null;
        return true;
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      if (this._ownerFileCache && this._ownerFileCache.path === this.pidFile && this._ownerFileCache.sig === sig) {
        return this._ownerFileCache.owned;
      }
      const cur = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
      const owned = !cur || !cur.token || cur.token === this.ownerToken;
      this._ownerFileCache = { path: this.pidFile, sig, owned };
      return owned;
    } catch {
      this._ownerFileCache = null;
      return true;
    }
  },

  releaseOwnership() {
    this._ownerFileCache = null;
    try {
      let st;
      try {
        st = fs.lstatSync(this.pidFile);
      } catch {
        return;
      }
      if (st.isSymbolicLink() || !st.isFile()) return;
      const cur = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
      if (cur && cur.token === this.ownerToken) {
        fs.unlinkSync(this.pidFile);
      }
    } catch {}
  },
};
