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
  MAX_CONCURRENCY,
  MAX_STREAM_CHARS,
  maskApiKey,
  redactSecrets,
  normalizeOpenAiBaseUrl,
  isKeylessAllowedEndpoint,
  buildNoThinkingParams,
} from '../vendor/thought-translator/translator-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function createMockDomEnv(extraWindowProps = {}) {
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
      hidden: false,
      disabled: false,
      value: '',
      placeholder: '',
      title: '',
      style: {
        minHeight: '',
        opacity: '',
        fontSize: '',
        borderBottom: '',
        paddingBottom: '',
        marginBottom: '',
        cursor: '',
        textDecoration: '',
        textUnderlineOffset: '',
        removeProperty(k) {
          if (k === 'min-height') this.minHeight = '';
        },
      },
      isConnected: true,
      ownerDocument: null,
      _boundingRect: null,
      getBoundingClientRect() {
        return this._boundingRect || { top: 80, bottom: 240, left: 20, right: 620, width: 600, height: 160 };
      },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
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
        if (this._text !== undefined && this.childNodes.length === 0) return this._text;
        return this.childNodes.map((n) => n.textContent ?? n.nodeValue ?? '').join('');
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
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      toggleAttribute(k, force) {
        const next = force === undefined ? !attrs.has(k) : Boolean(force);
        if (next) attrs.set(k, '');
        else attrs.delete(k);
        return next;
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
        if (child.nodeType === 1) {
          const cIdx = ref ? this.children.indexOf(ref) : -1;
          if (cIdx >= 0) this.children.splice(cIdx, 0, child);
          else this.children.unshift(child);
        }
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
      dispatchEvent(evName, payload = {}) {
        const fn = listeners.get(evName);
        if (fn) fn({ preventDefault() {}, stopPropagation() {}, ...payload });
      },
      dispatchClick() {
        this.dispatchEvent('click');
      },
      click() {
        this.dispatchClick();
      },
      querySelectorAll(sel) {
        const results = [];
        const matchNode = (node) => {
          if (!node || node.nodeType !== 1) return false;
          if (sel.includes('thinking-collapsible-trigger')) {
            if (node.getAttribute('data-testid') !== 'thinking-collapsible-trigger') return false;
            if (sel.includes('aria-expanded="true"')) {
              return node.getAttribute('aria-expanded') === 'true';
            }
            return true;
          }
          if (sel.includes('.ag-prism-thought-overlay')) {
            return node.classList.contains('ag-prism-thought-overlay');
          }
          const testIdMatch = /^\[data-testid="([^"]+)"\]$/.exec(sel);
          if (testIdMatch) {
            return node.getAttribute('data-testid') === testIdMatch[1];
          }
          const clsMatch = /^\.([A-Za-z0-9_-]+)$/.exec(sel);
          if (clsMatch) {
            return node.classList.contains(clsMatch[1]);
          }
          return false;
        };
        const walk = (n) => {
          for (const ch of n.children || []) {
            if (matchNode(ch)) results.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return results;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
    };
    return el;
  }

  const rootBody = makeEl('body');
  const docEl = makeEl('html');
  docEl.clientHeight = 900;
  docEl.clientWidth = 1440;
  docEl.appendChild(rootBody);

  const storageMap = new Map();
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  };

  const doc = {
    documentElement: docEl,
    body: rootBody,
    createElement(tag) {
      const e = makeEl(tag);
      e.ownerDocument = doc;
      return e;
    },
    createTextNode(txt) {
      return { nodeType: 3, nodeValue: String(txt), textContent: String(txt) };
    },
    querySelectorAll(sel) {
      return rootBody.querySelectorAll(sel);
    },
    querySelector(sel) {
      return rootBody.querySelector(sel);
    },
  };
  rootBody.ownerDocument = doc;

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    localStorage,
    innerHeight: 900,
    innerWidth: 1440,
    URL,
    setTimeout,
    clearTimeout,
    ...extraWindowProps,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return { makeEl, doc, docEl, rootBody, localStorage, storageMap, sandbox };
}

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

    const mockKey1 = 'sk-' + 'test-primary-key-9988';
    const mockKey2 = 'sk-' + 'second-channel-5566';
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
          apiKey: mockKey1,
        },
      ],
    });

    assert.equal(initial.ok, true);
    assert.equal(initial.stylePreset, 'custom');
    assert.equal(initial.profiles.length, 1);
    assert.equal(initial.profiles[0].hasApiKey, true);
    assert.equal(initial.profiles[0].apiKey, undefined);
    assert.equal(JSON.stringify(initial).includes(mockKey1), false);

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
          apiKey: mockKey2,
        },
      ],
    });

    assert.equal(updated.stylePreset, 'technical');
    assert.equal(updated.activeProfileId, 'second');
    assert.equal(updated.profiles.length, 2);
    assert.equal(updated.profiles[0].hasApiKey, true);
    assert.equal(updated.profiles[1].hasApiKey, true);
    assert.equal(updated.profiles[1].baseUrl, 'https://backup.example.org/v1');
    assert.equal(JSON.stringify(updated).includes(mockKey2), false);
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
          apiKey: 'sk-' + 'mock-12345678',
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

  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
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
  });

  const triggerBtn = doc.createElement('button');
  triggerBtn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  triggerBtn.setAttribute('aria-expanded', 'true');
  triggerBtn.textContent = 'Thought for 4s';

  const panelDiv = doc.createElement('div');
  const rawPara = doc.createElement('p');
  rawPara.textContent = 'Investigating performance bottleneck in render loop and verifying frame budget.';
  panelDiv.appendChild(rawPara);
  triggerBtn.nextElementSibling = panelDiv;
  rootBody.appendChild(triggerBtn);
  rootBody.appendChild(panelDiv);

  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;
  assert.ok(api, '__agPrismThought should be mounted');

  api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'preload' });
  assert.equal(docEl.getAttribute('data-ag-prism-thought-owner'), 'obsidian-prism-thought');

  await new Promise((r) => setTimeout(r, 950));

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

