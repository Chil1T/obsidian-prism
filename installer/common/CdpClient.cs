using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AgyClaudeStyle
{
    public class CdpPageInfo
    {
        public string Id;
        public string Title;
        public string Url;
        public string WebSocketDebuggerUrl;
    }

    public class PluginManifest
    {
        public string Version;
        public string StyleId;
        public string SettingBinding;
        public List<string> Parts;
        public Dictionary<string, object> DefaultConfig;
        public Dictionary<string, object> Validators;
        public string RemoveExpression;

        public static PluginManifest Load(string baseDir)
        {
            string manifestPath = Path.Combine(baseDir, "manifest.json");
            Dictionary<string, object> raw = MiniJson.ParseObject(File.ReadAllText(manifestPath, Encoding.UTF8));
            PluginManifest m = new PluginManifest();
            m.Version = GetString(raw, "version", "1.0.1");
            m.StyleId = GetString(raw, "styleId", "ag-prism-css");
            m.SettingBinding = GetString(raw, "settingBinding", "__agPrismSetting");
            m.RemoveExpression = GetString(raw, "removeExpression", "");
            m.Parts = new List<string>();
            List<object> partsObj = raw.ContainsKey("parts") ? raw["parts"] as List<object> : null;
            if (partsObj != null)
            {
                for (int i = 0; i < partsObj.Count; i++)
                {
                    string s = partsObj[i] as string;
                    if (!string.IsNullOrEmpty(s)) m.Parts.Add(s);
                }
            }
            m.DefaultConfig = raw.ContainsKey("defaultConfig") && raw["defaultConfig"] is Dictionary<string, object>
                ? (Dictionary<string, object>)raw["defaultConfig"]
                : new Dictionary<string, object>(StringComparer.Ordinal);
            m.Validators = raw.ContainsKey("validators") && raw["validators"] is Dictionary<string, object>
                ? (Dictionary<string, object>)raw["validators"]
                : new Dictionary<string, object>(StringComparer.Ordinal);
            return m;
        }

        private static string GetString(Dictionary<string, object> d, string k, string fallback)
        {
            object v;
            if (d.TryGetValue(k, out v) && v is string) return (string)v;
            return fallback;
        }
    }

    public sealed class CdpSession : IDisposable
    {
        private readonly ClientWebSocket _ws;
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private readonly ConcurrentDictionary<int, TaskCompletionSource<Dictionary<string, object>>> _pending =
            new ConcurrentDictionary<int, TaskCompletionSource<Dictionary<string, object>>>();
        private readonly Dictionary<string, List<Action<Dictionary<string, object>>>> _listeners =
            new Dictionary<string, List<Action<Dictionary<string, object>>>>(StringComparer.Ordinal);
        private readonly object _listenerLock = new object();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private int _nextId = 0;
        private volatile bool _closed = false;

        public Action OnClose;

        private CdpSession(ClientWebSocket ws)
        {
            _ws = ws;
        }

        public static async Task<CdpSession> ConnectAsync(string wsUrl, int timeoutMs)
        {
            ClientWebSocket ws = new ClientWebSocket();
            CancellationTokenSource cts = new CancellationTokenSource(timeoutMs);
            try
            {
                await ws.ConnectAsync(new Uri(wsUrl), cts.Token).ConfigureAwait(false);
                CdpSession session = new CdpSession(ws);
                session.StartReceiveLoop();
                return session;
            }
            catch
            {
                try { ws.Dispose(); } catch { }
                throw;
            }
            finally
            {
                cts.Dispose();
            }
        }

        public void On(string method, Action<Dictionary<string, object>> callback)
        {
            lock (_listenerLock)
            {
                List<Action<Dictionary<string, object>>> list;
                if (!_listeners.TryGetValue(method, out list))
                {
                    list = new List<Action<Dictionary<string, object>>>();
                    _listeners[method] = list;
                }
                list.Add(callback);
            }
        }

        public async Task<Dictionary<string, object>> SendAsync(string method, Dictionary<string, object> parameters, int timeoutMs)
        {
            if (_closed) throw new InvalidOperationException("CDP connection closed");
            int id = Interlocked.Increment(ref _nextId);
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["id"] = id;
            payload["method"] = method;
            payload["params"] = parameters ?? new Dictionary<string, object>(StringComparer.Ordinal);
            string json = MiniJson.Stringify(payload, false);
            byte[] bytes = Encoding.UTF8.GetBytes(json);

            TaskCompletionSource<Dictionary<string, object>> tcs =
                new TaskCompletionSource<Dictionary<string, object>>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending[id] = tcs;

            try
            {
                await _sendLock.WaitAsync(_cts.Token).ConfigureAwait(false);
                try
                {
                    if (_closed) throw new InvalidOperationException("CDP connection closed");
                    const int chunkSize = 65536;
                    int offset = 0;
                    while (offset < bytes.Length)
                    {
                        int count = Math.Min(chunkSize, bytes.Length - offset);
                        bool endOfMessage = (offset + count) >= bytes.Length;
                        await _ws.SendAsync(
                            new ArraySegment<byte>(bytes, offset, count),
                            WebSocketMessageType.Text,
                            endOfMessage,
                            _cts.Token
                        ).ConfigureAwait(false);
                        offset += count;
                    }
                }
                finally
                {
                    _sendLock.Release();
                }

                using (CancellationTokenSource delayCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token))
                {
                    Task delayTask = Task.Delay(timeoutMs, delayCts.Token);
                    Task completed = await Task.WhenAny(tcs.Task, delayTask).ConfigureAwait(false);
                    if (completed == tcs.Task)
                    {
                        delayCts.Cancel();
                        return await tcs.Task.ConfigureAwait(false);
                    }
                }
                TaskCompletionSource<Dictionary<string, object>> removed;
                _pending.TryRemove(id, out removed);
                if (_closed) throw new InvalidOperationException("CDP connection closed");
                throw new TimeoutException("CDP " + method + " timeout");
            }
            catch
            {
                TaskCompletionSource<Dictionary<string, object>> removed;
                _pending.TryRemove(id, out removed);
                throw;
            }
        }

        public async Task<object> EvaluateAsync(string expression, bool awaitPromise)
        {
            Dictionary<string, object> parameters = new Dictionary<string, object>(StringComparer.Ordinal);
            parameters["expression"] = expression;
            parameters["returnByValue"] = true;
            parameters["awaitPromise"] = awaitPromise;
            Dictionary<string, object> res = await SendAsync("Runtime.evaluate", parameters, 15000).ConfigureAwait(false);

            object exObj;
            if (res.TryGetValue("exceptionDetails", out exObj) && exObj is Dictionary<string, object>)
            {
                Dictionary<string, object> exDetails = (Dictionary<string, object>)exObj;
                string msg = null;
                object innerEx;
                if (exDetails.TryGetValue("exception", out innerEx) && innerEx is Dictionary<string, object>)
                {
                    object desc;
                    if (((Dictionary<string, object>)innerEx).TryGetValue("description", out desc) && desc is string)
                    {
                        msg = (string)desc;
                    }
                }
                if (string.IsNullOrEmpty(msg))
                {
                    object text;
                    if (exDetails.TryGetValue("text", out text) && text is string) msg = (string)text;
                }
                throw new Exception(msg ?? "Runtime.evaluate exception");
            }

            object resultObj;
            if (res.TryGetValue("result", out resultObj) && resultObj is Dictionary<string, object>)
            {
                object val;
                if (((Dictionary<string, object>)resultObj).TryGetValue("value", out val)) return val;
            }
            return null;
        }

        private void StartReceiveLoop()
        {
            Task.Run(async () =>
            {
                byte[] buffer = new byte[65536];
                MemoryStream ms = new MemoryStream();
                try
                {
                    while (!_cts.IsCancellationRequested && _ws.State == WebSocketState.Open)
                    {
                        ms.SetLength(0);
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token).ConfigureAwait(false);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                return;
                            }
                            if (result.Count > 0)
                            {
                                ms.Write(buffer, 0, result.Count);
                            }
                        } while (!result.EndOfMessage);

                        if (result.MessageType == WebSocketMessageType.Text && ms.Length > 0)
                        {
                            string text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                            HandleMessage(text);
                        }
                    }
                }
                catch
                {
                }
                finally
                {
                    ms.Dispose();
                    MarkClosed();
                }
            });
        }

        private void HandleMessage(string text)
        {
            Dictionary<string, object> msg;
            try
            {
                msg = MiniJson.ParseObject(text);
            }
            catch
            {
                return;
            }

            object methodObj;
            if (msg.TryGetValue("method", out methodObj) && methodObj is string)
            {
                string method = (string)methodObj;
                Dictionary<string, object> p = msg.ContainsKey("params") && msg["params"] is Dictionary<string, object>
                    ? (Dictionary<string, object>)msg["params"]
                    : new Dictionary<string, object>(StringComparer.Ordinal);
                List<Action<Dictionary<string, object>>> snapshot = null;
                lock (_listenerLock)
                {
                    List<Action<Dictionary<string, object>>> list;
                    if (_listeners.TryGetValue(method, out list) && list.Count > 0)
                    {
                        snapshot = new List<Action<Dictionary<string, object>>>(list);
                    }
                }
                if (snapshot != null)
                {
                    for (int i = 0; i < snapshot.Count; i++)
                    {
                        try { snapshot[i](p); } catch { }
                    }
                }
                return;
            }

            object idObj;
            if (msg.TryGetValue("id", out idObj) && idObj != null)
            {
                int id = Convert.ToInt32(idObj);
                TaskCompletionSource<Dictionary<string, object>> tcs;
                if (_pending.TryRemove(id, out tcs))
                {
                    object errObj;
                    if (msg.TryGetValue("error", out errObj) && errObj != null)
                    {
                        string errMsg = null;
                        Dictionary<string, object> errDict = errObj as Dictionary<string, object>;
                        if (errDict != null && errDict.ContainsKey("message")) errMsg = errDict["message"] as string;
                        if (string.IsNullOrEmpty(errMsg)) errMsg = MiniJson.Stringify(errObj, false);
                        tcs.TrySetException(new Exception(errMsg));
                    }
                    else
                    {
                        Dictionary<string, object> resDict = msg.ContainsKey("result") && msg["result"] is Dictionary<string, object>
                            ? (Dictionary<string, object>)msg["result"]
                            : new Dictionary<string, object>(StringComparer.Ordinal);
                        tcs.TrySetResult(resDict);
                    }
                }
            }
        }

        private void MarkClosed()
        {
            if (_closed) return;
            _closed = true;
            foreach (KeyValuePair<int, TaskCompletionSource<Dictionary<string, object>>> kv in _pending)
            {
                TaskCompletionSource<Dictionary<string, object>> tcs;
                if (_pending.TryRemove(kv.Key, out tcs))
                {
                    tcs.TrySetException(new Exception("CDP connection closed"));
                }
            }
            Action cb = OnClose;
            if (cb != null)
            {
                try { cb(); } catch { }
            }
        }

        public void Close()
        {
            MarkClosed();
            try { _cts.Cancel(); } catch { }
            try
            {
                if (_ws.State == WebSocketState.Open)
                {
                    _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait(300);
                }
            }
            catch { }
            try { _ws.Dispose(); } catch { }
        }

        public void Dispose()
        {
            Close();
            try { _cts.Dispose(); } catch { }
            try { _sendLock.Dispose(); } catch { }
        }
    }

    public static class CdpHelper
    {
        private static readonly HttpClient SharedHttp = new HttpClient { Timeout = TimeSpan.FromMilliseconds(2000) };

        public static string GetPortFilePath()
        {
            string appData = Environment.GetEnvironmentVariable("APPDATA");
            if (string.IsNullOrEmpty(appData))
            {
                appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            }
            return Path.Combine(appData, "Antigravity", "DevToolsActivePort");
        }

        public static int? ReadPort(int? overridePort)
        {
            if (overridePort.HasValue && overridePort.Value > 0) return overridePort.Value;
            string envPort = Environment.GetEnvironmentVariable("AG_CDP_PORT");
            if (!string.IsNullOrEmpty(envPort))
            {
                int p;
                if (int.TryParse(envPort.Trim(), out p) && p > 0) return p;
            }
            try
            {
                string portFile = GetPortFilePath();
                if (!File.Exists(portFile)) return null;
                string[] lines = File.ReadAllLines(portFile, Encoding.UTF8);
                if (lines.Length == 0) return null;
                int p;
                if (int.TryParse(lines[0].Trim(), out p) && p > 0) return p;
            }
            catch { }
            return null;
        }

        public static bool IsEligibleTarget(string type, string wsUrl, string title, string pageUrl)
        {
            if (type != "page" || string.IsNullOrEmpty(wsUrl)) return false;
            string url = (pageUrl ?? "").Trim();
            string ttl = (title ?? "").Trim();
            if (url.Length == 0) return false;
            if (url.StartsWith("devtools://", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("about:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("chrome:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("chrome-extension:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("edge:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("blob:", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("plugin:", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            string combined = ttl + " " + url;
            if (combined.IndexOf("Untitled", StringComparison.OrdinalIgnoreCase) >= 0 ||
                combined.IndexOf("launchpad", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return false;
            }
            if (url.StartsWith("vscode-file://", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("app://", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            if (url.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
            {
                return url.IndexOf("workbench", StringComparison.OrdinalIgnoreCase) >= 0 ||
                       url.IndexOf("antigravity", StringComparison.OrdinalIgnoreCase) >= 0 ||
                       ttl.IndexOf("antigravity", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return false;
            string scheme = (uri.Scheme ?? "").ToLowerInvariant();
            if (scheme != "http" && scheme != "https") return false;
            string host = (uri.Host ?? "").ToLowerInvariant();
            if (host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]") return false;
            string absPath = (uri.AbsolutePath ?? "/").ToLowerInvariant();
            if (absPath == "/viewer" || absPath.StartsWith("/viewer/", StringComparison.Ordinal) ||
                absPath == "/sandbox" || absPath.StartsWith("/sandbox/", StringComparison.Ordinal) ||
                absPath == "/stream" || absPath.StartsWith("/stream/", StringComparison.Ordinal) ||
                absPath == "/api" || absPath.StartsWith("/api/", StringComparison.Ordinal))
            {
                return false;
            }
            if (ttl.IndexOf("antigravity", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (scheme == "https" && (ttl.Length == 0 || ttl.StartsWith("127.0.0.1", StringComparison.OrdinalIgnoreCase)))
            {
                return true;
            }
            return false;
        }

        public static async Task<List<CdpPageInfo>> ListPagesAsync(int port)
        {
            string url = string.Format("http://127.0.0.1:{0}/json/list", port);
            string json = await SharedHttp.GetStringAsync(url).ConfigureAwait(false);
            List<object> targets = MiniJson.ParseArray(json);
            List<CdpPageInfo> pages = new List<CdpPageInfo>();
            for (int i = 0; i < targets.Count; i++)
            {
                Dictionary<string, object> t = targets[i] as Dictionary<string, object>;
                if (t == null) continue;
                string type = GetStr(t, "type");
                string wsUrl = GetStr(t, "webSocketDebuggerUrl");
                string title = GetStr(t, "title") ?? "";
                string pageUrl = GetStr(t, "url") ?? "";
                if (IsEligibleTarget(type, wsUrl, title, pageUrl))
                {
                    CdpPageInfo info = new CdpPageInfo();
                    info.Id = GetStr(t, "id") ?? wsUrl;
                    info.Title = title;
                    info.Url = pageUrl;
                    info.WebSocketDebuggerUrl = wsUrl;
                    pages.Add(info);
                }
            }
            return pages;
        }

        private static bool ToBoolOnOff(object v)
        {
            if (v is bool) return (bool)v;
            string s = v as string;
            return s != null && !string.Equals(s, "off", StringComparison.OrdinalIgnoreCase) && !string.Equals(s, "false", StringComparison.OrdinalIgnoreCase);
        }

        public static Dictionary<string, object> ReconcileConfigAliases(Dictionary<string, object> raw)
        {
            Dictionary<string, object> res = new Dictionary<string, object>(StringComparer.Ordinal);
            if (raw != null)
            {
                foreach (KeyValuePair<string, object> kv in raw) res[kv.Key] = kv.Value;
            }
            if (res.ContainsKey("language")) res["lang"] = res["language"];
            else if (res.ContainsKey("lang")) res["language"] = res["lang"];

            if (res.ContainsKey("homeLayout")) res["homeMode"] = res["homeLayout"];
            else if (res.ContainsKey("homeMode")) res["homeLayout"] = res["homeMode"];

            if (res.ContainsKey("homeRipple") || res.ContainsKey("ripple"))
            {
                bool on = res.ContainsKey("homeRipple") ? ToBoolOnOff(res["homeRipple"]) : ToBoolOnOff(res["ripple"]);
                res["homeRipple"] = on;
                res["ripple"] = on ? "on" : "off";
            }
            if (res.ContainsKey("composerRestyle") || res.ContainsKey("composer"))
            {
                bool on = res.ContainsKey("composerRestyle") ? ToBoolOnOff(res["composerRestyle"]) : ToBoolOnOff(res["composer"]);
                res["composerRestyle"] = on;
                res["composer"] = on ? "on" : "off";
            }
            if (res.ContainsKey("placeholderStyle")) res["promptStyle"] = res["placeholderStyle"];
            else if (res.ContainsKey("promptStyle")) res["placeholderStyle"] = res["promptStyle"];

            if (res.ContainsKey("sidebarRestyle") || res.ContainsKey("sidebar"))
            {
                bool on = res.ContainsKey("sidebarRestyle") ? ToBoolOnOff(res["sidebarRestyle"]) : ToBoolOnOff(res["sidebar"]);
                res["sidebarRestyle"] = on;
                res["sidebar"] = on ? "on" : "off";
            }
            if (res.ContainsKey("sidebarCompact"))
            {
                res["sidebarCompact"] = ToBoolOnOff(res["sidebarCompact"]);
            }
            if (res.ContainsKey("smoothCaret"))
            {
                res["smoothCaret"] = ToBoolOnOff(res["smoothCaret"]);
            }
            if (res.ContainsKey("codeLigatures"))
            {
                object cl = res["codeLigatures"];
                if (cl is bool)
                {
                    res["codeLigatures"] = (bool)cl;
                }
                else
                {
                    string cls = cl as string;
                    res["codeLigatures"] = cls != null && (string.Equals(cls, "on", StringComparison.OrdinalIgnoreCase) || string.Equals(cls, "true", StringComparison.OrdinalIgnoreCase));
                }
            }
            return res;
        }

        public static Dictionary<string, object> ReadConfig(string baseDir, PluginManifest manifest)
        {
            Dictionary<string, object> cfg = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> kv in manifest.DefaultConfig)
            {
                cfg[kv.Key] = kv.Value;
            }
            try
            {
                string cfgPath = Path.Combine(baseDir, "config.json");
                if (File.Exists(cfgPath))
                {
                    Dictionary<string, object> userCfg = ReconcileConfigAliases(MiniJson.ParseObject(File.ReadAllText(cfgPath, Encoding.UTF8)));
                    foreach (KeyValuePair<string, object> kv in userCfg)
                    {
                        cfg[kv.Key] = kv.Value;
                    }
                }
            }
            catch { }
            return ReconcileConfigAliases(cfg);
        }

        public static bool ValidateConfigEntry(PluginManifest manifest, string key, object value)
        {
            if (manifest == null || manifest.Validators == null || string.IsNullOrEmpty(key)) return false;
            object rule;
            if (!manifest.Validators.TryGetValue(key, out rule)) return false;
            string ruleStr = rule as string;
            if (ruleStr == "boolean")
            {
                if (!(value is bool))
                {
                    string sv = value as string;
                    if (sv != "on" && sv != "off") return false;
                }
                return true;
            }
            if (rule is List<object>)
            {
                string strVal = value as string;
                if (strVal == null) return false;
                List<object> allowed = (List<object>)rule;
                for (int i = 0; i < allowed.Count; i++)
                {
                    if (string.Equals(allowed[i] as string, strVal, StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static void AtomicWriteJson(string cfgPath, Dictionary<string, object> next)
        {
            string tmpPath = cfgPath + ".tmp";
            string content = MiniJson.Stringify(next, true) + "\n";
            File.WriteAllText(tmpPath, content, new UTF8Encoding(false));
            if (File.Exists(cfgPath))
            {
                try
                {
                    File.Replace(tmpPath, cfgPath, null);
                }
                catch
                {
                    File.WriteAllText(cfgPath, content, new UTF8Encoding(false));
                    try { File.Delete(tmpPath); } catch { }
                }
            }
            else
            {
                File.Move(tmpPath, cfgPath);
            }
        }

        public static bool UpdateConfigBatch(string baseDir, PluginManifest manifest, Dictionary<string, object> entries)
        {
            if (entries == null || entries.Count == 0) return false;
            Dictionary<string, object> validPatch = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> kv in entries)
            {
                if (ValidateConfigEntry(manifest, kv.Key, kv.Value))
                {
                    validPatch[kv.Key] = kv.Value;
                }
            }
            if (validPatch.Count == 0) return false;

            Dictionary<string, object> reconciledPatch = ReconcileConfigAliases(validPatch);
            Dictionary<string, object> next = ReadConfig(baseDir, manifest);
            foreach (KeyValuePair<string, object> kv in reconciledPatch)
            {
                next[kv.Key] = kv.Value;
            }
            AtomicWriteJson(Path.Combine(baseDir, "config.json"), next);
            return true;
        }

        public static bool UpdateConfigSetting(string baseDir, PluginManifest manifest, string key, object value)
        {
            Dictionary<string, object> single = new Dictionary<string, object>(StringComparer.Ordinal);
            single[key] = value;
            return UpdateConfigBatch(baseDir, manifest, single);
        }

        public static string GetDefaultNativePluginDir()
        {
            string envOverride = Environment.GetEnvironmentVariable("AG_PRISM_PLUGIN_DIR");
            if (!string.IsNullOrEmpty(envOverride))
            {
                return Path.GetFullPath(envOverride.Trim()).TrimEnd('\\', '/');
            }
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (string.IsNullOrEmpty(home))
            {
                home = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
            }
            return Path.Combine(home, ".gemini", "config", "plugins", "obsidian-prism");
        }

        public static int? ReadNativeDaemonPid(string pluginDir)
        {
            if (string.IsNullOrEmpty(pluginDir)) return null;
            try
            {
                string pidPath = Path.Combine(pluginDir, ".daemon.pid");
                if (!File.Exists(pidPath)) return null;
                string raw = File.ReadAllText(pidPath, Encoding.UTF8).Trim();
                if (string.IsNullOrEmpty(raw)) return null;
                int plainPid;
                if (int.TryParse(raw, out plainPid) && plainPid > 0) return plainPid;
                if (raw.StartsWith("{", StringComparison.Ordinal))
                {
                    Dictionary<string, object> obj = MiniJson.ParseObject(raw);
                    object pidVal;
                    if (obj != null && obj.TryGetValue("pid", out pidVal) && pidVal != null)
                    {
                        int parsed = Convert.ToInt32(pidVal);
                        if (parsed > 0) return parsed;
                    }
                }
            }
            catch { }
            return null;
        }

        private static string QueryWindowsProcessCommandLine(int pid)
        {
            if (pid <= 0) return "";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -NonInteractive -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "').CommandLine\"";
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    if (p == null) return "";
                    Task<string> readTask = p.StandardOutput.ReadToEndAsync();
                    if (!p.WaitForExit(7500))
                    {
                        try { p.Kill(); } catch { }
                        return "";
                    }
                    return readTask.GetAwaiter().GetResult() ?? "";
                }
            }
            catch
            {
                return "";
            }
        }

        private static bool MatchesNativeLockFilePid(int pid, out long startedAtMs)
        {
            startedAtMs = 0L;
            if (pid <= 0) return false;
            try
            {
                string pidPath = Path.Combine(GetDefaultNativePluginDir(), ".daemon.pid");
                if (!File.Exists(pidPath)) return false;
                string raw = File.ReadAllText(pidPath, Encoding.UTF8).Trim();
                if (string.IsNullOrEmpty(raw)) return false;
                int plainPid;
                if (int.TryParse(raw, out plainPid)) return plainPid == pid;
                if (raw.StartsWith("{", StringComparison.Ordinal))
                {
                    Dictionary<string, object> obj = MiniJson.ParseObject(raw);
                    object pidVal;
                    if (obj != null && obj.TryGetValue("pid", out pidVal) && pidVal != null && Convert.ToInt32(pidVal) == pid)
                    {
                        object stVal;
                        if (obj.TryGetValue("startedAt", out stVal) && stVal != null)
                        {
                            startedAtMs = Convert.ToInt64(stVal);
                        }
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        public static bool IsExpectedPrismDaemonProcess(Process proc)
        {
            if (proc == null) return false;
            try
            {
                string name = (proc.ProcessName ?? "").ToLowerInvariant();
                if (string.IsNullOrEmpty(name)) return false;
                if (name.Contains("node") ||
                    name.Contains("watcher") ||
                    name.Contains("obsidian-prism") ||
                    name.Contains("agy-claude-style"))
                {
                    return true;
                }
                if (name.Contains("antigravity") || name.Contains("electron") || name == "agy")
                {
                    long lockStartedMs;
                    bool matchedLock = MatchesNativeLockFilePid(proc.Id, out lockStartedMs);
                    if (matchedLock && lockStartedMs > 0L)
                    {
                        try
                        {
                            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                            long procStartMs = (long)(proc.StartTime.ToUniversalTime() - epoch).TotalMilliseconds;
                            if (procStartMs <= lockStartedMs + 5000L && (lockStartedMs - procStartMs) <= 120000L)
                            {
                                return true;
                            }
                            return false;
                        }
                        catch { }
                    }
                    string cmd = QueryWindowsProcessCommandLine(proc.Id).Replace('\\', '/').ToLowerInvariant();
                    if (string.IsNullOrEmpty(cmd) || cmd.Contains("--type=")) return false;
                    bool hasPrismOwner = cmd.Contains("obsidian-prism") || cmd.Contains("antigravity-prism") || cmd.Contains("agy-claude-style");
                    bool hasDaemonEntry = cmd.Contains("sidecars/daemon/main.mjs") || cmd.Contains("/daemon/main.mjs") || cmd.Contains("/watch.js");
                    if (hasPrismOwner && hasDaemonEntry) return true;
                    if (matchedLock && cmd.Contains("sidecar_sdk/register_loader.js") && cmd.Contains("main.mjs")) return true;
                    return false;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        public static bool IsNativeDaemonAlive(string pluginDir)
        {
            int? pid = ReadNativeDaemonPid(pluginDir);
            if (!pid.HasValue || pid.Value <= 0) return false;
            Process proc = null;
            try
            {
                proc = Process.GetProcessById(pid.Value);
                return !proc.HasExited;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (proc != null)
                {
                    try { proc.Dispose(); } catch { }
                }
            }
        }

        public static string ComputeHash(string str)
        {
            unchecked
            {
                uint h = 2166136261u;
                for (int i = 0; i < str.Length; i++)
                {
                    h ^= (uint)str[i];
                    h *= 16777619u;
                }
                return ToBase36(h);
            }
        }

        private static string ToBase36(uint value)
        {
            const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
            if (value == 0) return "0";
            char[] buf = new char[8];
            int pos = buf.Length;
            while (value > 0)
            {
                buf[--pos] = digits[(int)(value % 36u)];
                value /= 36u;
            }
            return new string(buf, pos, buf.Length - pos);
        }

        public static string ReadRuntimeBundle(string baseDir, PluginManifest manifest)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < manifest.Parts.Count; i++)
            {
                if (i > 0) sb.Append('\n');
                string rel = manifest.Parts[i].Replace('/', Path.DirectorySeparatorChar);
                sb.Append(File.ReadAllText(Path.Combine(baseDir, rel), Encoding.UTF8));
            }
            return sb.ToString();
        }

        public static string BuildConfigRefreshExpression(string baseDir, PluginManifest manifest)
        {
            Dictionary<string, object> config = ReadConfig(baseDir, manifest);
            string codeHash = "";
            try { codeHash = ComputeHash(ReadRuntimeBundle(baseDir, manifest)); } catch { }
            Dictionary<string, object> nextCfg = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> kv in config)
            {
                nextCfg[kv.Key] = kv.Value;
            }
            nextCfg["binding"] = manifest.SettingBinding;
            if (!string.IsNullOrEmpty(codeHash)) nextCfg["codeHash"] = codeHash;
            nextCfg["__fromFile"] = true;
            string cfgJson = MiniJson.Stringify(nextCfg, false);
            string verJson = MiniJson.StringifyString(manifest.Version);
            string hashJson = MiniJson.StringifyString(codeHash);

            StringBuilder sb = new StringBuilder(cfgJson.Length + 768);
            sb.Append("(() => {\n");
            sb.Append("    const nextCfg = ").Append(cfgJson).Append(";\n");
            sb.Append("    const api = window.__agPrism || window.__agClaudeStyle;\n");
            sb.Append("    if (!api || api.version !== ").Append(verJson).Append(" || typeof api.refreshConfig !== 'function') return { ok: false, refreshed: false };\n");
            sb.Append("    if (").Append(hashJson).Append(" && api.codeHash && api.codeHash !== ").Append(hashJson).Append(") return { ok: false, refreshed: false };\n");
            sb.Append("    api.refreshConfig(nextCfg);\n");
            sb.Append("    const liveState = typeof api.getState === 'function' ? api.getState() : null;\n");
            sb.Append("    const effectiveCfg = (liveState && liveState.cfg) || nextCfg;\n");
            sb.Append("    try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("    try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("    try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("    try { if (effectiveCfg.omniModule === 'off') window.__agPrismOmni?.destroy?.(); else window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}\n");
            sb.Append("    return { ok: true, refreshed: true, state: liveState };\n");
            sb.Append("  })()");
            return sb.ToString();
        }

        public static string BuildOmniClientExpression(string baseDir, PluginManifest manifest)
        {
            string omniPath = Path.Combine(baseDir, Path.Combine("vendor", Path.Combine("omni-viewer", "omni-client.js")));
            if (!File.Exists(omniPath)) return "";
            string clientSource = File.ReadAllText(omniPath, Encoding.UTF8);
            if (string.IsNullOrEmpty(clientSource)) return "";
            Dictionary<string, object> config = ReadConfig(baseDir, manifest);
            string cfgJson = MiniJson.Stringify(config, false);
            string hashJson = MiniJson.StringifyString(ComputeHash(clientSource));
            StringBuilder sb = new StringBuilder(clientSource.Length + cfgJson.Length + 1024);
            sb.Append("(() => {\n");
            sb.Append("  const href = String((typeof location !== 'undefined' && location && location.href) || '');\n");
            sb.Append("  if (/^(devtools:|chrome:|chrome-extension:|edge:|about:|data:|blob:|plugin:)/i.test(href)) return { ok: false, skipped: true };\n");
            sb.Append("  if (/^https?:\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?\\/(?:viewer|sandbox|stream|api)(?:[/?#]|$)/i.test(href)) return { ok: false, skipped: true };\n");
            sb.Append("  const bootCfg = ").Append(cfgJson).Append(";\n");
            sb.Append("  const nextHash = ").Append(hashJson).Append(";\n");
            sb.Append("  const liveCfg = (window.__agPrism && typeof window.__agPrism.getState === 'function' && window.__agPrism.getState()?.cfg) || bootCfg;\n");
            sb.Append("  const serverMeta = window.__agPrismOmniServerMeta || null;\n");
            sb.Append("  const prev = window.__agPrismOmni;\n");
            sb.Append("  const reused = Boolean(prev && prev.codeHash === nextHash && typeof prev.sync === 'function');\n");
            sb.Append("  if (!reused) {\n");
            sb.Append("    try { prev?.destroy?.(); } catch {}\n");
            sb.Append("    ").Append(clientSource).Append('\n');
            sb.Append("    if (window.__agPrismOmni && typeof window.__agPrismOmni === 'object') {\n");
            sb.Append("      try { window.__agPrismOmni.codeHash = nextHash; } catch {}\n");
            sb.Append("    }\n");
            sb.Append("  }\n");
            sb.Append("  try { window.__agPrismOmni?.sync?.(liveCfg, serverMeta); } catch {}\n");
            sb.Append("  if (liveCfg && liveCfg.omniModule === 'off') return { ok: true, status: 'disabled' };\n");
            sb.Append("  return { ok: true, status: reused ? 'synced' : (window.__agPrismOmni ? 'mounted' : 'ready') };\n");
            sb.Append("})()");
            return sb.ToString();
        }

        public static string BuildInjectExpression(string baseDir, PluginManifest manifest)
        {
            Dictionary<string, object> config = ReadConfig(baseDir, manifest);
            string css = File.ReadAllText(Path.Combine(baseDir, "style.css"), Encoding.UTF8);
            string bundle = ReadRuntimeBundle(baseDir, manifest);
            string codeHash = ComputeHash(bundle);

            Dictionary<string, object> initCfg = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> kv in config)
            {
                initCfg[kv.Key] = kv.Value;
            }
            initCfg["binding"] = manifest.SettingBinding;
            initCfg["codeHash"] = codeHash;
            initCfg["__fromFile"] = true;

            string styleIdJson = MiniJson.StringifyString(manifest.StyleId);
            string verJson = MiniJson.StringifyString(manifest.Version);
            StringBuilder sb = new StringBuilder(css.Length + bundle.Length + 4608);
            sb.Append("(() => {\n");
            sb.Append("    const css = ");
            sb.Append(MiniJson.StringifyString(css));
            sb.Append(";\n");
            sb.Append("    const migrateLegacyStorage = () => {\n");
            sb.Append("      try {\n");
            sb.Append("        if (typeof localStorage === 'undefined' || !localStorage) return;\n");
            sb.Append("        const legacyRaw = localStorage.getItem('ag-claude-style:config');\n");
            sb.Append("        const v3Raw = localStorage.getItem('agClaudeStyle.settings.v3');\n");
            sb.Append("        const prismRaw = localStorage.getItem('ag-prism:config');\n");
            sb.Append("        if (!prismRaw && (legacyRaw || v3Raw)) localStorage.setItem('ag-prism:config', legacyRaw || v3Raw);\n");
            sb.Append("        if (!v3Raw && (prismRaw || legacyRaw)) localStorage.setItem('agClaudeStyle.settings.v3', prismRaw || legacyRaw);\n");
            sb.Append("      } catch {}\n");
            sb.Append("    };\n");
            sb.Append("    const cleanupLegacyResidue = () => {\n");
            sb.Append("      try { const oldStyle = document.getElementById('ag-claude-style-css'); if (oldStyle) oldStyle.remove(); } catch {}\n");
            sb.Append("      try { const oldApi = window.__agClaudeStyle; if (oldApi && (!window.__agPrism || Number(oldApi.version) <= 2)) { if (typeof oldApi.destroy === 'function') oldApi.destroy(); delete window.__agClaudeStyle; } } catch {}\n");
            sb.Append("    };\n");
            sb.Append("    const applyStyle = () => {\n");
            sb.Append("      const targetParent = document.head || document.documentElement;\n");
            sb.Append("      if (!targetParent) return;\n");
            sb.Append("      cleanupLegacyResidue();\n");
            sb.Append("      let style = document.getElementById(").Append(styleIdJson).Append(");\n");
            sb.Append("      if (!style) {\n");
            sb.Append("        style = document.createElement('style');\n");
            sb.Append("        style.id = ").Append(styleIdJson).Append(";\n");
            sb.Append("      }\n");
            sb.Append("      if (style.textContent !== css) style.textContent = css;\n");
            sb.Append("      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {\n");
            sb.Append("        targetParent.appendChild(style);\n");
            sb.Append("      }\n");
            sb.Append("    };\n\n");
            sb.Append("    let status = 'ok';\n");
            sb.Append("    let mounted = false;\n");
            sb.Append("    const mount = () => {\n");
            sb.Append("      if (mounted || !document.documentElement) return;\n");
            sb.Append("      mounted = true;\n");
            sb.Append("      try {\n");
            sb.Append("        cleanupLegacyResidue();\n");
            sb.Append("        if (!window.__agPrismRepoBridge) {\n");
            sb.Append("          const fn = (a) => Promise.resolve({ ok: false, offline: true, action: typeof a === 'string' ? a : (a && a.action) || 'status', noRemote: true, hasRemote: false, branch: 'local', commit: ").Append(verJson).Append(", shortHash: ").Append(verJson).Append(" });\n");
            sb.Append("          fn.call = fn; fn.request = fn; fn.status = () => fn('status'); fn.pull = () => fn('pull'); fn.sync = () => fn('pull'); fn.resolve = () => {};\n");
            sb.Append("          window.__agPrismRepoBridge = fn;\n");
            sb.Append("        }\n");
            sb.Append("        if (document.head) applyStyle();\n");
            sb.Append("        else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });\n");
            sb.Append("        const bootCfg = ").Append(MiniJson.Stringify(initCfg, false)).Append(";\n");
            sb.Append("        const existingPrism = window.__agPrism || window.__agClaudeStyle;\n");
            sb.Append("        const bundleUnchanged = Boolean(\n");
            sb.Append("          existingPrism &&\n");
            sb.Append("          existingPrism.version === ").Append(verJson).Append(" &&\n");
            sb.Append("          existingPrism.codeHash === bootCfg.codeHash &&\n");
            sb.Append("          typeof existingPrism.refreshConfig === 'function' &&\n");
            sb.Append("          window.__agPrismTelemetry &&\n");
            sb.Append("          window.__agPrismEffortSlider &&\n");
            sb.Append("          window.__agPrismThought\n");
            sb.Append("        );\n");
            sb.Append("        if (bundleUnchanged) {\n");
            sb.Append("          existingPrism.refreshConfig(bootCfg);\n");
            sb.Append("        } else {\n");
            sb.Append("          try { window.__agPrismThought?.destroy?.(); } catch {}\n");
            sb.Append("          ").Append(bundle).Append('\n');
            sb.Append("          if (typeof globalThis.__agCsUiMain === 'function') {\n");
            sb.Append("            globalThis.__agCsUiMain(bootCfg);\n");
            sb.Append("          }\n");
            sb.Append("        }\n");
            sb.Append("        migrateLegacyStorage();\n");
            sb.Append("        if (window.__agClaudeStyle && !window.__agPrism) window.__agPrism = window.__agClaudeStyle;\n");
            sb.Append("        else if (window.__agPrism) window.__agClaudeStyle = window.__agPrism;\n");
            sb.Append("        const liveState = window.__agPrism && typeof window.__agPrism.getState === 'function' ? window.__agPrism.getState() : null;\n");
            sb.Append("        const effectiveCfg = (liveState && liveState.cfg) || bootCfg;\n");
            sb.Append("        try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("        try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("        try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}\n");
            sb.Append("        try { if (effectiveCfg.omniModule === 'off') window.__agPrismOmni?.destroy?.(); else window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}\n");
            sb.Append("        if (document.documentElement && !document.documentElement.hasAttribute('data-ag-prism')) {\n");
            sb.Append("          document.documentElement.setAttribute('data-ag-prism', ").Append(verJson).Append(");\n");
            sb.Append("        }\n");
            sb.Append("      } catch (e) {\n");
            sb.Append("        status = 'error: ' + (e && e.message ? e.message : String(e));\n");
            sb.Append("        if (typeof console !== 'undefined' && console.error) {\n");
            sb.Append("          console.error('[obsidian-prism] init error:', e);\n");
            sb.Append("        }\n");
            sb.Append("      }\n");
            sb.Append("    };\n\n");
            sb.Append("    if (document.documentElement) {\n");
            sb.Append("      mount();\n");
            sb.Append("    } else {\n");
            sb.Append("      status = 'deferred';\n");
            sb.Append("      const onReady = () => {\n");
            sb.Append("        if (document.documentElement) {\n");
            sb.Append("          document.removeEventListener('readystatechange', onReady);\n");
            sb.Append("          document.removeEventListener('DOMContentLoaded', onReady);\n");
            sb.Append("          mount();\n");
            sb.Append("        }\n");
            sb.Append("      };\n");
            sb.Append("      document.addEventListener('readystatechange', onReady);\n");
            sb.Append("      document.addEventListener('DOMContentLoaded', onReady);\n");
            sb.Append("    }\n");
            sb.Append("    const api = window.__agPrism || window.__agClaudeStyle;\n");
            sb.Append("    const st = api && typeof api.getState === 'function' ? api.getState() : null;\n");
            sb.Append("    return {\n");
            sb.Append("      version: ").Append(verJson).Append(",\n");
            sb.Append("      status,\n");
            sb.Append("      state: st,\n");
            sb.Append("    };\n");
            sb.Append("  })()");
            return sb.ToString();
        }

        public static string ShortTitle(CdpPageInfo page)
        {
            string t = !string.IsNullOrEmpty(page.Title) ? page.Title : (page.Url ?? "");
            return t.Length > 60 ? t.Substring(0, 57) + "..." : t;
        }

        private static string GetStr(Dictionary<string, object> d, string k)
        {
            object v;
            if (d.TryGetValue(k, out v) && v is string) return (string)v;
            return null;
        }
    }
}
