// Obsidian Prism — Built-in Thought Translator & Polisher Service (Node Sidecar Module)
// - Dual Engine: Zero-config Machine Translate (GTX) + OpenAI-compatible Streaming AI Polish
// - Multi-Profile Management: Save & switch multiple BaseURL + APIKey + Model presets
// - Live Upstream Discovery: GET /v1/models & real-time latency test message
// - Privacy & Open-Source Cleanliness: Keys & custom prompts live strictly in ~/.gemini/config/ (0600), NEVER in Git!

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SYSTEM_PROMPTS = Object.freeze({
  technical:
    '你是资深软件工程推理转译助手。请将输入的英文模型思考过程（Chain-of-Thought）准确、自然地转写润色为简体中文第一人称（「我」）工程手稿。严格保留所有代码标识符、函数名、类名、文件路径、行号（如 path/file.js#L12）、终端命令与反引号格式不变；忠实还原技术因果推演、假设验证与边界排查逻辑，不编造原文没有的事实，不添加任何寒暄、标题前缀或额外解释，直接输出转写后的中文思考正文。',
  concise:
    '你是高效软件工程思考摘要助手。请将输入的英文模型思考过程提炼转写为简明利落的简体中文第一人称（「我」）推理脉络。严格保留所有精确文件路径、行号、关键代码标识符与核心结论依据，合并冗余重复的自我纠结句式，不加额外标题或套话，直接输出精炼后的中文思考正文。',
});

const KEY_REDACT_RE =
  /(sk-[A-Za-z0-9_\-]{6,}|AIza[A-Za-z0-9_\-]{12,}|xai-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._\-]{8,})/gi;

export function maskApiKey(rawKey) {
  const k = String(rawKey || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••' + k.slice(-2);
  const prefix = k.slice(0, Math.min(4, k.indexOf('-') > 0 ? k.indexOf('-') + 1 : 3));
  return `${prefix}••••${k.slice(-4)}`;
}

export function redactSecrets(text, explicitKey = '') {
  let out = String(text || '').replace(KEY_REDACT_RE, '***REDACTED***');
  const k = String(explicitKey || '').trim();
  if (k && k.length >= 6 && out.includes(k)) {
    out = out.split(k).join('***REDACTED***');
  }
  return out;
}

export function normalizeOpenAiBaseUrl(rawUrl) {
  let u = String(rawUrl || '').trim();
  if (!u) return 'https://api.openai.com/v1';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'https://api.openai.com/v1';
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    parsed.search = '';
    let pathname = parsed.pathname.replace(/\/+$/, '');
    pathname = pathname.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '').replace(/\/+$/, '');
    if (!pathname) pathname = '/v1';
    return `${parsed.origin}${pathname}`;
  } catch {
    return 'https://api.openai.com/v1';
  }
}

export function canonicalizeThoughtSkeleton(str) {
  return String(str || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '')
    .toLowerCase();
}

