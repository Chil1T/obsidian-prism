import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { platformPaths } from '../../compat/platform.mjs';
import { discoverProcesses } from './discovery.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const MAX_RESPONSE_LENGTH = 32 * 1024 * 1024;
const isLargeTrajectoryError = error => Boolean(error) && (
  /超过采集上限|本地接口超时|无法解析的数据|string length/i.test(String(error.message || '')) ||
  error.code === 'ERR_STRING_TOO_LONG' ||
  (typeof error.status === 'number' && error.status >= 500)
);
export function serverFromDiscovery(log, processes) {
  const rows = (Array.isArray(processes) ? processes : [processes]).filter(p => /--standalone\b/.test(p.CommandLine || ''));
  if (rows.length !== 1) throw new Error(rows.length ? '检测到多个 Antigravity 实例，请保留一个' : '未找到 Antigravity 桌面后台');
  const ports = new Set([rows[0].Ports].flat().map(Number));
  const port = [...log.matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)].reverse().map(m=>Number(m[1])).find(p=>ports.has(p));
  if (!port) throw new Error('等待 Antigravity 本地接口启动');
  const csrf = rows[0].CommandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
  if (!csrf) throw new Error('当前版本未提供可用的本地检测凭据');
  return {port,csrf,pid:rows[0].ProcessId};
}
export class AntigravityClient {
  constructor({paths=platformPaths,readLog=readFile,processes=discoverProcesses,now=Date.now}={}) {
    this.paths=paths;this.readLog=readLog;this.processes=processes;this.now=now;
  }
  server = null;
  discoveredAt = 0;
  discovering = null;
  lastScanAt = -Infinity;
  retryAt = 0;
  discoveryFailures = 0;
  discoveryError = null;
  // 按会话记录轻量降级级别（3 -> 2 -> 'metadata'），避免长会话每次轮询都重复撞击 32MB 上限
  trajectoryModes = new Map();

  async discover(force = false) {
    if (!force && this.server && this.now() - this.discoveredAt < 15000) return this.server;
    if (this.discovering) return this.discovering;
    if (!force && this.discoveryError && this.now() < this.retryAt) throw this.discoveryError;
    this.lastScanAt=this.now();
    this.discovering = this.discoverNow().then(server=>{
      this.discoveredAt=this.now();this.discoveryFailures=0;this.discoveryError=null;this.retryAt=0;return server;
    }).catch(error=>{
      this.discoveryError=error;this.discoveryFailures++;
      this.retryAt=this.now()+Math.min(30000,3000*2**Math.min(4,this.discoveryFailures-1));throw error;
    }).finally(() => { this.discovering = null; });
    return this.discovering;
  }

  async discoverNow() {
    this.server=null;
    // A sidecar can outlive a renderer/backend restart. Its injected token may
    // then refer to the previous LS instance; pair the current log port with
    // the current standalone process credential instead of mixing generations.
    const parsed = await this.processes();
    if (!parsed || Array.isArray(parsed) && !parsed.length) throw new Error('请先打开 Antigravity');
    // Credentials stay in process memory. They are never logged, persisted, or
    // returned to a browser; all calls go exclusively to 127.0.0.1.
    let foundLog=false,lastError=null;
    const paths=this.paths();
    for(const file of paths.logCandidates||[paths.log]) {
      try {
        const log=await this.readLog(file,'utf8');foundLog=true;
        this.server=serverFromDiscovery(log,parsed);break;
      } catch(error) {
        if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')lastError=error;
      }
    }
    if(!this.server)throw lastError||new Error(foundLog?'等待 Antigravity 本地接口启动':'未找到 Antigravity 语言服务日志，请检查日志路径');
    this.discoveredAt = this.now();
    return this.server;
  }

