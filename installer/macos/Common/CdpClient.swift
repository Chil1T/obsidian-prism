import Foundation
#if canImport(Darwin)
import Darwin
#endif

struct CdpPageInfo {
    let id: String
    let title: String
    let url: String
    let webSocketDebuggerUrl: String
}

struct CdpError: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { return message }
}

final class PluginManifest {
    let version: String
    let styleId: String
    let settingBinding: String
    let parts: [String]
    let defaultConfig: [String: JsonValue]
    let validators: [String: JsonValue]
    let removeExpression: String

    init(
        version: String,
        styleId: String,
        settingBinding: String,
        parts: [String],
        defaultConfig: [String: JsonValue],
        validators: [String: JsonValue],
        removeExpression: String
    ) {
        self.version = version
        self.styleId = styleId
        self.settingBinding = settingBinding
        self.parts = parts
        self.defaultConfig = defaultConfig
        self.validators = validators
        self.removeExpression = removeExpression
    }

    static func load(baseDir: String) throws -> PluginManifest {
        let manifestPath = (baseDir as NSString).appendingPathComponent("manifest.json")
        let text = try String(contentsOfFile: manifestPath, encoding: .utf8)
        let raw = try MiniJson.parseObject(text)
        let version = raw["version"]?.stringValue ?? "1.0.1"
        let styleId = raw["styleId"]?.stringValue ?? "ag-prism-css"
        let settingBinding = raw["settingBinding"]?.stringValue ?? "__agPrismSetting"
        let removeExpression = raw["removeExpression"]?.stringValue ?? ""
        var parts: [String] = []
        if let arr = raw["parts"]?.arrayValue {
            for item in arr {
                if let s = item.stringValue, !s.isEmpty {
                    parts.append(s)
                }
            }
        }
        let defaultConfig = raw["defaultConfig"]?.objectValue ?? [:]
        let validators = raw["validators"]?.objectValue ?? [:]
        return PluginManifest(
            version: version,
            styleId: styleId,
            settingBinding: settingBinding,
            parts: parts,
            defaultConfig: defaultConfig,
            validators: validators,
            removeExpression: removeExpression
        )
    }
}

final class CdpSession: NSObject, URLSessionWebSocketDelegate {
    private var urlSession: URLSession!
    private var wsTask: URLSessionWebSocketTask!
    private let lock = NSLock()
    private let sendQueue = DispatchQueue(label: "io.github.rmvdesi.obsidian-prism.cdp.send")
    private var nextId: Int = 0
    private var pending: [Int: (Result<[String: JsonValue], Error>) -> Void] = [:]
    private var listeners: [String: [([String: JsonValue]) -> Void]] = [:]
    private var closed = false
    private var opened = false
    private var openCallback: ((Error?) -> Void)?

    var onClose: (() -> Void)?

    private override init() {
        super.init()
    }

    static func connect(wsUrl: String, timeoutMs: Int = 3000) throws -> CdpSession {
        guard let url = URL(string: wsUrl) else {
            throw CdpError("Invalid WebSocket URL: \(wsUrl)")
        }
        let session = CdpSession()
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = max(1.0, Double(timeoutMs) / 1000.0)
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.name = "io.github.rmvdesi.obsidian-prism.cdp.ws"

        let sem = DispatchSemaphore(value: 0)
        var connectErr: Error?

        session.lock.lock()
        session.openCallback = { err in
            connectErr = err
            sem.signal()
        }
        session.lock.unlock()

        let urlSession = URLSession(configuration: cfg, delegate: session, delegateQueue: delegateQueue)
        let task = urlSession.webSocketTask(with: url)
        task.maximumMessageSize = 64 * 1024 * 1024
        session.urlSession = urlSession
        session.wsTask = task
        task.resume()

        let waitResult = sem.wait(timeout: .now() + .milliseconds(timeoutMs))
        if waitResult == .timedOut {
            session.lock.lock()
            session.openCallback = nil
            session.lock.unlock()
            session.close()
            throw CdpError("CDP connect timeout")
        }
        if let err = connectErr {
            session.close()
            throw err
        }
        return session
    }