test('Task 1: Restores clickable file:// source & #L line pills delegating to native host anchors and blocks javascript:/data: XSS', async () => {
  const clientSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
    'utf8'
  );

  let nativeAnchorClicks = 0;
  let nativePillClicks = 0;

  const { doc, rootBody, sandbox } = createMockDomEnv({
    __agPrismThoughtBridge: {
      call: async () => ({ ok: true, stylePreset: 'technical', entries: {} }),
      translateStream: async () => ({
        ok: true,
        text: [
          '我先检查 `cdp.js#L31-L45` 的压缩逻辑，并对齐 [配置入口](file:///c:/workspace/obsidian-prism/cdp.js#L31-L45)。',
          '同时核验 ui-runtime.js#L120 的事件委托；拦截 [XSS1](javascript:alert(1)) 与 [XSS2](data:text/html,<script>alert(1)</script>) 及 [Web](https://example.com/a)。',
        ].join('\n'),
        engine: 'ai',
      }),
    },
  });

  const triggerBtn = doc.createElement('button');
  triggerBtn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  triggerBtn.setAttribute('aria-expanded', 'true');
  triggerBtn.textContent = 'Thought for 3s';

  const panelDiv = doc.createElement('div');
  const rawPara = doc.createElement('p');
  rawPara.appendChild(doc.createTextNode('Checking bundle logic in '));

  const nativeAnchor = doc.createElement('a');
  nativeAnchor.setAttribute('href', 'file:///c%3A/workspace/obsidian-prism/cdp.js#L31-L45');
  nativeAnchor.textContent = 'cdp.js#L31-L45';
  nativeAnchor.addEventListener('click', () => {
    nativeAnchorClicks++;
  });
  rawPara.appendChild(nativeAnchor);

  rawPara.appendChild(doc.createTextNode(' and event handler in '));
  const hostSourcePill = doc.createElement('span');
  hostSourcePill.setAttribute('data-file-path', 'c:\\workspace\\obsidian-prism\\ui-runtime.js');
  hostSourcePill.setAttribute('data-line', '120');
  hostSourcePill.textContent = 'ui-runtime.js';
  hostSourcePill.addEventListener('click', () => {
    nativePillClicks++;
  });
  rawPara.appendChild(hostSourcePill);

  panelDiv.appendChild(rawPara);
  triggerBtn.nextElementSibling = panelDiv;
  rootBody.appendChild(triggerBtn);
  rootBody.appendChild(panelDiv);

  vm.runInNewContext(clientSrc, sandbox);
  sandbox.__agPrismThought.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
  await new Promise((r) => setTimeout(r, 80));

  const overlay = panelDiv.querySelector('.ag-prism-thought-overlay');
  assert.ok(overlay);
  const body = overlay.querySelector('.ag-prism-thought-body');
  const pills = body.querySelectorAll('.ag-prism-thought-file-pill');
  assert.equal(pills.length, 3, 'Should render 3 safe file:// pills (backtick mapped, markdown file://, bare path#L)');

  for (const p of pills) {
    const href = p.getAttribute('href') || '';
    assert.ok(href.startsWith('file:///'), `Every file pill must enforce file:// scheme, got: ${href}`);
  }

  // Clicking translated pills must trigger native host anchor click()!
  pills[0].dispatchClick();
  pills[1].dispatchClick();
  assert.equal(nativeAnchorClicks, 2, 'Clicking mapped/markdown cdp.js pills must delegate to native <a>.click()');

  pills[2].dispatchClick();
  assert.equal(nativePillClicks, 1, 'Clicking bare ui-runtime.js#L120 pill must delegate to host source pill click()');

  // Verify zero XSS anchors for javascript:, data:, or https:
  const allLinks = [];
  const collectAnchors = (n) => {
    for (const ch of n.children || []) {
      if (ch.tagName === 'A') allLinks.push(ch);
      collectAnchors(ch);
    }
  };
  collectAnchors(body);
  assert.equal(allLinks.length, 3, 'No <a> tags may be created for javascript:, data:, or https: links');
  assert.ok(body.textContent.includes('XSS1') && body.textContent.includes('XSS2'));
});

