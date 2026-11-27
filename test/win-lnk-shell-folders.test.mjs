// Windows 快捷方式重定向桌面目录（User Shell Folders）只读 reg.exe 双编码解析与进程级缓存测试
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const winLnk = require(path.join(ROOT_DIR, 'src', 'platform', 'win-lnk.cjs'));
const shortcutGuard = require(path.join(ROOT_DIR, 'src', 'platform', 'shortcut-guard.cjs'));

const LNK_CLSID = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

// 「桌面」的 GB18030 编码字节（CP936）
const GB18030_ZHUOMIAN = Buffer.from([0xd7, 0xc0, 0xc3, 0xe6]);

function buildRegStdoutBuffer(key, valueName, valueType, valueBytes) {
  const header = Buffer.from(`\r\n${key}\r\n    ${valueName}    ${valueType}    `, 'ascii');
  const tail = Buffer.from('\r\n\r\n', 'ascii');
  const valBuf = Buffer.isBuffer(valueBytes) ? valueBytes : Buffer.from(String(valueBytes), 'utf8');
  return Buffer.concat([header, valBuf, tail]);
}

function buildSyntheticAntigravityLnk(targetPath, argsStr = '') {
  const encodeUni = (str) => {
    const s = String(str || '');
    const hdr = Buffer.alloc(2);
    hdr.writeUInt16LE(s.length, 0);
    return Buffer.concat([hdr, Buffer.from(s, 'utf16le')]);
  };
  const volId = Buffer.alloc(17);
  volId.writeUInt32LE(17, 0);
  volId.writeUInt32LE(3, 4);
  volId.writeUInt32LE(0x12345678, 8);
  volId.writeUInt32LE(16, 12);
  const baseAnsi = Buffer.concat([Buffer.from(targetPath, 'latin1'), Buffer.from([0])]);
  const sufAnsi = Buffer.from([0]);
  const baseUni = Buffer.concat([Buffer.from(targetPath, 'utf16le'), Buffer.from([0, 0])]);
  const sufUni = Buffer.from([0, 0]);
  const hdrSz = 0x24;
  const volOff = hdrSz;
  const baseAnsiOff = volOff + volId.length;
  const sufAnsiOff = baseAnsiOff + baseAnsi.length;
  const baseUniOff = sufAnsiOff + sufAnsi.length;
  const sufUniOff = baseUniOff + baseUni.length;
  const totalLi = sufUniOff + sufUni.length;
  const liHdr = Buffer.alloc(hdrSz);
  liHdr.writeUInt32LE(totalLi, 0);
  liHdr.writeUInt32LE(hdrSz, 4);
  liHdr.writeUInt32LE(0x01, 8);
  liHdr.writeUInt32LE(volOff, 12);
  liHdr.writeUInt32LE(baseAnsiOff, 16);
  liHdr.writeUInt32LE(0, 20);
  liHdr.writeUInt32LE(sufAnsiOff, 24);
  liHdr.writeUInt32LE(baseUniOff, 28);
  liHdr.writeUInt32LE(sufUniOff, 32);
  const linkInfo = Buffer.concat([liHdr, volId, baseAnsi, sufAnsi, baseUni, sufUni]);

  let flags = 0x80 | 0x02;
  const parts = [linkInfo];
  if (argsStr) {
    flags |= 0x20;
    parts.push(encodeUni(argsStr));
  }
  parts.push(Buffer.alloc(4)); // ExtraData TerminalBlock

  const header = Buffer.alloc(76);
  header.writeUInt32LE(0x4c, 0);
  LNK_CLSID.copy(header, 4);
  header.writeUInt32LE(flags >>> 0, 20);
  return Buffer.concat([header, ...parts]);
}

