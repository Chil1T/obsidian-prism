using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AgyClaudeStyle
{
    public class BareHostProcessInfo
    {
        public int Pid;
        public string ExePath;
        public long StartTimeMs;
        public long UptimeMs;
    }
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
            m.Version = GetString(raw, "version", "1.0.4");
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

        public static bool IsBareAuxiliaryTarget(string title, string pageUrl)
        {
            string ttl = (title ?? "").Trim();
            if (string.Equals(ttl, "Untitled", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(ttl, "launchpad", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            string rawUrl = (pageUrl ?? "").Trim();
            int qIdx = rawUrl.IndexOfAny(new char[] { '?', '#' });
            string cleanUrl = (qIdx >= 0 ? rawUrl.Substring(0, qIdx) : rawUrl).TrimEnd('/');
            if (string.Equals(cleanUrl, "launchpad", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(cleanUrl, "launchpad.html", StringComparison.OrdinalIgnoreCase) ||
                cleanUrl.EndsWith("/launchpad", StringComparison.OrdinalIgnoreCase) ||
                cleanUrl.EndsWith("/launchpad.html", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return false;
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
            if (IsBareAuxiliaryTarget(ttl, url))
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

        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const int ProcessCommandLineInformation = 60;

        [StructLayout(LayoutKind.Sequential)]
        private struct UNICODE_STRING
        {
            public ushort Length;
            public ushort MaximumLength;
            public IntPtr Buffer;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr processHandle,
            int processInformationClass,
            IntPtr processInformation,
            int processInformationLength,
            out int returnLength
        );

        private static readonly object _daemonCacheLock = new object();
        private static int _verifiedDaemonPid = 0;
        private static long _verifiedStartTicks = 0L;

        private static string QueryProcessCommandLineFast(int pid)
        {
            if (pid <= 0) return "";
            IntPtr hProc = IntPtr.Zero;
            IntPtr buf = IntPtr.Zero;
            try
            {
                hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (hProc == IntPtr.Zero) return "";
                int allocSize = 2048;
                buf = Marshal.AllocHGlobal(allocSize);
                int reqLen = 0;
                int status = NtQueryInformationProcess(hProc, ProcessCommandLineInformation, buf, allocSize, out reqLen);
                if (status != 0 && reqLen > allocSize && reqLen <= 262144)
                {
                    Marshal.FreeHGlobal(buf);
                    allocSize = reqLen + 64;
                    buf = Marshal.AllocHGlobal(allocSize);
                    status = NtQueryInformationProcess(hProc, ProcessCommandLineInformation, buf, allocSize, out reqLen);
                }
                if (status == 0)
                {
                    UNICODE_STRING us = (UNICODE_STRING)Marshal.PtrToStructure(buf, typeof(UNICODE_STRING));
                    if (us.Buffer != IntPtr.Zero && us.Length > 0)
                    {
                        return Marshal.PtrToStringUni(us.Buffer, us.Length / 2) ?? "";
                    }
                }
            }
            catch { }
            finally
            {
                if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
                if (hProc != IntPtr.Zero) CloseHandle(hProc);
            }
            return "";
        }

        private static string QueryWindowsProcessCommandLine(int pid)
        {
            if (pid <= 0) return "";
            string fastCmd = QueryProcessCommandLineFast(pid);
            if (!string.IsNullOrEmpty(fastCmd)) return fastCmd;
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

        private static bool MatchesNativeLockFilePid(int pid, string pluginDir)
        {
            if (pid <= 0) return false;
            List<string> dirs = new List<string>();
            if (!string.IsNullOrEmpty(pluginDir)) dirs.Add(pluginDir);
            string defDir = GetDefaultNativePluginDir();
            if (!string.IsNullOrEmpty(defDir) && !dirs.Contains(defDir)) dirs.Add(defDir);
            for (int d = 0; d < dirs.Count; d++)
            {
                try
                {
                    string pidPath = Path.Combine(dirs[d], ".daemon.pid");
                    if (!File.Exists(pidPath)) continue;
                    string raw = File.ReadAllText(pidPath, Encoding.UTF8).Trim();
                    if (string.IsNullOrEmpty(raw)) continue;
                    int plainPid;
                    if (int.TryParse(raw, out plainPid) && plainPid == pid) return true;
                    if (raw.StartsWith("{", StringComparison.Ordinal))
                    {
                        Dictionary<string, object> obj = MiniJson.ParseObject(raw);
                        object pidVal;
                        if (obj != null && obj.TryGetValue("pid", out pidVal) && pidVal != null && Convert.ToInt32(pidVal) == pid)
                        {
                            return true;
                        }
                    }
                }
                catch { }
            }
            return false;
        }

        public static bool IsExpectedPrismDaemonProcess(Process proc, string pluginDir = null)
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
                    bool matchedLock = MatchesNativeLockFilePid(proc.Id, pluginDir);
                    string cmd = QueryWindowsProcessCommandLine(proc.Id).Replace('\\', '/').ToLowerInvariant();
                    if (string.IsNullOrEmpty(cmd) || cmd.Contains("--type=")) return false;
                    bool hasPrismOwner = cmd.Contains("obsidian-prism") || cmd.Contains("antigravity-prism") || cmd.Contains("agy-claude-style");
                    if (!hasPrismOwner && !string.IsNullOrEmpty(pluginDir))
                    {
                        string normPlugin = pluginDir.Replace('\\', '/').TrimEnd('/').ToLowerInvariant();
                        if (!string.IsNullOrEmpty(normPlugin) && cmd.Contains(normPlugin)) hasPrismOwner = true;
                    }
                    bool hasDaemonEntry = cmd.Contains("sidecars/daemon/main.mjs") || cmd.Contains("/daemon/main.mjs") || cmd.Contains("/watch.js");
                    if ((hasPrismOwner || matchedLock) && hasDaemonEntry) return true;
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

        public static string ResolveHostGeminiConfigDir(string pluginDir)
        {
            string envDir = Environment.GetEnvironmentVariable("AG_PRISM_GEMINI_CONFIG_DIR");
            if (!string.IsNullOrEmpty(envDir))
            {
                return Path.GetFullPath(envDir.Trim()).TrimEnd('\\', '/');
            }
            string defPlugin = Path.GetFullPath(GetDefaultNativePluginDir()).TrimEnd('\\', '/');
            string resolvedPlugin = string.IsNullOrEmpty(pluginDir) ? defPlugin : Path.GetFullPath(pluginDir).TrimEnd('\\', '/');
            if (string.Equals(resolvedPlugin, defPlugin, StringComparison.OrdinalIgnoreCase))
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                if (string.IsNullOrEmpty(home)) home = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
                return Path.Combine(home, ".gemini", "config");
            }
            string parent = Path.GetDirectoryName(resolvedPlugin);
            if (!string.IsNullOrEmpty(parent) && string.Equals(Path.GetFileName(parent), "plugins", StringComparison.OrdinalIgnoreCase))
            {
                return Path.GetDirectoryName(parent);
            }
            return null;
        }

        public static bool SyncHostPluginRegistry(string pluginDir, bool enable)
        {
            string cfgDir = ResolveHostGeminiConfigDir(pluginDir);
            if (string.IsNullOrEmpty(cfgDir)) return false;
            string cfgPath = Path.Combine(cfgDir, "config.json");
            try
            {
                if (enable)
                {
                    Directory.CreateDirectory(cfgDir);
                    Dictionary<string, object> rootObj = new Dictionary<string, object>(StringComparer.Ordinal);
                    if (File.Exists(cfgPath))
                    {
                        string raw = File.ReadAllText(cfgPath, Encoding.UTF8).TrimStart('\uFEFF').Trim();
                        if (raw.Length > 0)
                        {
                            Dictionary<string, object> parsed = MiniJson.ParseObject(raw);
                            if (parsed == null) return false;
                            rootObj = parsed;
                        }
                    }
                    Dictionary<string, object> pluginsObj = null;
                    object existingPlugins;
                    if (rootObj.TryGetValue("plugins", out existingPlugins) && existingPlugins is Dictionary<string, object>)
                    {
                        pluginsObj = (Dictionary<string, object>)existingPlugins;
                    }
                    else
                    {
                        pluginsObj = new Dictionary<string, object>(StringComparer.Ordinal);
                        rootObj["plugins"] = pluginsObj;
                    }
                    Dictionary<string, object> entryObj = null;
                    object existingEntry;
                    if (pluginsObj.TryGetValue("obsidian-prism", out existingEntry) && existingEntry is Dictionary<string, object>)
                    {
                        entryObj = (Dictionary<string, object>)existingEntry;
                    }
                    else
                    {
                        entryObj = new Dictionary<string, object>(StringComparer.Ordinal);
                    }
                    entryObj["enabled"] = true;
                    pluginsObj["obsidian-prism"] = entryObj;
                    if (pluginsObj.ContainsKey("antigravity-prism"))
                    {
                        pluginsObj.Remove("antigravity-prism");
                    }
                    AtomicWriteJson(cfgPath, rootObj);
                    return true;
                }

                if (File.Exists(cfgPath))
                {
                    string raw = File.ReadAllText(cfgPath, Encoding.UTF8).TrimStart('\uFEFF').Trim();
                    if (raw.Length > 0)
                    {
                        Dictionary<string, object> parsed = MiniJson.ParseObject(raw);
                        if (parsed != null)
                        {
                            bool changed = false;
                            object pVal;
                            if (parsed.TryGetValue("plugins", out pVal) && pVal is Dictionary<string, object>)
                            {
                                Dictionary<string, object> pDict = (Dictionary<string, object>)pVal;
                                if (pDict.Remove("obsidian-prism")) changed = true;
                                if (pDict.Remove("antigravity-prism")) changed = true;
                            }
                            object sVal;
                            if (parsed.TryGetValue("sidecars", out sVal) && sVal is Dictionary<string, object>)
                            {
                                Dictionary<string, object> sDict = (Dictionary<string, object>)sVal;
                                if (sDict.Remove("obsidian-prism/daemon")) changed = true;
                            }
                            if (changed)
                            {
                                AtomicWriteJson(cfgPath, parsed);
                            }
                        }
                    }
                }
                string cacheFile = Path.Combine(cfgDir, "obsidian-prism-thought-cache.json");
                if (File.Exists(cacheFile))
                {
                    try { File.Delete(cacheFile); } catch { }
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static string FindAntigravityExecutable(string preferredExe = null)
        {
            string envExe = Environment.GetEnvironmentVariable("AG_PRISM_ELECTRON_EXE");
            if (!string.IsNullOrEmpty(envExe) && File.Exists(envExe.Trim())) return envExe.Trim();
            if (!string.IsNullOrEmpty(preferredExe) && File.Exists(preferredExe)) return preferredExe;

            try
            {
                Process[] procs = Process.GetProcessesByName("Antigravity");
                for (int i = 0; i < procs.Length; i++)
                {
                    try
                    {
                        string p = procs[i].MainModule.FileName;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                    }
                    catch { }
                    finally
                    {
                        try { procs[i].Dispose(); } catch { }
                    }
                }
            }
            catch { }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string[] candidates = new string[]
            {
                !string.IsNullOrEmpty(localAppData) ? Path.Combine(localAppData, "Programs", "antigravity", "Antigravity.exe") : null,
                !string.IsNullOrEmpty(progFiles) ? Path.Combine(progFiles, "Antigravity", "Antigravity.exe") : null,
                !string.IsNullOrEmpty(progFilesX86) ? Path.Combine(progFilesX86, "Antigravity", "Antigravity.exe") : null
            };
            for (int i = 0; i < candidates.Length; i++)
            {
                if (!string.IsNullOrEmpty(candidates[i]) && File.Exists(candidates[i])) return candidates[i];
            }

            try
            {
                RegistryKey[] roots = new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine };
                string[] subPaths = new string[]
                {
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                    @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
                };
                for (int r = 0; r < roots.Length; r++)
                {
                    for (int sp = 0; sp < subPaths.Length; sp++)
                    {
                        using (RegistryKey parent = roots[r].OpenSubKey(subPaths[sp]))
                        {
                            if (parent == null) continue;
                            string[] names = parent.GetSubKeyNames();
                            for (int i = 0; i < names.Length; i++)
                            {
                                using (RegistryKey item = parent.OpenSubKey(names[i]))
                                {
                                    if (item == null) continue;
                                    string disp = item.GetValue("DisplayName") as string;
                                    if (string.IsNullOrEmpty(disp) || !disp.StartsWith("Antigravity", StringComparison.OrdinalIgnoreCase)) continue;
                                    if (disp.IndexOf("IDE", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                                    string loc = item.GetValue("InstallLocation") as string;
                                    if (!string.IsNullOrEmpty(loc))
                                    {
                                        string cand = Path.Combine(loc.Trim().Trim('"'), "Antigravity.exe");
                                        if (File.Exists(cand)) return cand;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        public static string FindFallbackNodeExecutable()
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] parts = pathEnv.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                try
                {
                    string cand = Path.Combine(parts[i].Trim().Trim('"'), "node.exe");
                    if (File.Exists(cand)) return cand;
                }
                catch { }
            }
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            List<string> extra = new List<string>();
            if (!string.IsNullOrEmpty(progFiles)) extra.Add(Path.Combine(progFiles, "nodejs", "node.exe"));
            if (!string.IsNullOrEmpty(localAppData)) extra.Add(Path.Combine(localAppData, "Volta", "bin", "node.exe"));
            if (!string.IsNullOrEmpty(localAppData)) extra.Add(Path.Combine(localAppData, "Programs", "nodejs", "node.exe"));
            for (int i = 0; i < extra.Count; i++)
            {
                if (File.Exists(extra[i])) return extra[i];
            }
            if (!string.IsNullOrEmpty(appData))
            {
                string nvmRoot = Path.Combine(appData, "nvm");
                if (Directory.Exists(nvmRoot))
                {
                    try
                    {
                        string[] dirs = Directory.GetDirectories(nvmRoot, "v*");
                        Array.Sort(dirs, StringComparer.OrdinalIgnoreCase);
                        for (int i = dirs.Length - 1; i >= 0; i--)
                        {
                            string cand = Path.Combine(dirs[i], "node.exe");
                            if (File.Exists(cand)) return cand;
                        }
                    }
                    catch { }
                }
            }
            return null;
        }

        public static bool EnsureNativeDaemonRunning(string pluginDir, int? cdpPort = null, string preferredAgExe = null, Action<string> log = null)
        {
            if (string.Equals(Environment.GetEnvironmentVariable("AG_PRISM_NO_NATIVE_DAEMON"), "1", StringComparison.Ordinal))
            {
                return false;
            }
            if (string.IsNullOrEmpty(pluginDir)) return false;
            string mainMjs = Path.Combine(pluginDir, Path.Combine("sidecars", Path.Combine("daemon", "main.mjs")));
            if (!File.Exists(mainMjs)) return false;
            if (IsNativeDaemonAlive(pluginDir)) return true;

            string runtimeExe = FindAntigravityExecutable(preferredAgExe);
            bool useElectronAsNode = !string.IsNullOrEmpty(runtimeExe);
            if (!useElectronAsNode)
            {
                runtimeExe = FindFallbackNodeExecutable();
            }
            if (string.IsNullOrEmpty(runtimeExe) || !File.Exists(runtimeExe))
            {
                return false;
            }

            try
            {
                string args = "\"" + mainMjs + "\" --root \"" + pluginDir.TrimEnd('\\', '/') + "\"";
                if (cdpPort.HasValue && cdpPort.Value > 0)
                {
                    args += " --port " + cdpPort.Value;
                }
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = runtimeExe;
                psi.Arguments = args;
                psi.WorkingDirectory = Path.GetDirectoryName(mainMjs);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                if (useElectronAsNode)
                {
                    psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                }
                Process started = Process.Start(psi);
                if (started == null) return false;

                for (int i = 0; i < 25; i++)
                {
                    if (IsNativeDaemonAlive(pluginDir))
                    {
                        if (log != null)
                        {
                            log("[✓] 已拉起原生五通道 Sidecar Daemon (" + (useElectronAsNode ? "ELECTRON_RUN_AS_NODE=1" : "node") + ")");
                        }
                        return true;
                    }
                    try
                    {
                        if (started.HasExited) break;
                    }
                    catch { }
                    Thread.Sleep(120);
                }
                return IsNativeDaemonAlive(pluginDir);
            }
            catch
            {
                return false;
            }
        }

        private static void RemoveStaleDaemonLockIfMatches(string pluginDir, int stalePid)
        {
            if (string.IsNullOrEmpty(pluginDir) || stalePid <= 0) return;
            try
            {
                if (ReadNativeDaemonPid(pluginDir) == stalePid)
                {
                    string pidPath = Path.Combine(pluginDir, ".daemon.pid");
                    if (File.Exists(pidPath)) File.Delete(pidPath);
                }
            }
            catch { }
        }

        public static bool IsNativeDaemonAlive(string pluginDir)
        {
            int? pid = ReadNativeDaemonPid(pluginDir);
            if (!pid.HasValue || pid.Value <= 0) return false;
            Process proc = null;
            try
            {
                proc = Process.GetProcessById(pid.Value);
                if (proc.HasExited)
                {
                    lock (_daemonCacheLock)
                    {
                        if (_verifiedDaemonPid == pid.Value)
                        {
                            _verifiedDaemonPid = 0;
                            _verifiedStartTicks = 0L;
                        }
                    }
                    RemoveStaleDaemonLockIfMatches(pluginDir, pid.Value);
                    return false;
                }
                long procStartTicks = 0L;
                try { procStartTicks = proc.StartTime.ToUniversalTime().Ticks; } catch { procStartTicks = 0L; }
                lock (_daemonCacheLock)
                {
                    if (_verifiedDaemonPid == pid.Value && _verifiedStartTicks == procStartTicks)
                    {
                        return true;
                    }
                }
                if (IsExpectedPrismDaemonProcess(proc, pluginDir))
                {
                    lock (_daemonCacheLock)
                    {
                        _verifiedDaemonPid = pid.Value;
                        _verifiedStartTicks = procStartTicks;
                    }
                    return true;
                }
                RemoveStaleDaemonLockIfMatches(pluginDir, pid.Value);
                return false;
            }
            catch
            {
                lock (_daemonCacheLock)
                {
                    if (_verifiedDaemonPid == pid.Value)
                    {
                        _verifiedDaemonPid = 0;
                        _verifiedStartTicks = 0L;
                    }
                }
                RemoveStaleDaemonLockIfMatches(pluginDir, pid.Value);
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

        public const string CdpOptInFlag = "--remote-debugging-port=0";
        private const uint MB_YESNO = 0x00000004;
        private const uint MB_ICONQUESTION = 0x00000020;
        private const uint MB_SETFOREGROUND = 0x00010000;
        private const int IDYES = 6;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBoxW(IntPtr hWnd, string lpText, string lpCaption, uint uType);

        private static long NowEpochMs()
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            return (long)(DateTime.UtcNow - epoch).TotalMilliseconds;
        }

        private static long ProcessStartEpochMs(Process proc)
        {
            try
            {
                DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                return (long)(proc.StartTime.ToUniversalTime() - epoch).TotalMilliseconds;
            }
            catch
            {
                return 0L;
            }
        }

        private static List<string> GetShortcutCandidateDirs(string installDir, string defaultInstallDir)
        {
            List<string> dirs = new List<string>();
            string envDirs = Environment.GetEnvironmentVariable("AG_PRISM_SHORTCUT_DIRS");
            if (!string.IsNullOrEmpty(envDirs))
            {
                string[] parts = envDirs.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++)
                {
                    string d = parts[i].Trim();
                    if (!string.IsNullOrEmpty(d) && Directory.Exists(d) && !dirs.Contains(d)) dirs.Add(d);
                }
                return dirs;
            }

            if (!string.IsNullOrEmpty(installDir) && !string.IsNullOrEmpty(defaultInstallDir))
            {
                string normInst = Path.GetFullPath(installDir).TrimEnd('\\', '/');
                string normDef = Path.GetFullPath(defaultInstallDir).TrimEnd('\\', '/');
                if (!string.Equals(normInst, normDef, StringComparison.OrdinalIgnoreCase))
                {
                    return dirs;
                }
            }

            string userDesktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string userPrograms = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string taskbarPinned = !string.IsNullOrEmpty(appData)
                ? Path.Combine(appData, @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
                : null;
            string commonDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
            string commonPrograms = Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms);

            string[] raw = new string[] { userDesktop, userPrograms, taskbarPinned, commonDesktop, commonPrograms };
            for (int i = 0; i < raw.Length; i++)
            {
                if (!string.IsNullOrEmpty(raw[i]) && Directory.Exists(raw[i]) && !dirs.Contains(raw[i]))
                {
                    dirs.Add(raw[i]);
                }
            }
            return dirs;
        }

        private static void CollectLnkFilesBounded(string dir, int depth, List<string> outFiles)
        {
            if (depth > 2 || string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
            try
            {
                string[] lnks = Directory.GetFiles(dir, "*.lnk", SearchOption.TopDirectoryOnly);
                for (int i = 0; i < lnks.Length; i++)
                {
                    outFiles.Add(lnks[i]);
                }
            }
            catch { }
            if (depth >= 2) return;
            try
            {
                string[] subs = Directory.GetDirectories(dir);
                for (int i = 0; i < subs.Length; i++)
                {
                    CollectLnkFilesBounded(subs[i], depth + 1, outFiles);
                }
            }
            catch { }
        }

        private static List<string> ReadPatchedShortcutsRecord(string stateDir)
        {
            List<string> list = new List<string>();
            if (string.IsNullOrEmpty(stateDir)) return list;
            try
            {
                string recPath = Path.Combine(stateDir, ".patched-shortcuts.json");
                if (!File.Exists(recPath)) return list;
                Dictionary<string, object> obj = MiniJson.ParseObject(File.ReadAllText(recPath, Encoding.UTF8));
                object arrObj;
                if (obj != null && obj.TryGetValue("patchedPaths", out arrObj) && arrObj is List<object>)
                {
                    List<object> rawList = (List<object>)arrObj;
                    for (int i = 0; i < rawList.Count; i++)
                    {
                        string p = rawList[i] as string;
                        if (!string.IsNullOrEmpty(p)) list.Add(p);
                    }
                }
            }
            catch { }
            return list;
        }

        private static void WritePatchedShortcutsRecord(string stateDir, List<string> paths)
        {
            if (string.IsNullOrEmpty(stateDir)) return;
            try
            {
                Directory.CreateDirectory(stateDir);
                string recPath = Path.Combine(stateDir, ".patched-shortcuts.json");
                List<object> arr = new List<object>();
                HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < paths.Count; i++)
                {
                    if (!string.IsNullOrEmpty(paths[i]) && seen.Add(paths[i]))
                    {
                        arr.Add(paths[i]);
                    }
                }
                Dictionary<string, object> root = new Dictionary<string, object>(StringComparer.Ordinal);
                root["patchedPaths"] = arr;
                root["updatedAt"] = NowEpochMs();
                AtomicWriteJson(recPath, root);
            }
            catch { }
        }

        public static int EnsureAntigravityShortcutsOptIn(
            string installDir,
            string defaultInstallDir,
            string stateDir,
            Action<string> log = null
        )
        {
            List<string> rootDirs = GetShortcutCandidateDirs(installDir, defaultInstallDir);
            if (rootDirs.Count == 0) return 0;

            List<string> lnkFiles = new List<string>();
            for (int i = 0; i < rootDirs.Count; i++)
            {
                CollectLnkFilesBounded(rootDirs[i], 0, lnkFiles);
            }
            if (lnkFiles.Count == 0) return 0;

            List<string> recorded = ReadPatchedShortcutsRecord(stateDir);
            int patchedCount = 0;
            object shell = null;
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return 0;
                shell = Activator.CreateInstance(shellType);
                for (int i = 0; i < lnkFiles.Count; i++)
                {
                    string lnkPath = lnkFiles[i];
                    object lnk = null;
                    try
                    {
                        lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                        if (lnk == null) continue;
                        Type lnkType = lnk.GetType();
                        string target = (lnkType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, lnk, null) as string) ?? "";
                        string fileName = Path.GetFileName(target.Trim().Trim('"'));
                        if (!string.Equals(fileName, "Antigravity.exe", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                        string origArgs = (lnkType.InvokeMember("Arguments", BindingFlags.GetProperty, null, lnk, null) as string) ?? "";
                        if (origArgs.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            continue;
                        }
                        string nextArgs = string.IsNullOrEmpty(origArgs.Trim())
                            ? CdpOptInFlag
                            : (origArgs.TrimEnd() + " " + CdpOptInFlag);
                        lnkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { nextArgs });
                        lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                        recorded.Add(lnkPath);
                        patchedCount++;
                    }
                    catch { }
                    finally
                    {
                        if (lnk != null && Marshal.IsComObject(lnk))
                        {
                            try { Marshal.FinalReleaseComObject(lnk); } catch { }
                        }
                    }
                }
            }
            catch { }
            finally
            {
                if (shell != null && Marshal.IsComObject(shell))
                {
                    try { Marshal.FinalReleaseComObject(shell); } catch { }
                }
            }

            if (patchedCount > 0)
            {
                WritePatchedShortcutsRecord(stateDir, recorded);
                if (log != null)
                {
                    log("已自动维护 " + patchedCount + " 个 Antigravity 快捷方式开启 --remote-debugging-port=0");
                }
            }
            return patchedCount;
        }

        private static string StripOptInFlagFromArguments(string rawArgs)
        {
            if (string.IsNullOrEmpty(rawArgs)) return "";
            string[] tokens = rawArgs.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> kept = new List<string>();
            for (int i = 0; i < tokens.Length; i++)
            {
                string t = tokens[i];
                if (string.Equals(t, CdpOptInFlag, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "\"--remote-debugging-port=0\"", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                kept.Add(t);
            }
            return string.Join(" ", kept.ToArray());
        }

        public static int RestoreAntigravityShortcutsOptIn(
            string installDir,
            string defaultInstallDir,
            string stateDir,
            Action<string> log = null
        )
        {
            HashSet<string> candidateLnks = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> rootDirs = GetShortcutCandidateDirs(installDir, defaultInstallDir);
            List<string> scanned = new List<string>();
            for (int i = 0; i < rootDirs.Count; i++)
            {
                CollectLnkFilesBounded(rootDirs[i], 0, scanned);
            }
            for (int i = 0; i < scanned.Count; i++) candidateLnks.Add(scanned[i]);

            string[] stateCandidates = new string[] { stateDir, installDir };
            for (int s = 0; s < stateCandidates.Length; s++)
            {
                List<string> rec = ReadPatchedShortcutsRecord(stateCandidates[s]);
                for (int i = 0; i < rec.Count; i++) candidateLnks.Add(rec[i]);
            }

            int restoredCount = 0;
            object shell = null;
            if (candidateLnks.Count > 0)
            {
                try
                {
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    if (shellType != null)
                    {
                        shell = Activator.CreateInstance(shellType);
                        foreach (string lnkPath in candidateLnks)
                        {
                            if (string.IsNullOrEmpty(lnkPath) || !File.Exists(lnkPath)) continue;
                            object lnk = null;
                            try
                            {
                                lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                                if (lnk == null) continue;
                                Type lnkType = lnk.GetType();
                                string target = (lnkType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, lnk, null) as string) ?? "";
                                string fileName = Path.GetFileName(target.Trim().Trim('"'));
                                if (!string.Equals(fileName, "Antigravity.exe", StringComparison.OrdinalIgnoreCase))
                                {
                                    continue;
                                }
                                string origArgs = (lnkType.InvokeMember("Arguments", BindingFlags.GetProperty, null, lnk, null) as string) ?? "";
                                if (origArgs.IndexOf(CdpOptInFlag, StringComparison.OrdinalIgnoreCase) < 0)
                                {
                                    continue;
                                }
                                string restoredArgs = StripOptInFlagFromArguments(origArgs);
                                lnkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { restoredArgs });
                                lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                                restoredCount++;
                            }
                            catch { }
                            finally
                            {
                                if (lnk != null && Marshal.IsComObject(lnk))
                                {
                                    try { Marshal.FinalReleaseComObject(lnk); } catch { }
                                }
                            }
                        }
                    }
                }
                catch { }
                finally
                {
                    if (shell != null && Marshal.IsComObject(shell))
                    {
                        try { Marshal.FinalReleaseComObject(shell); } catch { }
                    }
                }
            }

            for (int s = 0; s < stateCandidates.Length; s++)
            {
                if (string.IsNullOrEmpty(stateCandidates[s])) continue;
                try
                {
                    string recFile = Path.Combine(stateCandidates[s], ".patched-shortcuts.json");
                    if (File.Exists(recFile)) File.Delete(recFile);
                }
                catch { }
            }

            if (restoredCount > 0 && log != null)
            {
                log("已还原 " + restoredCount + " 个 Antigravity 快捷方式启动参数");
            }
            return restoredCount;
        }

        public static BareHostProcessInfo FindBareAntigravityMainProcess()
        {
            string mockPidEnv = Environment.GetEnvironmentVariable("AG_PRISM_MOCK_BARE_HOST_PID");
            int mockPid;
            if (!string.IsNullOrEmpty(mockPidEnv) && int.TryParse(mockPidEnv.Trim(), out mockPid) && mockPid > 0)
            {
                Process mp = null;
                try
                {
                    mp = Process.GetProcessById(mockPid);
                    if (!mp.HasExited)
                    {
                        long startMs = ProcessStartEpochMs(mp);
                        long uptimeMs = startMs > 0L ? Math.Max(0L, NowEpochMs() - startMs) : 10000L;
                        string mockUptimeEnv = Environment.GetEnvironmentVariable("AG_PRISM_MOCK_BARE_HOST_UPTIME_MS");
                        long forcedUptime;
                        if (!string.IsNullOrEmpty(mockUptimeEnv) && long.TryParse(mockUptimeEnv.Trim(), out forcedUptime))
                        {
                            uptimeMs = forcedUptime;
                        }
                        string exe = "";
                        try { exe = mp.MainModule.FileName; } catch { }
                        BareHostProcessInfo info = new BareHostProcessInfo();
                        info.Pid = mockPid;
                        info.ExePath = exe;
                        info.StartTimeMs = startMs;
                        info.UptimeMs = uptimeMs;
                        return info;
                    }
                }
                catch { }
                finally
                {
                    if (mp != null) { try { mp.Dispose(); } catch { } }
                }
                return null;
            }

            try
            {
                Process[] procs = Process.GetProcessesByName("Antigravity");
                BareHostProcessInfo candidate = null;
                for (int i = 0; i < procs.Length; i++)
                {
                    Process p = procs[i];
                    try
                    {
                        if (p.HasExited) continue;
                        string cmd = QueryWindowsProcessCommandLine(p.Id);
                        if (string.IsNullOrEmpty(cmd)) continue;
                        if (cmd.IndexOf("--type=", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                        if (cmd.IndexOf("sidecar_sdk", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            cmd.IndexOf("main.mjs", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            cmd.IndexOf("watch.js", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            continue;
                        }
                        if (cmd.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            // A host process already opted into CDP is running
                            return null;
                        }
                        if (candidate == null)
                        {
                            long stMs = ProcessStartEpochMs(p);
                            string exePath = "";
                            try { exePath = p.MainModule.FileName; } catch { }
                            if (string.IsNullOrEmpty(exePath)) exePath = FindAntigravityExecutable(null);
                            candidate = new BareHostProcessInfo();
                            candidate.Pid = p.Id;
                            candidate.ExePath = exePath;
                            candidate.StartTimeMs = stMs;
                            candidate.UptimeMs = stMs > 0L ? Math.Max(0L, NowEpochMs() - stMs) : 0L;
                        }
                    }
                    catch { }
                    finally
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
                return candidate;
            }
            catch
            {
                return null;
            }
        }

        private static bool StateFileMatchesHost(string filePath, int hostPid, long startTimeMs)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath) || hostPid <= 0) return false;
            try
            {
                string raw = File.ReadAllText(filePath, Encoding.UTF8).Trim();
                if (string.IsNullOrEmpty(raw)) return false;
                Dictionary<string, object> obj = MiniJson.ParseObject(raw);
                if (obj == null) return false;
                string expectedKey = hostPid + ":" + startTimeMs;
                string pidPrefix = hostPid + ":";
                object hkObj;
                if (obj.TryGetValue("hostKey", out hkObj) && hkObj is string)
                {
                    string hk = (string)hkObj;
                    if (string.Equals(hk, expectedKey, StringComparison.Ordinal)) return true;
                    if (startTimeMs <= 0L && hk.StartsWith(pidPrefix, StringComparison.Ordinal)) return true;
                }
                object kObj;
                if (obj.TryGetValue("key", out kObj) && kObj is string)
                {
                    string k = (string)kObj;
                    if (string.Equals(k, expectedKey, StringComparison.Ordinal)) return true;
                    if (startTimeMs <= 0L && k.StartsWith(pidPrefix, StringComparison.Ordinal)) return true;
                }
                object pidObj;
                if (obj.TryGetValue("hostPid", out pidObj) && pidObj != null && Convert.ToInt32(pidObj) == hostPid)
                {
                    long savedStart = 0L;
                    object st1;
                    object st2;
                    if (obj.TryGetValue("hostStartMs", out st1) && st1 != null) savedStart = Convert.ToInt64(st1);
                    else if (obj.TryGetValue("startTimeMs", out st2) && st2 != null) savedStart = Convert.ToInt64(st2);
                    if (savedStart <= 0L || startTimeMs <= 0L || Math.Abs(savedStart - startTimeMs) <= 15000L)
                    {
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        public static bool HasPromptedForHost(int hostPid, long startTimeMs, string installDir, string pluginDir)
        {
            if (hostPid <= 0) return true;
            if (!string.IsNullOrEmpty(pluginDir))
            {
                if (StateFileMatchesHost(Path.Combine(pluginDir, ".relaunch-prompt-state.json"), hostPid, startTimeMs))
                    return true;
            }
            if (!string.IsNullOrEmpty(installDir))
            {
                if (StateFileMatchesHost(Path.Combine(installDir, ".relaunch-prompt-state.json"), hostPid, startTimeMs))
                    return true;
            }
            return false;
        }

        public static void RecordPromptedForHost(int hostPid, long startTimeMs, string decision, string installDir, string pluginDir)
        {
            if (hostPid <= 0) return;
            string hostKey = hostPid + ":" + startTimeMs;
            Dictionary<string, object> obj = new Dictionary<string, object>(StringComparer.Ordinal);
            obj["hostPid"] = hostPid;
            obj["hostStartMs"] = startTimeMs;
            obj["startTimeMs"] = startTimeMs;
            obj["hostKey"] = hostKey;
            obj["key"] = hostKey;
            obj["decision"] = string.IsNullOrEmpty(decision) ? "prompted" : decision;
            obj["updatedAt"] = NowEpochMs();

            string[] dirs = new string[] { pluginDir, installDir };
            for (int i = 0; i < dirs.Length; i++)
            {
                if (string.IsNullOrEmpty(dirs[i])) continue;
                try
                {
                    Directory.CreateDirectory(dirs[i]);
                    AtomicWriteJson(Path.Combine(dirs[i], ".relaunch-prompt-state.json"), obj);
                }
                catch { }
            }
        }

        public static bool PromptUserForCdpRelaunch()
        {
            string mockDec = Environment.GetEnvironmentVariable("AG_PRISM_MOCK_RELAUNCH_DECISION");
            if (!string.IsNullOrEmpty(mockDec))
            {
                return string.Equals(mockDec.Trim(), "yes", StringComparison.OrdinalIgnoreCase) ||
                       string.Equals(mockDec.Trim(), "1", StringComparison.OrdinalIgnoreCase);
            }
            string text =
                "检测到 Antigravity 已升级或无参启动，尚未开启本地光学桥接端口（--remote-debugging-port=0）。\r\n" +
                "快捷方式参数已自动维护完毕。\r\n\r\n" +
                "是否立即重新打开 Antigravity 以恢复 Obsidian Prism（黑曜棱镜）界面？";
            int ans = MessageBoxW(IntPtr.Zero, text, "Obsidian Prism · 恢复界面连接", MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND);
            return ans == IDYES;
        }

        public static bool RelaunchAntigravityWithCdp(
            BareHostProcessInfo host,
            int waitExitMs = 15000,
            Action<string> log = null
        )
        {
            if (host == null || host.Pid <= 0 || string.IsNullOrEmpty(host.ExePath) || !File.Exists(host.ExePath))
            {
                return false;
            }
            try
            {
                Process target = null;
                try
                {
                    target = Process.GetProcessById(host.Pid);
                    if (!target.HasExited)
                    {
                        try { target.CloseMainWindow(); } catch { }
                        int softWait = Math.Min(8000, Math.Max(1000, waitExitMs));
                        if (!target.WaitForExit(softWait) && !target.HasExited)
                        {
                            try { target.Kill(); } catch { }
                            target.WaitForExit(4000);
                        }
                    }
                }
                catch { }
                finally
                {
                    if (target != null) { try { target.Dispose(); } catch { } }
                }

                // Wait until single-instance lock holder is fully gone before spawning --remote-debugging-port=0
                int waited = 0;
                while (waited < 5000)
                {
                    BareHostProcessInfo lingering = FindBareAntigravityMainProcess();
                    if (lingering == null || lingering.Pid != host.Pid) break;
                    Thread.Sleep(150);
                    waited += 150;
                }
                Thread.Sleep(250);

                string launchArgs = Environment.GetEnvironmentVariable("AG_PRISM_MOCK_RELAUNCH_ARGS");
                if (string.IsNullOrEmpty(launchArgs)) launchArgs = CdpOptInFlag;
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = host.ExePath;
                psi.Arguments = launchArgs;
                psi.WorkingDirectory = Path.GetDirectoryName(host.ExePath);
                psi.UseShellExecute = false;
                Process spawned = Process.Start(psi);
                if (spawned != null)
                {
                    if (log != null) log("已带 " + CdpOptInFlag + " 重新打开 Antigravity (PID " + spawned.Id + ")");
                    return true;
                }
            }
            catch { }
            return false;
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
            sb.Append("  const ttl = String((typeof document !== 'undefined' && document && document.title) || '').trim();\n");
            sb.Append("  if (/^(?:untitled|launchpad)$/i.test(ttl) || /\\/launchpad(?:\\.html)?(?:[?#]|$)/i.test(href)) return { ok: false, skipped: true };\n");
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
            sb.Append("      if (style.textContent !== css) { style.textContent = css; style.removeAttribute?.('data-ag-cs-flat'); }\n");
            sb.Append("      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {\n");
            sb.Append("        targetParent.appendChild(style);\n");
            sb.Append("      }\n");
            sb.Append("    };\n\n");
            sb.Append("    let status = 'ok';\n");
            sb.Append("    let mounted = false;\n");
            sb.Append("    const stripForeignMount = () => {\n");
            sb.Append("      try { window.__agPrismTelemetry?.destroy?.(); } catch {}\n");
            sb.Append("      try { window.__agPrismEffortSlider?.destroy?.(); } catch {}\n");
            sb.Append("      try { window.__agPrismThought?.destroy?.(); } catch {}\n");
            sb.Append("      try { window.__agPrismOmni?.destroy?.(); } catch {}\n");
            sb.Append("      try { window.__agPrism?.destroy?.(); } catch {}\n");
            sb.Append("      try { document.getElementById(").Append(styleIdJson).Append(")?.remove(); } catch {}\n");
            sb.Append("      try { document.getElementById('ag-claude-style-css')?.remove(); } catch {}\n");
            sb.Append("      try { document.getElementById('ag-prism-settings-v101-css')?.remove(); } catch {}\n");
            sb.Append("      try { document.getElementById('ag-prism-omni-css')?.remove(); } catch {}\n");
            sb.Append("      delete window.__agPrismOmni; delete window.__agPrism; delete window.__agClaudeStyle;\n");
            sb.Append("    };\n");
            sb.Append("    const hasDomWorkbenchMarkers = () => {\n");
            sb.Append("      try {\n");
            sb.Append("        if (document.body?.classList && (document.body.classList.contains('theme-standalone') || document.body.classList.contains('monaco-workbench'))) return true;\n");
            sb.Append("        return Boolean(document.querySelector('.agy-shell, .agy-home, [data-testid=\"aux-pane-split\"], [data-testid=\"conversation-view\"], [data-testid=\"agent-input-box\"], [data-testid=\"model-selector-trigger\"], .monaco-workbench'));\n");
            sb.Append("      } catch { return false; }\n");
            sb.Append("    };\n");
            sb.Append("    const checkHostIdentity = () => {\n");
            sb.Append("      try {\n");
            sb.Append("        const href = String((typeof window !== 'undefined' && window.location && window.location.href) || '');\n");
            sb.Append("        if (!href) return 'ok';\n");
            sb.Append("        const low = href.toLowerCase();\n");
            sb.Append("        if (/^(devtools:|data:|chrome:|chrome-extension:|edge:|blob:|plugin:)/.test(low)) return 'reject';\n");
            sb.Append("        const ttl = String(document.title || '').trim();\n");
            sb.Append("        const bareAux = /^(?:untitled|launchpad)$/i.test(ttl) || /(?:^|\\/)launchpad(?:\\.html)?(?:[?#]|$)/i.test(href);\n");
            sb.Append("        if (low.startsWith('vscode-file://') || low.startsWith('app://') || low.startsWith('about:')) return bareAux ? 'reject' : 'ok';\n");
            sb.Append("        if (bareAux) return 'reject';\n");
            sb.Append("        const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/[^?#]*)?(?:[?#]|$)/i.exec(href);\n");
            sb.Append("        if (!m) return low.startsWith('http:') || low.startsWith('https:') ? 'reject' : 'ok';\n");
            sb.Append("        const pathname = (m[3] || '/').toLowerCase();\n");
            sb.Append("        if (/^\\/(?:viewer(?:\\/|$)|sandbox(?:\\/|$)|stream(?:\\/|$)|api(?:\\/|$))/.test(pathname)) return 'reject';\n");
            sb.Append("        if (hasDomWorkbenchMarkers()) return 'ok';\n");
            sb.Append("        const rs = String(document.readyState || '');\n");
            sb.Append("        if (m[1].toLowerCase() === 'http') return rs === 'loading' ? 'defer' : 'reject';\n");
            sb.Append("        if (/\\bantigravity\\b/i.test(ttl)) return 'ok';\n");
            sb.Append("        return rs === 'complete' ? 'reject' : 'ok';\n");
            sb.Append("      } catch { return 'ok'; }\n");
            sb.Append("    };\n");
            sb.Append("    const mount = () => {\n");
            sb.Append("      if (mounted || !document.documentElement) return;\n");
            sb.Append("      const hostVerdict = checkHostIdentity();\n");
            sb.Append("      if (hostVerdict === 'reject') { status = 'skipped-non-host'; stripForeignMount(); return; }\n");
            sb.Append("      if (hostVerdict === 'defer') { status = 'deferred'; document.addEventListener('DOMContentLoaded', () => mount(), { once: true }); return; }\n");
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
            sb.Append("          try { window.__agPrismTelemetry?.destroy?.(); } catch {}\n");
            sb.Append("          try { window.__agPrismEffortSlider?.destroy?.(); } catch {}\n");
            sb.Append("          try { window.__agPrismThought?.destroy?.(); } catch {}\n");
            sb.Append("          try { window.__agPrismOmni?.destroy?.(); } catch {}\n");
            sb.Append("          try { document.querySelectorAll?.('[data-ag-prism-fallback=\"1\"]').forEach((n) => n.remove()); } catch {}\n");
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
