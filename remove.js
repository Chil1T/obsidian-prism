// Stop watch/daemon processes and remove Antigravity Prism from every open Antigravity window.
const fs = require('fs');
const path = require('path');
const { PID_FILE, REMOVE_EXPRESSION, readPort, listPages, CdpSession } = require('./cdp');

function stopPidFile(filePath, label) {
  try {
    const pid = parseInt(fs.readFileSync(filePath, 'utf8'), 10);
    if (pid) {
      try {
        process.kill(pid);
        console.log(`[✓] 已停止${label} (PID ${pid})`);
      } catch {
        console.log(`[i] ${label}未在运行`);
      }
    }
    fs.unlinkSync(filePath);
  } catch {}
}

function stopWatcher() {
  stopPidFile(PID_FILE, '守护进程');
  stopPidFile(path.join(__dirname, '.daemon.pid'), 'Sidecar 守护进程');
}

async function main() {
  stopWatcher();
  const port = readPort();
  if (!port) {
    console.log('[i] Antigravity 未运行，无需清理窗口');
    return;
  }
  let pages;
  try {
    pages = await listPages(port);
  } catch {
    console.log(`[i] 端口 ${port} 无响应，无需清理窗口`);
    return;
  }
  for (const page of pages) {
    const session = await CdpSession.connect(page.webSocketDebuggerUrl);
    try {
      const res = await session.evaluate(REMOVE_EXPRESSION);
      console.log(`[✓] 已恢复原生界面: ${page.title || page.url} (清理节点 ${res?.removed ?? 0})`);
    } finally {
      session.close();
    }
  }
}

main().catch((err) => {
  console.error(`[✗] ${err.message}`);
  process.exit(1);
});
