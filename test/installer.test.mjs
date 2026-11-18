import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function runExe(exePath, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout running ${path.basename(exePath)} ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(exePath)} exited with code ${code}`));
    });
  });
}

import { VALIDATORS, buildInstaller } from '../scripts/build-installer.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function createMockCdpServer() {
  const receivedCalls = [];
  const sockets = new Set();
  let prismMounted = false;
  let lastInjectedExpr = null;
  let lastRemovedExpr = null;

  function encodeWsTextFrame(str) {
    const payload = Buffer.from(str, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  function sendWsMessage(socket, obj) {
    if (!socket.destroyed) {
      socket.write(encodeWsTextFrame(JSON.stringify(obj)));
    }
  }

  function handleCdpCommand(socket, msg) {
    receivedCalls.push(msg);
    let result = {};
    if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
      result = { identifier: 'script-' + receivedCalls.length };
    } else if (msg.method === 'Runtime.evaluate') {
      const expr = msg.params && msg.params.expression ? msg.params.expression : '';
      if (expr.startsWith('Boolean(window.__agPrism') || expr === 'Boolean(window.__agClaudeStyle)') {
        result = { result: { type: 'boolean', value: prismMounted } };
      } else if (expr.includes('delete globalThis.__agCsUiMain')) {
        lastRemovedExpr = expr;
        prismMounted = false;
        result = { result: { type: 'object', value: { removed: 3 } } };
      } else if (expr.includes('const serverMeta = window.__agPrismOmniServerMeta')) {
        result = {
          result: {
            type: 'object',
            value: { ok: true, status: 'mounted' },
          },
        };
      } else {
        lastInjectedExpr = expr;
        prismMounted = true;
        result = {
          result: {
            type: 'object',
            value: { version: cdp.PLUGIN_VERSION, status: 'ok', state: { mounted: true } },
          },
        };
      }
    }
    sendWsMessage(socket, { id: msg.id, result });
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const addr = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'PAGE_1',
            type: 'page',
            title: 'Antigravity',
            url: 'https://127.0.0.1:9999/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/PAGE_1`,
          },
          {
            id: 'USER_PREVIEW_1',
            type: 'page',
            title: 'AI Rap Video Generator',
            url: 'http://127.0.0.1:3115/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/USER_PREVIEW_1`,
          },
          {
            id: 'EXT_WEB_1',
            type: 'page',
            title: 'Antigravity Spoofed External',
            url: 'https://example.com/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/EXT_WEB_1`,
          },
          {
            id: 'DEVTOOLS_1',
            type: 'page',
            title: 'DevTools',
            url: 'devtools://devtools/bundled/inspector.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/DEVTOOLS_1`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    let buf = Buffer.alloc(0);
    let fragChunks = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) return;
          payloadLen = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + payloadLen) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ mask[i & 3];
          }
          payload = unmasked;
        }
        buf = buf.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          socket.write(pong);
          continue;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          fragChunks.push(payload);
          if (fin) {
            const fullText = Buffer.concat(fragChunks).toString('utf8');
            fragChunks = [];
            try {
              const msg = JSON.parse(fullText);
              handleCdpCommand(socket, msg);
            } catch {}
          }
        }
      }
    });
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    emitBindingCalled(name, payload) {
      for (const s of sockets) {
        sendWsMessage(s, {
          method: 'Runtime.bindingCalled',
          params: { name, payload: JSON.stringify(payload) },
        });
      }
    },
    getCalls() {
      return receivedCalls;
    },
    getLastInjectedExpr() {
      return lastInjectedExpr;
    },
    getLastRemovedExpr() {
      return lastRemovedExpr;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitFor(fn, timeoutMs = 6000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw lastErr || new Error('Timed out waiting for condition');
}

test('installer manifest validators match inject.js, cdp.js, and config.example.json 100%', () => {
  const injectSrc = fs.readFileSync(path.join(ROOT_DIR, 'inject.js'), 'utf8');
  assert.ok(injectSrc.includes('validateConfigEntry'), 'inject.js must delegate directly to cdp.validateConfigEntry');
  assert.deepEqual(Object.keys(VALIDATORS).sort(), Object.keys(cdp.VALIDATORS).sort());

  const exampleCfg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.example.json'), 'utf8'));
  assert.deepEqual(Object.keys(exampleCfg).sort(), Object.keys(cdp.VALIDATORS).sort());
  for (const k of Object.keys(cdp.VALIDATORS)) {
    assert.ok(k in cdp.DEFAULT_CONFIG, `DEFAULT_CONFIG includes ${k}`);
    assert.ok(k in exampleCfg, `config.example.json includes ${k}`);
  }

  assert.equal(cdp.STYLE_ID, 'ag-prism-css');
  assert.equal(cdp.DEFAULT_CONFIG.palette, 'obsidian');
  assert.equal(cdp.DEFAULT_CONFIG.lightPreset, 'crystal');
  assert.equal(cdp.DEFAULT_CONFIG.motionLevel, 'ultra');
  assert.equal(cdp.DEFAULT_CONFIG.telemetryModule, 'auto');
  assert.equal(cdp.DEFAULT_CONFIG.effortSliderModule, 'auto');

  assert.deepEqual(VALIDATORS.palette, ['host', 'obsidian', 'warm', 'claude']);
  assert.deepEqual(VALIDATORS.lightPreset, ['crystal', 'alabaster']);
  assert.deepEqual(VALIDATORS.motionLevel, ['off', 'subtle', 'standard', 'ultra']);
  assert.deepEqual(VALIDATORS.telemetryModule, ['auto', 'on', 'off']);
  assert.deepEqual(VALIDATORS.effortSliderModule, ['auto', 'on', 'off']);

  assert.equal(exampleCfg.palette, 'obsidian');
  assert.equal(exampleCfg.lightPreset, 'crystal');
  assert.equal(exampleCfg.motionLevel, 'ultra');
  assert.equal(exampleCfg.telemetryModule, 'auto');
  assert.equal(exampleCfg.effortSliderModule, 'auto');

  // Wave 2: 6 new settings + host-workbench-enhancer.js registration parity
  assert.deepEqual(VALIDATORS.accentTone, ['follow', 'cobalt', 'iris', 'amber', 'mono']);
  assert.deepEqual(VALIDATORS.cornerStyle, ['sharp', 'balanced', 'soft']);
  assert.deepEqual(VALIDATORS.codeFont, ['default', 'jetbrains', 'cascadia', 'sfmono']);
  assert.equal(VALIDATORS.codeLigatures, 'boolean');
  assert.deepEqual(VALIDATORS.ambientIntensity, ['0', '35', '70', '100']);
  assert.deepEqual(VALIDATORS.thoughtView, ['immersive', 'bilingual']);
  assert.equal(exampleCfg.accentTone, 'follow');
  assert.equal(exampleCfg.cornerStyle, 'balanced');
  assert.equal(exampleCfg.codeFont, 'default');
  assert.equal(exampleCfg.codeLigatures, false);
  assert.equal(exampleCfg.ambientIntensity, '100');
  assert.equal(exampleCfg.thoughtView, 'immersive');
  assert.ok(cdp.RUNTIME_PARTS.includes('host-workbench-enhancer.js'));
  assert.ok(cdp.SYNC_ROOT_FILES.includes('host-workbench-enhancer.js'));
});

test(
  'installer.exe builds cleanly and executes full install, native Sidecar deployment, CDP injection, patch-batch sync, polite daemon yield, upgrade, and uninstall lifecycle',
  { skip: process.platform !== 'win32' ? 'Windows-only installer.exe E2E test' : false },
  async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-e2e-'));
    const installerExe = path.join(workDir, 'installer.exe');
    const installDir = path.join(workDir, 'installed');
    const nativePluginDir = path.join(workDir, 'plugins', 'obsidian-prism');
    const outInstall = path.join(workDir, 'install.json');
    const outUpgrade = path.join(workDir, 'upgrade.json');
    const outUninstall = path.join(workDir, 'uninstall.json');
    const outStatus = path.join(workDir, 'status.json');
    const mockCdp = createMockCdpServer();

    try {
      const buildRes = buildInstaller({ outputPath: installerExe });
      assert.ok(fs.existsSync(installerExe));
      assert.ok(buildRes.sizeBytes > 50 * 1024);

      const port = await mockCdp.start();

      // 1. Check --status CLI
      await runExe(
        installerExe,
        ['--status', '--install-dir', installDir, '--plugin-dir', nativePluginDir, '--cdp-port', String(port), '--out', outStatus],
        10000
      );
      const st = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
      assert.equal(st.installed, false);
      assert.equal(st.nativePluginInstalled, false);
      assert.equal(st.cdpPort, port);

      // 2. Run --silent install against mock CDP server with isolated --plugin-dir
      await runExe(
        installerExe,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--plugin-dir',
          nativePluginDir,
          '--cdp-port',
          String(port),
          '--out',
          outInstall,
        ],
        20000
      );

      const installResult = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
      assert.equal(installResult.ok, true);
      assert.equal(installResult.nativePluginDeployed, true);
      assert.equal(installResult.preservedExistingConfig, false);
      assert.deepEqual(installResult.injectedPages, ['Antigravity']);
      assert.ok(fs.existsSync(path.join(installDir, 'obsidian-prism-watcher.exe')));
      assert.ok(fs.existsSync(path.join(installDir, 'obsidian-prism-installer.exe')));
      assert.ok(fs.existsSync(path.join(installDir, 'manifest.json')));
      assert.ok(fs.existsSync(path.join(installDir, 'host-workbench-enhancer.js')));
      assert.ok(fs.existsSync(path.join(installDir, 'vendor', 'pulse-dashboard', 'inline-fallback.js')));
      assert.ok(fs.existsSync(path.join(installDir, 'vendor', 'effort-slider', 'slider-coexist.js')));
      assert.ok(fs.existsSync(path.join(installDir, '.watch.pid')));

      // Verify full 5-channel native Sidecar plugin directory deployed cleanly
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'plugin.json')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'sidecars', 'daemon', 'sidecar.json')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'sidecars', 'daemon', 'main.mjs')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'vendor', 'thought-translator', 'translator-service.mjs')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'vendor', 'pulse-dashboard', 'sidecars', 'panel', 'store.mjs')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'host-workbench-enhancer.js')));
      assert.ok(fs.existsSync(path.join(nativePluginDir, 'config.json')));

      const activeCfgPath = path.join(ROOT_DIR, 'config.example.json');
      const expectedCfg = fs.readFileSync(activeCfgPath, 'utf8');
      assert.equal(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'), expectedCfg);

      // Verify exact CDP sequence & valid JS payload
      const calls = mockCdp.getCalls();
      assert.ok(calls.some((c) => c.method === 'Page.enable'));
      assert.ok(calls.some((c) => c.method === 'Runtime.enable'));
      assert.ok(
        calls.some(
          (c) =>
            c.method === 'Runtime.addBinding' &&
            c.params &&
            c.params.name === cdp.SETTING_BINDING
        )
      );
      assert.ok(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'));
      const injectedExpr = mockCdp.getLastInjectedExpr();
      assert.ok(injectedExpr, 'injected expression was sent over CDP');
      assert.doesNotThrow(() => new vm.Script(injectedExpr), 'C# injected JS compiles cleanly');

      // Verify codeHash parity and active config values between Node cdp.js and C# watcher
      const nodeExpr = cdp.buildInjectExpression();
      const nodeHash = nodeExpr.match(/"codeHash":"([^"]+)"/)[1];
      const csHash = injectedExpr.match(/"codeHash":"([^"]+)"/)[1];
      assert.equal(csHash, nodeHash);
      const expectedCfgObj = JSON.parse(expectedCfg);
      assert.ok(injectedExpr.includes(`"palette":"${expectedCfgObj.palette}"`));
      assert.ok(injectedExpr.includes(`"lightPreset":"${expectedCfgObj.lightPreset}"`));

      // Verify watcher --once CLI mode works standalone against CDP
      const watcherExe = path.join(installDir, 'obsidian-prism-watcher.exe');
      const onceOut = path.join(workDir, 'once.json');
      await runExe(
        watcherExe,
        ['--once', '--dir', installDir, '--cdp-port', String(port), '--out', onceOut],
        10000
      );
      const onceResult = JSON.parse(fs.readFileSync(onceOut, 'utf8'));
      assert.equal(onceResult.ok, true);
      assert.deepEqual(onceResult.pages, ['Antigravity']);

      // 3. Test Runtime.bindingCalled (single + patch-batch) -> config.json update & hot-reload
      const beforeCallCount = mockCdp.getCalls().length;
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'hacker-invalid' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'lightPreset', value: 'invalid-preset' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'lightPreset', value: 'alabaster' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'warm' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, {
        action: 'patch-batch',
        entries: {
          accentTone: 'iris',
          cornerStyle: 'soft',
          ambientIntensity: '70',
          thoughtView: 'bilingual',
          codeLigatures: true,
        },
      });

      const updatedCfg = await waitFor(() => {
        const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
        return parsed.palette === 'warm' &&
          parsed.lightPreset === 'alabaster' &&
          parsed.accentTone === 'iris' &&
          parsed.cornerStyle === 'soft' &&
          parsed.ambientIntensity === '70' &&
          parsed.thoughtView === 'bilingual' &&
          parsed.codeLigatures === true
          ? parsed
          : null;
      });
      assert.equal(updatedCfg.palette, 'warm');
      assert.equal(updatedCfg.lightPreset, 'alabaster');
      assert.equal(updatedCfg.accentTone, 'iris');
      assert.equal(updatedCfg.ambientIntensity, '70');

      const syncedPluginCfg = JSON.parse(fs.readFileSync(path.join(nativePluginDir, 'config.json'), 'utf8'));
      assert.equal(syncedPluginCfg.accentTone, 'iris');
      assert.equal(syncedPluginCfg.thoughtView, 'bilingual');

      // Confirm hot-reload fired on watcher
      await waitFor(() => {
        const newer = mockCdp.getCalls().slice(beforeCallCount);
        return newer.some((c) => c.method === 'Page.removeScriptToEvaluateOnNewDocument') ? true : null;
      });

      // 3b. Test Watcher polite yield when native Sidecar daemon (.daemon.pid) is alive & auto-resume on exit
      const daemonPidPath = path.join(nativePluginDir, '.daemon.pid');
      const watchLogPath = path.join(installDir, 'watch.log');
      fs.writeFileSync(daemonPidPath, JSON.stringify({ pid: process.pid }), 'utf8');
      await waitFor(() => {
        const logText = fs.existsSync(watchLogPath) ? fs.readFileSync(watchLogPath, 'utf8') : '';
        return logText.includes('检测到原生 Sidecar Daemon 运行中') ? true : null;
      }, 6000, 120);
      fs.unlinkSync(daemonPidPath);
      await waitFor(() => {
        const logText = fs.existsSync(watchLogPath) ? fs.readFileSync(watchLogPath, 'utf8') : '';
        return logText.includes('原生 Sidecar Daemon 已离线') ? true : null;
      }, 6000, 120);

      // 4. Test re-install / upgrade preserves existing user config.json across both dirs
      await runExe(
        installerExe,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--plugin-dir',
          nativePluginDir,
          '--cdp-port',
          String(port),
          '--out',
          outUpgrade,
        ],
        20000
      );
      const upgradeResult = JSON.parse(fs.readFileSync(outUpgrade, 'utf8'));
      assert.equal(upgradeResult.ok, true);
      assert.equal(upgradeResult.preservedExistingConfig, true);
      const cfgAfterUpgrade = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
      assert.equal(cfgAfterUpgrade.palette, 'warm');
      assert.equal(cfgAfterUpgrade.lightPreset, 'alabaster');
      assert.equal(cfgAfterUpgrade.accentTone, 'iris');

      // 5. Test --uninstall from installed copy inside installDir (exercises self-delete, plugin cleanup & CDP cleanup)
      const installedSelf = path.join(installDir, 'obsidian-prism-installer.exe');
      await runExe(
        installedSelf,
        [
          '--uninstall',
          '--silent',
          '--no-autostart',
          '--install-dir',
          installDir,
          '--plugin-dir',
          nativePluginDir,
          '--cdp-port',
          String(port),
          '--out',
          outUninstall,
        ],
        20000
      );

      const uninstallResult = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
      assert.equal(uninstallResult.ok, true);
      assert.equal(uninstallResult.selfDeleteScheduled, true);
      assert.deepEqual(uninstallResult.injectedPages, ['Antigravity']);
      assert.equal(mockCdp.getLastRemovedExpr(), cdp.REMOVE_EXPRESSION);
      assert.equal(fs.existsSync(nativePluginDir), false);

      await waitFor(() => (!fs.existsSync(installDir) ? true : null), 8000, 150);
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      try {
        const pidPath = path.join(installDir, '.watch.pid');
        if (fs.existsSync(pidPath)) {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
          if (pid) process.kill(pid);
        }
      } catch {}
      await mockCdp.close();
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  }
);