test('win-lnk reg.exe 解析器: 支持 REG_EXPAND_SZ/REG_SZ、GB18030 中文桌面路径解码、UTF-8/GB18030 碰撞回退与未展开变量过滤', () => {
  const env = { USERPROFILE: 'C:\\Users\\Alice', PUBLIC: 'C:\\Users\\Public' };

  // 1) ASCII REG_EXPAND_SZ 展开
  const asciiBuf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_EXPAND_SZ',
    Buffer.from('%USERPROFILE%\\Desktop', 'ascii')
  );
  assert.equal(winLnk.decodeRegQueryPath(asciiBuf, 'Desktop', env), 'C:\\Users\\Alice\\Desktop');

  // 2) CP936 GB18030 原始字节 D:\桌面（strict UTF-8 解码失败，自动回退 TextDecoder('gb18030')）
  const gbDesktopBuf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_EXPAND_SZ',
    Buffer.concat([Buffer.from('D:\\', 'ascii'), GB18030_ZHUOMIAN])
  );
  assert.equal(winLnk.decodeRegQueryPath(gbDesktopBuf, 'Desktop', env), 'D:\\桌面');

  // 3) GB18030 中文路径叠加环境变量展开：%USERPROFILE%\桌面
  const gbEnvBuf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_EXPAND_SZ',
    Buffer.concat([Buffer.from('%USERPROFILE%\\', 'ascii'), GB18030_ZHUOMIAN])
  );
  assert.equal(winLnk.decodeRegQueryPath(gbEnvBuf, 'Desktop', env), 'C:\\Users\\Alice\\桌面');

  // 4) UTF-8 (CP65001) 中文路径 + 空格 + REG_SZ
  const utf8Buf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_SZ',
    Buffer.from('E:\\我的 桌面\\Antigravity', 'utf8')
  );
  assert.equal(winLnk.decodeRegQueryPath(utf8Buf, 'Desktop', env), 'E:\\我的 桌面\\Antigravity');

  // 5) UTF-8 与 GB18030 双合法字节碰撞（"中文" 的 UTF-8 字节也是 GB18030 的 "涓枃"），借助 existsSync 精准择优
  const dualValidBytes = Buffer.from('D:\\中文', 'utf8');
  const dualBuf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_SZ',
    dualValidBytes
  );
  const gbDecodedCollision = new TextDecoder('gb18030').decode(dualValidBytes);
  assert.notEqual(gbDecodedCollision, 'D:\\中文');
  assert.equal(
    winLnk.decodeRegQueryPath(dualBuf, 'Desktop', env, (p) => p === gbDecodedCollision),
    gbDecodedCollision,
    'When GB18030 path exists on disk and UTF-8 candidate does not, must pick GB18030 candidate'
  );
  assert.equal(
    winLnk.decodeRegQueryPath(dualBuf, 'Desktop', env, (p) => p === 'D:\\中文'),
    'D:\\中文',
    'When UTF-8 path exists on disk, must pick UTF-8 candidate'
  );

  // 6) 未定义环境变量不落入扫描列表
  const unresolvedBuf = buildRegStdoutBuffer(
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'Desktop',
    'REG_EXPAND_SZ',
    Buffer.from('%UNKNOWN_CUSTOM_ROOT%\\Desktop', 'ascii')
  );
  assert.equal(winLnk.decodeRegQueryPath(unresolvedBuf, 'Desktop', env), '');
});

