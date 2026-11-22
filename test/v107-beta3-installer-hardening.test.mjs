import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildInstaller } from '../scripts/build-installer.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const cliInstaller = require(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'));

function findCsc() {
  const winDir = process.env.WINDIR || 'C:\\Windows';
  return [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ].find((p) => fs.existsSync(p));
}

function runExeAllowFail(exePath, args, timeoutMs = 25000, customEnv = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, {
      stdio: 'ignore',
      windowsHide: true,
      env: customEnv || process.env,
    });
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
      resolve({ code });
    });
  });
}

test('all hardened installer source files use pure LF and UTF-8 without BOM', () => {
  const files = [
    path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs'),
    path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'),
    path.join(ROOT_DIR, 'installer', 'watcher', 'Program.cs'),
    path.join(ROOT_DIR, 'installer', 'macos', 'Setup', 'main.swift'),
    path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'),
  ];
  for (const fp of files) {
    const buf = fs.readFileSync(fp);
    assert.equal(
      buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
      false,
      `${path.basename(fp)} must not contain UTF-8 BOM`
    );
    const txt = buf.toString('utf8');
    assert.equal(txt.includes('\r\n'), false, `${path.basename(fp)} must use pure LF line endings`);
  }
});

test(
  'Windows C# ReparsePoint tag classifier allows WOF/OneDrive/Dedup non-redirect tags while strictly blocking Symlink/Junction/unknown tags (Fail-Closed)',
  { skip: process.platform !== 'win32' ? 'Windows-only NTFS ReparsePoint probe' : false },
  () => {
    const csc = findCsc();
    assert.ok(csc, 'Expected .NET Framework csc.exe on Windows');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-reparse-probe-'));
    try {
      const probeCs = path.join(tmpDir, 'ReparseProbe.cs');
      const probeExe = path.join(tmpDir, 'reparse-probe.exe');
      const realDir = path.join(tmpDir, 'real-dir');
      const junctionDir = path.join(tmpDir, 'junction-dir');
      fs.mkdirSync(realDir, { recursive: true });
      execFileSync('cmd.exe', ['/c', 'mklink', '/J', junctionDir, realDir], { stdio: 'ignore' });

      fs.writeFileSync(
        probeCs,
        [
          'using System;',
          'using System.Collections.Generic;',
          'using AgyClaudeStyle;',
          'class ReparseProbe {',
          '  static void Main(string[] args) {',
          '    uint jTag;',
          '    bool jUnsafe = CdpHelper.IsUnsafeReparsePoint(args[0], out jTag);',
          '    uint rTag;',
          '    bool rUnsafe = CdpHelper.IsUnsafeReparsePoint(args[1], out rTag);',
          '    var res = new Dictionary<string, object>(StringComparer.Ordinal) {',
          '      { "wofSafe", CdpHelper.IsSafeNonRedirectReparseTag(0x80000017u) },',
          '      { "dedupSafe", CdpHelper.IsSafeNonRedirectReparseTag(0x80000013u) },',
          '      { "onedriveSafe", CdpHelper.IsSafeNonRedirectReparseTag(0x80000021u) },',
          '      { "cloud0Safe", CdpHelper.IsSafeNonRedirectReparseTag(0x9000001Au) },',
          '      { "cloudFSafe", CdpHelper.IsSafeNonRedirectReparseTag(0x9000F01Au) },',
          '      { "symlinkSafe", CdpHelper.IsSafeNonRedirectReparseTag(0xA000000Cu) },',
          '      { "mountSafe", CdpHelper.IsSafeNonRedirectReparseTag(0xA0000003u) },',
          '      { "lxSymlinkSafe", CdpHelper.IsSafeNonRedirectReparseTag(0xA000001Du) },',
          '      { "appExecSafe", CdpHelper.IsSafeNonRedirectReparseTag(0x8000001Bu) },',
          '      { "unknownSafe", CdpHelper.IsSafeNonRedirectReparseTag(0xDEADBEEFu) },',
          '      { "zeroSafe", CdpHelper.IsSafeNonRedirectReparseTag(0u) },',
          '      { "junctionUnsafe", jUnsafe },',
          '      { "junctionDesc", CdpHelper.DescribeReparseTag(jTag) },',
          '      { "realUnsafe", rUnsafe }',
          '    };',
          '    Console.Write(MiniJson.Stringify(res, false));',
          '  }',
          '}',
        ].join('\n'),
        'utf8'
      );

      execFileSync(
        csc,
        [
          '/nologo',
          '/utf8output',
          '/codepage:65001',
          '/target:exe',
          `/out:${probeExe}`,
          '/r:System.dll',
          '/r:System.Core.dll',
          '/r:System.Net.Http.dll',
          path.join(ROOT_DIR, 'installer', 'common', 'MiniJson.cs'),
          path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'),
          probeCs,
        ],
        { stdio: 'pipe' }
      );

      const out = JSON.parse(execFileSync(probeExe, [junctionDir, realDir], { encoding: 'utf8' }));
      assert.equal(out.wofSafe, true, 'WOF CompactOS tag must be allowed');
      assert.equal(out.dedupSafe, true, 'NTFS Dedup tag must be allowed');
      assert.equal(out.onedriveSafe, true, 'Legacy OneDrive tag must be allowed');
      assert.equal(out.cloud0Safe, true, 'Cloud Filter base tag must be allowed');
      assert.equal(out.cloudFSafe, true, 'Cloud Filter F tag must be allowed');

      assert.equal(out.symlinkSafe, false, 'Symlink tag must be blocked');
      assert.equal(out.mountSafe, false, 'Junction/MountPoint tag must be blocked');
      assert.equal(out.lxSymlinkSafe, false, 'WSL symlink tag must be blocked');
      assert.equal(out.appExecSafe, false, 'AppExecLink tag must be blocked');
      assert.equal(out.unknownSafe, false, 'Unknown reparse tag must Fail-Closed');
      assert.equal(out.zeroSafe, false, 'Zero reparse tag must Fail-Closed');

      assert.equal(out.junctionUnsafe, true, 'Real NTFS junction must be rejected as unsafe');
      assert.ok(out.junctionDesc.includes('0xA0000003'), `Expected Junction tag in description, got: ${out.junctionDesc}`);
      assert.equal(out.realUnsafe, false, 'Normal directory must be allowed');
    } finally {
      try { execFileSync('cmd.exe', ['/c', 'rmdir', path.join(tmpDir, 'junction-dir')], { stdio: 'ignore' }); } catch {}
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);

test(
  'Windows installer.exe handles read-only/hidden files, shared-read locked main.mjs, legacy antigravity-prism cleanup, read-only & locked shortcuts, and structured junction error reporting',
  { skip: process.platform !== 'win32' ? 'Windows-only installer.exe hardening E2E' : false },
  async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-win-harden-'));
    const installerExe = path.join(workDir, 'installer.exe');
    const installDir = path.join(workDir, 'installed');
    const cfgDir = path.join(workDir, '.gemini', 'config');
    const pluginsRoot = path.join(cfgDir, 'plugins');
    const pluginDir = path.join(pluginsRoot, 'obsidian-prism');
    const legacyDir = path.join(pluginsRoot, 'antigravity-prism');
    const shortcutDir = path.join(workDir, 'shortcuts');
    const fakeBinDir = path.join(workDir, 'fake-bin');
    const outInstall = path.join(workDir, 'install.json');
    const outJunctionErr = path.join(workDir, 'junction-err.json');
    let readerLockChild = null;
    let lockedLnkHolder = null;

    try {
      buildInstaller({ outputPath: installerExe });

      // 1) Prepare pre-existing read-only + hidden files and legacy sibling directory
      fs.mkdirSync(installDir, { recursive: true });
      fs.mkdirSync(path.join(pluginDir, 'sidecars', 'daemon'), { recursive: true });
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(shortcutDir, { recursive: true });
      fs.mkdirSync(fakeBinDir, { recursive: true });

      const roStyle = path.join(installDir, 'style.css');
      const roWatcher = path.join(installDir, 'obsidian-prism-watcher.exe');
      const roMainMjs = path.join(pluginDir, 'sidecars', 'daemon', 'main.mjs');
      const roPluginJson = path.join(pluginDir, 'plugin.json');
      const roWatchPid = path.join(installDir, '.watch.pid');
      const legacyCfg = path.join(legacyDir, 'config.json');

      fs.writeFileSync(roStyle, '/* stale readonly hidden css */', 'utf8');
      fs.writeFileSync(roWatcher, 'stale-watcher-stub', 'utf8');
      fs.writeFileSync(roMainMjs, '// stale readonly main.mjs', 'utf8');
      fs.writeFileSync(roPluginJson, '{"stale":true}', 'utf8');
      fs.writeFileSync(roWatchPid, '999999', 'utf8');
      fs.writeFileSync(legacyCfg, JSON.stringify({ palette: 'warm', motionLevel: 'subtle' }), 'utf8');

      // Mark existing targets ReadOnly + Hidden (bare FileMode.Create throws UnauthorizedAccessException on Windows!)
      for (const fp of [roStyle, roWatcher, roMainMjs, roPluginJson, roWatchPid]) {
        execFileSync('attrib.exe', ['+R', '+H', fp], { stdio: 'ignore' });
      }

      // Hold a shared-read handle on main.mjs simulating a live Antigravity v2.34 sidecar reading it
      const lockReadyFile = path.join(workDir, 'lock.ready');
      readerLockChild = spawn(
        process.execPath,
        [
          '-e',
          `const fs = require('node:fs'); const fd = fs.openSync(process.argv[1], 'r'); fs.writeFileSync(process.argv[2], 'ok'); setInterval(() => {}, 1000);`,
          roMainMjs,
          lockReadyFile,
        ],
        { stdio: 'ignore', windowsHide: true }
      );
      const waitDeadline = Date.now() + 4000;
      while (!fs.existsSync(lockReadyFile) && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(fs.existsSync(lockReadyFile), true, 'reader lock helper must be holding main.mjs');

      // Prepare 2 Antigravity shortcuts: one ReadOnly (should be cleared & patched), one write-locked (must be skipped non-fatally)
      const fakeAgExe = path.join(fakeBinDir, 'Antigravity.exe');
      fs.writeFileSync(fakeAgExe, 'stub', 'utf8');
      const roLnk = path.join(shortcutDir, 'Antigravity-RO.lnk');
      const lockedLnk = path.join(shortcutDir, 'Antigravity-Locked.lnk');
      const mkLnksPs = [
        '$sh = New-Object -ComObject WScript.Shell;',
        '$s1 = $sh.CreateShortcut($env:LNK1); $s1.TargetPath = $env:AG_EXE; $s1.Arguments = ""; $s1.Save();',
        '$s2 = $sh.CreateShortcut($env:LNK2); $s2.TargetPath = $env:AG_EXE; $s2.Arguments = ""; $s2.Save();',
      ].join(' ');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', mkLnksPs], {
        env: { ...process.env, LNK1: roLnk, LNK2: lockedLnk, AG_EXE: fakeAgExe },
      });
      execFileSync('attrib.exe', ['+R', roLnk], { stdio: 'ignore' });

      // Hold read-shared lock on lockedLnk (readable TargetPath, refuses Save()) to simulate a protected ProgramData shortcut
      const lnkLockReady = path.join(workDir, 'lnklock.ready');
      lockedLnkHolder = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$fs = [System.IO.File]::Open($env:LOCK_LNK, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); Set-Content -Path $env:READY_FILE -Value "1"; Start-Sleep -Seconds 30; $fs.Close()',
        ],
        {
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, LOCK_LNK: lockedLnk, READY_FILE: lnkLockReady },
        }
      );
      const lnkDeadline = Date.now() + 5000;
      while (!fs.existsSync(lnkLockReady) && Date.now() < lnkDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(fs.existsSync(lnkLockReady), true, 'locked shortcut holder must be active');

      const testEnv = {
        ...process.env,
        APPDATA: path.join(workDir, 'appdata'),
        AG_PRISM_GEMINI_CONFIG_DIR: cfgDir,
        AG_PRISM_SHORTCUT_DIRS: shortcutDir,
        PRISM_NO_RELAUNCH_PROMPT: '1',
      };
      delete testEnv.NODE_ENV;

      const installRun = await runExeAllowFail(
        installerExe,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--no-native-daemon',
          '--install-dir',
          installDir,
          '--plugin-dir',
          pluginDir,
          '--out',
          outInstall,
        ],
        25000,
        testEnv
      );
      assert.equal(installRun.code, 0, 'installer.exe must succeed despite read-only/hidden files, shared-read lock, and locked shortcut');

      const res = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
      assert.equal(res.ok, true);
      assert.equal(res.nativePluginDeployed, true);
      assert.equal(res.patchedShortcuts, 1, 'Read-only Antigravity-RO.lnk must be cleared and patched');
      assert.equal(res.skippedShortcuts, 1, 'Protected/locked Antigravity-Locked.lnk must be skipped non-fatally');
      assert.ok(Array.isArray(res.warnings) && res.warnings.length >= 1, 'Skipped shortcut warning must be recorded');

      // Verify read-only/hidden/locked files were actually overwritten with real payload
      assert.ok(fs.readFileSync(roStyle, 'utf8').length > 200, 'ReadOnly+Hidden style.css must be updated');
      assert.ok(fs.statSync(roWatcher).size > 20 * 1024, 'ReadOnly+Hidden watcher.exe must be updated');
      assert.ok(fs.readFileSync(roMainMjs, 'utf8').includes('PrismDaemon'), 'Shared-read locked main.mjs must be updated');
      assert.equal(JSON.parse(fs.readFileSync(roPluginJson, 'utf8')).name, 'obsidian-prism');

      // Verify legacy antigravity-prism sibling was cleaned & config migrated
      assert.equal(fs.existsSync(legacyDir), false, 'Legacy antigravity-prism sibling must be cleaned');
      assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8')).palette, 'warm');

      // Verify no stale .tmp.* files remain
      const leftTmps = fs.readdirSync(installDir).filter((n) => n.includes('.tmp.'));
      assert.deepEqual(leftTmps, [], 'No stale .tmp.* files should remain in installDir');

      // Verify read-only shortcut now has --remote-debugging-port=0
      const roArgs = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$sh = New-Object -ComObject WScript.Shell; Write-Output ($sh.CreateShortcut($env:TEST_LNK).Arguments)',
        ],
        { encoding: 'utf8', env: { ...process.env, TEST_LNK: roLnk } }
      ).trim();
      assert.equal(roArgs, '--remote-debugging-port=0');

      // 2) Verify real NTFS Junction pluginDir is strictly refused with structured diagnostics
      const victimDir = path.join(workDir, 'victim-dir');
      const evilInstallDir = path.join(workDir, 'evil-inst');
      const evilPluginJunction = path.join(workDir, 'evil-plugin-junction');
      fs.mkdirSync(victimDir, { recursive: true });
      execFileSync('cmd.exe', ['/c', 'mklink', '/J', evilPluginJunction, victimDir], { stdio: 'ignore' });

      const jRun = await runExeAllowFail(
        installerExe,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--no-native-daemon',
          '--install-dir',
          evilInstallDir,
          '--plugin-dir',
          evilPluginJunction,
          '--out',
          outJunctionErr,
        ],
        20000,
        testEnv
      );
      assert.notEqual(jRun.code, 0, 'Junction pluginDir must be rejected with non-zero exit');
      assert.deepEqual(fs.readdirSync(victimDir), [], 'Junction target victimDir must remain untouched');
      const jErr = JSON.parse(fs.readFileSync(outJunctionErr, 'utf8'));
      assert.equal(jErr.ok, false);
      assert.equal(jErr.failedStep, 'prepare-dirs');
      assert.ok(jErr.error.includes('0xA0000003'), `Error must identify Junction tag, got: ${jErr.error}`);
      assert.ok(jErr.failedPath.toLowerCase().includes('evil-plugin-junction'));
      assert.ok(jErr.errorType.includes('InvalidOperationException'));
      assert.ok(jErr.hint.includes('符号链接') || jErr.hint.includes('目录联接'));
    } finally {
      if (readerLockChild) {
        try { readerLockChild.kill(); } catch {}
      }
      if (lockedLnkHolder) {
        try { lockedLnkHolder.kill(); } catch {}
      }
      try {
        const wPidFile = path.join(installDir, '.watch.pid');
        if (fs.existsSync(wPidFile)) {
          const wPid = parseInt(fs.readFileSync(wPidFile, 'utf8'), 10);
          if (wPid) process.kill(wPid);
        }
      } catch {}
      try { execFileSync('cmd.exe', ['/c', 'rmdir', path.join(workDir, 'evil-plugin-junction')], { stdio: 'ignore' }); } catch {}
      await new Promise((r) => setTimeout(r, 150));
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  }
);

