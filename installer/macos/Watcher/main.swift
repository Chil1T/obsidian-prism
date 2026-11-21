import Foundation
#if canImport(Darwin)
import Darwin
#endif

struct FrameContextMeta {
    let frameId: String
    let isDefault: Bool
    let contextType: String
}

final class AttachedEntry {
    let session: CdpSession
    var scriptId: String?
    var omniScriptId: String?
    var thoughtScriptId: String?
    let title: String
    private let ctxLock = NSLock()
    var mainFrameId: String = ""
    var hasFrameTree: Bool = false
    var contextFrames: [Int: FrameContextMeta] = [:]

    init(session: CdpSession, scriptId: String? = nil, omniScriptId: String? = nil, thoughtScriptId: String? = nil, title: String) {
        self.session = session
        self.scriptId = scriptId
        self.omniScriptId = omniScriptId
        self.thoughtScriptId = thoughtScriptId
        self.title = title
    }

    func setMainFrame(_ id: String) {
        guard !id.isEmpty else { return }
        ctxLock.lock()
        mainFrameId = id
        hasFrameTree = true
        ctxLock.unlock()
    }

    func recordContext(id: Int, meta: FrameContextMeta) {
        ctxLock.lock()
        contextFrames[id] = meta
        ctxLock.unlock()
    }

    func removeContext(id: Int) {
        ctxLock.lock()
        contextFrames.removeValue(forKey: id)
        ctxLock.unlock()
    }

    func clearContexts() {
        ctxLock.lock()
        contextFrames.removeAll()
        ctxLock.unlock()
    }

    func isTrustedMainFrameBinding(_ params: [String: JsonValue]) -> Bool {
        ctxLock.lock()
        defer { ctxLock.unlock() }
        if let ctxId = params["executionContextId"]?.intValue,
           let meta = contextFrames[ctxId] {
            if !meta.isDefault { return false }
            if !meta.contextType.isEmpty && meta.contextType != "default" { return false }
            if !mainFrameId.isEmpty && !meta.frameId.isEmpty && meta.frameId != mainFrameId {
                return false
            }
            return true
        }
        if hasFrameTree {
            if params["executionContextId"]?.intValue == nil { return false }
            if !contextFrames.isEmpty { return false }
        }
        return true
    }
}

final class WatcherApp {
    private let baseDir: String
    private let pluginDir: String
    private let logFile: String
    private let pidFile: String
    private let lockFile: String
    private let isWatch: Bool
    private let noNativeDaemon: Bool
    private let noRelaunchPrompt: Bool
    private let logLock = NSLock()

    init(baseDir: String, pluginDir: String, isWatch: Bool, noNativeDaemon: Bool = false, noRelaunchPrompt: Bool = false) {
        self.baseDir = baseDir
        self.pluginDir = pluginDir
        self.logFile = (baseDir as NSString).appendingPathComponent("watch.log")
        self.pidFile = (baseDir as NSString).appendingPathComponent(".watch.pid")
        self.lockFile = (baseDir as NSString).appendingPathComponent(".watch.lock")
        self.isWatch = isWatch
        self.noNativeDaemon = noNativeDaemon || (ProcessInfo.processInfo.environment["AG_PRISM_NO_NATIVE_DAEMON"] == "1")
        self.noRelaunchPrompt = noRelaunchPrompt
    }