test('Task 2: Allows keyless local Ollama / LM Studio / vLLM with Qwen3 no-thinking params and surfaces explicit machine-fallback badge', async () => {
  assert.equal(isKeylessAllowedEndpoint('http://127.0.0.1:11434/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://localhost:1234/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://[::1]:8000/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://192.168.31.88:11434/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://10.0.0.12:8000/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://172.16.10.5:8000/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('http://ollama.local:11434/v1'), true);
  assert.equal(isKeylessAllowedEndpoint('https://api.openai.com/v1'), false);

  const qwenParams = buildNoThinkingParams('qwen3:8b', 'http://127.0.0.1:11434/v1');
  assert.equal(qwenParams.enable_thinking, false);
  assert.deepEqual(qwenParams.chat_template_kwargs, { enable_thinking: false });
  assert.equal(qwenParams.reasoning_effort, 'none');

  const o3Params = buildNoThinkingParams('o3-mini', 'https://api.openai.com/v1');
  assert.equal(o3Params.reasoning_effort, 'low');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-local-'));
  try {
    const capturedRequests = [];
    let rejectExtendedOnce = false;

    const mockFetch = async (url, init = {}) => {
      const u = String(url);
      if (u.startsWith('http://127.0.0.1:11434/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        capturedRequests.push({ headers: init.headers || {}, body });
        if (rejectExtendedOnce && body.enable_thinking !== undefined) {
          rejectExtendedOnce = false;
          return new Response('Unrecognized field enable_thinking', { status: 400 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: body.stream ? '我已完成本地免密 Qwen3 转译。' : '连通正常' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('translate.googleapis.com')) {
        return new Response(JSON.stringify([[['降级机翻结果文本', 'src']]]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const svc = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: mockFetch });

    // 1) Local Ollama without API key succeeds in both testConnection & translateThought
    svc.saveConfig({
      activeProfileId: 'ollama',
      profiles: [
        {
          id: 'ollama',
          name: 'Local Ollama',
          baseUrl: '127.0.0.1:11434/v1',
          apiKey: '',
          model: 'qwen3:8b',
        },
      ],
    });

    const connRes = await svc.testConnection({});
    assert.equal(connRes.ok, true);
    assert.equal(connRes.reply, '连通正常');
    assert.equal(capturedRequests[0].headers.Authorization, undefined, 'Empty apiKey must omit Authorization header');
    assert.equal(capturedRequests[0].body.enable_thinking, false);

    rejectExtendedOnce = true;
    const localAiRes = await svc.translateThought({
      text: 'Verifying local keyless Qwen3 translation pipeline without API key.',
      mode: 'ai',
    });
    assert.equal(localAiRes.ok, true);
    assert.equal(localAiRes.engine, 'ai');
    assert.equal(localAiRes.fallback, false);
    assert.equal(localAiRes.text, '我已完成本地免密 Qwen3 转译。');

    // 2) Cloud endpoint without API key triggers explicit machine-fallback (never masquerading as AI)
    svc.saveConfig({
      activeProfileId: 'cloud',
      profiles: [
        {
          id: 'cloud',
          name: 'Cloud No Key',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
        },
      ],
    });

    const cloudConn = await svc.testConnection({});
    assert.equal(cloudConn.ok, false);

    const fbRes = await svc.translateThought({
      text: 'Cloud profile without key must report explicit fallback engine.',
      mode: 'ai',
    });
    assert.equal(fbRes.ok, true);
    assert.equal(fbRes.engine, 'machine-fallback');
    assert.equal(fbRes.fallback, true);
    assert.ok(fbRes.key.startsWith('mt_'), 'Fallback result must not pollute ai_* cache namespace');

    // 3) Verify client displays explicit fallback pill badge
    const clientSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
      'utf8'
    );
    const { doc, rootBody, sandbox } = createMockDomEnv({
      __agPrismThoughtBridge: {
        call: async () => ({ ok: true, stylePreset: 'technical', entries: {} }),
        translateStream: async () => fbRes,
      },
    });
    const btn = doc.createElement('button');
    btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Thought for 2s';
    const panel = doc.createElement('div');
    const p = doc.createElement('p');
    p.textContent = 'Cloud profile without key must report explicit fallback engine.';
    panel.appendChild(p);
    btn.nextElementSibling = panel;
    rootBody.appendChild(btn);
    rootBody.appendChild(panel);

    vm.runInNewContext(clientSrc, sandbox);
    sandbox.__agPrismThought.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(panel.getAttribute('data-op-zh-fallback'), '1');
    const fbBadge = panel.querySelector('[data-testid="thought-fallback-badge"]');
    assert.ok(fbBadge);
    assert.equal(fbBadge.hidden, false, 'Fallback badge must be visible on machine-fallback');
    assert.equal(fbBadge.textContent, '机翻降级');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Task 3: Enforces MAX_CONCURRENCY=3 LIFO/priority semaphore, cancels unstarted tasks, and supports retry & retranslate', async () => {
  assert.equal(MAX_CONCURRENCY, 3);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-queue-'));
  try {
    let activeFetches = 0;
    let peakFetches = 0;
    const startedOrder = [];
    const gates = [];

    const mockFetch = async (_url, init = {}) => {
      const body = JSON.parse(init.body || '{}');
      const userMsg = body.messages?.[1]?.content || '';
      const tagMatch = /Block-(\w+)/.exec(userMsg);
      const tag = tagMatch ? tagMatch[1] : 'unknown';

      activeFetches++;
      if (activeFetches > peakFetches) peakFetches = activeFetches;
      startedOrder.push(tag);

      await new Promise((resolve) => gates.push(resolve));
      activeFetches--;

      return new Response(
        JSON.stringify({ choices: [{ message: { content: `译文-${tag}` } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const svc = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: mockFetch });
    svc.saveConfig({
      activeProfileId: 'local',
      profiles: [{ id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'qwen3' }],
    });

    // Fire 7 distinct blocks simultaneously: first 3 fill concurrency=3; D,E,G (prio 5) & F (prio 25) queue up
    const p1 = svc.translateThought({ text: 'Analyzing Block-A execution path in detail now.', priority: 5, requestId: 'rA' });
    const p2 = svc.translateThought({ text: 'Analyzing Block-B execution path in detail now.', priority: 5, requestId: 'rB' });
    const p3 = svc.translateThought({ text: 'Analyzing Block-C execution path in detail now.', priority: 5, requestId: 'rC' });
    const p4 = svc.translateThought({ text: 'Analyzing Block-D execution path in detail now.', priority: 5, requestId: 'rD' });
    const p5 = svc.translateThought({ text: 'Analyzing Block-E execution path in detail now.', priority: 5, requestId: 'rE' });
    const p7 = svc.translateThought({ text: 'Analyzing Block-G execution path in detail now.', priority: 5, requestId: 'rG' });
    const p6 = svc.translateThought({ text: 'Analyzing Block-F execution path in detail now.', priority: 25, requestId: 'rF' });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(peakFetches, 3, 'Must cap concurrent upstream requests at MAX_CONCURRENCY = 3');
    assert.equal(svc.getQueueStats().queued, 4);

    // Cancel queued unstarted Block-D
    const cancelRes = svc.cancelPending('rD');
    assert.equal(cancelRes.cancelled, true);
    const dResult = await p4;
    assert.equal(dResult.cancelled, true);
    assert.equal(svc.getQueueStats().queued, 3);

    // Release slots one by one: F (prio 25) -> G (prio 5, newer LIFO) -> E (prio 5, older)
    while (gates.length) {
      const release = gates.shift();
      release();
      await new Promise((r) => setTimeout(r, 15));
    }

    const [resA, resB, resC, resE, resG, resF] = await Promise.all([p1, p2, p3, p5, p7, p6]);
    assert.equal(resA.ok && resB.ok && resC.ok && resE.ok && resG.ok && resF.ok, true);
    assert.equal(startedOrder.includes('D'), false, 'Cancelled queued task must never hit upstream fetch');
    assert.deepEqual(
      startedOrder.slice(3),
      ['F', 'G', 'E'],
      'Priority block F must dequeue first, followed by LIFO order G before E'
    );

    // Client test: viewport priority + error retry pill + single-block force retranslate
    const clientSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
      'utf8'
    );
    let callCount = 0;
    const receivedOpts = [];
    const { doc, rootBody, sandbox } = createMockDomEnv({
      __agPrismThoughtBridge: {
        call: async () => ({ ok: true, stylePreset: 'technical', entries: {} }),
        translateStream: async (opts) => {
          callCount++;
          receivedOpts.push(opts);
          if (callCount === 1) {
            return { ok: false, error: 'HTTP 429 rate limit' };
          }
          return { ok: true, text: `第 ${callCount} 次成功译文`, engine: 'ai' };
        },
      },
    });

    const btn = doc.createElement('button');
    btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Thought for 5s';
    const panel = doc.createElement('div');
    const p = doc.createElement('p');
    p.textContent = 'Investigating rate limit recovery and manual single-block retranslation.';
    panel.appendChild(p);
    btn.nextElementSibling = panel;
    rootBody.appendChild(btn);
    rootBody.appendChild(panel);

    vm.runInNewContext(clientSrc, sandbox);
    sandbox.__agPrismThought.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 80));

    // 1st attempt failed -> must show non-intrusive retry bar & keep raw English visible
    assert.equal(panel.getAttribute('data-op-zh-failed'), '1');
    assert.equal(panel.getAttribute('data-op-show-raw'), '1');
    const retryBtn = panel.querySelector('[data-testid="thought-retry-btn"]');
    assert.ok(retryBtn, 'Failed panel must expose ↻ retry button instead of silent lockout');

    // Click retry -> clears cooldown & succeeds immediately
    retryBtn.dispatchClick();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(panel.getAttribute('data-op-zh-ready'), '1');
    assert.equal(panel.getAttribute('data-op-zh-failed'), null);
    assert.ok(panel.textContent.includes('第 2 次成功译文'));

    // Click subtle ↻ retranslate button on ready block -> forces cache bypass!
    const retranslateBtn = panel.querySelector('[data-testid="thought-retranslate-btn"]');
    assert.ok(retranslateBtn && retranslateBtn.hidden === false);
    retranslateBtn.dispatchClick();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(receivedOpts[receivedOpts.length - 1].force, true, 'Single-block ↻ must pass force:true');
    assert.ok(panel.textContent.includes('第 3 次成功译文'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Task 4: Supports global bilingual stacked view mode and dual-end cache stats / clear (with daemon-unwired fallback)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-cache-'));
  try {
    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '服务端缓存测试译文。' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    svc.saveConfig({
      activeProfileId: 'local',
      profiles: [{ id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen3' }],
    });

    await svc.translateThought({ text: 'Caching first thought block on disk and memory.', mode: 'ai' });
    const statsBefore = svc.getCacheStats();
    assert.equal(statsBefore.ok, true);
    assert.equal(statsBefore.entries, 1);
    assert.ok(statsBefore.diskBytes > 0 && fs.existsSync(svc.cacheFile));

    const clientSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
      'utf8'
    );
    const settingsUiSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
      'utf8'
    );

    let daemonWired = false;
    const rpcCalls = [];

    const { doc, docEl, rootBody, localStorage, sandbox } = createMockDomEnv({
      // Simulate real V8 CDP Runtime.addBinding: throws if passed a non-string object and returns void!
      __agPrismThoughtCall: (rawArg) => {
        if (typeof rawArg !== 'string') {
          throw new TypeError('CDP Runtime.addBinding only accepts a single string argument');
        }
      },
      __agPrismThoughtBridge: {
        call: async (payload) => {
          const action = payload && payload.action;
          rpcCalls.push(action);
          if (action === 'get-cache') return { ok: true, stylePreset: 'technical', entries: {} };
          if (action === 'get-config') return svc.getSanitizedConfig();
          if (action === 'cache-stats' || action === 'clear-cache') {
            if (!daemonWired) return { ok: false, error: 'Unknown action (daemon not wired yet)' };
            return action === 'cache-stats' ? svc.getCacheStats() : svc.clearCache();
          }
          return { ok: true };
        },
        translateStream: async () => ({
          ok: true,
          text: '块级双语对照测试译文。',
          key: 'ai_technical_v3_demo',
          engine: 'ai',
        }),
      },
    });

    const btn = doc.createElement('button');
    btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Thought for 2s';
    const panel = doc.createElement('div');
    const rawPara = doc.createElement('p');
    rawPara.textContent = 'Original English reasoning block kept cleanly below translated block.';
    panel.appendChild(rawPara);
    btn.nextElementSibling = panel;
    rootBody.appendChild(btn);
    rootBody.appendChild(panel);

    vm.runInNewContext(clientSrc, sandbox);
    vm.runInNewContext(settingsUiSrc, sandbox);

    const api = sandbox.__agPrismThought;
    const uiFactory = sandbox.__agPrismThoughtSettingsUi.createThoughtAiConfigBox;

    api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 80));
    // Force flush localStorage cache so storage has entry
    api.destroy();
    api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(localStorage.getItem('ag_prism_thought_zh_cache_v1'));

    const cfgUi = uiFactory({
      mkEl: (tag, cls) => {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        return e;
      },
      btnClass: 'seg-btn',
      ui: {},
      isZh: () => true,
      getMode: () => 'ai',
      runGuardedMut: (fn) => fn(),
    });
    rootBody.appendChild(cfgUi.box);
    await new Promise((r) => setTimeout(r, 40));

    // 1) Toggle Reading View -> Bilingual Stacked
    const viewGroup = cfgUi.box.querySelector('[data-testid="thought-view-mode-group"]');
    assert.ok(viewGroup);
    const bilingualBtn = viewGroup.children.find((b) => b.getAttribute('data-thought-view') === 'bilingual');
    const immersiveBtn = viewGroup.children.find((b) => b.getAttribute('data-thought-view') === 'immersive');
    assert.ok(bilingualBtn && immersiveBtn);

    bilingualBtn.dispatchClick();
    assert.equal(api.getViewMode(), 'bilingual');
    assert.equal(docEl.getAttribute('data-ag-prism-thought-view'), 'bilingual');
    assert.equal(panel.getAttribute('data-op-bilingual'), '1');
    assert.equal(panel.getAttribute('data-op-show-raw'), '1');
    const ovEl = panel.querySelector('.ag-prism-thought-overlay');
    assert.equal(ovEl.style.borderBottom, '', 'Must delegate bilingual separator to CSS without duplicate inline border');

    immersiveBtn.dispatchClick();
    assert.equal(api.getViewMode(), 'immersive');
    assert.equal(panel.getAttribute('data-op-bilingual'), null);
    assert.equal(panel.getAttribute('data-op-show-raw'), null);

    // 2) Daemon unwired graceful fallback: shows frontend cache count & clears localStorage cleanly
    const cacheBadge = cfgUi.box.querySelector('[data-testid="thought-cache-stats"]');
    const clearBtn = cfgUi.box.querySelector('[data-testid="thought-clear-cache-btn"]');
    const statusBadge = cfgUi.box.querySelector('[data-testid="thought-status-badge"]');
    assert.ok(cacheBadge && clearBtn);
    assert.equal(cacheBadge.textContent, '缓存 1 条');

    clearBtn.dispatchClick();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(localStorage.getItem('ag_prism_thought_zh_cache_v1'), null);
    assert.equal(api.getLocalCacheStats().memEntries, 0);
    assert.equal(cacheBadge.textContent, '缓存 0 条');
    assert.ok(statusBadge.textContent.includes('已清空前端缓存'));

    // 3) Daemon wired: clears daemon memory + disk cache file end-to-end
    daemonWired = true;
    await cfgUi.refreshCacheStats();
    assert.equal(cacheBadge.textContent, '缓存 1 条');

    clearBtn.dispatchClick();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(svc.getCacheStats().entries, 0);
    assert.equal(fs.existsSync(svc.cacheFile), false, 'Disk cache file must be removed on clearCache()');
    assert.equal(cacheBadge.textContent, '缓存 0 条');
    assert.ok(statusBadge.textContent.includes('已清空双端转译缓存'));
    assert.ok(rpcCalls.includes('cache-stats') && rpcCalls.includes('clear-cache'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Cross-module thoughtView contract: api.sync({ thoughtView }) resists async get-cache clobbering and syncs with __agPrism.saveSettingsBatch / onViewSwitched', async () => {
  const clientSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
    'utf8'
  );
  const settingsUiSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
    'utf8'
  );

  const savedBatches = [];
  let hostCfg = { thoughtView: 'bilingual' };

  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrism: {
      getState: () => ({ cfg: hostCfg }),
      saveSettingsBatch: (patch) => {
        savedBatches.push(patch);
        hostCfg = { ...hostCfg, ...patch };
      },
    },
    __agPrismThoughtBridge: {
      call: async ({ action }) => {
        if (action === 'get-cache') {
          await new Promise((r) => setTimeout(r, 25));
          // Stale default viewMode from daemon must NOT overwrite explicit cfg.thoughtView!
          return { ok: true, stylePreset: 'technical', viewMode: 'immersive', entries: {} };
        }
        if (action === 'get-config') {
          return { ok: true, stylePreset: 'technical', viewMode: 'immersive', profiles: [] };
        }
        return { ok: true };
      },
      translateStream: async () => ({
        ok: true,
        text: '双语对照宿主键名对齐测试。',
        engine: 'machine',
      }),
    },
  });

  const btn = doc.createElement('button');
  btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Thought for 2s';
  const panel = doc.createElement('div');
  const rawPara = doc.createElement('p');
  rawPara.textContent = 'Verifying host cfg.thoughtView synchronization across settings and client.';
  panel.appendChild(rawPara);
  btn.nextElementSibling = panel;
  rootBody.appendChild(btn);
  rootBody.appendChild(panel);

  vm.runInNewContext(clientSrc, sandbox);
  vm.runInNewContext(settingsUiSrc, sandbox);

  const api = sandbox.__agPrismThought;
  api.sync({ thoughtTranslate: 'machine', thoughtView: 'bilingual' });
  assert.equal(api.getViewMode(), 'bilingual');
  assert.equal(docEl.getAttribute('data-ag-prism-thought-view'), 'bilingual');

  // Wait past async get-cache + render to confirm no regression back to 'immersive'
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(api.getViewMode(), 'bilingual');
  assert.equal(docEl.getAttribute('data-ag-prism-thought-view'), 'bilingual');
  assert.equal(panel.getAttribute('data-op-bilingual'), '1');
  assert.equal(panel.getAttribute('data-op-show-raw'), '1');

  const cfgUi = sandbox.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
    mkEl: (tag, cls) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      return e;
    },
    btnClass: 'seg-btn',
    ui: {},
    isZh: () => true,
    getMode: () => 'ai',
    runGuardedMut: (fn) => fn(),
  });
  rootBody.appendChild(cfgUi.box);
  await new Promise((r) => setTimeout(r, 30));

  const viewGroup = cfgUi.box.querySelector('[data-testid="thought-view-mode-group"]');
  const bilingualBtn = viewGroup.children.find((b) => b.getAttribute('data-thought-view') === 'bilingual');
  const immersiveBtn = viewGroup.children.find((b) => b.getAttribute('data-thought-view') === 'immersive');
  assert.equal(bilingualBtn.getAttribute('aria-pressed'), 'true', 'Initial UI must read __agPrism cfg.thoughtView');

  immersiveBtn.dispatchClick();
  assert.equal(savedBatches[savedBatches.length - 1]?.thoughtView, 'immersive');
  assert.equal(api.getViewMode(), 'immersive');

  cfgUi.onViewSwitched('bilingual');
  assert.equal(bilingualBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(immersiveBtn.getAttribute('aria-pressed'), 'false');
});

test('UX-3 & UX-6 regression: prioritizes data-ag-cs-lang over host lang="en", live-refreshes 5 locales, and prevents preload/engine-switch leakage', async () => {
  const clientSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
    'utf8'
  );

  let streamCalls = [];
  let cancelCalls = [];

  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrismThoughtCall: async (payload) => {
      if (payload.action === 'cancel-translate') cancelCalls.push(payload.requestId);
      return { ok: true };
    },
    __agPrismThoughtBridge: {
      call: async () => ({ ok: true, stylePreset: 'technical', entries: {} }),
      translateStream: async (opts) => {
        streamCalls.push(opts);
        await new Promise((r) => setTimeout(r, 40));
        return {
          ok: true,
          text: opts.mode === 'machine' ? '机翻版本内容。' : 'AI 精修版本内容。',
          engine: opts.mode === 'machine' ? 'machine-fallback' : 'ai',
          fallback: opts.mode === 'machine',
        };
      },
    },
  });

  // Simulate real host DOM: host sets <html lang="en">, Prism sets data-ag-cs-lang="zh-CN"
  docEl.setAttribute('lang', 'en');
  docEl.setAttribute('data-ag-cs-lang', 'zh-CN');

  // Block 1: Expanded panel
  const btn1 = doc.createElement('button');
  btn1.setAttribute('data-testid', 'thinking-collapsible-trigger');
  btn1.setAttribute('aria-expanded', 'true');
  btn1.textContent = 'Thought for 3s';
  const panel1 = doc.createElement('div');
  const p1 = doc.createElement('p');
  p1.textContent = 'First expanded reasoning block to verify five-locale button refresh.';
  panel1.appendChild(p1);
  btn1.nextElementSibling = panel1;
  panel1.previousElementSibling = btn1;

  // Block 2: Latest collapsed panel (streaming -> finishes -> enters waitTimer under preload)
  const btn2 = doc.createElement('button');
  btn2.setAttribute('data-testid', 'thinking-collapsible-trigger');
  btn2.setAttribute('aria-expanded', 'false');
  btn2.setAttribute('data-op-thought-state', 'streaming');
  btn2.textContent = 'Thinking...';
  const panel2 = doc.createElement('div');
  const p2 = doc.createElement('p');
  p2.textContent = 'Second collapsed block streaming then settling to test preload->expand abort.';
  panel2.appendChild(p2);
  btn2.nextElementSibling = panel2;
  panel2.previousElementSibling = btn2;

  rootBody.appendChild(btn1);
  rootBody.appendChild(panel1);
  rootBody.appendChild(btn2);
  rootBody.appendChild(panel2);

  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;

  // 1) Start in machine mode + preload: must use zh-CN despite host lang="en"!
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'preload', language: 'zh-CN' });
  await new Promise((r) => setTimeout(r, 90));

  const ov1 = panel1.querySelector('.ag-prism-thought-overlay');
  const rawBtn1 = ov1.children.find((c) => c.classList.contains('ag-prism-thought-raw-toggle'));
  const fbBadge1 = panel1.querySelector('[data-testid="thought-fallback-badge"]');
  assert.equal(rawBtn1.textContent, '原文', 'Must read data-ag-cs-lang="zh-CN" instead of host lang="en"');
  assert.equal(fbBadge1.textContent, '机翻降级');

  // Toggle raw on so we can test live-refresh of "Hide Raw" across 5 locales
  rawBtn1.dispatchClick();
  assert.equal(rawBtn1.textContent, '收起原文');

  // Live switch to Cantonese (yue), Japanese (ja), Traditional Chinese (zh-TW), English (en)
  docEl.setAttribute('data-ag-cs-lang', 'yue');
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'preload', language: 'yue' });
  assert.equal(rawBtn1.textContent, '收埋原文');
  assert.equal(fbBadge1.textContent, '機翻降級');

  docEl.setAttribute('data-ag-cs-lang', 'ja');
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'preload', language: 'ja' });
  assert.equal(rawBtn1.textContent, '原文を隠す');
  assert.equal(fbBadge1.textContent, '機械翻訳代替');

  docEl.setAttribute('data-ag-cs-lang', 'en');
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'preload', language: 'en' });
  assert.equal(rawBtn1.textContent, 'Hide Raw');
  assert.equal(fbBadge1.textContent, 'Fallback');

  docEl.setAttribute('data-ag-cs-lang', 'zh-TW');
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'preload', language: 'zh-TW' });
  assert.equal(rawBtn1.textContent, '收起原文');
  assert.equal(fbBadge1.textContent, '機翻降級');

  // 2) Finish streaming on collapsed btn2 so it enters waitTimer under preload, then switch thoughtTrigger -> 'expand'!
  btn2.removeAttribute('data-op-thought-state');
  btn2.textContent = 'Thought for 2s';
  api.scanImmediate();
  const callsBeforeExpandSwitch = streamCalls.length;
  // Immediately switch trigger to 'expand' BEFORE 450ms/900ms waitTimer fires!
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN' });
  await new Promise((r) => setTimeout(r, 980));
  assert.equal(
    streamCalls.length,
    callsBeforeExpandSwitch,
    'Switching preload -> expand must clear pending waitTimers on collapsed blocks without closure leakage'
  );

  // 3) Switch engine machine -> ai: must clear old sigs and retranslate with AI!
  api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand', language: 'zh-CN' });
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(panel1.textContent.includes('AI 精修版本内容。'));

  // 4) Switch -> off: must restore clean raw English immediately
  api.sync({ thoughtTranslate: 'off' });
  assert.equal(panel1.querySelector('.ag-prism-thought-overlay'), null);
  assert.equal(panel1.getAttribute('data-op-thought-panel'), null);
  assert.equal(panel1.getAttribute('data-op-show-raw'), null);
});