export function hashThoughtKey(rawText, modeTag = 'ai') {
  const norm = String(rawText || '').trim();
  if (!norm) return '';
  const skel = canonicalizeThoughtSkeleton(norm) || norm;
  let h = 2166136261;
  for (let i = 0; i < skel.length; i++) {
    h ^= skel.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${modeTag}_v3_${(h >>> 0).toString(36)}_${skel.length}`;
}

export function isMostlyChinese(text) {
  const s = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  if (!s.trim()) return true;
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinWords = (s.match(/[A-Za-z]{3,}/g) || []).length;
  if (cjk >= 24 && cjk > latinWords * 0.85) return true;
  if (latinWords <= 2 && cjk >= 4) return true;
  return false;
}

export function stripThinkTagsAndQuotes(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/<think>/i.test(s) && !/<\/think>/i.test(s)) {
    s = s.replace(/<think>[\s\S]*$/i, '');
  }
  return s.trim();
}

export class ThoughtTranslatorService {
  constructor(opts = {}) {
    const home = opts.homeDir || os.homedir();
    const cfgDir = opts.configDir || path.join(home, '.gemini', 'config');
    this.configFile = opts.configFile || path.join(cfgDir, 'obsidian-prism-thought.json');
    this.cacheFile = opts.cacheFile || path.join(cfgDir, 'obsidian-prism-thought-cache.json');
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.maxCacheEntries = opts.maxCacheEntries || 1600;

    this.memCache = new Map();
    this.inflight = new Map();
    this._cacheLoaded = false;
    this._saveCacheTimer = null;
    this._config = null;
  }

  _defaultStore() {
    return {
      version: 1,
      stylePreset: 'technical',
      customPrompt: '',
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'OpenAI 兼容主力渠道',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
        },
      ],
    };
  }

  loadStore() {
    if (this._config) return this._config;
    try {
      if (fs.existsSync(this.configFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          this._config = this._normalizeStore(parsed);
          return this._config;
        }
      }
    } catch {}
    this._config = this._defaultStore();
    return this._config;
  }

  _normalizeStore(raw) {
    const def = this._defaultStore();
    const stylePreset = ['technical', 'concise', 'custom'].includes(raw.stylePreset) ? raw.stylePreset : 'technical';
    const customPrompt = typeof raw.customPrompt === 'string' ? raw.customPrompt.slice(0, 6000) : '';
    const profiles = [];
    const seen = new Set();
    for (const item of Array.isArray(raw.profiles) ? raw.profiles : []) {
      if (!item || typeof item !== 'object') continue;
      const id =
        String(item.id || `p_${profiles.length + 1}`)
          .replace(/[^a-zA-Z0-9_\-]/g, '')
          .slice(0, 36) || `p_${profiles.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      profiles.push({
        id,
        name: String(item.name || `渠道 ${profiles.length + 1}`).trim().slice(0, 48) || `渠道 ${profiles.length + 1}`,
        baseUrl: normalizeOpenAiBaseUrl(item.baseUrl || ''),
        apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : '',
        model: String(item.model || '').trim().slice(0, 120),
      });
      if (profiles.length >= 12) break;
    }
    if (!profiles.length) profiles.push(...def.profiles);
    const activeProfileId = profiles.some((p) => p.id === raw.activeProfileId) ? raw.activeProfileId : profiles[0].id;
    return { version: 1, stylePreset, customPrompt, activeProfileId, profiles };
  }

  _persistStore(store) {
    try {
      fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
      const tmp = `${this.configFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.configFile);
    } catch {}
  }

  getSanitizedConfig() {
    const store = this.loadStore();
    return {
      ok: true,
      stylePreset: store.stylePreset,
      customPrompt: store.customPrompt,
      activeProfileId: store.activeProfileId,
      profiles: store.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        hasApiKey: Boolean(p.apiKey),
        maskedKey: maskApiKey(p.apiKey),
      })),
    };
  }

  saveConfig(input = {}) {
    const prev = this.loadStore();
    const prevMap = new Map(prev.profiles.map((p) => [p.id, p]));

    const nextRaw = {
      stylePreset: input.stylePreset ?? prev.stylePreset,
      customPrompt: input.customPrompt !== undefined ? String(input.customPrompt) : prev.customPrompt,
      activeProfileId: input.activeProfileId ?? prev.activeProfileId,
      profiles: Array.isArray(input.profiles)
        ? input.profiles.map((p) => {
            const old = prevMap.get(p?.id);
            const rawKey = typeof p?.apiKey === 'string' ? p.apiKey.trim() : '';
            const isMaskedUnchanged = !rawKey && p?.keepExistingKey !== false && old;
            const looksLikeMask = rawKey.includes('••••');
            return {
              id: p?.id,
              name: p?.name,
              baseUrl: p?.baseUrl,
              model: p?.model,
              apiKey: looksLikeMask || isMaskedUnchanged ? (old ? old.apiKey : '') : rawKey,
            };
          })
        : prev.profiles,
    };

    this._config = this._normalizeStore(nextRaw);
    this._persistStore(this._config);
    return this.getSanitizedConfig();
  }

  _resolveEffectiveCredentials(input = {}) {
    const store = this.loadStore();
    const targetId = input.profileId || store.activeProfileId;
    const saved = store.profiles.find((p) => p.id === targetId) || store.profiles[0];
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl || saved?.baseUrl || '');
    const rawKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const apiKey = rawKey && !rawKey.includes('••••') ? rawKey : saved?.apiKey || '';
    const model = String(input.model || saved?.model || '').trim();
    return { baseUrl, apiKey, model, store };
  }

  _resolveSystemPrompt(store) {
    if (store.stylePreset === 'custom' && store.customPrompt && store.customPrompt.trim()) {
      return store.customPrompt.trim();
    }
    if (store.stylePreset === 'concise') return SYSTEM_PROMPTS.concise;
    return SYSTEM_PROMPTS.technical;
  }

  async fetchModels(input = {}) {
    const { baseUrl, apiKey } = this._resolveEffectiveCredentials(input);
    if (!this.fetchImpl) return { ok: false, error: 'Fetch unavailable in runtime' };
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      });
      const latencyMs = Date.now() - t0;
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          latencyMs,
          error: `HTTP ${res.status}: ${redactSecrets(text.slice(0, 220), apiKey)}`,
        };
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, latencyMs, error: 'Invalid JSON from /models endpoint' };
      }
      const list = Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.models)
        ? body.models
        : Array.isArray(body)
        ? body
        : [];
      const models = Array.from(
        new Set(
          list
            .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || ''))
            .map((s) => String(s).replace(/^models\//, '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      return { ok: true, status: res.status, latencyMs, count: models.length, models };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: redactSecrets(err?.message || String(err), apiKey),
      };
    }
  }

  async testConnection(input = {}) {
    const { baseUrl, apiKey, model } = this._resolveEffectiveCredentials(input);
    if (!model) return { ok: false, error: '请先选择或输入模型 ID（Model）' };
    if (!apiKey) return { ok: false, error: '请先填写 API Key' };
    if (!this.fetchImpl) return { ok: false, error: 'Fetch unavailable' };

    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: 160,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: '请仅用简体中文回复“连通正常”四个字。',
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - t0;
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          latencyMs,
          model,
          error: `HTTP ${res.status}: ${redactSecrets(text.slice(0, 240), apiKey)}`,
        };
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, latencyMs, model, error: '响应非合法 JSON' };
      }
      const replyRaw = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
      const reply = stripThinkTagsAndQuotes(replyRaw).slice(0, 80) || 'OK';
      return { ok: true, status: res.status, latencyMs, model, reply };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        model,
        error: redactSecrets(err?.message || String(err), apiKey),
      };
    }
  }

  _ensureCacheLoaded() {
    if (this._cacheLoaded) return;
    this._cacheLoaded = true;
    try {
      if (fs.existsSync(this.cacheFile)) {
        const obj = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        const entries = obj?.entries && typeof obj.entries === 'object' ? obj.entries : obj;
        if (entries && typeof entries === 'object') {
          for (const [k, v] of Object.entries(entries)) {
            const val = typeof v === 'string' ? v : v?.text;
            if (k && typeof val === 'string' && val.trim()) {
              this.memCache.set(k, val);
            }
          }
        }
      }
    } catch {}
    this._trimCache();
  }

  _trimCache() {
    while (this.memCache.size > this.maxCacheEntries) {
      const oldest = this.memCache.keys().next().value;
      this.memCache.delete(oldest);
    }
  }

  _setCache(key, value) {
    if (!key || !value || !String(value).trim()) return;
    this._ensureCacheLoaded();
    if (this.memCache.has(key)) this.memCache.delete(key);
    this.memCache.set(key, String(value).trim());
    this._trimCache();
    this._schedulePersistCache();
  }

  _schedulePersistCache() {
    if (this._saveCacheTimer) return;
    this._saveCacheTimer = setTimeout(() => {
      this._saveCacheTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
        const out = {};
        for (const [k, v] of this.memCache.entries()) out[k] = v;
        const tmp = `${this.cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: out }), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmp, this.cacheFile);
      } catch {}
    }, 350);
    if (this._saveCacheTimer.unref) this._saveCacheTimer.unref();
  }

  getWarmCacheSnapshot(limit = 400) {
    this._ensureCacheLoaded();
    const store = this.loadStore();
    const items = {};
    const keys = Array.from(this.memCache.keys());
    const start = Math.max(0, keys.length - limit);
    for (let i = start; i < keys.length; i++) {
      items[keys[i]] = this.memCache.get(keys[i]);
    }
    return { ok: true, stylePreset: store.stylePreset, entries: items };
  }

  async translateMachine(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return '';
    const paragraphs = text.split(/\n{2,}/);
    const chunks = [];
    let cur = '';
    for (const p of paragraphs) {
      if (cur && cur.length + p.length + 2 > 1500) {
        chunks.push(cur);
        cur = p;
      } else {
        cur = cur ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur) chunks.push(cur);

    const outParts = [];
    for (const chunk of chunks) {
      const codeSpans = [];
      const masked = chunk.replace(/`[^`\n]+`/g, (m) => {
        const idx = codeSpans.push(m) - 1;
        return `__OPCODE_${idx}__`;
      });
      const url =
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
        encodeURIComponent(masked);
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) throw new Error(`Machine translate HTTP ${res.status}`);
      const json = await res.json();
      const segs = Array.isArray(json?.[0]) ? json[0] : [];
      let translated = segs.map((s) => (Array.isArray(s) && s[0] ? String(s[0]) : '')).join('');
      translated = translated.replace(/__OPCODE_(\d+)__/gi, (_, n) => codeSpans[Number(n)] || _);
      outParts.push(translated.trim());
    }
    return outParts.join('\n\n').trim();
  }

  async translateAiStream(rawText, onPartial) {
    const store = this.loadStore();
    const { baseUrl, apiKey, model } = this._resolveEffectiveCredentials({});
    if (!apiKey || !model) {
      const fallback = await this.translateMachine(rawText);
      if (fallback && onPartial) onPartial(fallback);
      return { text: fallback, engine: 'machine-fallback' };
    }

    const sysPrompt = this._resolveSystemPrompt(store);
    const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.3,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: String(rawText || '').trim() },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`AI HTTP ${res.status}: ${redactSecrets(errBody.slice(0, 200), apiKey)}`);
    }

    const ctype = String(res.headers?.get?.('content-type') || '').toLowerCase();
    if (!ctype.includes('text/event-stream') || !res.body) {
      const json = await res.json();
      const full = stripThinkTagsAndQuotes(json?.choices?.[0]?.message?.content || '');
      if (full && onPartial) onPartial(full);
      return { text: full, engine: 'ai' };
    }

    const decoder = new TextDecoder();
    let buf = '';
    let acc = '';
    let lastEmitAt = 0;

    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') break;
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content ?? obj?.choices?.[0]?.message?.content ?? '';
          if (delta) {
            acc += delta;
            const cleaned = stripThinkTagsAndQuotes(acc);
            const now = Date.now();
            if (cleaned && onPartial && now - lastEmitAt >= 50) {
              lastEmitAt = now;
              onPartial(cleaned);
            }
          }
        } catch {}
      }
    }

    const finalClean = stripThinkTagsAndQuotes(acc);
    if (finalClean && onPartial) onPartial(finalClean);
    return { text: finalClean, engine: 'ai' };
  }

  async translateThought({ text, mode = 'ai', onPartial }) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: true, text: '', skipped: true };
    if (isMostlyChinese(raw)) return { ok: true, text: raw, skipped: true };

    this._ensureCacheLoaded();
    const { apiKey, store } = this._resolveEffectiveCredentials({});
    const modeTag = mode === 'machine' ? 'mt' : `ai_${store.stylePreset}`;
    const cacheKey = hashThoughtKey(raw, modeTag);

    if (this.memCache.has(cacheKey)) {
      const hit = this.memCache.get(cacheKey);
      if (onPartial) onPartial(hit);
      return { ok: true, text: hit, cached: true, key: cacheKey };
    }

    if (this.inflight.has(cacheKey)) {
      const existing = this.inflight.get(cacheKey);
      if (onPartial) {
        existing.listeners.add(onPartial);
        if (existing.lastPartial) onPartial(existing.lastPartial);
      }
      return existing.promise;
    }

    const entry = {
      listeners: new Set(onPartial ? [onPartial] : []),
      lastPartial: '',
      promise: null,
    };

    entry.promise = (async () => {
      try {
        if (mode === 'machine') {
          const out = await this.translateMachine(raw);
          if (out) {
            this._setCache(cacheKey, out);
            entry.listeners.forEach((cb) => cb(out));
          }
          return { ok: Boolean(out), text: out, engine: 'machine', key: cacheKey };
        }
        const { text: aiOut, engine } = await this.translateAiStream(raw, (partial) => {
          entry.lastPartial = partial;
          entry.listeners.forEach((cb) => {
            try {
              cb(partial);
            } catch {}
          });
        });
        if (aiOut) {
          this._setCache(cacheKey, aiOut);
        }
        return { ok: Boolean(aiOut), text: aiOut, engine, key: cacheKey };
      } catch (err) {
        return {
          ok: false,
          error: redactSecrets(err?.message || String(err), apiKey),
        };
      } finally {
        this.inflight.delete(cacheKey);
      }
    })();

    this.inflight.set(cacheKey, entry);
    return entry.promise;
  }
}
