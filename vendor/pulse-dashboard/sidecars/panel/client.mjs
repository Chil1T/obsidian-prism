// Upstream: ATtacK030130/antigrative-dashboard v0.9.1 (MIT License — Copyright (c) 2026 AG Pulse contributors)
// Integrated & adapted for Obsidian Prism under GPL-3.0-only compatibility terms.
// Enhanced with cdpPort multi-instance lineage resolution and backward-compatible _fetchMetadataOnly().
import { readFile, stat } from 'node:fs/promises';
import { request, Agent as HttpAgent } from 'node:http';
import { setImmediate as yieldStream } from 'node:timers/promises';
import { platformPaths } from '../../compat/platform.mjs';
import { discoverProcesses, httpLogPorts, extractHubPort } from './discovery.mjs';
import { TrajectoryJson } from './trajectory-json.mjs';
import { TrajectoryReader } from './trajectory-reader.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';

export function serverFromPorts(logPorts, processes) {
  const list = Array.isArray(processes) ? processes : [processes];
  const rows = list.filter(p => p && (/--standalone\b/.test(p.CommandLine || '') || p.HubPort || /--subclient_type(?:=|\s+)["']?ide["']?/i.test(p.CommandLine || '')));
  if (!rows.length) throw new Error('未找到 Antigravity 桌面后台');

  // 1) Explicit --hub-port match (IDE 2.6+ agy --hub)
  for (const row of rows) {
    const hubPort = row.HubPort || extractHubPort(row.CommandLine);
    const ports = new Set([row.Ports].flat().map(Number));
    if (hubPort && ports.has(hubPort)) {
      const csrf = String(row.CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
      if (csrf) return { port: hubPort, csrf, pid: row.ProcessId };
    }
  }

  // 2) Single standalone instance fast path
  if (rows.length === 1) {
    const ports = new Set([rows[0].Ports].flat().map(Number));
    const port = logPorts.find(p => ports.has(p));
    if (!port) throw new Error('等待 Antigravity 本地接口启动');
    const csrf = String(rows[0].CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
    if (!csrf) throw new Error('当前版本未提供可用的本地检测凭据');
    return { port, csrf, pid: rows[0].ProcessId };
  }

  // 3) Multi-instance fallback: match the process that actively owns the most recent HTTP log port
  for (const candidatePort of logPorts) {
    const matching = rows.filter(r => new Set([r.Ports].flat().map(Number)).has(candidatePort));
    if (matching.length === 1) {
      const csrf = String(matching[0].CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
      if (csrf) return { port: candidatePort, csrf, pid: matching[0].ProcessId };
    }
  }

  throw new Error('检测到多个 Antigravity 实例，等待窗口归属解析');
}

export function serverFromDiscovery(log, processes) {
  return serverFromPorts(httpLogPorts(log), processes);
}

export class AntigravityClient {
  constructor({ paths = platformPaths, readLog = readFile, logStat = stat, processes = discoverProcesses, now = Date.now, onRpc = null, cdpPort = null, debugPort = null } = {}) {
    this.paths = paths;
    this.readLog = readLog;
    this.logStat = logStat;
    this.processes = processes;
    this.now = now;
    this.onRpc = onRpc;
    this.cdpPort = cdpPort ?? debugPort ?? null;
    this.agent = new HttpAgent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 2, maxFreeSockets: 2, timeout: 25000 });
    this.reader = new TrajectoryReader(this);
  }
  server = null;
  discoveredAt = 0;
  discovering = null;
  lastScanAt = -Infinity;
  retryAt = 0;
  discoveryFailures = 0;
  discoveryError = null;

  setCdpPort(port) {
    const next = typeof port === 'function' ? port : (Number.isInteger(Number(port)) && Number(port) > 0 ? Number(port) : null);
    if (next !== this.cdpPort) {
      this.cdpPort = next;
    }
  }

  _resolveCdpPort() {
    const raw = typeof this.cdpPort === 'function' ? this.cdpPort() : this.cdpPort;
    const p = Number(raw);
    return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null;
  }

  async discover(force = false) {
    if (!force && this.server && this.now() - this.discoveredAt < 15000) return this.server;
    if (this.discovering) return this.discovering;
    if (!force && this.discoveryError && this.now() < this.retryAt) throw this.discoveryError;
    this.lastScanAt = this.now();
    this.discovering = this.discoverNow()
      .then(server => {
        this.discoveredAt = this.now();
        this.discoveryFailures = 0;
        this.discoveryError = null;
        this.retryAt = 0;
        return server;
      })
      .catch(error => {
        this.discoveryError = error;
        this.discoveryFailures++;
        this.retryAt = this.now() + Math.min(30000, 3000 * 2 ** Math.min(4, this.discoveryFailures - 1));
        throw error;
      })
      .finally(() => {
        this.discovering = null;
      });
    return this.discovering;
  }

  async discoverNow() {
    this.server = null;
    const paths = this.paths(), logs = [], files = [...new Set(paths.logCandidates || [paths.log])];
    for (const file of files) {
      try {
        let modifiedAt = null;
        if (files.length > 1) {
          try {
            const info = await this.logStat(file);
            if (Number.isFinite(info?.mtimeMs)) modifiedAt = info.mtimeMs;
          } catch {}
        }
        logs.push({ ports: httpLogPorts(await this.readLog(file, 'utf8')), modifiedAt });
      } catch (error) {
        logs.push({ error });
      }
    }
    if (logs.every(entry => entry.error || Number.isFinite(entry.modifiedAt))) {
      logs.sort((a, b) => {
        const first = a.modifiedAt ?? -Infinity, second = b.modifiedAt ?? -Infinity;
        return first === second ? 0 : second - first;
      });
    }
    const expectedPorts = [...new Set(logs.flatMap(log => log.ports || []))];
    const cdpPort = this._resolveCdpPort();
    const parsed = await this.processes({ expectedPorts, ...(cdpPort ? { cdpPort } : {}) });
    if (!parsed || (Array.isArray(parsed) && !parsed.length)) throw new Error('请先打开 Antigravity');

    // Allow hub-port resolution even if log files are absent
    if (Array.isArray(parsed) && parsed.some(r => r?.HubPort)) {
      try {
        this.server = serverFromPorts(expectedPorts, parsed);
        this.discoveredAt = this.now();
        return this.server;
      } catch {}
    }

    let foundLog = false, lastError = null;
    for (const entry of logs) {
      try {
        if (entry.error) throw entry.error;
        foundLog = true;
        this.server = serverFromPorts(entry.ports, parsed);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') lastError = error;
      }
    }
    if (!this.server) throw lastError || new Error(foundLog ? '等待 Antigravity 本地接口启动' : '未找到 Antigravity 语言服务日志，请检查日志路径');
    this.discoveredAt = this.now();
    return this.server;
  }

  async call(method, body = {}, retry = true) {
    const server = await this.discover();
    try {
      return await new Promise((resolve, reject) => {
        const reqBody =
          method === 'GetCascadeTrajectoryGeneratorMetadata' && body && typeof body === 'object' && body.includeMessages === undefined
            ? { ...body, includeMessages: false }
            : body;
        const data = JSON.stringify(reqBody);
        const projection = ['GetCascadeTrajectory', 'GetCascadeTrajectorySteps', 'GetCascadeTrajectoryGeneratorMetadata', 'GetAllCascadeTrajectories'].includes(method);
        const started = this.now();
        const req = request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            method: 'POST',
            path: SERVICE + method,
            agent: this.agent,
            headers: {
              'Content-Type': 'application/json',
              'Connect-Protocol-Version': '1',
              'x-codeium-csrf-token': server.csrf,
              'Content-Length': Buffer.byteLength(data),
            },
          },
          res => {
            const projected = projection ? new TrajectoryJson() : null;
            let text = '', bytes = 0, failed = false;
            const fail = error => {
              if (failed) return;
              failed = true;
              reject(error);
              req.destroy(error);
            };
            res.setEncoding('utf8');
            res.on('error', error => { if (!failed) reject(error); });
            res.on('data', chunk => {
              if (failed) return;
              bytes += Buffer.byteLength(chunk);
              if (!(projected && res.statusCode === 200) && bytes > 32 * 1024 * 1024) {
                fail(new Error('接口响应超过采集上限'));
                return;
              }
              try {
                if (projected && res.statusCode === 200) projected.write(chunk);
                else text += chunk;
              } catch (error) {
                fail(error);
              }
            });
            res.on('end', () => {
              if (failed) return;
              if (res.statusCode !== 200) return reject(Object.assign(new Error(`Antigravity 接口 ${method} 返回 ${res.statusCode}`), { status: res.statusCode }));
              try {
                const value = projected ? projected.end() : JSON.parse(text);
                try { this.onRpc?.({ method, bytes, retainedBytes: projected?.retained ?? Buffer.byteLength(text), ms: this.now() - started }); } catch {}
                resolve(value);
              } catch (error) {
                reject(projected ? error : new Error('Antigravity 接口返回了无法解析的数据'));
              }
            });
          }
        );
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('Antigravity 本地接口超时')));
        const deadline = setTimeout(() => req.destroy(new Error('Antigravity 本地接口超时')), 30000);
        deadline.unref();
        req.once('close', () => clearTimeout(deadline));
        req.end(data);
      });
    } catch (error) {
      const endpointLost = [401, 403].includes(error.status) || ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTCONN'].includes(error.code);
      if (!endpointLost) throw error;
      if (this.server === server) {
        this.server = null;
        this.discoveryError = error;
        this.retryAt = Math.max(this.retryAt, this.lastScanAt + 3000);
      }
      if (retry) {
        await this.discover();
        return this.call(method, body, false);
      }
      throw error;
    }
  }

  async streamTrajectoryPage(method, body, { onRecord, isCurrent = () => true, wallMs = 30000 } = {}) {
    if (!['GetCascadeTrajectorySteps', 'GetCascadeTrajectoryGeneratorMetadata'].includes(method) || typeof onRecord !== 'function') throw Error('Unsupported statistics stream');
    if (!Number.isSafeInteger(wallMs) || wallMs < 30000 || wallMs > 300000) throw Error('Invalid statistics stream deadline');
    let streamError = null, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    aborted.catch(() => {});
    const assertCurrent = () => {
      if (streamError) throw streamError;
      if (isCurrent() !== true) throw Error('Statistics stream cancelled');
    };
    assertCurrent();
    const server = await this.discover();
    assertCurrent();
    const input = JSON.stringify(method === 'GetCascadeTrajectoryGeneratorMetadata' ? { ...body, includeMessages: false } : body);
    let pending = null;
    const parser = new TrajectoryJson({
      onRecord: (kind, index, value) => {
        if (pending) throw Error('Statistics stream consumer overflow');
        pending = { kind, index, value };
      },
    });
    const started = this.now();
    let bytes = 0, peakRetained = 0, req, res, deadline, watch;
    const timeout = () => Error('Antigravity 本地接口超时');
    const abort = error => {
      streamError ||= error;
      rejectAbort(streamError);
      res?.destroy();
      req?.destroy(streamError);
    };
    try {
      res = await new Promise((resolve, reject) => {
        req = request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            method: 'POST',
            path: SERVICE + method,
            agent: this.agent,
            headers: {
              'Content-Type': 'application/json',
              'Connect-Protocol-Version': '1',
              'x-codeium-csrf-token': server.csrf,
              'Content-Length': Buffer.byteLength(input),
            },
          },
          resolve
        );
        req.on('error', error => { streamError ||= error; rejectAbort(streamError); reject(error); });
        req.setTimeout(12000, () => abort(timeout()));
        deadline = setTimeout(() => abort(timeout()), wallMs);
        deadline.unref();
        watch = setInterval(() => { if (isCurrent() !== true) abort(Error('Statistics stream cancelled')); }, 250);
        watch.unref();
        req.end(input);
      });
      if (res.statusCode !== 200) throw Object.assign(Error('Statistics stream HTTP ' + res.statusCode), { status: res.statusCode });
      res.setEncoding('utf8');
      for await (const chunk of res) {
        assertCurrent();
        bytes += Buffer.byteLength(chunk);
        for (let offset = 0; offset < chunk.length;) {
          assertCurrent();
          const slice = chunk.slice(offset, offset + 8192);
          const consumed = parser.write(slice, { stopAfterRecord: true });
          offset += consumed;
          peakRetained = Math.max(peakRetained, parser.retained);
          if (pending) {
            const item = pending;
            pending = null;
            await Promise.race([onRecord(item.kind, item.index, item.value), aborted]);
            assertCurrent();
          }
          await yieldStream();
        }
      }
      assertCurrent();
      const result = parser.end();
      if (pending) {
        const item = pending;
        pending = null;
        await Promise.race([onRecord(item.kind, item.index, item.value), aborted]);
        assertCurrent();
      }
      try { this.onRpc?.({ method, bytes, retainedBytes: peakRetained, ms: this.now() - started, streamed: true }); } catch {}
      return result;
    } catch (error) {
      streamError ||= error;
      throw error;
    } finally {
      clearTimeout(deadline);
      clearInterval(watch);
      if (streamError || !res?.complete) {
        res?.destroy();
        req?.destroy();
      }
    }
  }

  // Backward-compatible lightweight metadata-only fetcher used by PrismDaemon.fetchUsageRollupBatch
  async _fetchMetadataOnly(id) {
    const generatorMetadata = [];
    let total = null;
    while (true) {
      const page = await this.call('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        generatorMetadataOffset: generatorMetadata.length,
        includeMessages: false,
      });
      const items = page?.generatorMetadata || page?.generatorMetadatas || [];
      if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
        total = Number(page.numTotalGeneratorMetadata);
      }
      if (!items.length) {
        if (generatorMetadata.length === 0 && total === null) throw new Error('会话暂时没有可用统计');
        if (total !== null && generatorMetadata.length < total) throw new Error('完整会话统计分页暂不可用');
        break;
      }
      generatorMetadata.push(...items);
      if (total !== null && generatorMetadata.length >= total) break;
    }
    const inferredSteps = generatorMetadata.reduce((max, g) => {
      for (const i of g.stepIndices || []) if (Number.isInteger(i) && i >= max) max = i + 1;
      return max;
    }, 0);
    return {
      numTotalSteps: inferredSteps,
      numTotalGeneratorMetadata: generatorMetadata.length,
      trajectory: {
        cascadeId: id,
        steps: [],
        generatorMetadata,
        _metadataOnly: true,
      },
    };
  }

  resetTrajectories() { this.reader.reset(); }
  trajectory(id, options) { return this.reader.read(id, options); }
  dispose() {
    try { this.agent?.destroy?.(); } catch {}
    this.reader?.reset?.();
  }
}
