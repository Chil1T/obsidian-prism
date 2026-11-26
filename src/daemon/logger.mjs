// Obsidian Prism 守护进程日志落盘、0o600 权限与路径/凭据脱敏（Tier 0）
import fs from 'node:fs';
import { sanitizeSecretText, sanitizeLogLine } from '../../sidecars/daemon/redact.mjs';

export const DAEMON_LOG_MAX_BYTES = 512 * 1024;

export const loggerMethods = {
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
  },

  _redactSensitiveText(text) {
    const base =
      typeof this.cdp?.redactSensitiveUrl === 'function'
        ? this.cdp.redactSensitiveUrl(text)
        : String(text || '');
    return sanitizeSecretText(base);
  },
};

export { sanitizeSecretText, sanitizeLogLine };
