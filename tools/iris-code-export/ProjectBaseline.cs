using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// Local, persistent project state. Network requests and session ownership stay in the exporter.
public sealed class BaselineEntry {
    public string document, path, sha256, checkedAt, contentAt, outcome, candidateRun, candidateSha256, source;
    public long bytes;
}
public sealed class BaselineRun {
    public string id, mode, startedAt, endedAt, state, reason, source, acceptedAt;
    public long elapsedMs;
    public int fetched, missing, failed, changed, accepted;
    public int segments, requestCount, authenticationCount;
    public List<string> documents = new List<string>();
}
public sealed class BaselineIndex {
    public string schema = "iris-project-baseline/v1", name, origin, activeRun, lastFullCheck;
    public List<BaselineEntry> items = new List<BaselineEntry>();
    public List<BaselineRun> runs = new List<BaselineRun>();
}
public sealed class BaselinePublication {
    public string document, path, expected, sha256, candidate, contentAt;
    public long bytes;
}
public sealed class ProjectBaseline : IDisposable {
    readonly JavaScriptSerializer json = new JavaScriptSerializer {MaxJsonLength = 33554432};
    readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
    FileStream lease;
    public readonly string Root;
    public BaselineIndex Index {get; private set;}
    public string ControlRoot {get {return Path.Combine(Root, ".export");}}
    static string Now() {return DateTime.UtcNow.ToString("o");}
    public static string Hash(byte[] bytes) {using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();}
    public static string FileHash(string path) {using (var sha = SHA256.Create()) using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();}
    public static string Origin(string address, string ns) {
        var uri = new Uri(address.Trim());
        return Hash(Encoding.UTF8.GetBytes(uri.GetLeftPart(UriPartial.Authority).ToLowerInvariant() + uri.AbsolutePath.TrimEnd('/') + "|" + ns.Trim()));
    }
    public static void PlainPath(string path) {
        string current = Path.GetFullPath(path);
        while (!String.IsNullOrEmpty(current)) {
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("基线目录及其父目录不能是链接或目录联接。");
            current = Path.GetDirectoryName(current);
        }
    }
    public static string Within(string root, string relative) {
        if (String.IsNullOrEmpty(relative) || Path.IsPathRooted(relative) || relative.Contains("\\") || relative.Contains(":")) throw new IOException("对象保存路径无效。");
        foreach (var part in relative.Split('/')) if (part == "." || part == ".." || part.Length == 0 || part.EndsWith(".") || part.EndsWith(" ")) throw new IOException("对象保存路径无效。");
        string anchor = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        string file = Path.GetFullPath(Path.Combine(anchor, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!file.StartsWith(anchor + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("对象保存路径越界。");
        PlainPath(file); return file;
    }
    public ProjectBaseline(string root, string name, string origin) {
        Root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (Root == Path.GetPathRoot(Root).TrimEnd(Path.DirectorySeparatorChar)) throw new IOException("请选择专用项目目录，不能使用磁盘根目录。");
        PlainPath(Root);
        string indexFile = Path.Combine(ControlRoot, "project.json");
        bool exists = File.Exists(indexFile);
        if (!exists && Directory.Exists(Root) && Directory.GetFileSystemEntries(Root).Length > 0) throw new IOException("该目录已有其它文件。请选择新的空项目目录，或打开已有的项目基线目录；旧批次保持原样。");
        Directory.CreateDirectory(ControlRoot);
        try {
            lease = new FileStream(Path.Combine(ControlRoot, "project.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            Index = exists ? json.Deserialize<BaselineIndex>(File.ReadAllText(indexFile, utf8)) : new BaselineIndex {name = name, origin = origin};
            if (Index == null || Index.schema != "iris-project-baseline/v1" || Index.items == null || Index.runs == null) throw new IOException("项目索引格式不兼容。");
            if (Index.origin != origin) throw new IOException("该基线属于另一连接或 Namespace。请选择原连接，或为新来源选择独立目录。");
            ValidateIndex(); RecoverPublication(); Save();
        } catch {Dispose(); throw;}
    }
    void ValidateIndex() {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in Index.items) {
            if (String.IsNullOrWhiteSpace(entry.document) || !names.Add(entry.document) || !paths.Add(entry.path)) throw new IOException("项目索引存在重复对象或路径。");
            Within(Root, "src/" + entry.path);
        }
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var run in Index.runs) if (String.IsNullOrEmpty(run.id) || run.id.Length > 100 || !System.Text.RegularExpressions.Regex.IsMatch(run.id, @"^[a-zA-Z0-9-]+$") || !ids.Add(run.id) || run.documents == null) throw new IOException("项目采集记录无效。");
        if (!String.IsNullOrEmpty(Index.activeRun) && FindRun(Index.activeRun) == null) throw new IOException("未完成任务的索引丢失，请保留目录并检查诊断。");
    }
    public void Save() {
        Atomic(Path.Combine(ControlRoot, "project.json"), utf8.GetBytes(json.Serialize(Index)));
        WriteSummary();
    }
    public static void Atomic(string file, byte[] bytes) {
        PlainPath(file); Directory.CreateDirectory(Path.GetDirectoryName(file));
        string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {stream.Write(bytes, 0, bytes.Length); stream.Flush(true);}
            if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
        } finally {if (File.Exists(temp)) File.Delete(temp);}
    }
    void WriteSummary() {
        int files = 0; var missing = new List<string>();
        foreach (var e in Index.items) {if (!String.IsNullOrEmpty(e.sha256)) files++; if (String.IsNullOrEmpty(e.sha256) || e.outcome != "fetched") missing.Add(e.document);}
        Atomic(Path.Combine(Root, "基线说明.txt"), utf8.GetBytes("项目：" + Index.name + "\r\n当前文件：" + files + "；登记范围：" + Index.items.Count + "\r\n最近全范围检查：" + Index.lastFullCheck + "\r\n源码目录：src\r\n增补和重试保存到本目录。历史采集与候选结果由 .export 管理。\r\n未取得或需要处理的对象见 未取得对象.txt；已有文件不因远端 404 删除。\r\n"));
        Atomic(Path.Combine(Root, "未取得对象.txt"), utf8.GetBytes(String.Join("\r\n", missing) + (missing.Count > 0 ? "\r\n" : "")));
    }
    public BaselineEntry Find(string name) {foreach (var entry in Index.items) if (entry.document == name) return entry; return null;}
    static string SourcePath(Dictionary<string, object> node) {
        string path = Convert.ToString(node["path"]);
        if (!path.StartsWith("src/", StringComparison.Ordinal)) throw new IOException("采集回执的源码路径无效。");
        return path.Substring(4);
    }
    public BaselineRun FindRun(string id) {foreach (var run in Index.runs) if (run.id == id) return run; return null;}
    public string RunDirectory(string id) {
        if (FindRun(id) == null) throw new IOException("采集记录不存在。");
        return Within(ControlRoot, "runs/" + id);
    }
    public BaselineRun NewRun(string mode) {
        if (mode != "append" && mode != "check" && mode != "retry") throw new IOException("未知的基线操作。");
        if (!String.IsNullOrEmpty(Index.activeRun)) throw new IOException("当前有未完成任务，请先继续或结束该次采集。");
        foreach (var e in Index.items) if (!String.IsNullOrEmpty(e.candidateRun)) throw new IOException("请先查看并处理上次检查发现的候选变化，再发起新采集。");
        var run = new BaselineRun {id = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8), mode = mode, startedAt = Now(), state = "planning"};
        Index.runs.Add(run); Index.activeRun = run.id; Directory.CreateDirectory(RunDirectory(run.id)); Save(); return run;
    }
    public List<string> Plan(BaselineRun run, IEnumerable planItems, string source) {
        var queue = new List<string>(); var plan = new List<BaselineEntry>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var paths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var old in Index.items) {names.Add(old.document); paths.Add(old.path, old.document);}
        foreach (Dictionary<string, object> node in planItems) {
            string document = Convert.ToString(node["document"]), path = SourcePath(node);
            Within(Root, "src/" + path); var old = Find(document);
            if (old == null && names.Contains(document)) throw new IOException("对象名仅大小写不同，请核实：" + document);
            string owner; if (paths.TryGetValue(path, out owner) && owner != document) throw new IOException("对象保存路径冲突：" + document);
            if (old != null && old.path != path) throw new IOException("对象保存路径已变化，请保留原基线另行核查：" + document);
            if (old == null) {old = new BaselineEntry {document = document, path = path, outcome = "pending", source = source}; plan.Add(old); names.Add(document); paths[path] = document;}
            // A local deletion/edit is a conflict, including when the server still has the original bytes.
            if (!String.IsNullOrEmpty(old.sha256)) {
                string local = Within(Root, "src/" + old.path);
                if (!File.Exists(local) || FileHash(local) != old.sha256) {
                    if (run.mode != "check") throw new IOException("检测到本地文件变动，已停止增补。请检查更新后分别处理：" + document);
                } else if (run.mode != "check") continue;
            }
            if (!queue.Contains(document)) queue.Add(document);
        }
        Index.items.AddRange(plan); run.documents = queue; run.source=source;run.state = queue.Count == 0 ? "complete" : "ready";
        if (queue.Count == 0) {run.endedAt = Now(); Index.activeRun = null;} Save(); return queue;
    }
    public void Ingest(BaselineRun run, Dictionary<string, object> receipt) {
        var publications = new List<BaselinePublication>(); bool pending = false;
        var nodes=new List<Dictionary<string,object>>();var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(Dictionary<string,object> node in (IEnumerable)receipt["items"]){
            string name=Convert.ToString(node["document"]);var entry=Find(name);
            if(entry==null||!run.documents.Contains(name)||!seen.Add(name)||entry.path!=SourcePath(node))throw new IOException("采集回执与项目范围不一致。");
            string outcome=Convert.ToString(node["status"]);
            if(outcome!="fetched"&&outcome!="missing"&&outcome!="failed"&&outcome!="empty"&&outcome!="pending"&&outcome!="writing")throw new IOException("采集回执包含未知状态。");
            if(outcome=="fetched"){
                string candidate=Within(RunDirectory(run.id),"export/src/"+entry.path),hash=Convert.ToString(node["sha256"]).ToLowerInvariant();
                if(hash.Length!=64||!File.Exists(candidate)||FileHash(candidate)!=hash)throw new IOException("候选源码摘要核验失败："+name);
            }
            nodes.Add(node);
        }
        if(seen.Count!=run.documents.Count)throw new IOException("采集回执未覆盖完整的本次范围。");
        run.fetched=run.missing=run.failed=run.changed=0;
        foreach (Dictionary<string, object> node in nodes) {
            string name = Convert.ToString(node["document"]); var entry = Find(name);
            if (entry == null || !run.documents.Contains(name) || entry.path != SourcePath(node)) throw new IOException("采集回执与项目范围不一致。");
            string outcome = Convert.ToString(node["status"]); entry.outcome = outcome;
            if (outcome == "pending" || outcome == "writing") {pending = true; continue;}
            DateTime observed;entry.checkedAt=node.ContainsKey("observedAt")&&DateTime.TryParse(Convert.ToString(node["observedAt"]),out observed)?observed.ToUniversalTime().ToString("o"):Now();
            if(outcome=="fetched")run.fetched++;else if(outcome=="missing")run.missing++;else run.failed++;
            if (outcome != "fetched") continue;
            string stage = Within(RunDirectory(run.id), "export/src/" + entry.path), hash = Convert.ToString(node["sha256"]).ToLowerInvariant();
            if (hash.Length != 64 || !File.Exists(stage) || FileHash(stage) != hash) throw new IOException("候选源码摘要核验失败：" + name);
            string target = Within(Root, "src/" + entry.path), current = File.Exists(target) ? FileHash(target) : null;
            if(hash!=entry.sha256)run.changed++;
            if (!String.IsNullOrEmpty(entry.sha256) && current != entry.sha256 || String.IsNullOrEmpty(entry.sha256) && current != null) {
                entry.outcome = "local-conflict"; entry.candidateRun = run.id; entry.candidateSha256 = hash; continue;
            }
            if (hash == entry.sha256) {entry.candidateRun = entry.candidateSha256 = null; continue;}
            entry.candidateRun = run.id; entry.candidateSha256 = hash; entry.outcome = String.IsNullOrEmpty(entry.sha256) ? "candidate-new" : "candidate-change";
            if (run.mode != "check" && String.IsNullOrEmpty(entry.sha256)) publications.Add(Publication(entry));
        }
        run.reason = receipt.ContainsKey("reason") ? Convert.ToString(receipt["reason"]) : null;
        run.state = pending ? "paused" : "complete"; if (!pending) {run.endedAt = Now(); Index.activeRun = null;}
        if (!pending && run.mode == "check" && run.documents.Count == Index.items.Count) Index.lastFullCheck = Now();
        Save(); if (publications.Count > 0) Publish(publications);
    }
    BaselinePublication Publication(BaselineEntry entry) {
        string candidate = ".export/runs/" + entry.candidateRun + "/export/src/" + entry.path;
        return new BaselinePublication {document = entry.document, path = entry.path, expected = entry.sha256, sha256 = entry.candidateSha256, candidate = candidate, bytes = new FileInfo(Within(Root, candidate)).Length, contentAt = Now()};
    }
    public int AcceptChanges() {
        var changes = new List<BaselinePublication>();
        foreach (var entry in Index.items) if (!String.IsNullOrEmpty(entry.candidateRun) && entry.outcome != "local-conflict") changes.Add(Publication(entry));
        if (changes.Count > 0) Publish(changes); return changes.Count;
    }
    void Publish(List<BaselinePublication> changes) {
        // Validate the entire acceptance before making its persisted intent recoverable.
        foreach (var change in changes) CheckPublication(change, false);
        string transaction = Path.Combine(ControlRoot, "publication.json");
        if (File.Exists(transaction)) throw new IOException("上次基线更新尚未完成，请重新打开项目恢复。");
        Atomic(transaction, utf8.GetBytes(json.Serialize(changes))); RecoverPublication();
    }
    void CheckPublication(BaselinePublication change, bool recovering) {
        var entry = Find(change.document);
        if (entry == null || entry.path != change.path || change.sha256 == null || change.sha256.Length != 64) throw new IOException("基线更新记录无效。");
        string source = Within(Root, change.candidate), target = Within(Root, "src/" + change.path);
        var parts=change.candidate.Split('/');
        if (parts.Length<6||parts[0]!=".export"||parts[1]!="runs"||FindRun(parts[2])==null||change.candidate!=".export/runs/"+parts[2]+"/export/src/"+change.path||!File.Exists(source)||FileHash(source)!=change.sha256) throw new IOException("基线候选内容已变化，请保留目录并核查。");
        string hash = File.Exists(target) ? FileHash(target) : null;
        if (hash != change.expected && !(recovering && hash == change.sha256)) throw new IOException("当前源码有本地变动，未覆盖：" + change.document);
    }
    void RecoverPublication() {
        string transaction = Path.Combine(ControlRoot, "publication.json"); if (!File.Exists(transaction)) return;
        var changes = json.Deserialize<List<BaselinePublication>>(File.ReadAllText(transaction, utf8));
        if (changes == null || changes.Count == 0) throw new IOException("基线更新恢复记录无效。");
        foreach (var change in changes) CheckPublication(change, true);
        foreach (var change in changes) {
            var entry = Find(change.document); string target = Within(Root, "src/" + change.path);
            if (!File.Exists(target) || FileHash(target) != change.sha256) {
                CheckPublication(change, true);
                if (File.Exists(target)) {
                    string old = Within(ControlRoot, "versions/" + change.expected + "/" + change.path);
                    if (File.Exists(old) && FileHash(old) != change.expected) throw new IOException("历史源码摘要不符。");
                    if (!File.Exists(old)) Atomic(old, File.ReadAllBytes(target));
                }
                Atomic(target, File.ReadAllBytes(Within(Root, change.candidate)));
                if (FileHash(target) != change.sha256) throw new IOException("当前源码保存核验失败。");
            }
            if(entry.sha256!=change.sha256){var run=FindRun(change.candidate.Split('/')[2]);run.accepted++;run.acceptedAt=Now();}
            entry.sha256 = change.sha256; entry.bytes = change.bytes; entry.contentAt = change.contentAt;
            entry.candidateRun = entry.candidateSha256 = null; entry.outcome = "fetched";
        }
        Save(); File.Delete(transaction);
    }
    public void KeepCurrentCandidates() {
        foreach (var entry in Index.items) if (!String.IsNullOrEmpty(entry.candidateRun)) {
            bool conflict=entry.outcome=="local-conflict";
            entry.candidateRun = entry.candidateSha256 = null;
            entry.outcome = conflict?"local-conflict":!String.IsNullOrEmpty(entry.sha256) ? "kept-local" : "not-accepted";
        }
        Save(); // Candidate files and run receipts remain in history.
    }
    public void EndRun(BaselineRun run) {run.state = "ended"; run.endedAt = Now(); if (Index.activeRun == run.id) Index.activeRun = null; Save();}
    public void Freeze(string destination) {
        if(!Path.IsPathRooted(destination))throw new IOException("交付副本请选择完整的本地目录。");
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
        if(root==Path.GetPathRoot(root).TrimEnd(Path.DirectorySeparatorChar))throw new IOException("交付副本不能使用磁盘根目录。");
        PlainPath(root);
        if (root.Equals(Root, StringComparison.OrdinalIgnoreCase) || root.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Root.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Directory.Exists(root) && Directory.GetFileSystemEntries(root).Length > 0) throw new IOException("交付副本请选择当前基线目录之外的空目录。");
        var manifest = new List<Dictionary<string, object>>();
        foreach (var entry in Index.items) if (!String.IsNullOrEmpty(entry.sha256)) {
            string source = Within(Root, "src/" + entry.path);
            if (!File.Exists(source) || FileHash(source) != entry.sha256) throw new IOException("本地文件已变化，交付前请处理：" + entry.document);
            manifest.Add(new Dictionary<string, object> {{"document", entry.document}, {"path", "src/" + entry.path}, {"sha256", entry.sha256}, {"bytes", entry.bytes}});
        }
        Directory.CreateDirectory(root);
        Atomic(Path.Combine(root, "交付状态.txt"), utf8.GetBytes("正在生成，尚未核验完成。\r\n"));
        foreach (var entry in manifest) {
            string relative = Convert.ToString(entry["path"]); byte[] bytes = File.ReadAllBytes(Within(Root, relative));
            if (Hash(bytes) != Convert.ToString(entry["sha256"])) throw new IOException("交付过程中源码变化，请勿使用未完成副本。");
            string target = Within(root, relative); Atomic(target, bytes);
            if (FileHash(target) != Convert.ToString(entry["sha256"])) throw new IOException("交付副本核验失败。");
        }
        bool complete=manifest.Count==Index.items.Count&&String.IsNullOrEmpty(Index.activeRun);
        foreach(var entry in Index.items)if(entry.outcome!="fetched"||!String.IsNullOrEmpty(entry.candidateRun))complete=false;
        Atomic(Path.Combine(root, "交付清单.json"), utf8.GetBytes(json.Serialize(new {schema = "iris-baseline-handoff/v1", createdAt = Now(), project = Index.name, complete = complete, files = manifest})));
        Atomic(Path.Combine(root, "基线说明.txt"), File.ReadAllBytes(Path.Combine(Root, "基线说明.txt")));
        Atomic(Path.Combine(root, "未取得对象.txt"), File.ReadAllBytes(Path.Combine(Root, "未取得对象.txt")));
        Atomic(Path.Combine(root, "交付状态.txt"), utf8.GetBytes("已完成逐文件摘要核验。\r\n" + (complete ? "登记范围全部已有源码。\r\n" : "仍有未取得或待处理项，详见 未取得对象.txt 与采集记录。\r\n") + "此副本不会随项目基线后续增补而改变。\r\n"));
    }
    public void Dispose() {if (lease != null) {lease.Dispose(); lease = null;}}
}
