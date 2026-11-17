import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  ThoughtTranslatorService,
  SYSTEM_PROMPTS,
  maskApiKey,
  redactSecrets,
  normalizeOpenAiBaseUrl,
} from '../vendor/thought-translator/translator-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Open-source defaults use neutral engineering prompts, enforce HTTP(S) URL whitelist, and redact multi-format secrets', () => {
  for (const [presetName, prompt] of Object.entries(SYSTEM_PROMPTS)) {
    assert.ok(prompt.length > 30, `Preset ${presetName} should be non-empty`);
    assert.ok(prompt.includes('软件工程'), `Preset ${presetName} should be technical engineering focused`);
  }
  assert.equal(normalizeOpenAiBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(
    normalizeOpenAiBaseUrl('https://user:secret@api.example.com/v1/chat/completions/?foo=1#bar'),
    'https://api.example.com/v1'
  );
  // Reject non-HTTP(S) schemes safely
  assert.equal(normalizeOpenAiBaseUrl('file:///etc/passwd'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('javascript:alert(1)'), 'https://api.openai.com/v1');

  assert.equal(maskApiKey('sk-proj-' + '1234567890abcdef'), 'sk-••••cdef');
  const mockSk = 'sk-' + 'secret9876543210';
  const mockGcp = 'AIza' + 'SyMockKey1234567890';
  assert.equal(
    redactSecrets(`Upstream error with key ${mockSk} and ${mockGcp} failed`, 'custom-raw-secret-99'),
    'Upstream error with key ***REDACTED*** and ***REDACTED*** failed'
  );
  assert.equal(
    redactSecrets('Custom token custom-raw-secret-99 rejected', 'custom-raw-secret-99'),
    'Custom token ***REDACTED*** rejected'
  );
});

test('Multi-profile CRUD and key masking never expose raw API keys in sanitized payloads', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-cfg-'));
  try {
    const svc = new ThoughtTranslatorService({
      configDir: path.join(tmpDir, 'gemini-cfg'),
    });

    const initial = svc.saveConfig({
      stylePreset: 'custom',
      customPrompt: '请保留所有代码标识符并以简洁工程笔记输出。',
      activeProfileId: 'primary',
      profiles: [
        {
          id: 'primary',
          name: 'Primary Endpoint',
          baseUrl: 'https://gateway.example.org/v1',
          model: 'deepseek-v3',
          apiKey: 'sk-test-primary-key-9988',
        },
      ],
    });

    assert.equal(initial.ok, true);
    assert.equal(initial.stylePreset, 'custom');
    assert.equal(initial.profiles.length, 1);
    assert.equal(initial.profiles[0].hasApiKey, true);
    assert.equal(initial.profiles[0].apiKey, undefined);
    assert.equal(JSON.stringify(initial).includes('sk-test-primary-key-9988'), false);

    // Save a second profile while keeping first profile's existing key with blank input
    const updated = svc.saveConfig({
      stylePreset: 'technical',
      activeProfileId: 'second',
      profiles: [
        {
          id: 'primary',
          name: 'Primary Endpoint',
          baseUrl: 'https://gateway.example.org/v1',
          model: 'deepseek-v3',
          apiKey: '',
          keepExistingKey: true,
        },
        {
          id: 'second',
          name: 'Backup Channel',
          baseUrl: 'https://backup.example.org',
          model: 'gpt-4o-mini',
          apiKey: 'sk-second-channel-5566',
        },
      ],
    });

    assert.equal(updated.stylePreset, 'technical');
    assert.equal(updated.activeProfileId, 'second');
    assert.equal(updated.profiles.length, 2);
    assert.equal(updated.profiles[0].hasApiKey, true);
    assert.equal(updated.profiles[1].hasApiKey, true);
    assert.equal(updated.profiles[1].baseUrl, 'https://backup.example.org/v1');
    assert.equal(JSON.stringify(updated).includes('sk-second-channel-5566'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OpenAI /models fetch, testConnection latency, SSE AI stream, and inline-code machine translate work end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-net-'));
  try {
    const encoder = new TextEncoder();
    const mockFetch = async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'models/gemini-2.5-flash' }, { id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.endsWith('/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        if (body.stream === false) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: '<think>internal</think>连通正常' } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const chunks = [
          'data: {"choices":[{"delta":{"content":"<think>draft</think>我先核对 "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"`cdp.js#L31` 的配置校验逻辑。"}}]}\n\n',
          'data: [DONE]\n\n',
        ];
        const stream = new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      const parsedReqUrl = new URL(u);
      if (parsedReqUrl.hostname === 'translate.googleapis.com') {
        const q = parsedReqUrl.searchParams.get('q') || '';
        const zh = q.replace('Checking configuration in', '正在检查配置于');
        return new Response(JSON.stringify([[[zh, q]]]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      fetchImpl: mockFetch,
    });

    svc.saveConfig({
      stylePreset: 'technical',
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Mock OpenAI',
          baseUrl: 'https://mock.ai/v1',
          apiKey: 'sk-mock-12345678',
          model: 'gpt-4o-mini',
        },
      ],
    });

    const modelsRes = await svc.fetchModels({});
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.models, ['deepseek-chat', 'gemini-2.5-flash', 'gpt-4o-mini']);

    const testRes = await svc.testConnection({});
    assert.equal(testRes.ok, true);
    assert.equal(testRes.reply, '连通正常');
    assert.equal(typeof testRes.latencyMs, 'number');

    const partials = [];
    const aiRes = await svc.translateThought({
      text: 'Let me verify the config validator in `cdp.js#L31` before building the bundle.',
      mode: 'ai',
      onPartial: (p) => partials.push(p),
    });
    assert.equal(aiRes.ok, true);
    assert.equal(aiRes.text, '我先核对 `cdp.js#L31` 的配置校验逻辑。');
    assert.ok(partials.length >= 1);

    const cachedRes = await svc.translateThought({
      text: 'Let me verify the config validator in `cdp.js#L31` before building the bundle.',
      mode: 'ai',
    });
    assert.equal(cachedRes.cached, true);
    assert.equal(cachedRes.text, '我先核对 `cdp.js#L31` 的配置校验逻辑。');

    const mtRes = await svc.translateThought({
      text: 'Checking configuration in `ui-runtime.js#L510`',
      mode: 'machine',
    });
    assert.equal(mtRes.ok, true);
    assert.ok(mtRes.text.includes('`ui-runtime.js#L510`'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Browser thought-client renders safe DOM markdown (zero XSS), toggles raw text, and cleans up cleanly', async () => {
  const clientSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
    'utf8'
  );

  function makeEl(tag) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: [],
      childNodes: [],
      parentElement: null,
      style: {
        minHeight: '',
        removeProperty(k) {
          if (k === 'min-height') this.minHeight = '';
        },
      },
      isConnected: true,
      ownerDocument: null,
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
      },
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(v) {
        classes.clear();
        String(v || '')
          .split(/\s+/)
          .filter(Boolean)
          .forEach((c) => classes.add(c));
      },
      get textContent() {
        if (this._text !== undefined) return this._text;
        return this.childNodes.map((n) => n.textContent || '').join('');
      },
      set textContent(v) {
        this.children.length = 0;
        this.childNodes.length = 0;
        this._text = String(v ?? '');
      },
      get firstChild() {
        return this.childNodes[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      appendChild(child) {
        child.parentElement = this;
        this.childNodes.push(child);
        if (child.nodeType === 1) this.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        child.parentElement = this;
        const idx = ref ? this.childNodes.indexOf(ref) : -1;
        if (idx >= 0) this.childNodes.splice(idx, 0, child);
        else this.childNodes.push(child);
        if (child.nodeType === 1) this.children.unshift(child);
        return child;
      },
      removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i >= 0) this.childNodes.splice(i, 1);
        const ci = this.children.indexOf(child);
        if (ci >= 0) this.children.splice(ci, 1);
        child.parentElement = null;
      },
      remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
      },
      addEventListener(ev, fn) {
        listeners.set(ev, fn);
      },
      dispatchClick() {
        const fn = listeners.get('click');
        if (fn) fn({ preventDefault() {}, stopPropagation() {} });
      },
      querySelector(sel) {
        if (sel.includes('.ag-prism-thought-overlay')) {
          return this.children.find((c) => c.classList.contains('ag-prism-thought-overlay')) || null;
        }
        if (sel === '.ag-prism-thought-body') {
          return this.children.find((c) => c.classList.contains('ag-prism-thought-body')) || null;
        }
        if (sel === '.ag-prism-thought-stream') {
          return this.children.find((c) => c.classList.contains('ag-prism-thought-stream')) || null;
        }
        return null;
      },
    };
    return el;
  }

  const docEl = makeEl('html');
  const triggerBtn = makeEl('button');
  triggerBtn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  triggerBtn.setAttribute('aria-expanded', 'true');
  triggerBtn.textContent = 'Thought for 4s';

  const panelDiv = makeEl('div');
  const rawPara = makeEl('p');
  rawPara.textContent = 'Investigating performance bottleneck in render loop and verifying frame budget.';
  panelDiv.appendChild(rawPara);
  triggerBtn.nextElementSibling = panelDiv;

  const doc = {
    documentElement: docEl,
    createElement(tag) {
      const e = makeEl(tag);
      e.ownerDocument = doc;
      return e;
    },
    createTextNode(txt) {
      return { nodeType: 3, textContent: String(txt) };
    },
    querySelectorAll(sel) {
      if (sel.includes('thinking-collapsible-trigger')) return [triggerBtn];
      if (sel.includes('.ag-prism-thought-overlay')) {
        const ov = panelDiv.querySelector('.ag-prism-thought-overlay');
        return ov ? [ov] : [];
      }
      return [];
    },
  };
  panelDiv.ownerDocument = doc;

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    setTimeout,
    clearTimeout,
    __agPrismThoughtBridge: {
      call: async ({ action }) => {
        if (action === 'get-cache') return { ok: true, stylePreset: 'technical', entries: {} };
        return { ok: true };
      },
      translateStream: async (_opts, onPartial) => {
        const maliciousPayload = '已完成 `runSync` 帧耗时核验 <img src=x onerror=alert(1)>';
        if (onPartial) onPartial(maliciousPayload);
        return { ok: true, text: maliciousPayload, key: 'ai_technical_mock' };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;
  assert.ok(api, '__agPrismThought should be mounted');

  api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'preload' });
  assert.equal(docEl.getAttribute('data-ag-prism-thought-owner'), 'obsidian-prism-thought');

  await new Promise((r) => setTimeout(r, 920));

  assert.equal(panelDiv.getAttribute('data-op-zh-ready'), '1');
  const overlay = panelDiv.querySelector('.ag-prism-thought-overlay');
  assert.ok(overlay, 'Overlay should be mounted inside thought panel');
  const body = overlay.querySelector('.ag-prism-thought-body');
  assert.equal(body.children.some((el) => el.tagName === 'IMG'), false);
  assert.ok(body.textContent.includes('<img src=x onerror=alert(1)>'));

  const rawBtn = overlay.children.find((c) => c.classList.contains('ag-prism-thought-raw-toggle'));
  assert.ok(rawBtn);
  assert.equal(rawBtn.textContent, '原文');
  rawBtn.dispatchClick();
  assert.equal(panelDiv.getAttribute('data-op-show-raw'), '1');
  assert.equal(rawBtn.textContent, '收起原文');

  api.sync({ thoughtTranslate: 'off' });
  assert.equal(panelDiv.getAttribute('data-op-zh-ready'), null);
  assert.equal(panelDiv.querySelector('.ag-prism-thought-overlay'), null);
});
