import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import * as arch from '../sidecars/daemon/conversation-archive.mjs';
import {
  PrismDaemon,
  SIDEBAR_BINDING,
  writeFileAtomicSync,
} from '../sidecars/daemon/main.mjs';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const installPluginTool = require(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'));

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('security-daemon 1: isLanguageServerRunning detects platform-suffixed Windows/POSIX host processes, excludes self, and fails closed on query errors', () => {
  // Windows 全量 CSV：命中 language_server_windows_x64.exe / arm64 / Antigravity.exe / agy.exe
  const cleanWinCsv = [
    '"System Idle Process","0","Services","0","8 K"',
    '"node.exe","4321","Console","1","45,120 K"',
    '"explorer.exe","1200","Console","1","62,000 K"',
  ].join('\r\n');
  assert.equal(
    arch.isLanguageServerRunning({ platform: 'win32', exec: () => cleanWinCsv }),
    false,
    '无关进程列表应返回 false'
  );

  for (const img of [
    'language_server.exe',
    'language_server_windows_x64.exe',
    'LANGUAGE_SERVER_WINDOWS_ARM64.EXE',
    'Antigravity.exe',
    'agy.exe',
  ]) {
    const csvWithTarget = `${cleanWinCsv}\r\n"${img}","9876","Console","1","512,000 K"\r\n`;
    assert.equal(
      arch.isLanguageServerRunning({ platform: 'win32', exec: () => csvWithTarget }),
      true,
      `Windows 必须检出目标进程 ${img}`
    );
  }

  // Windows 异常输出、空输出、命令失败 -> 严格 fail-closed (true)
  assert.equal(arch.isLanguageServerRunning({ platform: 'win32', exec: () => '' }), true);
  assert.equal(arch.isLanguageServerRunning({ platform: 'win32', exec: () => 'ERROR: Access denied.' }), true);
  assert.equal(
    arch.isLanguageServerRunning({
      platform: 'win32',
      exec: () => {
        const e = new Error('tasklist failed');
        e.status = 1;
        throw e;
      },
    }),
    true,
    'Windows 进程查询非零退出必须 fail-closed'
  );

  // POSIX ps 输出：检出 language_server 与 Antigravity 主进程，同时排除归档脚本自身命令行
  const cleanPosixPs = [
    '    1 /sbin/launchd',
    '  500 /usr/local/bin/node /tmp/demo/sidecars/daemon/conversation-archive.mjs --archive',
    '  499 /usr/bin/env bash /tmp/antigravity/conversations_archive/archive-subagents.sh',
    '  610 /usr/bin/vim /tmp/notes/readme.md',
  ].join('\n');
  assert.equal(
    arch.isLanguageServerRunning({ platform: 'darwin', selfPid: 500, selfPpid: 499, exec: () => cleanPosixPs }),
    false,
    'POSIX 应排除当前归档脚本与父包装脚本，避免自误判'
  );

  for (const procLine of [
    '  901 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9222',
    '  902 /Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)',
    '  903 /opt/antigravity/bin/language_server_linux_x64 --standalone',
    '  904 /Users/demo/bin/language_server_macos_arm64 --port=42000',
    '  905 /usr/share/antigravity/antigravity --no-sandbox',
    '  906 /usr/local/bin/agy --hub',
  ]) {
    const psWithTarget = `${cleanPosixPs}\n${procLine}\n`;
    assert.equal(
      arch.isLanguageServerRunning({ platform: 'linux', selfPid: 500, selfPpid: 499, exec: () => psWithTarget }),
      true,
      `POSIX 必须检出目标进程: ${procLine}`
    );
  }

  // POSIX 空输出 / 非法输出 / 进程查询报错 -> fail-closed (true)
  assert.equal(arch.isLanguageServerRunning({ platform: 'linux', exec: () => '' }), true);
  assert.equal(arch.isLanguageServerRunning({ platform: 'linux', exec: () => 'ps: permission denied' }), true);
  assert.equal(
    arch.isLanguageServerRunning({
      platform: 'linux',
      exec: () => {
        const e = new Error('ps failed');
        e.status = 1;
        throw e;
      },
    }),
    true
  );
});

test('security-daemon 2: parseCliArgs rejects invalid numeric flags (fail-closed) and scanConversationStorage falls back to safe defaults instead of zeroing thresholds', () => {
  // 1) parseCliArgs 非法参数全部抛错拒绝
  const invalidArgLists = [
    ['--subagent-hours='],
    ['--subagent-hours=   '],
    ['--subagent-hours=abc'],
    ['--subagent-hours=-1'],
    ['--subagent-hours=Infinity'],
    ['--subagent-hours=NaN'],
    ['--subagent-hours'],
    ['--main-days='],
    ['--main-days=abc'],
    ['--main-days=-0.5'],
    ['--main-days=1=2'],
    ['--main-days'],
    ['--keep-main='],
    ['--keep-main=abc'],
    ['--keep-main=-5'],
    ['--keep-main=1.5'],
    ['--keep-main=Infinity'],
    ['--keep-main'],
  ];
  for (const argv of invalidArgLists) {
    assert.throws(
      () => arch.parseCliArgs(argv),
      /Invalid CLI option/,
      `非法 CLI 参数必须直接抛错: ${JSON.stringify(argv)}`
    );
  }

  // 合法参数（含显式 0 与小数小时/天数）正常解析
  const okOpts = arch.parseCliArgs(['--archive', '--subagent-hours=0.5', '--main-days=0', '--keep-main=0']);
  assert.equal(okOpts.subagentHours, 0.5);
  assert.equal(okOpts.mainDays, 0);
  assert.equal(okOpts.keepRecentMain, 0);

  // CLI 真实入口对非法参数以非零退出码退出
  const scriptPath = path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs');
  assert.throws(
    () => {
      execFileSync(process.execPath, [scriptPath, '--scan', '--keep-main=abc'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
    (err) => err && err.status !== 0,
    'CLI 遇到非法阈值参数必须以非零状态码退出'
  );

  // 2) scanConversationStorage 对非有限/负值/空字符串参数回退安全默认值（6 / 14 / 20），严禁静默清零
  const tmpRoot = makeTempDir('ag-prism-sec-thresh-');
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    const archiveDir = path.join(tmpRoot, 'conversations_archive');
    fs.mkdirSync(convDir, { recursive: true });

    const now = Date.now();
    const recentSubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const recentMainId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const oldMainId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const twoHoursAgo = new Date(now - 2 * 3600000);
    const fiveDaysAgo = new Date(now - 5 * 86400000);
    const thirtyDaysAgo = new Date(now - 30 * 86400000);

    for (const [id, dt] of [
      [recentSubId, twoHoursAgo],
      [recentMainId, fiveDaysAgo],
      [oldMainId, thirtyDaysAgo],
    ]) {
      const fp = path.join(convDir, `${id}.db`);
      fs.writeFileSync(fp, 'db-bytes', 'utf8');
      fs.utimesSync(fp, dt, dt);
    }

    const summaries = {
      [recentSubId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: twoHoursAgo.toISOString(),
        trajectoryMetadata: { parentConversationId: recentMainId },
      },
      [recentMainId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: fiveDaysAgo.toISOString(),
        trajectoryMetadata: {},
      },
      [oldMainId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: thirtyDaysAgo.toISOString(),
        trajectoryMetadata: {},
      },
    };

    for (const badVal of [NaN, Infinity, -10, '', '   ', null, false, 'not-a-num']) {
      const scan = arch.scanConversationStorage({
        convDir,
        archiveDir,
        summaries,
        subagentMaxAgeHours: badVal,
        mainMaxAgeDays: badVal,
        keepRecentMain: badVal,
        now,
      });
      assert.equal(
        scan.archivableSubagentCount,
        0,
        `非法 subagentMaxAgeHours=${String(badVal)} 必须回退默认 6h（2h 旧子代理不得被列为可归档）`
      );
      assert.equal(
        scan.archivableOldMainCount,
        0,
        `非法 mainMaxAgeDays/keepRecentMain=${String(badVal)} 必须回退默认 14d/20（不得清空主对话保护）`
      );
    }

    // 显式传入合法 0 仍按预期生效
    const explicitZero = arch.scanConversationStorage({
      convDir,
      archiveDir,
      summaries,
      subagentMaxAgeHours: 0,
      mainMaxAgeDays: 0,
      keepRecentMain: 0,
      now,
    });
    assert.equal(explicitZero.archivableSubagentCount, 1);
    assert.equal(explicitZero.archivableOldMainCount, 2);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 3: conversation-archive POSIX helper scripts tighten permissions to 0o700', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs'), 'utf8');
  assert.equal(src.includes('0o755'), false, 'POSIX 辅助脚本不得保留 0o755 权限');
  assert.ok(src.includes('atomicWriteTextExclusiveSync(archiveShPath, archiveSh, 0o700)'));
  assert.ok(src.includes('atomicWriteTextExclusiveSync(restoreShPath, restoreSh, 0o700)'));

  if (process.platform !== 'win32') {
    const tmpRoot = makeTempDir('ag-prism-sec-mode-');
    try {
      const helpers = arch.writeHelperScripts({
        scriptPath: path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs'),
        archiveDir: path.join(tmpRoot, 'archive'),
      });
      assert.equal(fs.statSync(helpers.archiveScriptPath).mode & 0o777, 0o700);
      assert.equal(fs.statSync(helpers.restoreScriptPath).mode & 0o777, 0o700);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
});

test('security-daemon 4: verifyAndHealEntry serializes via _runEntryExclusive to prevent concurrent CDP race', async () => {
  const daemon = Object.create(PrismDaemon.prototype);
  daemon.codeHash = 'hash-v1';
  daemon.injectExpr = '/* inject */';
  daemon.omniExpr = '';
  daemon.sidebarExpr = '';
  daemon.browserSession = null;
  daemon.sessions = new Map();
  daemon.cdp = {
    PLUGIN_VERSION: '1.0.3',
    SETTING_BINDING: '__agPrismSet',
    readConfig: () => ({ sidebarStudio: 'off' }),
  };
  daemon.log = () => {};
  daemon.ensureOmniServer = async () => null;
  daemon.ensureSidebarService = async () => null;
  daemon._hasOmniClientFile = () => false;
  daemon._hasSafeV2SidebarClientFile = () => false;

  let activeCdpOps = 0;
  let maxConcurrentCdpOps = 0;
  const trace = [];
  const entry = {
    wsUrl: 'ws://127.0.0.1:19999/devtools/page/serial-1',
    pageId: 'serial-1',
    title: 'Synthetic Window',
    url: 'vscode-file://vscode-app/workbench.html',
    scriptId: 'sc-1',
    omniScriptId: null,
    sidebarScriptId: null,
    sidebarBindingAdded: false,
    sidebarMounted: false,
    sidebarHostVerified: true,
    sidebarDocument: 0,
    lastVerifyAt: 0,
    healthyStreak: 0,
    verifyDirty: true,
    lastVerifiedCodeHash: '',
    _opChain: Promise.resolve(),
    session: {
      closed: false,
      close() {
        this.closed = true;
      },
      async send() {
        return {};
      },
      async evaluate() {
        activeCdpOps += 1;
        maxConcurrentCdpOps = Math.max(maxConcurrentCdpOps, activeCdpOps);
        trace.push('eval:enter');
        await new Promise((r) => setTimeout(r, 25));
        trace.push('eval:exit');
        activeCdpOps -= 1;
        return {
          ready: true,
          isHostDom: true,
          href: 'vscode-file://vscode-app/workbench.html',
          prismAttr: '1.0.3',
          hasPrism: true,
          hasRepoBridge: true,
          hasThoughtBridge: true,
          hasUsageBridge: true,
          hasOmniBridge: true,
          hasOmniServerMeta: true,
          hasOmni: false,
          omniMode: 'off',
          hasSidebarBridge: false,
          hasSidebar: false,
          sidebarMode: 'off',
          codeHash: 'hash-v1',
          hasLegacyCss: false,
          needsDashboardSync: false,
        };
      },
    },
  };

  // 同时发起互斥队列操作与 verifyAndHealEntry，验证绝不并发交叉执行
  const exclusiveOp = daemon._runEntryExclusive(entry, async () => {
    activeCdpOps += 1;
    maxConcurrentCdpOps = Math.max(maxConcurrentCdpOps, activeCdpOps);
    trace.push('exclusive:enter');
    await new Promise((r) => setTimeout(r, 30));
    trace.push('exclusive:exit');
    activeCdpOps -= 1;
  });
  const healOp1 = daemon.verifyAndHealEntry(entry, true);
  const healOp2 = daemon.verifyAndHealEntry(entry, true);

  await Promise.all([exclusiveOp, healOp1, healOp2]);
  assert.equal(maxConcurrentCdpOps, 1, 'verifyAndHealEntry 必须与 _runEntryExclusive 严格串行化，最大并发必须为 1');
  assert.deepEqual(trace, [
    'exclusive:enter',
    'exclusive:exit',
    'eval:enter',
    'eval:exit',
    'eval:enter',
    'eval:exit',
  ]);
});

test('security-daemon 5: _handleStorageAction refreshes on NaN updatedAt and protects ensureLsClient via _telemetryInFlight', async () => {
  const tmpRoot = makeTempDir('ag-prism-sec-storage-');
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    const archiveDir = path.join(tmpRoot, 'conversations_archive');
    fs.mkdirSync(convDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

    const subId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    fs.writeFileSync(path.join(convDir, `${subId}.db`), 'synthetic-sub-db', 'utf8');

    // 写入包含非法 updatedAt 的 catalog index（Date.parse 结果为 NaN）
    const indexPath = path.join(archiveDir, '.last-catalog-index.json');
    fs.writeFileSync(
      indexPath,
      JSON.stringify({
        schema: 1,
        updatedAt: 'not-a-valid-timestamp',
        count: 0,
        entries: {},
      }),
      'utf8'
    );

    const daemon = Object.create(PrismDaemon.prototype);
    daemon.rootDir = tmpRoot;
    daemon._storageHealthCache = null;
    daemon._storageHealthAt = 0;
    daemon._telemetryInFlight = 0;
    daemon._lastTelemetryActivityAt = 0;
    daemon._lazyStore = null;
    daemon._lazyUsage = null;
    daemon._backendSummariesCache = null;

    let lsCalls = 0;
    let disposedCount = 0;
    let inFlightObserved = 0;
    let releaseDuringFlightSoft = null;
    let releaseDuringFlightForce = null;

    const fakeClient = {
      dispose() {
        disposedCount += 1;
      },
      async call(method) {
        assert.equal(method, 'GetAllCascadeTrajectories');
        lsCalls += 1;
        inFlightObserved = daemon._telemetryInFlight;
        // 模拟并发 tick() 在 RPC 飞行中尝试释放空闲客户端
        releaseDuringFlightSoft = daemon._releaseIdleTelemetry(false);
        releaseDuringFlightForce = daemon._releaseIdleTelemetry(true);
        return {
          trajectorySummaries: {
            [subId]: {
              status: 'CASCADE_RUN_STATUS_IDLE',
              stepCount: 12,
              lastModifiedTime: new Date(Date.now() - 10 * 3600000).toISOString(),
              trajectoryMetadata: { parentConversationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
            },
          },
        };
      },
    };
    daemon._lazyLsClient = fakeClient;
    daemon.ensureLsClient = async () => fakeClient;

    const res = await daemon._handleStorageAction('storage-health', { convDir, archiveDir });
    assert.equal(res.ok, true);
    assert.equal(lsCalls, 1, '非法 updatedAt (NaN) 必须视为过期并触发索引刷新');
    assert.equal(inFlightObserved, 1, 'ensureLsClient RPC 期间 _telemetryInFlight 必须递增为 1');
    assert.equal(releaseDuringFlightSoft, false, 'RPC 飞行期间 _releaseIdleTelemetry(false) 必须被拦截');
    assert.equal(releaseDuringFlightForce, false, 'RPC 飞行期间 _releaseIdleTelemetry(true) 也必须被拦截');
    assert.equal(disposedCount, 0, 'RPC 飞行期间绝不可 dispose 正在使用的客户端');
    assert.equal(daemon._telemetryInFlight, 0, 'RPC 结束后 _telemetryInFlight 必须归 0');
    assert.ok(daemon._lastTelemetryActivityAt > 0, 'RPC 结束后必须刷新 _lastTelemetryActivityAt');

    // 验证落盘索引的 updatedAt 已刷新为有效时间戳
    const refreshed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.ok(Number.isFinite(Date.parse(refreshed.updatedAt)), '刷新后索引 updatedAt 必须为有效时间戳');
    assert.equal(refreshed.count, 1);

    // 验证 RPC 抛错时 finally 仍能安全释放 _telemetryInFlight
    daemon._storageHealthCache = null;
    daemon.ensureLsClient = async () => {
      throw new Error('simulated ls disconnect');
    };
    fs.writeFileSync(
      indexPath,
      JSON.stringify({ schema: 1, updatedAt: 'invalid-again', count: 0, entries: {} }),
      'utf8'
    );
    const errFallbackRes = await daemon._handleStorageAction('storage-health', { convDir, archiveDir });
    assert.equal(errFallbackRes.ok, true);
    assert.equal(daemon._telemetryInFlight, 0, 'RPC 异常时 finally 必须归零 _telemetryInFlight');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 6: writeFileAtomicSync rejects symlink parent directory and symlink target file (including before copyFileSync fallback)', () => {
  const tmpRoot = makeTempDir('ag-prism-sec-atomic-');
  try {
    const realDir = path.join(tmpRoot, 'real-dir');
    const outsideDir = path.join(tmpRoot, 'outside-dir');
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    // 正常写入不存在目标文件（ENOENT 忽略）
    const normalFile = path.join(realDir, 'config.json');
    writeFileAtomicSync(normalFile, '{"ok":true}\n', { mode: 0o600 });
    assert.equal(fs.readFileSync(normalFile, 'utf8'), '{"ok":true}\n');
    assert.equal(
      fs.readdirSync(realDir).some((f) => f.endsWith('.tmp')),
      false,
      '原子写完成后不得残留 .tmp 文件'
    );

    // 父目录为符号链接/junction 时必须拒绝写入
    const linkedParent = path.join(tmpRoot, 'linked-parent');
    let dirLinkCreated = false;
    try {
      fs.symlinkSync(outsideDir, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
      dirLinkCreated = true;
    } catch {}
    if (dirLinkCreated) {
      const victimInOutside = path.join(outsideDir, 'config.json');
      fs.writeFileSync(victimInOutside, 'ORIGINAL_SECRET', 'utf8');
      assert.throws(
        () => writeFileAtomicSync(path.join(linkedParent, 'config.json'), 'OVERWRITTEN'),
        /symbolic link/i,
        '符号链接/junction 父目录必须被 writeFileAtomicSync 拒绝'
      );
      assert.equal(fs.readFileSync(victimInOutside, 'utf8'), 'ORIGINAL_SECRET');
    }

    // 目标文件为符号链接时必须拒绝覆盖
    const victimFile = path.join(outsideDir, 'victim.json');
    fs.writeFileSync(victimFile, 'KEEP_INTACT', 'utf8');
    const linkedTarget = path.join(realDir, 'linked-config.json');
    let fileLinkCreated = false;
    try {
      fs.symlinkSync(victimFile, linkedTarget, 'file');
      fileLinkCreated = true;
    } catch {}
    if (fileLinkCreated) {
      assert.throws(
        () => writeFileAtomicSync(linkedTarget, 'OVERWRITTEN'),
        /symbolic link/i,
        '符号链接目标文件必须被 writeFileAtomicSync 拒绝'
      );
      assert.equal(fs.readFileSync(victimFile, 'utf8'), 'KEEP_INTACT');
    }

    // 静态核验 Windows copyFileSync 回退分支前存在父目录与目标文件 lstatSync 符号链接守卫
    const mainSrc = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'daemon', 'main.mjs'), 'utf8');
    const copyIdx = mainSrc.indexOf('fs.copyFileSync(tmpPath, resolvedTarget)');
    assert.ok(copyIdx > 0, '应保留 Windows copyFileSync 回退逻辑');
    const beforeCopyWindow = mainSrc.slice(Math.max(0, copyIdx - 220), copyIdx);
    assert.ok(
      beforeCopyWindow.includes("assertNotSymlinkSync(dir, 'target directory')") &&
        beforeCopyWindow.includes("assertNotSymlinkSync(resolvedTarget, 'target file')"),
      'copyFileSync 回退前必须再次校验父目录与目标文件非符号链接'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 7: SIDEBAR_BINDING has zero exposure in disabled state and hot-binds before client injection on off->on toggle', async () => {
  const workDir = makeTempDir('ag-prism-sec-sbbind-');
  const targetPluginDir = path.join(workDir, 'obsidian-prism');
  await installPluginTool.installPlugin({
    targetDir: targetPluginDir,
    noCdp: true,
    skipHostConfig: true,
    startDaemon: false,
  });

  let daemon = null;
  try {
    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      overridePort: 19998,
      pollIntervalMs: 5000,
      silent: true,
    });
    assert.equal(daemon.cdp.DEFAULT_CONFIG.sidebarStudio, 'off', 'DEFAULT_CONFIG.sidebarStudio 必须保持 off');

    const evListeners = new Map();
    const timeline = [];
    const bindingCalls = [];
    const fakeSession = {
      closed: false,
      on(ev, fn) {
        if (!evListeners.has(ev)) evListeners.set(ev, []);
        evListeners.get(ev).push(fn);
      },
      emit(ev, params) {
        for (const fn of evListeners.get(ev) || []) fn(params);
      },
      async send(method, params) {
        if (method === 'Runtime.addBinding' || method === 'Runtime.removeBinding') {
          bindingCalls.push({ method, name: params?.name });
          timeline.push(`${method}:${params?.name}`);
        }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'MAIN_FRAME' } } };
        if (method === 'Runtime.enable') {
          this.emit('Runtime.executionContextCreated', {
            context: { id: 1, auxData: { frameId: 'MAIN_FRAME', isDefault: true, type: 'default' } },
          });
          return {};
        }
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `sc-${timeline.length}` };
        return {};
      },
      async evaluate(expr) {
        const s = String(expr || '');
        if (s.includes('SIDEBAR_STUDIO_CLIENT_V2')) {
          timeline.push('evaluate:sidebar-client');
        } else if (s.includes(`delete window.${SIDEBAR_BINDING}`)) {
          timeline.push('evaluate:sidebar-cleanup');
        } else if (s.includes('hasSidebarBridge')) {
          // verifyAndHealEntry 探针返回全健康但无侧栏
          return {
            ready: true,
            isHostDom: true,
            href: 'vscode-file://vscode-app/workbench.html',
            prismAttr: daemon.cdp.PLUGIN_VERSION,
            hasPrism: true,
            hasRepoBridge: true,
            hasThoughtBridge: true,
            hasUsageBridge: true,
            hasOmniBridge: true,
            hasOmniServerMeta: true,
            hasOmni: false,
            omniMode: 'off',
            hasSidebarBridge: false,
            hasSidebar: false,
            sidebarMode: 'off',
            codeHash: daemon.codeHash,
            hasLegacyCss: false,
            needsDashboardSync: false,
          };
        }
        return { status: 'ok', refreshed: true };
      },
      close() {
        this.closed = true;
      },
    };

    const origConnect = daemon.cdp.CdpSession.connect;
    daemon.cdp.CdpSession.connect = async () => fakeSession;
    daemon.ensureOmniServer = async () => null;
    daemon.ensureSidebarService = async () => ({
      handleRpc: async () => ({ ok: true }),
      getBootDiagnostic: () => null,
      dispose: async () => {},
    });

    // 1) 关闭态 attachTarget 与 verifyAndHealEntry 绝不注册 SIDEBAR_BINDING
    const entry = await daemon.attachTarget({
      id: 'T_SB_ZERO',
      title: 'Antigravity',
      url: 'vscode-file://vscode-app/workbench.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:19998/devtools/page/T_SB_ZERO',
    });
    daemon.cdp.CdpSession.connect = origConnect;

    assert.equal(entry.sidebarBindingAdded, false, '关闭态 attachTarget 不得标记 sidebarBindingAdded');
    assert.equal(
      bindingCalls.some((c) => c.method === 'Runtime.addBinding' && c.name === SIDEBAR_BINDING),
      false,
      '关闭态 attachTarget 严禁预注册 SIDEBAR_BINDING'
    );

    await daemon.verifyAndHealEntry(entry, true);
    assert.equal(
      bindingCalls.some((c) => c.method === 'Runtime.addBinding' && c.name === SIDEBAR_BINDING),
      false,
      '关闭态 verifyAndHealEntry 严禁注册 SIDEBAR_BINDING'
    );

    // 关闭态直接调用 handleBindingCall 仍保留 JSON.parse 前硬拦截纵深防御
    const disabledDirectRes = await daemon.handleBindingCall(entry, {
      name: SIDEBAR_BINDING,
      executionContextId: 1,
      payload: '{invalid-json-must-not-parse',
    });
    assert.deepEqual(disabledDirectRes, { ok: false, error: 'Chat Beta is disabled' });

    // 2) 热切 off -> on：broadcastConfigRefresh 必须先于 sidebar-client 注入补绑 SIDEBAR_BINDING
    timeline.length = 0;
    daemon.updateConfigSetting('sidebarStudio', 'on');
    await daemon.broadcastConfigRefresh();

    const addIdx = timeline.indexOf(`Runtime.addBinding:${SIDEBAR_BINDING}`);
    const evalIdx = timeline.indexOf('evaluate:sidebar-client');
    assert.ok(addIdx >= 0, 'off->on 热开时必须调用 Runtime.addBinding 注册 SIDEBAR_BINDING');
    assert.ok(evalIdx > addIdx, 'SIDEBAR_BINDING 必须在注入 sidebar-client 之前完成注册');
    assert.equal(entry.sidebarBindingAdded, true);
    assert.equal(entry.sidebarMounted, true);

    // 3) 切回 on -> off：移除 SIDEBAR_BINDING 并下发清理脚本
    timeline.length = 0;
    daemon.updateConfigSetting('sidebarStudio', 'off');
    await daemon.broadcastConfigRefresh();
    assert.ok(
      timeline.includes(`Runtime.removeBinding:${SIDEBAR_BINDING}`),
      'on->off 切换时应调用 Runtime.removeBinding 移除 SIDEBAR_BINDING'
    );
    assert.ok(
      timeline.includes('evaluate:sidebar-cleanup'),
      'on->off 切换时应清理页面侧栏与全局句柄'
    );
    assert.equal(entry.sidebarBindingAdded, false);
    assert.equal(entry.sidebarMounted, false);
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 8: install-plugin atomicWriteFileSync uses crypto.randomBytes + O_EXCL ("wx") and copyDirRecursiveSync skips pid/log/tmp files', () => {
  const installerSrc = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'), 'utf8');
  assert.ok(installerSrc.includes('crypto.randomBytes(8).toString("hex")'), 'atomicWriteFileSync 必须使用 crypto.randomBytes 生成临时文件名');
  assert.ok(installerSrc.includes('fs.openSync(tmpPath, "wx", mode)'), 'atomicWriteFileSync 必须使用 wx 排他创建临时文件');
  assert.equal(installerSrc.includes('Math.random()'), false, 'atomicWriteFileSync 不得再使用弱随机 Math.random()');

  const tmpRoot = makeTempDir('ag-prism-sec-install-');
  try {
    // 1) atomicWriteFileSync 正常写盘与符号链接拒绝
    const outFile = path.join(tmpRoot, 'out', 'meta.json');
    installPluginTool.atomicWriteFileSync(outFile, '{"v":1}\n', { encoding: 'utf8', mode: 0o600 });
    assert.equal(fs.readFileSync(outFile, 'utf8'), '{"v":1}\n');
    assert.equal(
      fs.readdirSync(path.dirname(outFile)).some((f) => f.includes('.tmp.')),
      false,
      'atomicWriteFileSync 写盘后不得残留临时文件'
    );

    const outsideDir = path.join(tmpRoot, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const linkDir = path.join(tmpRoot, 'linked-out');
    let linked = false;
    try {
      fs.symlinkSync(outsideDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      linked = true;
    } catch {}
    if (linked) {
      assert.throws(
        () => installPluginTool.atomicWriteFileSync(path.join(linkDir, 'x.json'), '{}'),
        /symbolic link/i
      );
    }

    // 2) copyDirRecursiveSync 跳过 .daemon.pid / *.log / *.tmp / *.tmp.* / __pycache__ / .DS_Store
    const srcDir = path.join(tmpRoot, 'src-sidecars');
    const dstDir = path.join(tmpRoot, 'dst-sidecars');
    fs.mkdirSync(path.join(srcDir, 'daemon'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, '__pycache__'), { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'daemon', 'main.mjs'), '// valid runtime\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'sidecar.json'), '{"ok":true}\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', '.daemon.pid'), '{"pid":123}\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'daemon.log'), 'log line\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'TRACE.LOG'), 'upper log\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'scratch.tmp'), 'temp\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'config.json.tmp.99.aabbcc'), 'atomic temp\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, '.DS_Store'), 'mac meta\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, '__pycache__', 'x.pyc'), 'pyc\n', 'utf8');

    const copiedCount = installPluginTool.copyDirRecursiveSync(srcDir, dstDir);
    assert.equal(copiedCount, 2, '仅应复制 2 个合法运行时文件');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'main.mjs')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'sidecar.json')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', '.daemon.pid')), false, '必须跳过 .daemon.pid');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'daemon.log')), false, '必须跳过 *.log');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'TRACE.LOG')), false, '必须大小写不敏感跳过 *.LOG');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'scratch.tmp')), false, '必须跳过 *.tmp');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'config.json.tmp.99.aabbcc')), false, '必须跳过 *.tmp.*');
    assert.equal(fs.existsSync(path.join(dstDir, '.DS_Store')), false);
    assert.equal(fs.existsSync(path.join(dstDir, '__pycache__')), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