test('UX-5 & UX-8 regression: thought-settings-ui supports 5 locales, optThoughtImmersive/Bilingual keys, deduplicated view bar, and reloadConfig()', async () => {
  const settingsUiSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
    'utf8'
  );

  let backendConfig = {
    ok: true,
    stylePreset: 'concise',
    viewMode: 'immersive',
    customPrompt: '',
    activeProfileId: 'p1',
    profiles: [
      { id: 'p1', name: 'Initial Profile', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasApiKey: false },
    ],
  };

  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrismThought: {
      getViewMode: () => 'immersive',
      setViewMode: () => {},
      getLocalCacheStats: () => ({ memEntries: 3 }),
      getConfig: async () => backendConfig,
    },
  });

  docEl.setAttribute('data-ag-cs-lang', 'ja');
  vm.runInNewContext(settingsUiSrc, sandbox);
  const uiFactory = sandbox.__agPrismThoughtSettingsUi.createThoughtAiConfigBox;

  // Mount with parent settings-panel ui keys (optThoughtImmersive / optThoughtBilingual)
  const cfgUi = uiFactory({
    mkEl: (tag, cls) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      return e;
    },
    btnClass: 'seg-btn',
    ui: {
      optThoughtImmersive: '翻訳のみ(親)',
      optThoughtBilingual: '対照表示(親)',
    },
    getMode: () => 'ai',
    runGuardedMut: (fn) => fn(),
  });
  rootBody.appendChild(cfgUi.box);
  await new Promise((r) => setTimeout(r, 30));

  // Auto-hides duplicate internal viewBar when parent settings-panel provides optThoughtImmersive, while keeping buttons synced
  const viewGroup = cfgUi.box.querySelector('[data-testid="thought-view-mode-group"]');
  assert.equal(viewGroup.parentElement.hidden, true, 'Duplicate viewBar should hide when parent settings row exists');
  assert.equal(viewGroup.children[0].textContent, '翻訳のみ(親)');
  assert.equal(viewGroup.children[1].textContent, '対照表示(親)');

  // Japanese locale strings applied (not degraded to English!)
  const fetchBtn = cfgUi.box.querySelector('[data-testid="thought-fetch-models-btn"]');
  const cacheBadge = cfgUi.box.querySelector('[data-testid="thought-cache-stats"]');
  assert.equal(fetchBtn.textContent, 'モデル一覧取得');
  assert.equal(cacheBadge.textContent, 'キャッシュ 3 件');

  // Switch to Cantonese (yue) & Traditional Chinese (zh-TW) dynamically
  docEl.setAttribute('data-ag-cs-lang', 'yue');
  cfgUi.onLanguageChanged('yue');
  assert.equal(cacheBadge.textContent, '快取 3 條');

  docEl.setAttribute('data-ag-cs-lang', 'zh-TW');
  cfgUi.onLanguageChanged('zh-TW');
  assert.equal(fetchBtn.textContent, '擷取模型清單');
  assert.equal(cacheBadge.textContent, '快取 3 筆');

  // Simulate JSON config import updating backend store (including 'tech' alias -> normalized 'technical') and calling reloadConfig()
  backendConfig = {
    ok: true,
    stylePreset: 'tech',
    viewMode: 'bilingual',
    customPrompt: 'Imported custom system prompt',
    activeProfileId: 'imported_ollama',
    profiles: [
      {
        id: 'imported_ollama',
        name: 'Imported Local vLLM',
        baseUrl: 'http://127.0.0.1:8000/v1',
        model: 'Qwen/Qwen3-8B',
        hasApiKey: false,
      },
    ],
  };

  await cfgUi.reloadConfig();

  const nameInput = cfgUi.box.querySelector('[data-testid="thought-prof-name"]');
  const urlInput = cfgUi.box.querySelector('[data-testid="thought-base-url"]');
  const modelInput = cfgUi.box.querySelector('[data-testid="thought-model-input"]');
  const promptTa = cfgUi.box.querySelector('[data-testid="thought-custom-prompt"]');
  assert.equal(nameInput.value, 'Imported Local vLLM');
  assert.equal(urlInput.value, 'http://127.0.0.1:8000/v1');
  assert.equal(modelInput.value, 'Qwen/Qwen3-8B');
  assert.equal(promptTa.value, 'Imported custom system prompt');
});