  async call(method, body = {}, retry = true) {
    const server = await this.discover();
    try {
      return await new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = request({ hostname: '127.0.0.1', port: server.port, method: 'POST', path: SERVICE + method,
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': server.csrf, 'Content-Length': Buffer.byteLength(data) } }, res => {
          let text = '';
          let settled = false;
          const fail = err => {
            if (settled) return;
            settled = true;
            text = '';
            reject(err);
          };
          res.setEncoding('utf8');
          res.on('data', chunk => {
            if (settled) return;
            if (text.length + chunk.length > MAX_RESPONSE_LENGTH) {
              const limitError = new Error('会话数据超过采集上限');
              req.destroy(limitError);
              fail(limitError);
              return;
            }
            text += chunk;
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            if (res.statusCode !== 200) return reject(Object.assign(new Error(`Antigravity 接口 ${method} 返回 ${res.statusCode}`),{status:res.statusCode}));
            try { resolve(JSON.parse(text)); } catch { reject(new Error('Antigravity 接口返回了无法解析的数据')); }
          });
        });
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('Antigravity 本地接口超时')));
        req.end(data);
      });
    } catch (error) {
      // A missing historical cascade, busy API or malformed response does not
      // prove the process/credential changed. Do not launch CIM scans for it.
      const endpointLost=[401,403].includes(error.status)||['ECONNREFUSED','ECONNRESET','EPIPE','ENOTCONN'].includes(error.code);
      if(!endpointLost)throw error;
      // A late failure from an old endpoint cannot invalidate a newer one.
      if(this.server===server){
        this.server=null;this.discoveryError=error;
        this.retryAt=Math.max(this.retryAt,this.lastScanAt+3000);
      }
      if(retry){await this.discover();return this.call(method,body,false);}
      throw error;
    }
  }

  _rememberTrajectoryMode(id, mode) {
    if (this.trajectoryModes.size >= 500 && !this.trajectoryModes.has(id)) {
      this.trajectoryModes.clear();
    }
    this.trajectoryModes.set(id, mode);
  }

  async _fetchTrajectoryVerbosity(id, verbosity) {
    const first = await this.call('GetCascadeTrajectory', { cascadeId: id, trajectoryVerbosity: verbosity });
    const t = first?.trajectory;
    if (!t) throw new Error('会话暂时没有可用统计');
    // The LS may page large conversations. Match its frontend pagination so the
    // session TPS never silently represents only the first page.
    // 优先拉满轻量的 generatorMetadata，避免 steps 超限阻断模型与上下文更新。
    t.generatorMetadata ||= [];
    const targetMetadata = Number(first.numTotalGeneratorMetadata ?? t.generatorMetadata.length);
    while (t.generatorMetadata.length < targetMetadata) {
      const page = await this.call('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        generatorMetadataOffset: t.generatorMetadata.length,
      });
      const items = page.generatorMetadata || page.generatorMetadatas || [];
      if (!items.length) throw new Error('完整会话统计分页暂不可用');
      t.generatorMetadata.push(...items);
    }
    t.steps ||= [];
    const targetSteps = Number(first.numTotalSteps ?? t.steps.length);
    while (t.steps.length < targetSteps) {
      try {
        const page = await this.call('GetCascadeTrajectorySteps', {
          cascadeId: id,
          stepOffset: t.steps.length,
          trajectoryVerbosity: verbosity,
        });
        const items = page.steps || [];
        if (!items.length) throw new Error('完整会话统计分页暂不可用');
        t.steps.push(...items);
      } catch (error) {
        if (verbosity <= 2 && isLargeTrajectoryError(error)) {
          this._rememberTrajectoryMode(id, 'metadata');
          t._metadataOnly = true;
          first.numTotalGeneratorMetadata = t.generatorMetadata.length;
          return first;
        }
        throw error;
      }
    }
    return first;
  }

  async _fetchMetadataOnly(id) {
    const generatorMetadata = [];
    let total = null;
    while (true) {
      const page = await this.call('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        generatorMetadataOffset: generatorMetadata.length,
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

  async trajectory(id) {
    const mode = this.trajectoryModes.get(id) ?? 3;
    if (mode === 'metadata') return this._fetchMetadataOnly(id);
    const levels = mode === 2 ? [2, 'metadata'] : [3, 2, 'metadata'];
    let lastError;
    for (const level of levels) {
      try {
        return level === 'metadata'
          ? await this._fetchMetadataOnly(id)
          : await this._fetchTrajectoryVerbosity(id, level);
      } catch (error) {
        if (!isLargeTrajectoryError(error)) throw error;
        lastError = error;
        this._rememberTrajectoryMode(id, level === 3 ? 2 : 'metadata');
      }
    }
    throw lastError;
  }
}