    func on(_ method: String, callback: @escaping ([String: JsonValue]) -> Void) {
        lock.lock()
        var list = listeners[method] ?? []
        list.append(callback)
        listeners[method] = list
        lock.unlock()
    }

    func send(_ method: String, params: [String: JsonValue]? = nil, timeoutMs: Int = 5000) throws -> [String: JsonValue] {
        lock.lock()
        if closed {
            lock.unlock()
            throw CdpError("CDP connection closed")
        }
        nextId += 1
        let id = nextId
        let sem = DispatchSemaphore(value: 0)
        var outcome: Result<[String: JsonValue], Error>?
        pending[id] = { res in
            outcome = res
            sem.signal()
        }
        lock.unlock()

        let payload: JsonValue = .object([
            "id": .int(Int64(id)),
            "method": .string(method),
            "params": .object(params ?? [:])
        ])
        let json = MiniJson.stringify(payload, pretty: false)

        sendQueue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let isClosed = self.closed
            let task = self.wsTask
            self.lock.unlock()
            if isClosed || task == nil { return }
            task!.send(.string(json)) { [weak self] err in
                if let err = err {
                    self?.failPending(id: id, error: err)
                }
            }
        }

        let waitRes = sem.wait(timeout: .now() + .milliseconds(timeoutMs))
        if waitRes == .timedOut {
            lock.lock()
            pending.removeValue(forKey: id)
            let wasClosed = closed
            lock.unlock()
            if wasClosed {
                throw CdpError("CDP connection closed")
            }
            throw CdpError("CDP \(method) timeout")
        }

        switch outcome {
        case .success(let val):
            return val
        case .failure(let err):
            throw err
        case .none:
            throw CdpError("CDP \(method) failed")
        }
    }

    func evaluate(_ expression: String, awaitPromise: Bool = false) throws -> JsonValue {
        let res = try send("Runtime.evaluate", params: [
            "expression": .string(expression),
            "returnByValue": .bool(true),
            "awaitPromise": .bool(awaitPromise)
        ], timeoutMs: 15000)

        if let exDetails = res["exceptionDetails"]?.objectValue {
            var msg = exDetails["exception"]?.objectValue?["description"]?.stringValue
            if msg == nil || msg!.isEmpty {
                msg = exDetails["text"]?.stringValue
            }
            throw CdpError(msg ?? "Runtime.evaluate exception")
        }

        if let resultObj = res["result"]?.objectValue, let val = resultObj["value"] {
            return val
        }
        return .null
    }

    func close() {
        markClosed()
        lock.lock()
        let task = wsTask
        let session = urlSession
        lock.unlock()
        task?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
    }

    private func failPending(id: Int, error: Error) {
        lock.lock()
        let cb = pending.removeValue(forKey: id)
        lock.unlock()
        cb?(.failure(error))
    }

    private func startReceiveLoop() {
        lock.lock()
        let isClosed = closed
        let task = wsTask
        lock.unlock()
        if isClosed || task == nil { return }

        task!.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleMessage(text)
                    }
                @unknown default:
                    break
                }
                self.startReceiveLoop()
            case .failure:
                self.markClosed()
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let msg = try? MiniJson.parseObject(text) else { return }

        if let method = msg["method"]?.stringValue {
            let params = msg["params"]?.objectValue ?? [:]
            lock.lock()
            let callbacks = listeners[method] ?? []
            lock.unlock()
            for cb in callbacks {
                cb(params)
            }
            return
        }

        if let id = msg["id"]?.intValue {
            lock.lock()
            let cb = pending.removeValue(forKey: id)
            lock.unlock()
            guard let callback = cb else { return }
            if let errVal = msg["error"], case .null = errVal {
                // error is null -> treat as success
            } else if let errVal = msg["error"] {
                let errMsg = errVal.objectValue?["message"]?.stringValue ?? MiniJson.stringify(errVal, pretty: false)
                callback(.failure(CdpError(errMsg)))
                return
            }
            let resDict = msg["result"]?.objectValue ?? [:]
            callback(.success(resDict))
        }
    }

    private func markClosed() {
        lock.lock()
        if closed {
            lock.unlock()
            return
        }
        closed = true
        let pendingCallbacks = pending
        pending.removeAll()
        let closeHandler = onClose
        let openCb = openCallback
        openCallback = nil
        lock.unlock()

        openCb?(CdpError("CDP connection closed"))
        for (_, cb) in pendingCallbacks {
            cb(.failure(CdpError("CDP connection closed")))
        }
        closeHandler?()
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        lock.lock()
        opened = true
        let cb = openCallback
        openCallback = nil
        lock.unlock()
        startReceiveLoop()
        cb?(nil)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        markClosed()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let wasOpened = opened
        let cb = openCallback
        openCallback = nil
        lock.unlock()
        if !wasOpened, let cb = cb {
            cb(error ?? CdpError("CDP connect failed"))
        }
        markClosed()
    }
}