test('Phase 2 TS-1~TS-8 security & lifecycle audit: SSRF/redirect defense, key revocation, live SSE abort + 96K cap, Omni fallback & 600K storage budget', async () => {
  // 1) TS-3: Block cloud metadata SSRF, 0.0.0.0, and dangerous non-HTTP ports
  assert.equal(normalizeOpenAiBaseUrl('http://169.254.169.254/latest/meta-data/'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://100.100.100.200/latest/meta-data/'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://metadata.google.internal/computeMetadata/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://0.0.0.0:11434/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:6379/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:22/v1'), 'https://api.openai.com/v1');
  assert.equal(isKeylessAllowedEndpoint('http://169.254.169.254/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('http://100.100.100.200/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('http://0.0.0.0:8000/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('http://127.0.0.1:6379/v1'), false);

  // 2) TS-4: Extended secret redaction patterns (Groq, HF, Perplexity, NVIDIA, JWT Bearer, URL api_key, short secret)
  const gskTok = 'gsk_' + 'abcdefghijklmnop1234';
  const hfTok = 'hf_' + 'abcdefghijklmnop5678';
  const pplxTok = 'pplx-' + 'abcdefghijklmnop9012';
  const nvTok = 'nvapi-' + 'abcdefghijklmnop3456';
  const redacted = redactSecrets(
    `Err: ${gskTok} | ${hfTok} | ${pplxTok} | ${nvTok} | Bearer eyJhbGci:a+b/c= | https://gw.example/v1?api_key=mysecret99&x=1 | pin=7788`,
    '7788'
  );
  assert.equal(redacted.includes('abcdefghijklmnop'), false);
  assert.equal(redacted.includes('mysecret99'), false);
  assert.equal(redacted.includes('7788'), false);
  assert.ok(redacted.includes('?api_key=***REDACTED***&x=1'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-thought-sec-'));
  try {
    const encoder = new TextEncoder();
    const seenRedirects = [];
    let streamSignalAborted = false;
    let streamBodyCancelled = false;

    const mockFetch = async (url, init = {}) => {
      seenRedirects.push(init.redirect);
      const u = String(url);
      if (u.includes('slow-abort')) {
        return await new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              streamSignalAborted = true;
              reject(new Error('Aborted by controller'));
            },
            { once: true }
          );
        });
      }
      if (u.includes('runaway-loop')) {
        // Emit > 110,000 chars to test MAX_STREAM_CHARS (96,000) cap
        let pushed = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (pushed >= 12) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }
            pushed++;
            const bigDelta = '我'.repeat(10000);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: bigDelta } }] })}\n\n`)
            );
          },
          cancel() {
            streamBodyCancelled = true;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '正常译文。' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const svc = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: mockFetch });
    const savedKey = 'sk-' + 'revocable-key-112233';
    svc.saveConfig({
      activeProfileId: 'default',
      profiles: [
        { id: 'default', name: 'Live Abort', baseUrl: 'http://127.0.0.1:11434/slow-abort/v1', apiKey: savedKey, model: 'qwen3' },
      ],
    });
    assert.equal(svc.getSanitizedConfig().profiles[0].hasApiKey, true);

    // 3) TS-5: Abort already-started inflight stream & immediately free concurrency slot
    const inflightProm = svc.translateThought({
      text: 'Long running thought block that should be aborted mid-flight cleanly.',
      mode: 'ai',
      requestId: 'req-live-sse',
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(svc.getQueueStats().active, 1);

    const abortRes = svc.cancelPending('req-live-sse');
    assert.equal(abortRes.cancelled, true);
    assert.equal(abortRes.abortedInflight, true);
    const settled = await inflightProm;
    assert.equal(settled.cancelled, true);
    assert.equal(streamSignalAborted, true);
    assert.equal(svc.getQueueStats().active, 0, 'Concurrency slot must release immediately on abort');
    assert.ok(seenRedirects.every((r) => r === 'error'), 'Every upstream fetch must enforce redirect: error');

    // 4) TS-5: Runaway SSE output capped at MAX_STREAM_CHARS (96,000)
    svc.saveConfig({
      activeProfileId: 'default',
      profiles: [{ id: 'default', name: 'Runaway', baseUrl: 'http://127.0.0.1:11434/runaway-loop/v1', apiKey: '', model: 'qwen3' }],
    });
    const runawayRes = await svc.translateThought({
      text: 'Testing runaway infinite repetition model output protection cap now.',
      mode: 'ai',
    });
    assert.equal(runawayRes.ok, true);
    assert.equal(runawayRes.text.length, MAX_STREAM_CHARS);
    assert.equal(streamBodyCancelled, true);

    // 5) TS-4 UI Key Revocation + TS-2 Badge Display Guard + TS-6 Omni Fallback + TS-7 600K Storage Budget
    svc.saveConfig({
      activeProfileId: 'default',
      profiles: [{ id: 'default', name: 'Default Keyed', baseUrl: 'https://api.openai.com/v1', apiKey: savedKey, model: 'gpt-4o-mini' }],
    });

    const clientSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'),
      'utf8'
    );
    const settingsUiSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
      'utf8'
    );

    const omniOpened = [];
    let omniSpanClicks = 0;

    const { doc, rootBody, localStorage, sandbox } = createMockDomEnv({
      __agPrismOmni: {
        openFile: async (filePath, opts) => {
          omniOpened.push({ filePath, opts });
        },
      },
      __agPrismThoughtBridge: {
        call: async (payload) => {
          if (payload.action === 'get-config') return svc.getSanitizedConfig();
          if (payload.action === 'save-config') return svc.saveConfig(payload);
          if (payload.action === 'get-cache') return { ok: true, entries: {} };
          return { ok: true };
        },
        translateStream: async () => ({
          ok: true,
          text: '已关联 `vendor/omni-viewer/omni-server.mjs#L114` 与独立 [架构图](file:///c:/project/arch.svg#L10)。',
          engine: 'ai',
        }),
      },
    });

    const btn = doc.createElement('button');
    btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Thought for 2s';
    const panel = doc.createElement('div');
    const p = doc.createElement('p');
    const omniSpan = doc.createElement('span');
    omniSpan.className = 'ag-omni-autolink';
    omniSpan.setAttribute('data-omni-path', 'vendor/omni-viewer/omni-server.mjs');
    omniSpan.setAttribute('data-omni-line-start', '114');
    omniSpan.textContent = 'vendor/omni-viewer/omni-server.mjs#L114';
    omniSpan.addEventListener('click', () => {
      omniSpanClicks++;
    });
    p.appendChild(doc.createTextNode('Checking path in '));
    p.appendChild(omniSpan);
    p.appendChild(doc.createTextNode(' before rendering diagram.'));
    panel.appendChild(p);
    btn.nextElementSibling = panel;
    rootBody.appendChild(btn);
    rootBody.appendChild(panel);

    vm.runInNewContext(clientSrc, sandbox);
    vm.runInNewContext(settingsUiSrc, sandbox);

    const api = sandbox.__agPrismThought;
    api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 60));

    // TS-2: Normal AI translation must set display:none on fallback badge (cannot be overridden by CSS inline-flex)
    const fbBadge = panel.querySelector('[data-testid="thought-fallback-badge"]');
    assert.equal(fbBadge.hidden, true);
    assert.equal(fbBadge.style.display, 'none');

    // TS-6: First pill delegates to original .ag-omni-autolink; second pill (no native <a>) falls back to __agPrismOmni.openFile!
    const pills = panel.querySelectorAll('.ag-prism-thought-file-pill');
    assert.equal(pills.length, 2);
    pills[0].dispatchClick();
    assert.equal(omniSpanClicks, 1);
    pills[1].dispatchClick();
    assert.equal(omniOpened.length, 1);
    assert.equal(omniOpened[0].filePath, 'c:/project/arch.svg');
    assert.equal(omniOpened[0].opts.lineStart, 10);

    // TS-4: Revoke/clear saved API key on single default profile via UI Clear button
    const cfgUi = sandbox.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
      mkEl: (tag, cls) => {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        return e;
      },
      btnClass: 'seg-btn',
      ui: {},
      getMode: () => 'ai',
      runGuardedMut: (fn) => fn(),
    });
    rootBody.appendChild(cfgUi.box);
    await new Promise((r) => setTimeout(r, 30));

    const clearKeyBtn = cfgUi.box.querySelector('[data-testid="thought-clear-key-btn"]');
    const saveBtn = cfgUi.box.querySelector('[data-testid="thought-save-btn"]');
    assert.ok(clearKeyBtn && clearKeyBtn.hidden === false);
    clearKeyBtn.dispatchClick();
    saveBtn.dispatchClick();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(svc.getSanitizedConfig().profiles[0].hasApiKey, false, 'Saved API key must be wiped from disk');

    // TS-7: Verify 600,000-char localStorage LRU budget & >32,000-char oversized entry skip
    for (let i = 0; i < 35; i++) {
      api.__memCache.set(`ai_tech_bulk_${i}`, '译'.repeat(24000));
    }
    api.__memCache.set('ai_tech_huge', '巨'.repeat(40000));
    api.destroy();
    const rawStored = localStorage.getItem('ag_prism_thought_zh_cache_v1') || '';
    assert.ok(rawStored.length > 0 && rawStored.length <= 630000, `Storage payload must respect 600K budget, got ${rawStored.length}`);
    assert.equal(rawStored.includes('ai_tech_huge'), false, 'Oversized >32K entry must stay memory-only');

    svc.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