    func log(_ line: String) {
        guard isWatch else { return }
        logLock.lock()
        defer { logLock.unlock() }
        let fm = FileManager.default
        if let attrs = try? fm.attributesOfItem(atPath: logFile),
           let size = attrs[.size] as? NSNumber,
           size.int64Value > 1024 * 1024 {
            try? "".write(toFile: logFile, atomically: false, encoding: .utf8)
        }
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let entry = "[\(fmt.string(from: Date()))] \(line)\n"
        guard let data = entry.data(using: .utf8) else { return }
        if !fm.fileExists(atPath: logFile) {
            fm.createFile(atPath: logFile, contents: data, attributes: nil)
            return
        }
        if let handle = FileHandle(forWritingAtPath: logFile) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        }
    }

    static func writeResult(outFile: String?, ok: Bool, message: String, pages: [String]?) {
        guard let outFile = outFile, !outFile.isEmpty else { return }
        var obj: [String: JsonValue] = [
            "ok": .bool(ok),
            "message": .string(message)
        ]
        if let pages = pages {
            obj["pages"] = .array(pages.map { .string($0) })
        }
        let text = MiniJson.stringify(.object(obj), pretty: true) + "\n"
        try? text.write(toFile: outFile, atomically: true, encoding: .utf8)
    }

    private func readPidFile() -> Int32? {
        guard let text = try? String(contentsOfFile: pidFile, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let pid = Int32(trimmed), pid > 0 { return pid }
        return nil
    }

    private func releasePidFile(selfPid: Int32) {
        if let current = readPidFile(), current == selfPid {
            try? FileManager.default.removeItem(atPath: pidFile)
        }
    }

    func runOnce(overridePort: Int?, outFile: String?) -> Int32 {
        do {
            let manifest = try PluginManifest.load(baseDir: baseDir)
            guard let port = CdpHelper.readPort(overridePort: overridePort) else {
                Self.writeResult(outFile: outFile, ok: false, message: "未找到调试端口文件，Antigravity 可能未运行", pages: nil)
                return 1
            }
            let pages = try CdpHelper.listPages(port: port)
            if pages.isEmpty {
                Self.writeResult(outFile: outFile, ok: false, message: "未找到 Antigravity 窗口页面", pages: nil)
                return 1
            }
            let onceCfg = CdpHelper.readConfig(baseDir: baseDir, manifest: manifest)
            let expr = try CdpHelper.buildInjectExpression(baseDir: baseDir, manifest: manifest)
            let omniExpr = CdpHelper.buildOmniClientExpression(baseDir: baseDir, manifest: manifest)
            let thoughtExpr = CdpHelper.shouldEnableThought(onceCfg)
                ? CdpHelper.buildThoughtExpression(baseDir: baseDir, cfg: onceCfg)
                : ""
            var injectedTitles: [String] = []
            for page in pages {
                let session = try CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 4000)
                defer { session.close() }
                _ = try session.evaluate(expr, awaitPromise: false)
                if !omniExpr.isEmpty {
                    _ = try? session.evaluate(omniExpr, awaitPromise: false)
                }
                if !thoughtExpr.isEmpty {
                    _ = try? session.evaluate(thoughtExpr, awaitPromise: false)
                }
                injectedTitles.append(CdpHelper.shortTitle(page))
            }
            Self.writeResult(outFile: outFile, ok: true, message: "injected \(injectedTitles.count) page(s)", pages: injectedTitles)
            return 0
        } catch {
            Self.writeResult(outFile: outFile, ok: false, message: error.localizedDescription, pages: nil)
            return 1
        }
    }

    func runRemove(overridePort: Int?, outFile: String?) -> Int32 {
        let manifest = try? PluginManifest.load(baseDir: baseDir)
        stopRunningWatcherInDir()
        var cleaned: [String] = []
        if let port = CdpHelper.readPort(overridePort: overridePort),
           let removeExpr = manifest?.removeExpression,
           !removeExpr.isEmpty,
           let pages = try? CdpHelper.listPages(port: port) {
            for page in pages {
                if let session = try? CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 3000) {
                    defer { session.close() }
                    if (try? session.evaluate(removeExpr, awaitPromise: false)) != nil {
                        cleaned.append(CdpHelper.shortTitle(page))
                    }
                }
            }
        }
        Self.writeResult(outFile: outFile, ok: true, message: "removed from \(cleaned.count) page(s)", pages: cleaned)
        return 0
    }

    private func stopRunningWatcherInDir() {
        let selfPid = getpid()
        if let pid = readPidFile(), pid != selfPid {
            if kill(pid, 0) == 0 && CdpHelper.isExpectedDaemonProcess(pid: pid) {
                _ = kill(pid, SIGTERM)
                let deadline = Date().addingTimeInterval(2.0)
                while Date() < deadline {
                    if kill(pid, 0) != 0 { break }
                    Thread.sleep(forTimeInterval: 0.05)
                }
                if kill(pid, 0) == 0 {
                    _ = kill(pid, SIGKILL)
                    Thread.sleep(forTimeInterval: 0.1)
                }
            }
        }
        try? FileManager.default.removeItem(atPath: pidFile)
    }

    private func computeDirStamp() -> [String: String] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: baseDir) else { return [:] }
        var stamp: [String: String] = [:]
        for name in names {
            if name.hasPrefix(".") { continue }
            let lower = name.lowercased()
            if !lower.hasSuffix(".css") && !lower.hasSuffix(".js") && !lower.hasSuffix(".json") {
                continue
            }
            let full = (baseDir as NSString).appendingPathComponent(name)
            if let attrs = try? fm.attributesOfItem(atPath: full) {
                let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
                stamp[name] = "\(mtime):\(size)"
            }
        }
        for vendorRel in [
            "vendor/omni-viewer/omni-client.js",
            "vendor/thought-translator/thought-client.js",
            "vendor/thought-translator/thought-settings-ui.js",
        ] {
            let vendorFull = (baseDir as NSString).appendingPathComponent(vendorRel)
            if let attrs = try? fm.attributesOfItem(atPath: vendorFull) {
                let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
                stamp[vendorRel] = "\(mtime):\(size)"
            }
        }
        return stamp
    }

    private func firstChangedFile(oldStamp: [String: String], newStamp: [String: String]) -> String? {
        for (k, v) in newStamp {
            if oldStamp[k] != v { return k }
        }
        for k in oldStamp.keys where newStamp[k] == nil {
            return k
        }
        return nil
    }

    func runWatch(overridePort: Int?) -> Int32 {
        try? FileManager.default.createDirectory(atPath: baseDir, withIntermediateDirectories: true, attributes: nil)
        let lockFd = open(lockFile, O_CREAT | O_RDWR, 0o644)
        if lockFd < 0 {
            return 1
        }
        if flock(lockFd, LOCK_EX | LOCK_NB) != 0 {
            close(lockFd)
            return 0
        }

        let selfPid = getpid()
        try? String(selfPid).write(toFile: pidFile, atomically: true, encoding: .utf8)
        try? "".write(toFile: logFile, atomically: false, encoding: .utf8)

        var manifest: PluginManifest
        var currentExpr: String
        var currentOmniExpr: String
        var currentThoughtExpr: String
        do {
            manifest = try PluginManifest.load(baseDir: baseDir)
            let initCfg = CdpHelper.readConfig(baseDir: baseDir, manifest: manifest)
            currentExpr = try CdpHelper.buildInjectExpression(baseDir: baseDir, manifest: manifest)
            currentOmniExpr = CdpHelper.buildOmniClientExpression(baseDir: baseDir, manifest: manifest)
            currentThoughtExpr = CdpHelper.shouldEnableThought(initCfg)
                ? CdpHelper.buildThoughtExpression(baseDir: baseDir, cfg: initCfg)
                : ""
        } catch {
            log("[!] 初始化加载失败: \(error.localizedDescription)")
            releasePidFile(selfPid: selfPid)
            flock(lockFd, LOCK_UN)
            close(lockFd)
            return 1
        }

        log("[*] Obsidian Prism (obsidian-prism) 守护模式启动 (PID \(selfPid))，每 2 秒检查一次窗口")

        let stateLock = NSLock()
        var attached: [String: AttachedEntry] = [:]
        var attaching: Set<String> = []
        var lastDirStamp = computeDirStamp()

        let exitSem = DispatchSemaphore(value: 0)
        var shouldExit = false
        let exitLock = NSLock()
        let requestExit = {
            exitLock.lock()
            let already = shouldExit
            shouldExit = true
            exitLock.unlock()
            if !already {
                exitSem.signal()
            }
        }
        let isExiting: () -> Bool = {
            exitLock.lock()
            let v = shouldExit
            exitLock.unlock()
            return v
        }

        signal(SIGTERM, SIG_IGN)
        signal(SIGINT, SIG_IGN)
        let sigQueue = DispatchQueue(label: "io.github.rmvdesi.obsidian-prism.signals")
        let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: sigQueue)
        termSource.setEventHandler(handler: requestExit)
        termSource.resume()
        let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: sigQueue)
        intSource.setEventHandler(handler: requestExit)
        intSource.resume()

        let applyToEntry: (AttachedEntry, String, String, String) throws -> JsonValue = { entry, exprToUse, omniExprToUse, thoughtExprToUse in
            if let oldId = entry.scriptId, !oldId.isEmpty {
                _ = try? entry.session.send(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    params: ["identifier": .string(oldId)],
                    timeoutMs: 5000
                )
            }
            let addRes = try entry.session.send(
                "Page.addScriptToEvaluateOnNewDocument",
                params: ["source": .string(exprToUse)],
                timeoutMs: 15000
            )
            if let newId = addRes["identifier"]?.stringValue {
                entry.scriptId = newId
            }
            let mainVal = try entry.session.evaluate(exprToUse, awaitPromise: false)
            if mainVal.objectValue?["status"]?.stringValue == "skipped-non-host" {
                if let revId = entry.scriptId, !revId.isEmpty {
                    _ = try? entry.session.send(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        params: ["identifier": .string(revId)],
                        timeoutMs: 5000
                    )
                    entry.scriptId = nil
                }
                if let oldOmniId = entry.omniScriptId, !oldOmniId.isEmpty {
                    _ = try? entry.session.send(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        params: ["identifier": .string(oldOmniId)],
                        timeoutMs: 5000
                    )
                    entry.omniScriptId = nil
                }
                if let oldThoughtId = entry.thoughtScriptId, !oldThoughtId.isEmpty {
                    _ = try? entry.session.send(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        params: ["identifier": .string(oldThoughtId)],
                        timeoutMs: 5000
                    )
                    entry.thoughtScriptId = nil
                }
                return mainVal
            }

            if let oldOmniId = entry.omniScriptId, !oldOmniId.isEmpty {
                _ = try? entry.session.send(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    params: ["identifier": .string(oldOmniId)],
                    timeoutMs: 5000
                )
                entry.omniScriptId = nil
            }
            if !omniExprToUse.isEmpty {
                if let omniRes = try? entry.session.send(
                    "Page.addScriptToEvaluateOnNewDocument",
                    params: ["source": .string(omniExprToUse)],
                    timeoutMs: 15000
                ), let omniId = omniRes["identifier"]?.stringValue {
                    entry.omniScriptId = omniId
                }
                _ = try? entry.session.evaluate(omniExprToUse, awaitPromise: false)
            }

            let hadThought = (entry.thoughtScriptId?.isEmpty == false)
            if let oldThoughtId = entry.thoughtScriptId, !oldThoughtId.isEmpty {
                _ = try? entry.session.send(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    params: ["identifier": .string(oldThoughtId)],
                    timeoutMs: 5000
                )
                entry.thoughtScriptId = nil
            }
            if !thoughtExprToUse.isEmpty {
                if let thoughtRes = try? entry.session.send(
                    "Page.addScriptToEvaluateOnNewDocument",
                    params: ["source": .string(thoughtExprToUse)],
                    timeoutMs: 15000
                ), let thoughtId = thoughtRes["identifier"]?.stringValue {
                    entry.thoughtScriptId = thoughtId
                }
                _ = try? entry.session.evaluate(thoughtExprToUse, awaitPromise: false)
            } else if hadThought {
                _ = try? entry.session.evaluate(CdpHelper.thoughtRemoveExpression, awaitPromise: false)
            }
            return mainVal
        }

        let attachPage: (CdpPageInfo) -> Void = { page in
            stateLock.lock()
            if attached[page.id] != nil || attaching.contains(page.id) {
                stateLock.unlock()
                return
            }
            attaching.insert(page.id)
            stateLock.unlock()

            var session: CdpSession?
            do {
                let s = try CdpSession.connect(wsUrl: page.webSocketDebuggerUrl, timeoutMs: 4000)
                session = s
                let title = CdpHelper.shortTitle(page)
                let entry = AttachedEntry(session: s, scriptId: nil, title: title)

                s.onClose = {
                    stateLock.lock()
                    let removed = attached.removeValue(forKey: page.id)
                    stateLock.unlock()
                    if let removed = removed {
                        self.log("[-] 窗口已关闭: \(removed.title)")
                    }
                }

                s.on("Runtime.executionContextCreated") { cp in
                    guard let ctx = cp["context"]?.objectValue,
                          let cid = ctx["id"]?.intValue else { return }
                    let aux = ctx["auxData"]?.objectValue ?? [:]
                    let fid = aux["frameId"]?.stringValue ?? ""
                    let isDef = aux["isDefault"]?.boolValue ?? true
                    let cType = aux["type"]?.stringValue ?? "default"
                    entry.recordContext(id: cid, meta: FrameContextMeta(frameId: fid, isDefault: isDef, contextType: cType))
                }
                s.on("Runtime.executionContextDestroyed") { dp in
                    if let cid = dp["executionContextId"]?.intValue {
                        entry.removeContext(id: cid)
                    }
                }
                s.on("Runtime.executionContextsCleared") { _ in
                    entry.clearContexts()
                }
                s.on("Page.frameNavigated") { fp in
                    if let frame = fp["frame"]?.objectValue {
                        let parentId = frame["parentId"]?.stringValue ?? ""
                        if parentId.isEmpty, let fid = frame["id"]?.stringValue, !fid.isEmpty {
                            entry.setMainFrame(fid)
                        }
                    }
                }

                _ = try s.send("Page.enable", params: nil, timeoutMs: 5000)
                if let ftRes = try? s.send("Page.getFrameTree", params: nil, timeoutMs: 3000),
                   let topId = ftRes["frameTree"]?.objectValue?["frame"]?.objectValue?["id"]?.stringValue,
                   !topId.isEmpty {
                    entry.setMainFrame(topId)
                }
                s.on("Runtime.bindingCalled") { params in
                    guard entry.isTrustedMainFrameBinding(params) else { return }
                    guard let name = params["name"]?.stringValue,
                          let payloadStr = params["payload"]?.stringValue else { return }
                    stateLock.lock()
                    let manifestSnap = manifest
                    stateLock.unlock()
                    guard name == manifestSnap.settingBinding || name == "__agClaudeStyleSetting" else { return }
                    guard let kv = try? MiniJson.parseObject(payloadStr) else { return }

                    if kv["action"]?.stringValue == "patch-batch",
                       let entriesObj = kv["entries"]?.objectValue {
                        if CdpHelper.updateConfigBatch(baseDir: self.baseDir, manifest: manifestSnap, entries: entriesObj) {
                            if !self.pluginDir.isEmpty && FileManager.default.fileExists(atPath: self.pluginDir) {
                                _ = CdpHelper.updateConfigBatch(baseDir: self.pluginDir, manifest: manifestSnap, entries: entriesObj)
                            }
                            self.log("[⚙] 批量设置已保存 (\(entriesObj.count) 项)")
                        }
                        return
                    }

                    if let key = kv["key"]?.stringValue,
                       let value = kv["value"] {
                        if CdpHelper.updateConfigSetting(baseDir: self.baseDir, manifest: manifestSnap, key: key, value: value) {
                            if !self.pluginDir.isEmpty && FileManager.default.fileExists(atPath: self.pluginDir) {
                                _ = CdpHelper.updateConfigSetting(baseDir: self.pluginDir, manifest: manifestSnap, key: key, value: value)
                            }
                            self.log("[⚙] 设置已保存: \(key) = \(MiniJson.stringify(value, pretty: false))")
                        }
                    }
                }

                _ = try s.send("Runtime.enable", params: nil, timeoutMs: 5000)
                stateLock.lock()
                let bindingName = manifest.settingBinding
                let exprSnap = currentExpr
                let omniSnap = currentOmniExpr
                let thoughtSnap = currentThoughtExpr
                stateLock.unlock()

                _ = try s.send("Runtime.addBinding", params: ["name": .string(bindingName)], timeoutMs: 5000)
                if bindingName != "__agClaudeStyleSetting" {
                    _ = try? s.send("Runtime.addBinding", params: ["name": .string("__agClaudeStyleSetting")], timeoutMs: 5000)
                }

                stateLock.lock()
                attached[page.id] = entry
                attaching.remove(page.id)
                stateLock.unlock()

                let evalVal = try applyToEntry(entry, exprSnap, omniSnap, thoughtSnap)
                let status = evalVal.objectValue?["status"]?.stringValue ?? "ok"
                self.log("[✓] 已注入 obsidian-prism: \(title) (\(status))")
            } catch {
                stateLock.lock()
                attaching.remove(page.id)
                let removed = attached.removeValue(forKey: page.id)
                stateLock.unlock()
                removed?.session.close()
                session?.close()
                self.log("[!] 注入失败，稍后重试: \(CdpHelper.shortTitle(page)) — \(error.localizedDescription)")
            }
        }

        let reloadQueue = DispatchQueue(label: "io.github.rmvdesi.obsidian-prism.reload")
        var pendingReloadWork: DispatchWorkItem?
        var pendingChangedHint: String?

        let performReload: (String?) -> Void = { hintName in
            pendingReloadWork?.cancel()
            pendingReloadWork = nil
            pendingChangedHint = nil

            let currentStamp = self.computeDirStamp()
            stateLock.lock()
            let detectedChange = self.firstChangedFile(oldStamp: lastDirStamp, newStamp: currentStamp)
            if detectedChange == nil {
                stateLock.unlock()
                return
            }
            lastDirStamp = currentStamp
            stateLock.unlock()

            let changedName = detectedChange ?? hintName ?? "config.json"
            do {
                let nextManifest = try PluginManifest.load(baseDir: self.baseDir)
                let nextCfg = CdpHelper.readConfig(baseDir: self.baseDir, manifest: nextManifest)
                let nextExpr = try CdpHelper.buildInjectExpression(baseDir: self.baseDir, manifest: nextManifest)
                let nextOmniExpr = CdpHelper.buildOmniClientExpression(baseDir: self.baseDir, manifest: nextManifest)
                let nextThoughtExpr = CdpHelper.shouldEnableThought(nextCfg)
                    ? CdpHelper.buildThoughtExpression(baseDir: self.baseDir, cfg: nextCfg)
                    : ""
                let fastCfgExpr: String? = ((changedName as NSString).lastPathComponent.caseInsensitiveCompare("config.json") == .orderedSame)
                    ? CdpHelper.buildConfigRefreshExpression(baseDir: self.baseDir, manifest: nextManifest)
                    : nil
                stateLock.lock()
                let prevThoughtExpr = currentThoughtExpr
                manifest = nextManifest
                currentExpr = nextExpr
                currentOmniExpr = nextOmniExpr
                currentThoughtExpr = nextThoughtExpr
                let entries = Array(attached.values)
                stateLock.unlock()

                var n = 0
                for entry in entries {
                    if let fastExpr = fastCfgExpr {
                        if let oldId = entry.scriptId, !oldId.isEmpty {
                            _ = try? entry.session.send("Page.removeScriptToEvaluateOnNewDocument", params: ["identifier": .string(oldId)], timeoutMs: 5000)
                            entry.scriptId = nil
                        }
                        if let addRes = try? entry.session.send("Page.addScriptToEvaluateOnNewDocument", params: ["source": .string(nextExpr)], timeoutMs: 15000),
                           let newId = addRes["identifier"]?.stringValue {
                            entry.scriptId = newId
                        }
                        if let oldOmniId = entry.omniScriptId, !oldOmniId.isEmpty {
                            _ = try? entry.session.send("Page.removeScriptToEvaluateOnNewDocument", params: ["identifier": .string(oldOmniId)], timeoutMs: 5000)
                            entry.omniScriptId = nil
                        }
                        if !nextOmniExpr.isEmpty,
                           let omniAdd = try? entry.session.send("Page.addScriptToEvaluateOnNewDocument", params: ["source": .string(nextOmniExpr)], timeoutMs: 15000),
                           let omniId = omniAdd["identifier"]?.stringValue {
                            entry.omniScriptId = omniId
                        }
                        let hadThought = (entry.thoughtScriptId?.isEmpty == false) || !prevThoughtExpr.isEmpty
                        if let oldThoughtId = entry.thoughtScriptId, !oldThoughtId.isEmpty {
                            _ = try? entry.session.send("Page.removeScriptToEvaluateOnNewDocument", params: ["identifier": .string(oldThoughtId)], timeoutMs: 5000)
                            entry.thoughtScriptId = nil
                        }
                        if !nextThoughtExpr.isEmpty,
                           let thoughtAdd = try? entry.session.send("Page.addScriptToEvaluateOnNewDocument", params: ["source": .string(nextThoughtExpr)], timeoutMs: 15000),
                           let thoughtId = thoughtAdd["identifier"]?.stringValue {
                            entry.thoughtScriptId = thoughtId
                        }
                        if let fastRes = try? entry.session.evaluate(fastExpr, awaitPromise: false),
                           fastRes.objectValue?["refreshed"]?.boolValue == true {
                            if !nextOmniExpr.isEmpty {
                                _ = try? entry.session.evaluate(nextOmniExpr, awaitPromise: false)
                            }
                            if !nextThoughtExpr.isEmpty {
                                _ = try? entry.session.evaluate(nextThoughtExpr, awaitPromise: false)
                            } else if hadThought {
                                _ = try? entry.session.evaluate(CdpHelper.thoughtRemoveExpression, awaitPromise: false)
                            }
                            n += 1
                            continue
                        }
                        if (try? entry.session.evaluate(nextExpr, awaitPromise: false)) != nil {
                            if !nextOmniExpr.isEmpty {
                                _ = try? entry.session.evaluate(nextOmniExpr, awaitPromise: false)
                            }
                            if !nextThoughtExpr.isEmpty {
                                _ = try? entry.session.evaluate(nextThoughtExpr, awaitPromise: false)
                            } else if hadThought {
                                _ = try? entry.session.evaluate(CdpHelper.thoughtRemoveExpression, awaitPromise: false)
                            }
                            n += 1
                        }
                    } else {
                        if (try? applyToEntry(entry, nextExpr, nextOmniExpr, nextThoughtExpr)) != nil {
                            n += 1
                        }
                    }
                }
                self.log("[↻] \(changedName) 已变更，已热更新 \(n) 个窗口")
            } catch {
                self.log("[!] 读取文件失败: \(error.localizedDescription)")
            }
        }

        let scheduleReload: (String?) -> Void = { hintName in
            reloadQueue.async {
                if let hint = hintName { pendingChangedHint = hint }
                pendingReloadWork?.cancel()
                let work = DispatchWorkItem {
                    let hint = pendingChangedHint
                    pendingChangedHint = nil
                    performReload(hint)
                }
                pendingReloadWork = work
                reloadQueue.asyncAfter(deadline: .now() + .milliseconds(180), execute: work)
            }
        }

        var dirSource: DispatchSourceFileSystemObject?
        let dirFd = open(baseDir, O_EVTONLY)
        if dirFd >= 0 {
            let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: dirFd, eventMask: [.write, .rename, .extend, .delete], queue: reloadQueue)
            src.setEventHandler {
                let currentStamp = self.computeDirStamp()
                stateLock.lock()
                let changed = self.firstChangedFile(oldStamp: lastDirStamp, newStamp: currentStamp)
                stateLock.unlock()
                if let changed = changed {
                    scheduleReload(changed)
                }
            }
            src.setCancelHandler {
                close(dirFd)
            }
            src.resume()
            dirSource = src
        }

        let syncNewerPluginConfigToBase = {
            guard !self.pluginDir.isEmpty else { return }
            let pluginCfg = (self.pluginDir as NSString).appendingPathComponent("config.json")
            let baseCfg = (self.baseDir as NSString).appendingPathComponent("config.json")
            let fm = FileManager.default
            guard fm.fileExists(atPath: pluginCfg) else { return }
            if !fm.fileExists(atPath: baseCfg) {
                try? fm.copyItem(atPath: pluginCfg, toPath: baseCfg)
                return
            }
            if let pAttrs = try? fm.attributesOfItem(atPath: pluginCfg),
               let bAttrs = try? fm.attributesOfItem(atPath: baseCfg),
               let pMtime = pAttrs[.modificationDate] as? Date,
               let bMtime = bAttrs[.modificationDate] as? Date,
               pMtime.timeIntervalSince(bMtime) > 0.25 {
                try? fm.removeItem(atPath: baseCfg)
                try? fm.copyItem(atPath: pluginCfg, toPath: baseCfg)
            }
        }

        let defaultMacInstallDir = URL(
            fileURLWithPath: (FileManager.default.homeDirectoryForCurrentUser.path as NSString)
                .appendingPathComponent("Library/Application Support/obsidian-prism")
        ).standardizedFileURL.path
        let isDefaultDir = (self.baseDir == defaultMacInstallDir)

        var lastPort: Int?
        var yieldingToDaemon = false
        var lastDaemonSpawnAttempt = Date.distantPast
        while !isExiting() {
            var nativeAlive = !pluginDir.isEmpty && CdpHelper.isNativeDaemonAlive(pluginDir: pluginDir)
            if !nativeAlive && !noNativeDaemon && !pluginDir.isEmpty {
                if let activePort = CdpHelper.readPort(overridePort: overridePort),
                   Date().timeIntervalSince(lastDaemonSpawnAttempt) >= 6.0 {
                    lastDaemonSpawnAttempt = Date()
                    if CdpHelper.ensureNativeDaemonRunning(pluginDir: pluginDir, cdpPort: activePort, log: { msg in
                        self.log("[+] \(msg)")
                    }) {
                        nativeAlive = true
                    }
                }
            }
            if nativeAlive {
                syncNewerPluginConfigToBase()
                stateLock.lock()
                let hasAttached = !attached.isEmpty
                let oldEntries = Array(attached.values)
                attached.removeAll()
                stateLock.unlock()
                if !yieldingToDaemon || hasAttached {
                    for oldEntry in oldEntries {
                        oldEntry.session.close()
                    }
                    lastPort = nil
                    if !yieldingToDaemon {
                        yieldingToDaemon = true
                        log("[~] 检测到原生 Sidecar Daemon 运行中，Watcher 进入热备避让态")
                    }
                }
                _ = exitSem.wait(timeout: .now() + .milliseconds(750))
                continue
            }
            if yieldingToDaemon {
                yieldingToDaemon = false
                log("[+] 原生 Sidecar Daemon 已离线，Watcher 接管实时注入")
            }

            // Poll fallback for in-place edits that don't fire directory vnode write events
            reloadQueue.sync {
                performReload(nil)
            }

            let activePort = CdpHelper.readPort(overridePort: overridePort)
            if activePort == nil && overridePort == nil {
                let env = ProcessInfo.processInfo.environment
                let mockDec = env["AG_PRISM_MOCK_RELAUNCH_DECISION"] ?? ""
                var allowPrompt = !self.noRelaunchPrompt &&
                    env["PRISM_NO_RELAUNCH_PROMPT"] != "1" &&
                    env["AG_PRISM_NO_RELAUNCH_PROMPT"] != "1" &&
                    (env["NODE_ENV"] ?? "").caseInsensitiveCompare("test") != .orderedSame &&
                    (isDefaultDir || !mockDec.isEmpty)
                if allowPrompt {
                    stateLock.lock()
                    let mSnap = manifest
                    stateLock.unlock()
                    let curCfg = CdpHelper.readConfig(baseDir: self.baseDir, manifest: mSnap)
                    if let autoVal = curCfg["autoPromptCdpRelaunch"] {
                        if autoVal.boolValue == false { allowPrompt = false }
                        else if let s = autoVal.stringValue?.lowercased(), (s == "off" || s == "false") { allowPrompt = false }
                    }
                }
                if allowPrompt,
                   let bare = CdpHelper.findBareAntigravityMainProcess(),
                   bare.uptimeMs >= 8000,
                   !CdpHelper.hasPromptedForHost(pid: bare.pid, startTimeMs: bare.startTimeMs, installDir: self.baseDir, pluginDir: self.pluginDir) {
                    CdpHelper.recordPromptedForHost(pid: bare.pid, startTimeMs: bare.startTimeMs, decision: "prompted", installDir: self.baseDir, pluginDir: self.pluginDir)
                    let confirmed = CdpHelper.promptUserForCdpRelaunch()
                    CdpHelper.recordPromptedForHost(pid: bare.pid, startTimeMs: bare.startTimeMs, decision: confirmed ? "yes" : "no", installDir: self.baseDir, pluginDir: self.pluginDir)
                    if confirmed {
                        log("[*] 用户确认带 --remote-debugging-port=0 重新打开 Antigravity (旧 PID \(bare.pid))")
                        _ = CdpHelper.relaunchAntigravityWithCdp(host: bare, waitExitMs: 15000) { m in self.log("[+] \(m)") }
                    }
                }
            }

            if let port = activePort,
               let pages = try? CdpHelper.listPages(port: port) {
                if lastPort != port {
                    stateLock.lock()
                    let oldEntries = Array(attached.values)
                    attached.removeAll()
                    stateLock.unlock()
                    for oldEntry in oldEntries {
                        oldEntry.session.close()
                    }
                    log("[+] 连接到调试端口 \(port)")
                    lastPort = port
                }

                let group = DispatchGroup()
                for page in pages {
                    stateLock.lock()
                    let needsAttach = (attached[page.id] == nil && !attaching.contains(page.id))
                    stateLock.unlock()
                    if needsAttach {
                        group.enter()
                        DispatchQueue.global(qos: .utility).async {
                            attachPage(page)
                            group.leave()
                        }
                    }
                }
                _ = group.wait(timeout: .now() + .seconds(10))
            }

            _ = exitSem.wait(timeout: .now() + .seconds(2))
        }

        dirSource?.cancel()
        termSource.cancel()
        intSource.cancel()

        stateLock.lock()
        let finalEntries = Array(attached.values)
        attached.removeAll()
        stateLock.unlock()
        for entry in finalEntries {
            entry.session.close()
        }

        releasePidFile(selfPid: selfPid)
        flock(lockFd, LOCK_UN)
        close(lockFd)
        return 0
    }
}