test('win-lnk 异步 reg.exe 发现迁移桌面（含 GB18030 中文）、Symbol.for 缓存命中 0 重复 spawn 与并发去重', async (t) => {
  t.after(() => winLnk._setWindowsRegExecForTest(null));
  winLnk._resetWindowsShellDesktopCacheForTest();

  const calls = [];
  const mockExecFile = (file, args, options, cb) => {
    calls.push({ file, args, options });
    setTimeout(() => {
      const valueName = args[3];
      if (valueName === 'Desktop') {
        cb(
          null,
          buildRegStdoutBuffer(
            'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
            'Desktop',
            'REG_EXPAND_SZ',
            Buffer.concat([Buffer.from('D:\\', 'ascii'), GB18030_ZHUOMIAN])
          ),
          Buffer.alloc(0)
        );
        return;
      }
      if (valueName === 'Common Desktop') {
        cb(
          null,
          buildRegStdoutBuffer(
            'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
            'Common Desktop',
            'REG_EXPAND_SZ',
            Buffer.from('E:\\SharedDesktop', 'ascii')
          ),
          Buffer.alloc(0)
        );
        return;
      }
      cb(new Error('unexpected reg value'));
    }, 10);
  };

  const mockEnv = {
    USERPROFILE: 'C:\\Users\\Alice',
    APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
    PUBLIC: 'C:\\Users\\Public',
    ProgramData: 'C:\\ProgramData',
  };

  // 并发触发 3 次异步查询 + 开启进程级缓存：必须共享 in-flight promise，仅触发 1 轮（2 次）reg.exe
  const [dirs1, dirs2, dirs3] = await Promise.all([
    winLnk.getDefaultWindowsShortcutDirsAsync(mockEnv, { execFile: mockExecFile, platform: 'win32', useCache: true }),
    winLnk.getDefaultWindowsShortcutDirsAsync(mockEnv, { execFile: mockExecFile, platform: 'win32', useCache: true }),
    winLnk.getDefaultWindowsShortcutDirsAsync(mockEnv, { execFile: mockExecFile, platform: 'win32', useCache: true }),
  ]);

  assert.equal(calls.length, 2, 'Concurrent async calls must share inflight lookup (only 2 reg.exe queries total)');
  for (const c of calls) {
    assert.equal(c.file, 'reg.exe');
    assert.equal(c.args[0], 'query');
    assert.equal(c.args[2], '/v');
    assert.equal(c.options.windowsHide, true);
    assert.equal(c.options.encoding, 'buffer');
    assert.ok(c.options.timeout > 0 && c.options.timeout <= 2000);
  }
  assert.deepEqual(dirs1, dirs2);
  assert.deepEqual(dirs2, dirs3);
  assert.equal(dirs1[0], 'D:\\桌面', 'Relocated GB18030 Desktop directory must appear first');
  assert.ok(dirs1.includes('E:\\SharedDesktop'), 'Relocated Common Desktop must be included');
  assert.ok(dirs1.includes('C:\\Users\\Alice\\Desktop'), 'Default %USERPROFILE%\\Desktop fallback must remain included');

  // 再次调用异步与同步路径：命中 Symbol.for 进程级缓存，0 重复 spawn
  let syncCalls = 0;
  const mockExecFileSync = () => {
    syncCalls += 1;
    throw new Error('sync reg.exe must not be invoked on cache hit');
  };
  const dirsCachedAsync = await winLnk.getDefaultWindowsShortcutDirsAsync(mockEnv, {
    execFile: mockExecFile,
    platform: 'win32',
    useCache: true,
  });
  const dirsCachedSync = winLnk.getDefaultWindowsShortcutDirs(mockEnv, {
    execFileSync: mockExecFileSync,
    platform: 'win32',
    useCache: true,
  });
  assert.equal(calls.length, 2, 'Async cache hit must trigger 0 extra reg.exe spawns');
  assert.equal(syncCalls, 0, 'Sync cache hit must trigger 0 reg.exe spawns');
  assert.deepEqual(dirsCachedAsync, dirs1);
  assert.deepEqual(dirsCachedSync, dirs1);
});

