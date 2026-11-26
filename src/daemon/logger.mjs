// Obsidian Prism 守护进程日志子组件（0o600 权限与路径/凭据脱敏，Tier 0，无原型 Mixin）
import fs from 'node:fs';
import { sanitizeSecretText, sanitizeLogLine } from '../../sidecars/daemon/redact.mjs';

export const DAEMON_LOG_MAX_BYTES = 512 * 1024;

export class DaemonLogger {
  constructor({ logFile = '', silent = false, getCdp = () => null } = {}) {
    this.logFile = logFile;
    this.silent = Boolean(silent);
    this._getCdp = getCdp;
    this._logBytes = -1;
  }

  log(msg) {
    if (!this.silent) {
      try {
        if (this._logBytes < 0) {
          try {
            this._logBytes = fs.statSync(this.logFile).size;
          } catch {
            this._logBytes = 0;
          }
        }
        if (this._logBytes > DAEMON_LOG_MAX_BYTES) {
          fs.writeFileSync(this.logFile, '', { encoding: 'utf8', mode: 0o600 });
          this._logBytes = 0;
        }
        const line = `[${new Date().toISOString()}] ${sanitizeLogLine(msg)}\n`;
        fs.appendFileSync(this.logFile, line, { encoding: 'utf8', mode: 0o600 });
        this._logBytes += Buffer.byteLength(line, 'utf8');
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
