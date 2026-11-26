// Obsidian Prism 守护进程日志子组件（0o600 权限、双文件安全滚动轮转与路径/凭据脱敏，Tier 0，无原型 Mixin）
import fs from 'node:fs';
import { sanitizeSecretText, sanitizeLogLine } from '../../sidecars/daemon/redact.mjs';

export const DAEMON_LOG_MAX_BYTES = 512 * 1024;

export class DaemonLogger {
  constructor({ logFile = '', silent = false, getCdp = () => null, maxBytes = DAEMON_LOG_MAX_BYTES } = {}) {
    this.logFile = logFile;
    this.silent = Boolean(silent);
    this._getCdp = getCdp;
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : DAEMON_LOG_MAX_BYTES;
    this._logBytes = -1;
  }

  _rotateLogFile() {
    if (!this.logFile) return;
    const backupFile = `${this.logFile}.1`;
    try {
      const st = fs.lstatSync(this.logFile);
      if (st.isSymbolicLink()) return;
    } catch {
      this._logBytes = 0;
      return;
    }
    try {
      const bst = fs.lstatSync(backupFile);
      if (bst.isSymbolicLink()) return;
    } catch {}
    let rotated = false;
    try {
      fs.renameSync(this.logFile, backupFile);
      rotated = true;
    } catch {
      try {
        try { fs.unlinkSync(backupFile); } catch {}
        fs.renameSync(this.logFile, backupFile);
        rotated = true;
      } catch {
        try {
          fs.copyFileSync(this.logFile, backupFile);
          rotated = true;
        } catch {}
      }
    }
    if (rotated) {
      try { fs.chmodSync(backupFile, 0o600); } catch {}
    }
    fs.writeFileSync(this.logFile, '', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(this.logFile, 0o600); } catch {}
    this._logBytes = 0;
  }

  log(msg) {
    if (!this.silent && this.logFile) {
      try {
        if (this._logBytes < 0) {
          try {
            this._logBytes = fs.statSync(this.logFile).size;
          } catch {
            this._logBytes = 0;
          }
        }
        const line = `[${new Date().toISOString()}] ${sanitizeLogLine(msg)}\n`;
        const lineBytes = Buffer.byteLength(line, 'utf8');
        if (this._logBytes > 0 && (this._logBytes >= this.maxBytes || this._logBytes + lineBytes > this.maxBytes)) {
          this._rotateLogFile();
        }
        fs.appendFileSync(this.logFile, line, { encoding: 'utf8', mode: 0o600 });
        this._logBytes += lineBytes;
      } catch {}
    }
  }

  redactSensitiveText(text) {
    const cdp = this._getCdp?.();
    const base =
      typeof cdp?.redactSensitiveUrl === 'function'
        ? cdp.redactSensitiveUrl(text)
        : String(text || '');
    return sanitizeSecretText(base);
  }
}

export { sanitizeSecretText, sanitizeLogLine };