test('win-lnk 环境与平台隔离: 自定义 mock env !== process.env 与非 win32 自动跳过 reg.exe，查询失败优雅降级', async (t) => {
  t.after(() => winLnk._setWindowsRegExecForTest(null));

  let asyncCalls = 0;
  let syncCalls = 0;
  winLnk._setWindowsRegExecForTest({
    platform: 'win32',
    execFile: (...args) => {
      asyncCalls += 1;
      args[3](new Error('should not be called'));
    },
    execFileSync: () => {
      syncCalls += 1;
      throw new Error('should not be called');
    },
  });

  // 1) 自定义 mock env !== process.env 必须自动跳过 reg.exe，不污染单测
  const customEnv = {
    USERPROFILE: 'C:\\Users\\MockOnly',
    APPDATA: 'C:\\Users\\MockOnly\\AppData\\Roaming',
    PUBLIC: 'C:\\Users\\Public',
    ProgramData: 'C:\\ProgramData',
  };
  const syncCustom = winLnk.getDefaultWindowsShortcutDirs(customEnv);
  const asyncCustom = await winLnk.getDefaultWindowsShortcutDirsAsync(customEnv);
  assert.equal(syncCalls, 0, 'Custom env sync call must skip reg.exe');
  assert.equal(asyncCalls, 0, 'Custom env async call must skip reg.exe');
  assert.ok(syncCustom.includes('C:\\Users\\MockOnly\\Desktop'));
  assert.deepEqual(asyncCustom, syncCustom);

  // 2) 非 win32 平台（即使 env === process.env）必须跳过 reg.exe
  winLnk._setWindowsRegExecForTest({
    platform: 'darwin',
    execFile: (...args) => {
      asyncCalls += 1;
      args[3](new Error('should not run on darwin'));
    },
    execFileSync: () => {
      syncCalls += 1;
      throw new Error('should not run on darwin');
    },
  });
  winLnk.getDefaultWindowsShortcutDirs(process.env);
  await winLnk.getDefaultWindowsShortcutDirsAsync(process.env);
  assert.equal(syncCalls, 0, 'Non-win32 sync call must skip reg.exe');
  assert.equal(asyncCalls, 0, 'Non-win32 async call must skip reg.exe');

  // 3) reg.exe 报错或超时时优雅降级返回默认目录，不抛错
  const failingDirs = await winLnk.getDefaultWindowsShortcutDirsAsync(customEnv, {
    platform: 'win32',
    execFile: (_file, _args, _opts, cb) => cb(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })),
  });
  assert.ok(failingDirs.includes('C:\\Users\\MockOnly\\Desktop'));
});