func runWatcherMain() -> Int32 {
    var mode = "watch"
    var customDir: String?
    var customPluginDir: String?
    var overridePort: Int?
    var outFile: String?
    var noNativeDaemon = false
    var noRelaunchPrompt = false

    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        let a = args[i]
        if a == "--watch" { mode = "watch" }
        else if a == "--once" { mode = "once" }
        else if a == "--remove" { mode = "remove" }
        else if a == "--no-native-daemon" { noNativeDaemon = true }
        else if a == "--no-relaunch-prompt" { noRelaunchPrompt = true }
        else if a == "--dir" && i + 1 < args.count { i += 1; customDir = args[i] }
        else if a == "--plugin-dir" && i + 1 < args.count { i += 1; customPluginDir = args[i] }
        else if a == "--cdp-port" && i + 1 < args.count {
            i += 1
            if let p = Int(args[i]), p > 0 { overridePort = p }
        }
        else if a == "--out" && i + 1 < args.count { i += 1; outFile = args[i] }
        i += 1
    }

    let rawBase = (customDir?.isEmpty == false)
        ? customDir!
        : ((args[0] as NSString).deletingLastPathComponent)
    let baseDir = URL(fileURLWithPath: rawBase.isEmpty ? "." : rawBase).standardizedFileURL.path

    let defaultInstallDir = URL(
        fileURLWithPath: (FileManager.default.homeDirectoryForCurrentUser.path as NSString)
            .appendingPathComponent("Library/Application Support/obsidian-prism")
    ).standardizedFileURL.path

    let pluginDir: String
    if let explicitPlugin = customPluginDir, !explicitPlugin.isEmpty {
        pluginDir = URL(fileURLWithPath: explicitPlugin).standardizedFileURL.path
    } else if let envOverride = ProcessInfo.processInfo.environment["AG_PRISM_PLUGIN_DIR"], !envOverride.isEmpty {
        pluginDir = CdpHelper.getDefaultNativePluginDir()
    } else if customDir == nil || baseDir == defaultInstallDir {
        pluginDir = CdpHelper.getDefaultNativePluginDir()
    } else {
        let parentDir = (baseDir as NSString).deletingLastPathComponent
        let baseName = (baseDir as NSString).lastPathComponent
        pluginDir = (parentDir as NSString).appendingPathComponent("\(baseName)-native-plugin")
    }

    let app = WatcherApp(baseDir: baseDir, pluginDir: pluginDir, isWatch: mode == "watch", noNativeDaemon: noNativeDaemon, noRelaunchPrompt: noRelaunchPrompt)

    if mode == "once" {
        return app.runOnce(overridePort: overridePort, outFile: outFile)
    }
    if mode == "remove" {
        return app.runRemove(overridePort: overridePort, outFile: outFile)
    }
    return app.runWatch(overridePort: overridePort)
}

exit(runWatcherMain())
