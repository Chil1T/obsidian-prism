using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AgyClaudeStyle.Watcher
{
    internal class FrameContextMeta
    {
        public string FrameId;
        public bool IsDefault;
        public string ContextType;
    }

    internal class AttachedEntry
    {
        public CdpSession Session;
        public string ScriptId;
        public string OmniScriptId;
        public string Title;
        public string MainFrameId;
        public bool HasFrameTree;
        public readonly ConcurrentDictionary<long, FrameContextMeta> ContextFrames = new ConcurrentDictionary<long, FrameContextMeta>();

        public bool IsTrustedMainFrameBinding(Dictionary<string, object> p)
        {
            object ctxIdObj = null;
            bool hasCtxId = p != null && p.TryGetValue("executionContextId", out ctxIdObj) && ctxIdObj != null;
            long ctxId = 0;
            if (hasCtxId)
            {
                try { ctxId = Convert.ToInt64(ctxIdObj); }
                catch { hasCtxId = false; }
            }
            FrameContextMeta meta;
            if (hasCtxId && ContextFrames.TryGetValue(ctxId, out meta) && meta != null)
            {
                if (!meta.IsDefault) return false;
                if (!string.IsNullOrEmpty(meta.ContextType) && !string.Equals(meta.ContextType, "default", StringComparison.Ordinal)) return false;
                if (!string.IsNullOrEmpty(MainFrameId) && !string.IsNullOrEmpty(meta.FrameId) &&
                    !string.Equals(meta.FrameId, MainFrameId, StringComparison.Ordinal))
                {
                    return false;
                }
                return true;
            }
            if (HasFrameTree)
            {
                if (!hasCtxId) return false;
                if (ContextFrames.Count > 0) return false;
            }
            return true;
        }
    }

    internal static class Program
    {
        private static readonly object LogLock = new object();
        private static string _baseDir;
        private static string _pluginDir;
        private static string _logFile;
        private static string _pidFile;
        private static bool _isWatch;

        private static string GetDefaultWatcherInstallDir()
        {
            string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            }
            return Path.GetFullPath(Path.Combine(localAppData, "obsidian-prism")).TrimEnd('\\', '/');
        }

        [STAThread]
        private static int Main(string[] args)
        {
            string mode = "watch";
            string customDir = null;
            string customPluginDir = null;
            int? overridePort = null;
            string outFile = null;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--watch") mode = "watch";
                else if (a == "--once") mode = "once";
                else if (a == "--remove") mode = "remove";
                else if (a == "--dir" && i + 1 < args.Length) customDir = args[++i];
                else if (a == "--plugin-dir" && i + 1 < args.Length) customPluginDir = args[++i];
                else if (a == "--cdp-port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[++i], out p) && p > 0) overridePort = p;
                }
                else if (a == "--out" && i + 1 < args.Length) outFile = args[++i];
            }

            _baseDir = Path.GetFullPath(string.IsNullOrEmpty(customDir) ? AppDomain.CurrentDomain.BaseDirectory : customDir).TrimEnd('\\', '/');
            if (!string.IsNullOrEmpty(customPluginDir))
            {
                _pluginDir = Path.GetFullPath(customPluginDir).TrimEnd('\\', '/');
            }
            else if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AG_PRISM_PLUGIN_DIR")))
            {
                _pluginDir = CdpHelper.GetDefaultNativePluginDir();
            }
            else if (string.IsNullOrEmpty(customDir) ||
                     string.Equals(_baseDir, GetDefaultWatcherInstallDir(), StringComparison.OrdinalIgnoreCase))
            {
                _pluginDir = CdpHelper.GetDefaultNativePluginDir();
            }
            else
            {
                _pluginDir = Path.Combine(_baseDir, "obsidian-prism-plugin");
            }
            _logFile = Path.Combine(_baseDir, "watch.log");
            _pidFile = Path.Combine(_baseDir, ".watch.pid");
            _isWatch = (mode == "watch");

            try
            {
                if (mode == "once")
                {
                    return RunOnceAsync(overridePort, outFile).GetAwaiter().GetResult();
                }
                if (mode == "remove")
                {
                    return RunRemoveAsync(overridePort, outFile).GetAwaiter().GetResult();
                }
                return RunWatchAsync(overridePort).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Log("[!] Fatal error: " + ex.Message);
                WriteResult(outFile, false, ex.Message, null);
                return 1;
            }
        }

        private static void Log(string line)
        {
            if (!_isWatch) return;
            lock (LogLock)
            {
                try
                {
                    FileInfo fi = new FileInfo(_logFile);
                    if (fi.Exists && fi.Length > 1024 * 1024)
                    {
                        File.WriteAllText(_logFile, "", new UTF8Encoding(false));
                    }
                    string entry = string.Format("[{0}] {1}\n", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), line);
                    byte[] bytes = new UTF8Encoding(false).GetBytes(entry);
                    using (FileStream fs = new FileStream(_logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    {
                        fs.Write(bytes, 0, bytes.Length);
                    }
                }
                catch { }
            }
        }

        private static void WriteResult(string outFile, bool ok, string message, List<string> pages)
        {
            if (string.IsNullOrEmpty(outFile)) return;
            try
            {
                Dictionary<string, object> res = new Dictionary<string, object>(StringComparer.Ordinal);
                res["ok"] = ok;
                res["message"] = message ?? "";
                if (pages != null) res["pages"] = pages;
                File.WriteAllText(outFile, MiniJson.Stringify(res, true), new UTF8Encoding(false));
            }
            catch { }
        }

        public static string GetDirHash(string dir)
        {
            return CdpHelper.ComputeHash(Path.GetFullPath(dir).TrimEnd('\\', '/').ToLowerInvariant());
        }

        private static int? ReadPidFile()
        {
            try
            {
                if (!File.Exists(_pidFile)) return null;
                int pid;
                if (int.TryParse(File.ReadAllText(_pidFile, Encoding.UTF8).Trim(), out pid) && pid > 0) return pid;
            }
            catch { }
            return null;
        }

        private static void ReleasePidFile(int selfPid)
        {
            try
            {
                int? current = ReadPidFile();
                if (current.HasValue && current.Value == selfPid)
                {
                    File.Delete(_pidFile);
                }
            }
            catch { }
        }

        private static async Task<int> RunOnceAsync(int? overridePort, string outFile)
        {
            PluginManifest manifest = PluginManifest.Load(_baseDir);
            int? port = CdpHelper.ReadPort(overridePort);
            if (!port.HasValue)
            {
                WriteResult(outFile, false, "未找到调试端口文件，Antigravity 可能未运行", null);
                return 1;
            }

            List<CdpPageInfo> pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
            if (pages.Count == 0)
            {
                WriteResult(outFile, false, "未找到 Antigravity 窗口页面", null);
                return 1;
            }

            string expr = CdpHelper.BuildInjectExpression(_baseDir, manifest);
            string omniExpr = CdpHelper.BuildOmniClientExpression(_baseDir, manifest);
            List<string> injectedTitles = new List<string>();
            for (int i = 0; i < pages.Count; i++)
            {
                CdpPageInfo page = pages[i];
                using (CdpSession session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 4000).ConfigureAwait(false))
                {
                    await session.EvaluateAsync(expr, false).ConfigureAwait(false);
                    if (!string.IsNullOrEmpty(omniExpr))
                    {
                        try { await session.EvaluateAsync(omniExpr, false).ConfigureAwait(false); } catch { }
                    }
                    injectedTitles.Add(CdpHelper.ShortTitle(page));
                }
            }
            WriteResult(outFile, true, "injected " + injectedTitles.Count + " page(s)", injectedTitles);
            return 0;
        }

        private static async Task<int> RunRemoveAsync(int? overridePort, string outFile)
        {
            PluginManifest manifest = PluginManifest.Load(_baseDir);
            StopRunningWatcherInDir(_baseDir);

            int? port = CdpHelper.ReadPort(overridePort);
            List<string> cleaned = new List<string>();
            if (port.HasValue)
            {
                try
                {
                    List<CdpPageInfo> pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
                    for (int i = 0; i < pages.Count; i++)
                    {
                        CdpPageInfo page = pages[i];
                        try
                        {
                            using (CdpSession session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 3000).ConfigureAwait(false))
                            {
                                await session.EvaluateAsync(manifest.RemoveExpression, false).ConfigureAwait(false);
                                cleaned.Add(CdpHelper.ShortTitle(page));
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
            WriteResult(outFile, true, "removed from " + cleaned.Count + " page(s)", cleaned);
            return 0;
        }

        private static void StopRunningWatcherInDir(string dir)
        {
            string hash = GetDirHash(dir);
            try
            {
                using (EventWaitHandle stopEvt = EventWaitHandle.OpenExisting("Local\\ObsidianPrismStop_" + hash))
                {
                    stopEvt.Set();
                }
            }
            catch { }

            string pidFile = Path.Combine(dir, ".watch.pid");
            int? pid = null;
            try
            {
                if (File.Exists(pidFile))
                {
                    int p;
                    if (int.TryParse(File.ReadAllText(pidFile, Encoding.UTF8).Trim(), out p) && p > 0) pid = p;
                }
            }
            catch { }

            if (pid.HasValue && pid.Value != Process.GetCurrentProcess().Id)
            {
                try
                {
                    using (Process proc = Process.GetProcessById(pid.Value))
                    {
                        if (!proc.WaitForExit(1500) && CdpHelper.IsExpectedPrismDaemonProcess(proc))
                        {
                            proc.Kill();
                            proc.WaitForExit(1500);
                        }
                    }
                }
                catch { }
            }
            try { if (File.Exists(pidFile)) File.Delete(pidFile); } catch { }
        }

        private static async Task<int> RunWatchAsync(int? overridePort)
        {
            string dirHash = GetDirHash(_baseDir);
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\ObsidianPrismWatcher_" + dirHash, out createdNew))
            {
                if (!createdNew)
                {
                    return 0;
                }

                int selfPid = Process.GetCurrentProcess().Id;
                File.WriteAllText(_pidFile, selfPid.ToString(), new UTF8Encoding(false));
                try { File.WriteAllText(_logFile, "", new UTF8Encoding(false)); } catch { }

                PluginManifest manifest = PluginManifest.Load(_baseDir);
                Log(string.Format("[*] Obsidian Prism (obsidian-prism) 守护模式启动 (PID {0})，每 2 秒检查一次窗口", selfPid));

                string currentExpr = CdpHelper.BuildInjectExpression(_baseDir, manifest);
                string currentOmniExpr = CdpHelper.BuildOmniClientExpression(_baseDir, manifest);
                object exprLock = new object();
                ConcurrentDictionary<string, AttachedEntry> attached = new ConcurrentDictionary<string, AttachedEntry>(StringComparer.Ordinal);
                ManualResetEventSlim exitEvent = new ManualResetEventSlim(false);
                EventWaitHandle stopSignal = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\ObsidianPrismStop_" + dirHash);

                ThreadPool.RegisterWaitForSingleObject(stopSignal, (state, timedOut) =>
                {
                    exitEvent.Set();
                }, null, -1, true);

                AppDomain.CurrentDomain.ProcessExit += (s, e) =>
                {
                    exitEvent.Set();
                    ReleasePidFile(selfPid);
                };

                Func<AttachedEntry, string, string, Task<Dictionary<string, object>>> applyAsync = async (entry, exprToUse, omniExprToUse) =>
                {
                    if (!string.IsNullOrEmpty(entry.ScriptId))
                    {
                        try
                        {
                            Dictionary<string, object> rmParams = new Dictionary<string, object>(StringComparer.Ordinal);
                            rmParams["identifier"] = entry.ScriptId;
                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmParams, 5000).ConfigureAwait(false);
                        }
                        catch { }
                    }
                    Dictionary<string, object> addParams = new Dictionary<string, object>(StringComparer.Ordinal);
                    addParams["source"] = exprToUse;
                    Dictionary<string, object> addRes = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addParams, 15000).ConfigureAwait(false);
                    object idVal;
                    if (addRes.TryGetValue("identifier", out idVal)) entry.ScriptId = idVal as string;
                    object evalVal = await entry.Session.EvaluateAsync(exprToUse, false).ConfigureAwait(false);

                    if (!string.IsNullOrEmpty(entry.OmniScriptId))
                    {
                        try
                        {
                            Dictionary<string, object> rmOmni = new Dictionary<string, object>(StringComparer.Ordinal);
                            rmOmni["identifier"] = entry.OmniScriptId;
                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmOmni, 5000).ConfigureAwait(false);
                        }
                        catch { }
                        entry.OmniScriptId = null;
                    }
                    if (!string.IsNullOrEmpty(omniExprToUse))
                    {
                        try
                        {
                            Dictionary<string, object> addOmni = new Dictionary<string, object>(StringComparer.Ordinal);
                            addOmni["source"] = omniExprToUse;
                            Dictionary<string, object> omniRes = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addOmni, 15000).ConfigureAwait(false);
                            object omniIdVal;
                            if (omniRes.TryGetValue("identifier", out omniIdVal)) entry.OmniScriptId = omniIdVal as string;
                            await entry.Session.EvaluateAsync(omniExprToUse, false).ConfigureAwait(false);
                        }
                        catch { }
                    }
                    return evalVal as Dictionary<string, object>;
                };

                Func<CdpPageInfo, Task> attachAsync = async (page) =>
                {
                    if (!attached.TryAdd(page.Id, null)) return;
                    CdpSession session = null;
                    try
                    {
                        session = await CdpSession.ConnectAsync(page.WebSocketDebuggerUrl, 4000).ConfigureAwait(false);
                        AttachedEntry entry = new AttachedEntry();
                        entry.Session = session;
                        entry.ScriptId = null;
                        entry.Title = CdpHelper.ShortTitle(page);
                        attached[page.Id] = entry;

                        session.OnClose = () =>
                        {
                            AttachedEntry ignored;
                            attached.TryRemove(page.Id, out ignored);
                            Log("[-] 窗口已关闭: " + entry.Title);
                        };

                        session.On("Runtime.executionContextCreated", (cp) =>
                        {
                            object ctxObj;
                            if (cp == null || !cp.TryGetValue("context", out ctxObj) || !(ctxObj is Dictionary<string, object>)) return;
                            Dictionary<string, object> ctxDict = (Dictionary<string, object>)ctxObj;
                            object idObj;
                            if (!ctxDict.TryGetValue("id", out idObj) || idObj == null) return;
                            long cid;
                            try { cid = Convert.ToInt64(idObj); } catch { return; }
                            FrameContextMeta meta = new FrameContextMeta();
                            meta.IsDefault = true;
                            meta.ContextType = "default";
                            meta.FrameId = "";
                            object auxObj;
                            if (ctxDict.TryGetValue("auxData", out auxObj) && auxObj is Dictionary<string, object>)
                            {
                                Dictionary<string, object> aux = (Dictionary<string, object>)auxObj;
                                object fid;
                                if (aux.TryGetValue("frameId", out fid) && fid is string) meta.FrameId = (string)fid;
                                object defObj;
                                if (aux.TryGetValue("isDefault", out defObj) && defObj is bool) meta.IsDefault = (bool)defObj;
                                object tObj;
                                if (aux.TryGetValue("type", out tObj) && tObj is string) meta.ContextType = (string)tObj;
                            }
                            entry.ContextFrames[cid] = meta;
                        });
                        session.On("Runtime.executionContextDestroyed", (dp) =>
                        {
                            object idObj;
                            if (dp != null && dp.TryGetValue("executionContextId", out idObj) && idObj != null)
                            {
                                try
                                {
                                    FrameContextMeta removedMeta;
                                    entry.ContextFrames.TryRemove(Convert.ToInt64(idObj), out removedMeta);
                                }
                                catch { }
                            }
                        });
                        session.On("Runtime.executionContextsCleared", (cp) =>
                        {
                            entry.ContextFrames.Clear();
                        });
                        session.On("Page.frameNavigated", (fp) =>
                        {
                            object fObj;
                            if (fp != null && fp.TryGetValue("frame", out fObj) && fObj is Dictionary<string, object>)
                            {
                                Dictionary<string, object> fDict = (Dictionary<string, object>)fObj;
                                object parentObj;
                                bool hasParent = fDict.TryGetValue("parentId", out parentObj) && parentObj is string && !string.IsNullOrEmpty((string)parentObj);
                                object fidObj;
                                if (!hasParent && fDict.TryGetValue("id", out fidObj) && fidObj is string && !string.IsNullOrEmpty((string)fidObj))
                                {
                                    entry.MainFrameId = (string)fidObj;
                                    entry.HasFrameTree = true;
                                }
                            }
                        });

                        await session.SendAsync("Page.enable", null, 5000).ConfigureAwait(false);
                        try
                        {
                            Dictionary<string, object> ftRes = await session.SendAsync("Page.getFrameTree", null, 3000).ConfigureAwait(false);
                            object ftObj;
                            if (ftRes != null && ftRes.TryGetValue("frameTree", out ftObj) && ftObj is Dictionary<string, object>)
                            {
                                object topFrameObj;
                                if (((Dictionary<string, object>)ftObj).TryGetValue("frame", out topFrameObj) && topFrameObj is Dictionary<string, object>)
                                {
                                    object topIdObj;
                                    if (((Dictionary<string, object>)topFrameObj).TryGetValue("id", out topIdObj) && topIdObj is string && !string.IsNullOrEmpty((string)topIdObj))
                                    {
                                        entry.MainFrameId = (string)topIdObj;
                                        entry.HasFrameTree = true;
                                    }
                                }
                            }
                        }
                        catch { }

                        session.On("Runtime.bindingCalled", (p) =>
                        {
                            if (!entry.IsTrustedMainFrameBinding(p)) return;
                            object bNameObj;
                            object payloadObj;
                            if (!p.TryGetValue("name", out bNameObj)) return;
                            string bName = bNameObj as string;
                            if (!string.Equals(bName, manifest.SettingBinding, StringComparison.Ordinal) &&
                                !string.Equals(bName, "__agClaudeStyleSetting", StringComparison.Ordinal))
                            {
                                return;
                            }
                            if (!p.TryGetValue("payload", out payloadObj) || !(payloadObj is string)) return;
                            try
                            {
                                Dictionary<string, object> kv = MiniJson.ParseObject((string)payloadObj);
                                object actObj;
                                object entriesObj;
                                if (kv.TryGetValue("action", out actObj) &&
                                    string.Equals(actObj as string, "patch-batch", StringComparison.Ordinal) &&
                                    kv.TryGetValue("entries", out entriesObj) &&
                                    entriesObj is Dictionary<string, object>)
                                {
                                    Dictionary<string, object> entriesDict = (Dictionary<string, object>)entriesObj;
                                    if (CdpHelper.UpdateConfigBatch(_baseDir, manifest, entriesDict))
                                    {
                                        if (!string.IsNullOrEmpty(_pluginDir) && Directory.Exists(_pluginDir))
                                        {
                                            try { CdpHelper.UpdateConfigBatch(_pluginDir, manifest, entriesDict); } catch { }
                                        }
                                        Log("[⚙] 批量设置已保存 (" + entriesDict.Count + " 项)");
                                    }
                                    return;
                                }
                                object kObj;
                                object vObj;
                                if (kv.TryGetValue("key", out kObj) && kObj is string && kv.TryGetValue("value", out vObj))
                                {
                                    string key = (string)kObj;
                                    if (CdpHelper.UpdateConfigSetting(_baseDir, manifest, key, vObj))
                                    {
                                        if (!string.IsNullOrEmpty(_pluginDir) && Directory.Exists(_pluginDir))
                                        {
                                            try { CdpHelper.UpdateConfigSetting(_pluginDir, manifest, key, vObj); } catch { }
                                        }
                                        Log("[⚙] 设置已保存: " + key + " = " + MiniJson.Stringify(vObj, false));
                                    }
                                }
                            }
                            catch { }
                        });

                        await session.SendAsync("Runtime.enable", null, 5000).ConfigureAwait(false);
                        Dictionary<string, object> bindParams = new Dictionary<string, object>(StringComparer.Ordinal);
                        bindParams["name"] = manifest.SettingBinding;
                        await session.SendAsync("Runtime.addBinding", bindParams, 5000).ConfigureAwait(false);
                        if (!string.Equals(manifest.SettingBinding, "__agClaudeStyleSetting", StringComparison.Ordinal))
                        {
                            try
                            {
                                Dictionary<string, object> legacyBind = new Dictionary<string, object>(StringComparer.Ordinal);
                                legacyBind["name"] = "__agClaudeStyleSetting";
                                await session.SendAsync("Runtime.addBinding", legacyBind, 5000).ConfigureAwait(false);
                            }
                            catch { }
                        }

                        string exprSnapshot;
                        string omniSnapshot;
                        lock (exprLock)
                        {
                            exprSnapshot = currentExpr;
                            omniSnapshot = currentOmniExpr;
                        }
                        Dictionary<string, object> res = await applyAsync(entry, exprSnapshot, omniSnapshot).ConfigureAwait(false);
                        string status = (res != null && res.ContainsKey("status")) ? Convert.ToString(res["status"]) : "ok";
                        Log(string.Format("[✓] 已注入 obsidian-prism: {0} ({1})", entry.Title, status));
                    }
                    catch (Exception ex)
                    {
                        AttachedEntry removed;
                        if (attached.TryRemove(page.Id, out removed) && removed != null && removed.Session != null)
                        {
                            try { removed.Session.Close(); } catch { }
                        }
                        if (session != null)
                        {
                            try { session.Close(); } catch { }
                        }
                        Log(string.Format("[!] 注入失败，稍后重试: {0} — {1}", CdpHelper.ShortTitle(page), ex.Message));
                    }
                };

                Timer reloadTimer = null;
                string pendingFilename = null;
                object timerLock = new object();

                FileSystemWatcher fsw = null;
                try
                {
                    fsw = new FileSystemWatcher(_baseDir);
                    fsw.IncludeSubdirectories = true;
                    fsw.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.CreationTime;
                    FileSystemEventHandler onFsChange = (sender, e) =>
                    {
                        string name = e.Name;
                        if (string.IsNullOrEmpty(name) || name.StartsWith(".", StringComparison.Ordinal)) return;
                        if (!name.EndsWith(".css", StringComparison.OrdinalIgnoreCase) &&
                            !name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) &&
                            !name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                        {
                            return;
                        }
                        lock (timerLock)
                        {
                            pendingFilename = name;
                            if (reloadTimer == null)
                            {
                                reloadTimer = new Timer(async (_) =>
                                {
                                    string changedName;
                                    lock (timerLock) { changedName = pendingFilename; }
                                    try
                                    {
                                        manifest = PluginManifest.Load(_baseDir);
                                        string nextExpr = CdpHelper.BuildInjectExpression(_baseDir, manifest);
                                        string nextOmniExpr = CdpHelper.BuildOmniClientExpression(_baseDir, manifest);
                                        string fastCfgExpr = string.Equals(Path.GetFileName(changedName ?? ""), "config.json", StringComparison.OrdinalIgnoreCase)
                                            ? CdpHelper.BuildConfigRefreshExpression(_baseDir, manifest)
                                            : null;
                                        lock (exprLock)
                                        {
                                            currentExpr = nextExpr;
                                            currentOmniExpr = nextOmniExpr;
                                        }

                                        int n = 0;
                                        foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                        {
                                            AttachedEntry entry = kv.Value;
                                            if (entry == null) continue;
                                            try
                                            {
                                                if (!string.IsNullOrEmpty(fastCfgExpr))
                                                {
                                                    if (!string.IsNullOrEmpty(entry.ScriptId))
                                                    {
                                                        try
                                                        {
                                                            Dictionary<string, object> rmP = new Dictionary<string, object>(StringComparer.Ordinal);
                                                            rmP["identifier"] = entry.ScriptId;
                                                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmP, 5000).ConfigureAwait(false);
                                                        }
                                                        catch { }
                                                    }
                                                    Dictionary<string, object> addP = new Dictionary<string, object>(StringComparer.Ordinal);
                                                    addP["source"] = nextExpr;
                                                    Dictionary<string, object> addR = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addP, 15000).ConfigureAwait(false);
                                                    object idV;
                                                    if (addR.TryGetValue("identifier", out idV)) entry.ScriptId = idV as string;

                                                    if (!string.IsNullOrEmpty(entry.OmniScriptId))
                                                    {
                                                        try
                                                        {
                                                            Dictionary<string, object> rmO = new Dictionary<string, object>(StringComparer.Ordinal);
                                                            rmO["identifier"] = entry.OmniScriptId;
                                                            await entry.Session.SendAsync("Page.removeScriptToEvaluateOnNewDocument", rmO, 5000).ConfigureAwait(false);
                                                        }
                                                        catch { }
                                                        entry.OmniScriptId = null;
                                                    }
                                                    if (!string.IsNullOrEmpty(nextOmniExpr))
                                                    {
                                                        try
                                                        {
                                                            Dictionary<string, object> addO = new Dictionary<string, object>(StringComparer.Ordinal);
                                                            addO["source"] = nextOmniExpr;
                                                            Dictionary<string, object> omniR = await entry.Session.SendAsync("Page.addScriptToEvaluateOnNewDocument", addO, 15000).ConfigureAwait(false);
                                                            object oIdV;
                                                            if (omniR.TryGetValue("identifier", out oIdV)) entry.OmniScriptId = oIdV as string;
                                                        }
                                                        catch { }
                                                    }

                                                    Dictionary<string, object> fastRes = await entry.Session.EvaluateAsync(fastCfgExpr, false).ConfigureAwait(false) as Dictionary<string, object>;
                                                    object refVal;
                                                    if (fastRes != null && fastRes.TryGetValue("refreshed", out refVal) && refVal is bool && (bool)refVal)
                                                    {
                                                        if (!string.IsNullOrEmpty(nextOmniExpr))
                                                        {
                                                            try { await entry.Session.EvaluateAsync(nextOmniExpr, false).ConfigureAwait(false); } catch { }
                                                        }
                                                        n++;
                                                        continue;
                                                    }
                                                    await entry.Session.EvaluateAsync(nextExpr, false).ConfigureAwait(false);
                                                    if (!string.IsNullOrEmpty(nextOmniExpr))
                                                    {
                                                        try { await entry.Session.EvaluateAsync(nextOmniExpr, false).ConfigureAwait(false); } catch { }
                                                    }
                                                    n++;
                                                }
                                                else
                                                {
                                                    await applyAsync(entry, nextExpr, nextOmniExpr).ConfigureAwait(false);
                                                    n++;
                                                }
                                            }
                                            catch { }
                                        }
                                        Log(string.Format("[↻] {0} 已变更，已热更新 {1} 个窗口", changedName, n));
                                    }
                                    catch (Exception ex)
                                    {
                                        Log("[!] 读取文件失败: " + ex.Message);
                                    }
                                }, null, 180, Timeout.Infinite);
                            }
                            else
                            {
                                reloadTimer.Change(180, Timeout.Infinite);
                            }
                        }
                    };
                    fsw.Changed += onFsChange;
                    fsw.Created += onFsChange;
                    fsw.Renamed += (s, e) => onFsChange(s, e);
                    fsw.EnableRaisingEvents = true;
                }
                catch { }

                int? lastPort = null;
                bool yieldingToDaemon = false;
                try
                {
                    while (!exitEvent.IsSet)
                    {
                        try
                        {
                            bool nativeAlive = !string.IsNullOrEmpty(_pluginDir) && CdpHelper.IsNativeDaemonAlive(_pluginDir);
                            if (nativeAlive)
                            {
                                if (!yieldingToDaemon || attached.Count > 0)
                                {
                                    foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                    {
                                        AttachedEntry oldEntry;
                                        if (attached.TryRemove(kv.Key, out oldEntry) && oldEntry != null && oldEntry.Session != null)
                                        {
                                            try { oldEntry.Session.Close(); } catch { }
                                        }
                                    }
                                    lastPort = null;
                                    if (!yieldingToDaemon)
                                    {
                                        yieldingToDaemon = true;
                                        Log("[~] 检测到原生 Sidecar Daemon 运行中，Watcher 进入热备避让态");
                                    }
                                }
                                exitEvent.Wait(750);
                                continue;
                            }
                            if (yieldingToDaemon)
                            {
                                yieldingToDaemon = false;
                                Log("[+] 原生 Sidecar Daemon 已离线，Watcher 接管实时注入");
                            }

                            int? port = CdpHelper.ReadPort(overridePort);
                            if (port.HasValue)
                            {
                                List<CdpPageInfo> pages = null;
                                try
                                {
                                    pages = await CdpHelper.ListPagesAsync(port.Value).ConfigureAwait(false);
                                }
                                catch
                                {
                                    pages = null;
                                }
                                if (pages != null)
                                {
                                    if (!lastPort.HasValue || lastPort.Value != port.Value)
                                    {
                                        // Close stale sessions if Antigravity restarted on a new port
                                        foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                                        {
                                            AttachedEntry oldEntry;
                                            if (attached.TryRemove(kv.Key, out oldEntry) && oldEntry != null && oldEntry.Session != null)
                                            {
                                                try { oldEntry.Session.Close(); } catch { }
                                            }
                                        }
                                        Log("[+] 连接到调试端口 " + port.Value);
                                        lastPort = port.Value;
                                    }

                                    List<Task> tasks = new List<Task>();
                                    for (int i = 0; i < pages.Count; i++)
                                    {
                                        if (!attached.ContainsKey(pages[i].Id))
                                        {
                                            tasks.Add(attachAsync(pages[i]));
                                        }
                                    }
                                    if (tasks.Count > 0)
                                    {
                                        await Task.WhenAll(tasks).ConfigureAwait(false);
                                    }
                                }
                            }
                        }
                        catch { }

                        exitEvent.Wait(2000);
                    }
                }
                finally
                {
                    if (fsw != null) { try { fsw.Dispose(); } catch { } }
                    if (reloadTimer != null) { try { reloadTimer.Dispose(); } catch { } }
                    foreach (KeyValuePair<string, AttachedEntry> kv in attached)
                    {
                        if (kv.Value != null && kv.Value.Session != null)
                        {
                            try { kv.Value.Session.Close(); } catch { }
                        }
                    }
                    try { stopSignal.Dispose(); } catch { }
                    try { exitEvent.Dispose(); } catch { }
                    ReleasePidFile(selfPid);
                }
            }
            return 0;
        }
    }
}