enum CdpHelper {
    static func getPortFilePath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ((home as NSString)
            .appendingPathComponent("Library/Application Support/Antigravity/DevToolsActivePort"))
    }

    static func readPort(overridePort: Int?) -> Int? {
        if let p = overridePort, p > 0 { return p }
        if let envPort = ProcessInfo.processInfo.environment["AG_CDP_PORT"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !envPort.isEmpty,
           let p = Int(envPort), p > 0 {
            return p
        }
        let portFile = getPortFilePath()
        guard let text = try? String(contentsOfFile: portFile, encoding: .utf8) else { return nil }
        let firstLine = text.components(separatedBy: CharacterSet.newlines).first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let p = Int(firstLine), p > 0 {
            return p
        }
        return nil
    }

    static func listPages(port: Int) throws -> [CdpPageInfo] {
        guard let url = URL(string: "http://127.0.0.1:\(port)/json/list") else {
            throw CdpError("Invalid CDP HTTP URL")
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = 2.0
        cfg.timeoutIntervalForResource = 2.0
        let session = URLSession(configuration: cfg)
        defer { session.finishTasksAndInvalidate() }

        let sem = DispatchSemaphore(value: 0)
        var fetchedData: Data?
        var fetchedError: Error?

        let task = session.dataTask(with: url) { data, _, err in
            fetchedData = data
            fetchedError = err
            sem.signal()
        }
        task.resume()

        if sem.wait(timeout: .now() + .milliseconds(2500)) == .timedOut {
            task.cancel()
            throw CdpError("CDP /json/list timeout")
        }
        if let err = fetchedError {
            throw err
        }
        guard let data = fetchedData, let jsonText = String(data: data, encoding: .utf8) else {
            throw CdpError("Empty response from /json/list")
        }

        let targets = try MiniJson.parseArray(jsonText)
        var pages: [CdpPageInfo] = []
        for targetVal in targets {
            guard let t = targetVal.objectValue else { continue }
            let type = t["type"]?.stringValue ?? ""
            let wsUrl = t["webSocketDebuggerUrl"]?.stringValue ?? ""
            let pageUrl = t["url"]?.stringValue ?? ""
            let title = t["title"]?.stringValue ?? ""
            if isEligibleTarget(type: type, wsUrl: wsUrl, title: title, pageUrl: pageUrl) {
                let id = t["id"]?.stringValue ?? wsUrl
                pages.append(CdpPageInfo(id: id, title: title, url: pageUrl, webSocketDebuggerUrl: wsUrl))
            }
        }
        return pages
    }

    static func isEligibleTarget(type: String, wsUrl: String, title: String, pageUrl: String) -> Bool {
        if type != "page" || wsUrl.isEmpty { return false }
        let url = pageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let ttl = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if url.isEmpty { return false }
        let lowerUrl = url.lowercased()
        let blockedPrefixes = ["devtools://", "data:", "about:", "chrome:", "chrome-extension:", "edge:", "blob:", "plugin:"]
        for pfx in blockedPrefixes {
            if lowerUrl.hasPrefix(pfx) { return false }
        }
        let combined = (ttl + " " + url).lowercased()
        if combined.contains("untitled") || combined.contains("launchpad") { return false }
        if lowerUrl.hasPrefix("vscode-file://") || lowerUrl.hasPrefix("app://") { return true }
        if lowerUrl.hasPrefix("file://") {
            return lowerUrl.contains("workbench") || lowerUrl.contains("antigravity") || ttl.lowercased().contains("antigravity")
        }
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(), (scheme == "http" || scheme == "https") else {
            return false
        }
        let host = (parsed.host ?? "").lowercased()
        if host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]" { return false }
        if ttl.lowercased().contains("antigravity") { return true }
        if scheme == "https" && (ttl.isEmpty || ttl.lowercased().hasPrefix("127.0.0.1")) { return true }
        return false
    }

    static func computeHash(_ str: String) -> String {
        var h: UInt32 = 2166136261
        for unit in str.utf16 {
            h ^= UInt32(unit)
            h = h &* 16777619
        }
        return String(h, radix: 36)
    }

    private static func toBoolOnOff(_ val: JsonValue?) -> Bool {
        guard let v = val else { return true }
        if case .bool(let b) = v { return b }
        if let s = v.stringValue?.lowercased() {
            return s != "off" && s != "false"
        }
        return true
    }

    static func reconcileConfigAliases(_ raw: [String: JsonValue]) -> [String: JsonValue] {
        var out = raw
        if let lang = out["language"] { out["lang"] = lang }
        else if let lang = out["lang"] { out["language"] = lang }

        if let hl = out["homeLayout"] { out["homeMode"] = hl }
        else if let hm = out["homeMode"] { out["homeLayout"] = hm }

        if out["homeRipple"] != nil || out["ripple"] != nil {
            let on = out["homeRipple"] != nil ? toBoolOnOff(out["homeRipple"]) : toBoolOnOff(out["ripple"])
            out["homeRipple"] = .bool(on)
            out["ripple"] = .string(on ? "on" : "off")
        }
        if out["composerRestyle"] != nil || out["composer"] != nil {
            let on = out["composerRestyle"] != nil ? toBoolOnOff(out["composerRestyle"]) : toBoolOnOff(out["composer"])
            out["composerRestyle"] = .bool(on)
            out["composer"] = .string(on ? "on" : "off")
        }
        if let ps = out["placeholderStyle"] { out["promptStyle"] = ps }
        else if let pr = out["promptStyle"] { out["placeholderStyle"] = pr }

        if out["sidebarRestyle"] != nil || out["sidebar"] != nil {
            let on = out["sidebarRestyle"] != nil ? toBoolOnOff(out["sidebarRestyle"]) : toBoolOnOff(out["sidebar"])
            out["sidebarRestyle"] = .bool(on)
            out["sidebar"] = .string(on ? "on" : "off")
        }
        if out["sidebarCompact"] != nil {
            out["sidebarCompact"] = .bool(toBoolOnOff(out["sidebarCompact"]))
        }
        if out["smoothCaret"] != nil {
            out["smoothCaret"] = .bool(toBoolOnOff(out["smoothCaret"]))
        }
        if let cl = out["codeLigatures"] {
            if case .bool(let b) = cl {
                out["codeLigatures"] = .bool(b)
            } else if let s = cl.stringValue?.lowercased() {
                out["codeLigatures"] = .bool(s == "on" || s == "true")
            }
        }
        return out
    }

    static func readConfig(baseDir: String, manifest: PluginManifest) -> [String: JsonValue] {
        var cfg = manifest.defaultConfig
        let cfgPath = (baseDir as NSString).appendingPathComponent("config.json")
        if let text = try? String(contentsOfFile: cfgPath, encoding: .utf8),
           let userCfg = try? MiniJson.parseObject(text) {
            let reconciled = reconcileConfigAliases(userCfg)
            for (k, v) in reconciled {
                cfg[k] = v
            }
        }
        return reconcileConfigAliases(cfg)
    }

    static func validateConfigEntry(manifest: PluginManifest, key: String, value: JsonValue) -> Bool {
        guard let rule = manifest.validators[key] else { return false }
        if let ruleStr = rule.stringValue, ruleStr == "boolean" {
            if case .bool = value { return true }
            if let sv = value.stringValue, (sv == "on" || sv == "off") { return true }
            return false
        } else if let allowed = rule.arrayValue {
            guard let strVal = value.stringValue else { return false }
            return allowed.contains { $0.stringValue == strVal }
        }
        return false
    }

    static func updateConfigBatch(baseDir: String, manifest: PluginManifest, entries: [String: JsonValue]) -> Bool {
        var validPatch: [String: JsonValue] = [:]
        for (k, v) in entries {
            if validateConfigEntry(manifest: manifest, key: k, value: v) {
                validPatch[k] = v
            }
        }
        if validPatch.isEmpty { return false }

        let reconciledPatch = reconcileConfigAliases(validPatch)
        var next = readConfig(baseDir: baseDir, manifest: manifest)
        for (k, v) in reconciledPatch {
            next[k] = v
        }
        let cfgPath = (baseDir as NSString).appendingPathComponent("config.json")
        let tmpPath = cfgPath + ".tmp"
        let content = MiniJson.stringify(.object(next), pretty: true) + "\n"
        do {
            try content.write(toFile: tmpPath, atomically: false, encoding: .utf8)
            if rename(tmpPath, cfgPath) != 0 {
                try content.write(toFile: cfgPath, atomically: true, encoding: .utf8)
                try? FileManager.default.removeItem(atPath: tmpPath)
            }
            return true
        } catch {
            return false
        }
    }

    static func updateConfigSetting(baseDir: String, manifest: PluginManifest, key: String, value: JsonValue) -> Bool {
        return updateConfigBatch(baseDir: baseDir, manifest: manifest, entries: [key: value])
    }

    static func getDefaultNativePluginDir() -> String {
        if let envOverride = ProcessInfo.processInfo.environment["AG_PRISM_PLUGIN_DIR"],
           !envOverride.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return URL(fileURLWithPath: envOverride.trimmingCharacters(in: .whitespacesAndNewlines)).standardizedFileURL.path
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return (((home as NSString).appendingPathComponent(".gemini/config/plugins")) as NSString)
            .appendingPathComponent("obsidian-prism")
    }

    static func readNativeDaemonPid(pluginDir: String) -> Int32? {
        guard !pluginDir.isEmpty else { return nil }
        let pidPath = (pluginDir as NSString).appendingPathComponent(".daemon.pid")
        guard let raw = try? String(contentsOfFile: pidPath, encoding: .utf8) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if let plainPid = Int32(trimmed), plainPid > 0 { return plainPid }
        if trimmed.hasPrefix("{"),
           let obj = try? MiniJson.parseObject(trimmed),
           let pidVal = obj["pid"] {
            if case .int(let n) = pidVal, n > 0 && n <= Int64(Int32.max) {
                return Int32(n)
            }
            if case .double(let d) = pidVal, d > 0 && d <= Double(Int32.max) {
                return Int32(d)
            }
        }
        return nil
    }

    static func isExpectedDaemonProcess(pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/ps")
        proc.arguments = ["-p", "\(pid)", "-o", "comm="]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()
        do {
            try proc.run()
            proc.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let comm = (String(data: data, encoding: .utf8) ?? "").lowercased()
            if comm.isEmpty { return false }
            return comm.contains("node") ||
                   comm.contains("watcher") ||
                   comm.contains("obsidian-prism") ||
                   comm.contains("agy-claude-style")
        } catch {
            return false
        }
    }

    static func isNativeDaemonAlive(pluginDir: String) -> Bool {
        guard let pid = readNativeDaemonPid(pluginDir: pluginDir), pid > 0 else { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    static func readRuntimeBundle(baseDir: String, manifest: PluginManifest) throws -> String {
        var partsContent: [String] = []
        partsContent.reserveCapacity(manifest.parts.count)
        for part in manifest.parts {
            let p = (baseDir as NSString).appendingPathComponent(part)
            partsContent.append(try String(contentsOfFile: p, encoding: .utf8))
        }
        return partsContent.joined(separator: "\n")
    }

    static func buildConfigRefreshExpression(baseDir: String, manifest: PluginManifest) -> String {
        var nextCfg = readConfig(baseDir: baseDir, manifest: manifest)
        let codeHash = (try? readRuntimeBundle(baseDir: baseDir, manifest: manifest)).map { computeHash($0) } ?? ""
        nextCfg["binding"] = .string(manifest.settingBinding)
        if !codeHash.isEmpty { nextCfg["codeHash"] = .string(codeHash) }
        nextCfg["__fromFile"] = .bool(true)
        let cfgJson = MiniJson.stringify(.object(nextCfg), pretty: false)
        let verJson = MiniJson.stringifyString(manifest.version)
        let hashJson = MiniJson.stringifyString(codeHash)
        var sb = ""
        sb.reserveCapacity(cfgJson.count + 768)
        sb.append("(() => {\n")
        sb.append("    const nextCfg = ")
        sb.append(cfgJson)
        sb.append(";\n")
        sb.append("    const api = window.__agPrism || window.__agClaudeStyle;\n")
        sb.append("    if (!api || api.version !== ")
        sb.append(verJson)
        sb.append(" || typeof api.refreshConfig !== 'function') return { ok: false, refreshed: false };\n")
        sb.append("    if (")
        sb.append(hashJson)
        sb.append(" && api.codeHash && api.codeHash !== ")
        sb.append(hashJson)
        sb.append(") return { ok: false, refreshed: false };\n")
        sb.append("    api.refreshConfig(nextCfg);\n")
        sb.append("    const liveState = typeof api.getState === 'function' ? api.getState() : null;\n")
        sb.append("    const effectiveCfg = (liveState && liveState.cfg) || nextCfg;\n")
        sb.append("    try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("    try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("    try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("    try { if (effectiveCfg.omniModule === 'off') window.__agPrismOmni?.destroy?.(); else window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}\n")
        sb.append("    return { ok: true, refreshed: true, state: liveState };\n")
        sb.append("  })()")
        return sb
    }

    static func buildOmniClientExpression(baseDir: String, manifest: PluginManifest) -> String {
        let omniPath = (baseDir as NSString).appendingPathComponent("vendor/omni-viewer/omni-client.js")
        guard let clientSource = try? String(contentsOfFile: omniPath, encoding: .utf8), !clientSource.isEmpty else {
            return ""
        }
        let config = readConfig(baseDir: baseDir, manifest: manifest)
        let cfgJson = MiniJson.stringify(.object(config), pretty: false)
        let hashJson = MiniJson.stringifyString(computeHash(clientSource))
        var sb = ""
        sb.reserveCapacity(clientSource.count + cfgJson.count + 1024)
        sb.append("(() => {\n")
        sb.append("  const href = String((typeof location !== 'undefined' && location && location.href) || '');\n")
        sb.append("  if (/^(devtools:|chrome:|chrome-extension:|edge:|about:|data:|blob:|plugin:)/i.test(href)) return { ok: false, skipped: true };\n")
        sb.append("  const bootCfg = ")
        sb.append(cfgJson)
        sb.append(";\n")
        sb.append("  const nextHash = ")
        sb.append(hashJson)
        sb.append(";\n")
        sb.append("  const liveCfg = (window.__agPrism && typeof window.__agPrism.getState === 'function' && window.__agPrism.getState()?.cfg) || bootCfg;\n")
        sb.append("  const serverMeta = window.__agPrismOmniServerMeta || null;\n")
        sb.append("  const prev = window.__agPrismOmni;\n")
        sb.append("  const reused = Boolean(prev && prev.codeHash === nextHash && typeof prev.sync === 'function');\n")
        sb.append("  if (!reused) {\n")
        sb.append("    try { prev?.destroy?.(); } catch {}\n")
        sb.append("    ")
        sb.append(clientSource)
        sb.append("\n")
        sb.append("    if (window.__agPrismOmni && typeof window.__agPrismOmni === 'object') {\n")
        sb.append("      try { window.__agPrismOmni.codeHash = nextHash; } catch {}\n")
        sb.append("    }\n")
        sb.append("  }\n")
        sb.append("  try { window.__agPrismOmni?.sync?.(liveCfg, serverMeta); } catch {}\n")
        sb.append("  if (liveCfg && liveCfg.omniModule === 'off') return { ok: true, status: 'disabled' };\n")
        sb.append("  return { ok: true, status: reused ? 'synced' : (window.__agPrismOmni ? 'mounted' : 'ready') };\n")
        sb.append("})()")
        return sb
    }

    static func buildInjectExpression(baseDir: String, manifest: PluginManifest) throws -> String {
        let config = readConfig(baseDir: baseDir, manifest: manifest)
        let cssPath = (baseDir as NSString).appendingPathComponent("style.css")
        let css = try String(contentsOfFile: cssPath, encoding: .utf8)
        let bundle = try readRuntimeBundle(baseDir: baseDir, manifest: manifest)
        let codeHash = computeHash(bundle)

        var initCfg = config
        initCfg["binding"] = .string(manifest.settingBinding)
        initCfg["codeHash"] = .string(codeHash)
        initCfg["__fromFile"] = .bool(true)

        let styleIdJson = MiniJson.stringifyString(manifest.styleId)
        let verJson = MiniJson.stringifyString(manifest.version)
        var sb = ""
        sb.reserveCapacity(css.count + bundle.count + 4608)
        sb.append("(() => {\n")
        sb.append("    const css = ")
        sb.append(MiniJson.stringifyString(css))
        sb.append(";\n")
        sb.append("    const migrateLegacyStorage = () => {\n")
        sb.append("      try {\n")
        sb.append("        if (typeof localStorage === 'undefined' || !localStorage) return;\n")
        sb.append("        const legacyRaw = localStorage.getItem('ag-claude-style:config');\n")
        sb.append("        const v3Raw = localStorage.getItem('agClaudeStyle.settings.v3');\n")
        sb.append("        const prismRaw = localStorage.getItem('ag-prism:config');\n")
        sb.append("        if (!prismRaw && (legacyRaw || v3Raw)) localStorage.setItem('ag-prism:config', legacyRaw || v3Raw);\n")
        sb.append("        if (!v3Raw && (prismRaw || legacyRaw)) localStorage.setItem('agClaudeStyle.settings.v3', prismRaw || legacyRaw);\n")
        sb.append("      } catch {}\n")
        sb.append("    };\n")
        sb.append("    const cleanupLegacyResidue = () => {\n")
        sb.append("      try { const oldStyle = document.getElementById('ag-claude-style-css'); if (oldStyle) oldStyle.remove(); } catch {}\n")
        sb.append("      try { const oldApi = window.__agClaudeStyle; if (oldApi && (!window.__agPrism || Number(oldApi.version) <= 2)) { if (typeof oldApi.destroy === 'function') oldApi.destroy(); delete window.__agClaudeStyle; } } catch {}\n")
        sb.append("    };\n")
        sb.append("    const applyStyle = () => {\n")
        sb.append("      const targetParent = document.head || document.documentElement;\n")
        sb.append("      if (!targetParent) return;\n")
        sb.append("      cleanupLegacyResidue();\n")
        sb.append("      let style = document.getElementById(")
        sb.append(styleIdJson)
        sb.append(");\n")
        sb.append("      if (!style) {\n")
        sb.append("        style = document.createElement('style');\n")
        sb.append("        style.id = ")
        sb.append(styleIdJson)
        sb.append(";\n")
        sb.append("      }\n")
        sb.append("      if (style.textContent !== css) style.textContent = css;\n")
        sb.append("      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {\n")
        sb.append("        targetParent.appendChild(style);\n")
        sb.append("      }\n")
        sb.append("    };\n\n")
        sb.append("    let status = 'ok';\n")
        sb.append("    let mounted = false;\n")
        sb.append("    const mount = () => {\n")
        sb.append("      if (mounted || !document.documentElement) return;\n")
        sb.append("      mounted = true;\n")
        sb.append("      try {\n")
        sb.append("        cleanupLegacyResidue();\n")
        sb.append("        if (!window.__agPrismRepoBridge) {\n")
        sb.append("          const fn = (a) => Promise.resolve({ ok: false, offline: true, action: typeof a === 'string' ? a : (a && a.action) || 'status', noRemote: true, hasRemote: false, branch: 'local', commit: ")
        sb.append(verJson)
        sb.append(", shortHash: ")
        sb.append(verJson)
        sb.append(" });\n")
        sb.append("          fn.call = fn; fn.request = fn; fn.status = () => fn('status'); fn.pull = () => fn('pull'); fn.sync = () => fn('pull'); fn.resolve = () => {};\n")
        sb.append("          window.__agPrismRepoBridge = fn;\n")
        sb.append("        }\n")
        sb.append("        if (document.head) applyStyle();\n")
        sb.append("        else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });\n")
        sb.append("        const bootCfg = ")
        sb.append(MiniJson.stringify(.object(initCfg), pretty: false))
        sb.append(";\n")
        sb.append("        const existingPrism = window.__agPrism || window.__agClaudeStyle;\n")
        sb.append("        const bundleUnchanged = Boolean(\n")
        sb.append("          existingPrism &&\n")
        sb.append("          existingPrism.version === ")
        sb.append(verJson)
        sb.append(" &&\n")
        sb.append("          existingPrism.codeHash === bootCfg.codeHash &&\n")
        sb.append("          typeof existingPrism.refreshConfig === 'function' &&\n")
        sb.append("          window.__agPrismTelemetry &&\n")
        sb.append("          window.__agPrismEffortSlider &&\n")
        sb.append("          window.__agPrismThought\n")
        sb.append("        );\n")
        sb.append("        if (bundleUnchanged) {\n")
        sb.append("          existingPrism.refreshConfig(bootCfg);\n")
        sb.append("        } else {\n")
        sb.append("          try { window.__agPrismThought?.destroy?.(); } catch {}\n")
        sb.append("          ")
        sb.append(bundle)
        sb.append("\n")
        sb.append("          if (typeof globalThis.__agCsUiMain === 'function') {\n")
        sb.append("            globalThis.__agCsUiMain(bootCfg);\n")
        sb.append("          }\n")
        sb.append("        }\n")
        sb.append("        migrateLegacyStorage();\n")
        sb.append("        if (window.__agClaudeStyle && !window.__agPrism) window.__agPrism = window.__agClaudeStyle;\n")
        sb.append("        else if (window.__agPrism) window.__agClaudeStyle = window.__agPrism;\n")
        sb.append("        const liveState = window.__agPrism && typeof window.__agPrism.getState === 'function' ? window.__agPrism.getState() : null;\n")
        sb.append("        const effectiveCfg = (liveState && liveState.cfg) || bootCfg;\n")
        sb.append("        try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("        try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("        try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}\n")
        sb.append("        try { if (effectiveCfg.omniModule === 'off') window.__agPrismOmni?.destroy?.(); else window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}\n")
        sb.append("        if (document.documentElement && !document.documentElement.hasAttribute('data-ag-prism')) {\n")
        sb.append("          document.documentElement.setAttribute('data-ag-prism', ")
        sb.append(verJson)
        sb.append(");\n")
        sb.append("        }\n")
        sb.append("      } catch (e) {\n")
        sb.append("        status = 'error: ' + (e && e.message ? e.message : String(e));\n")
        sb.append("        if (typeof console !== 'undefined' && console.error) {\n")
        sb.append("          console.error('[obsidian-prism] init error:', e);\n")
        sb.append("        }\n")
        sb.append("      }\n")
        sb.append("    };\n\n")
        sb.append("    if (document.documentElement) {\n")
        sb.append("      mount();\n")
        sb.append("    } else {\n")
        sb.append("      status = 'deferred';\n")
        sb.append("      const onReady = () => {\n")
        sb.append("        if (document.documentElement) {\n")
        sb.append("          document.removeEventListener('readystatechange', onReady);\n")
        sb.append("          document.removeEventListener('DOMContentLoaded', onReady);\n")
        sb.append("          mount();\n")
        sb.append("        }\n")
        sb.append("      };\n")
        sb.append("      document.addEventListener('readystatechange', onReady);\n")
        sb.append("      document.addEventListener('DOMContentLoaded', onReady);\n")
        sb.append("    }\n")
        sb.append("    const api = window.__agPrism || window.__agClaudeStyle;\n")
        sb.append("    const st = api && typeof api.getState === 'function' ? api.getState() : null;\n")
        sb.append("    return {\n")
        sb.append("      version: ")
        sb.append(verJson)
        sb.append(",\n")
        sb.append("      status,\n")
        sb.append("      state: st,\n")
        sb.append("    };\n")
        sb.append("  })()")
        return sb
    }

    static func shortTitle(_ page: CdpPageInfo) -> String {
        let t = !page.title.isEmpty ? page.title : page.url
        if t.count > 60 {
            return String(t.prefix(57)) + "..."
        }
        return t
    }
}