test('tools/install-plugin.cjs overwrites read-only files cleanly, preserves symlink refusal, and reports skipped shortcuts / unsynced registry in summary', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-cli-harden-'));
  try {
    const cfgDir = path.join(tmpDir, '.gemini', 'config');
    const targetDir = path.join(cfgDir, 'plugins', 'obsidian-prism');
    fs.mkdirSync(path.join(targetDir, 'sidecars', 'daemon'), { recursive: true });

    const roPlugin = path.join(targetDir, 'plugin.json');
    const roMain = path.join(targetDir, 'sidecars', 'daemon', 'main.mjs');
    const roPid = path.join(targetDir, '.daemon.pid');
    const roHostCfg = path.join(cfgDir, 'config.json');
    fs.writeFileSync(roPlugin, '{"stale":true}', 'utf8');
    fs.writeFileSync(roMain, '// stale', 'utf8');
    fs.writeFileSync(roPid, JSON.stringify({ pid: 999999 }), 'utf8');
    fs.writeFileSync(roHostCfg, '{}\n', 'utf8');

    for (const fp of [roPlugin, roMain, roPid, roHostCfg]) {
      fs.chmodSync(fp, 0o444);
    }

    const res = await cliInstaller.installPlugin({
      sourceDir: ROOT_DIR,
      targetDir,
      hostConfigDir: cfgDir,
      startDaemon: false,
      syncShortcuts: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.registrySynced, true);
    assert.equal(JSON.parse(fs.readFileSync(roPlugin, 'utf8')).name, 'obsidian-prism');
    assert.ok(fs.readFileSync(roMain, 'utf8').includes('PrismDaemon'));
    assert.equal(JSON.parse(fs.readFileSync(roHostCfg, 'utf8')).plugins['obsidian-prism'].enabled, true);

    // Self-check summary surfaces skipped shortcuts and registry warning cleanly
    const summary = cliInstaller.formatInstallSelfCheckSummary({
      ...res,
      registrySynced: false,
      shortcuts: { supported: true, patched: [], alreadySet: [], skipped: ['C:\\ProgramData\\Antigravity.lnk'] },
    });
    assert.ok(summary.includes('权限不足跳过 1 个'));
    assert.ok(summary.includes('config.json'));

    // Symlink targetDir must still be refused (zero security regression)
    const realTarget = path.join(tmpDir, 'real-target');
    const linkTarget = path.join(tmpDir, 'link-target');
    fs.mkdirSync(realTarget, { recursive: true });
    fs.symlinkSync(realTarget, linkTarget, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () =>
        cliInstaller.installPlugin({
          sourceDir: ROOT_DIR,
          targetDir: linkTarget,
          hostConfigDir: cfgDir,
          startDaemon: false,
          syncShortcuts: false,
        }),
      /symbolic link/i
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('Windows CdpClient and macOS Setup main.swift contain v1.0.7-beta.3 installer hardening contracts', () => {
  const cdpCs = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  assert.ok(cdpCs.includes('IsSafeNonRedirectReparseTag'), 'CdpClient.cs must distinguish safe WOF/Cloud reparse tags');
  assert.ok(cdpCs.includes('IsUnsafeReparsePoint'), 'CdpClient.cs must expose IsUnsafeReparsePoint');
  assert.ok(cdpCs.includes('ClearReadOnlyAndHiddenAttributes'), 'CdpClient.cs must clear ReadOnly/Hidden before overwrite');
  assert.ok(cdpCs.includes('Google Antigravity'), 'CdpClient.cs must match Google Antigravity uninstall registry entries');
  assert.ok(cdpCs.includes('"--import="'), 'CdpClient.cs FindBareAntigravityMainProcess must exclude --import= sidecars');
  assert.ok(cdpCs.includes('out int skippedCount'), 'CdpClient.cs EnsureAntigravityShortcutsOptIn must report skipped shortcuts');

  const setupCs = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs'), 'utf8');
  assert.ok(setupCs.includes('class InstallerStepException'), 'Program.cs must carry structured step/path diagnostics');
  assert.ok(setupCs.includes('WriteZipEntryWithRetry'), 'Program.cs must retry locked/readonly ZIP writes');
  assert.ok(setupCs.includes('TryCleanupLegacySiblingPluginDir'), 'Program.cs must clean legacy antigravity-prism sibling');
  assert.ok(setupCs.includes('FormatFailureLogBlock'), 'Program.cs must format clear failure reports');

  const macSwift = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'macos', 'Setup', 'main.swift'), 'utf8');
  assert.ok(macSwift.includes('clearReadOnlyPermissionsNoSymlink'), 'main.swift must clear readonly permissions safely');
  assert.ok(macSwift.includes('copyItemSafelyWithRetry'), 'main.swift must retry locked/readonly copies and block symlinks');
  assert.ok(macSwift.includes('cleanupLegacySiblingPluginDir'), 'main.swift must clean legacy antigravity-prism sibling');
  assert.ok(macSwift.includes('配置 LaunchAgent 登录自启失败（非致命'), 'main.swift must degrade non-fatally when LaunchAgent fails');
  assert.match(
    macSwift,
    /static func runInstall[\s\S]*?isDangerousRootPath\(installDir\)/,
    'main.swift runInstall must guard dangerous root paths'
  );
});

test(
  'Windows C# SyncHostPluginRegistry updates read-only host config.json cleanly and protects symlinked config.json without destroying it',
  { skip: process.platform !== 'win32' ? 'Windows-only C# registry sync probe' : false },
  () => {
    const csc = findCsc();
    assert.ok(csc, 'Expected .NET Framework csc.exe on Windows');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-reg-probe-'));
    try {
      const probeCs = path.join(tmpDir, 'RegProbe.cs');
      const probeExe = path.join(tmpDir, 'reg-probe.exe');

      const roCfgDir = path.join(tmpDir, 'ro-cfg');
      const roPluginDir = path.join(roCfgDir, 'plugins', 'obsidian-prism');
      fs.mkdirSync(roPluginDir, { recursive: true });
      const roCfgPath = path.join(roCfgDir, 'config.json');
      fs.writeFileSync(roCfgPath, '{"plugins":{"other":{"enabled":true}}}\n', 'utf8');
      execFileSync('attrib.exe', ['+R', roCfgPath], { stdio: 'ignore' });

      const symCfgDir = path.join(tmpDir, 'sym-cfg');
      const symPluginDir = path.join(symCfgDir, 'plugins', 'obsidian-prism');
      fs.mkdirSync(symPluginDir, { recursive: true });
      const externalRealCfg = path.join(tmpDir, 'external-real-config.json');
      const symCfgPath = path.join(symCfgDir, 'config.json');
      fs.writeFileSync(externalRealCfg, '{"plugins":{"keep":true}}\n', 'utf8');
      let symlinkReady = false;
      try {
        fs.symlinkSync(externalRealCfg, symCfgPath, 'file');
        symlinkReady = true;
      } catch {}

      fs.writeFileSync(
        probeCs,
        [
          'using System;',
          'using System.Collections.Generic;',
          'using AgyClaudeStyle;',
          'class RegProbe {',
          '  static void Main(string[] args) {',
          '    string r1;',
          '    bool ok1 = CdpHelper.SyncHostPluginRegistry(args[0], true, out r1);',
          '    string r2 = "";',
          '    bool ok2 = false;',
          '    if (args.Length > 1 && !string.IsNullOrEmpty(args[1])) {',
          '      ok2 = CdpHelper.SyncHostPluginRegistry(args[1], true, out r2);',
          '    }',
          '    var res = new Dictionary<string, object>(StringComparer.Ordinal) {',
          '      { "roOk", ok1 },',
          '      { "roReason", r1 ?? "" },',
          '      { "symOk", ok2 },',
          '      { "symReason", r2 ?? "" }',
          '    };',
          '    Console.Write(MiniJson.Stringify(res, false));',
          '  }',
          '}',
        ].join('\n'),
        'utf8'
      );

      execFileSync(
        csc,
        [
          '/nologo',
          '/utf8output',
          '/codepage:65001',
          '/target:exe',
          `/out:${probeExe}`,
          '/r:System.dll',
          '/r:System.Core.dll',
          '/r:System.Net.Http.dll',
          path.join(ROOT_DIR, 'installer', 'common', 'MiniJson.cs'),
          path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'),
          probeCs,
        ],
        { stdio: 'pipe' }
      );

      const out = JSON.parse(
        execFileSync(probeExe, symlinkReady ? [roPluginDir, symPluginDir] : [roPluginDir], { encoding: 'utf8' })
      );
      assert.equal(out.roOk, true, `Read-only host config.json must be synced cleanly, reason: ${out.roReason}`);
      const roParsed = JSON.parse(fs.readFileSync(roCfgPath, 'utf8'));
      assert.deepEqual(roParsed.plugins['obsidian-prism'], { enabled: true });
      assert.deepEqual(roParsed.plugins.other, { enabled: true });

      if (symlinkReady) {
        assert.equal(out.symOk, false, 'Symlinked host config.json must be refused without overwriting');
        assert.ok(out.symReason.includes('0xA000000C'), `Expected Symlink tag in reason, got: ${out.symReason}`);
        assert.equal(fs.lstatSync(symCfgPath).isSymbolicLink(), true, 'Original config.json symlink must remain intact');
        assert.deepEqual(JSON.parse(fs.readFileSync(externalRealCfg, 'utf8')), { plugins: { keep: true } });
      }
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
);