test('win-lnk 端到端: ensureAntigravityShortcutsCdpFlagAsync 与 restore 扫描并修补重定向中文桌面 .lnk 且复用缓存', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-relocated-desk-'));
  t.after(() => {
    winLnk._setWindowsRegExecForTest(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const pluginDir = path.join(tmpRoot, 'plugin');
  const relocatedDesktop = path.join(tmpRoot, '桌面');
  const fakeProfile = path.join(tmpRoot, 'fake-profile');
  const fakeAppData = path.join(fakeProfile, 'AppData', 'Roaming');
  const fakePublic = path.join(tmpRoot, 'fake-public');
  const fakeProgramData = path.join(tmpRoot, 'fake-programdata');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(relocatedDesktop, { recursive: true });
  fs.mkdirSync(fakeAppData, { recursive: true });
  fs.mkdirSync(fakePublic, { recursive: true });
  fs.mkdirSync(fakeProgramData, { recursive: true });

  const lnkPath = path.join(relocatedDesktop, 'Antigravity.lnk');
  const targetExe = 'C:\\Users\\Alice\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';
  fs.writeFileSync(lnkPath, buildSyntheticAntigravityLnk(targetExe, ''));

  // 若 tmpRoot 路径前缀为纯 ASCII，使用真实 GB18030 字节编码验证实盘端到端 GB18030 解码；否则用 UTF-8 字节
  const prefixWithSep = tmpRoot.endsWith(path.sep) ? tmpRoot : `${tmpRoot}${path.sep}`;
  const isAsciiPrefix = /^[\x00-\x7f]+$/.test(prefixWithSep);
  const desktopValueBytes = isAsciiPrefix
    ? Buffer.concat([Buffer.from(prefixWithSep, 'ascii'), GB18030_ZHUOMIAN])
    : Buffer.from(relocatedDesktop, 'utf8');

  let asyncRegSpawns = 0;
  let syncRegSpawns = 0;
  winLnk._setWindowsRegExecForTest({
    platform: 'win32',
    // 将默认扫描基准全部隔离至沙盒临时目录，绝不触碰宿主机真实用户快捷方式
    defaultEnv: {
      USERPROFILE: fakeProfile,
      APPDATA: fakeAppData,
      PUBLIC: fakePublic,
      ProgramData: fakeProgramData,
    },
    execFile: (file, args, options, cb) => {
      asyncRegSpawns += 1;
      assert.equal(file, 'reg.exe');
      assert.equal(options.windowsHide, true);
      assert.equal(options.encoding, 'buffer');
      if (args[3] === 'Desktop') {
        cb(
          null,
          buildRegStdoutBuffer(
            'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
            'Desktop',
            'REG_EXPAND_SZ',
            desktopValueBytes
          ),
          Buffer.alloc(0)
        );
        return;
      }
      cb(new Error('HKLM Common Desktop absent'));
    },
    execFileSync: () => {
      syncRegSpawns += 1;
      throw new Error('sync reg.exe must not run once async cache is populated');
    },
  });

  // 1) 首次异步巡检（不传 searchDirs，模拟常驻 daemon 真实路径）
  const firstRes = await shortcutGuard.ensureAntigravityShortcutsCdpFlagAsync({
    pluginDir,
    platformOverride: 'win32',
  });
  assert.equal(firstRes.supported, true);
  assert.equal(asyncRegSpawns, 2, 'First async scan queries HKCU Desktop and HKLM Common Desktop once');
  assert.equal(
    firstRes.patched.some((p) => path.resolve(p).toLowerCase() === path.resolve(lnkPath).toLowerCase()),
    true,
    `Expected relocated Desktop shortcut to be patched; got patched=${JSON.stringify(firstRes.patched)}`
  );
  assert.equal(winLnk.readWindowsLnkFileSync(lnkPath).arguments, '--remote-debugging-port=0');

  // 2) 第二次异步巡检：命中缓存，0 重复 spawn，且快捷方式识别为 alreadySet
  const secondRes = await shortcutGuard.ensureAntigravityShortcutsCdpFlagAsync({
    pluginDir,
    platformOverride: 'win32',
  });
  assert.equal(asyncRegSpawns, 2, 'Second async scan must hit Symbol.for cache with 0 extra spawns');
  assert.equal(
    secondRes.alreadySet.some((p) => path.resolve(p).toLowerCase() === path.resolve(lnkPath).toLowerCase()),
    true,
    'Second scan must report relocated Desktop shortcut in alreadySet'
  );

  // 3) 卸载还原：共享缓存 0 同步 reg.exe spawn，且精准还原迁移桌面快捷方式
  const restoreRes = shortcutGuard.restoreAntigravityShortcutsCdpFlag({
    pluginDir,
    platformOverride: 'win32',
  });
  assert.equal(syncRegSpawns, 0, 'Restore must reuse populated process-level cache with 0 sync reg.exe spawns');
  assert.equal(
    restoreRes.restored.some((p) => path.resolve(p).toLowerCase() === path.resolve(lnkPath).toLowerCase()),
    true,
    'Restore must strip CDP flag from relocated Desktop shortcut'
  );
  assert.equal(winLnk.readWindowsLnkFileSync(lnkPath).arguments, '');
});

test('win-lnk 安全与卫生契约: 0 AV 敏感脚本模式、UTF-8 无 BOM + LF、符合 <=800 行 / <=40KB 模块上限', () => {
  const filePath = path.join(ROOT_DIR, 'src', 'platform', 'win-lnk.cjs');
  const buf = fs.readFileSync(filePath);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  assert.equal(hasBom, false, 'src/platform/win-lnk.cjs must have 0 UTF-8 BOM');
  const src = buf.toString('utf8');
  assert.equal(src.includes('\r\n'), false, 'src/platform/win-lnk.cjs must use LF (0 CRLF)');
  const lines = src.split('\n').length;
  assert.ok(lines <= 800, `src/platform/win-lnk.cjs lines=${lines} must stay <= 800`);
  assert.ok(buf.length <= 40960, `src/platform/win-lnk.cjs bytes=${buf.length} must stay <= 40960`);

  const forbidden = [
    new RegExp('power' + 'shell', 'i'),
    new RegExp('\\bpw' + 'sh\\b', 'i'),
    new RegExp('WScript\\.' + 'Shell', 'i'),
    new RegExp('\\bAdd-' + 'Type\\b', 'i'),
    new RegExp('Win32_' + 'Process', 'i'),
    new RegExp('Get-' + 'CimInstance', 'i'),
    new RegExp('Get-' + 'WmiObject', 'i'),
    new RegExp('\\bwm' + 'ic\\b', 'i'),
  ];
  for (const re of forbidden) {
    assert.equal(re.test(src), false, `src/platform/win-lnk.cjs must not match forbidden pattern ${re}`);
  }
});
