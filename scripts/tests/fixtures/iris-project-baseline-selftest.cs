using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class BaselineSelfTest {
    static int assertions;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static void Check(bool pass, string name) {if (!pass) throw new Exception(name); assertions++;}
    static void Reject(Action action, string name) {bool rejected = false; try {action();} catch (IOException) {rejected = true;} Check(rejected, name);}
    static Dictionary<string, object> Item(string name, string text, string outcome) {
        return new Dictionary<string, object> {{"document", name}, {"path", "src/" + name.Replace(".cls", "").Replace('.', '/') + ".cls"}, {"status", outcome}, {"sha256", text == null ? null : ProjectBaseline.Hash(Encoding.UTF8.GetBytes(text))}, {"bytes", text == null ? 0 : Encoding.UTF8.GetByteCount(text)}};
    }
    static void Stage(ProjectBaseline baseline, BaselineRun run, Dictionary<string, object>[] items) {
        foreach (var item in items) if (Convert.ToString(item["status"]) == "fetched") {
            string name = Convert.ToString(item["document"]); string content = Contents[name];
            ProjectBaseline.Atomic(ProjectBaseline.Within(baseline.RunDirectory(run.id), "export/" + item["path"]), Encoding.UTF8.GetBytes(content));
        }
    }
    static Dictionary<string,string> Contents = new Dictionary<string,string>();
    static Dictionary<string, object> Receipt(params Dictionary<string, object>[] items) {return new Dictionary<string, object> {{"items", items}, {"reason", null}};}
    static void Run(string directory) {
        string root = Path.Combine(directory, "project"), origin = ProjectBaseline.Origin("http://127.0.0.1:1/api/atelier/", "TEST");
        string oldHash, oldContentAt; DateTime oldFileTime;
        using (var baseline = new ProjectBaseline(root, "Demo project", origin)) {
            var run = baseline.NewRun("append");
            var items = new[] {Item("Demo.A.cls", "one", "fetched"), Item("Demo.B.cls", "two", "fetched"), Item("Demo.Missing.cls", null, "missing")};
            Check(baseline.Plan(run, items, "pasted").Count == 3, "initial-plan");
            Contents["Demo.A.cls"] = "one"; Contents["Demo.B.cls"] = "two"; Stage(baseline, run, items); baseline.Ingest(run, Receipt(items));
            Check(File.ReadAllText(Path.Combine(root, "src/Demo/A.cls")) == "one", "initial-data-in-one-current-tree");
            Check(baseline.Index.items.Count == 3 && baseline.Index.activeRun == null, "range-and-completion-persisted");
            oldHash = baseline.Find("Demo.A.cls").sha256; oldContentAt = baseline.Find("Demo.A.cls").contentAt; oldFileTime = File.GetLastWriteTimeUtc(Path.Combine(root, "src/Demo/A.cls"));
            var next = baseline.NewRun("append");
            var extra = new[] {Item("Demo.A.cls", "one", "pending"), Item("Demo.C.cls", "three", "fetched")};
            var queue = baseline.Plan(next, extra, "xml");
            Check(queue.Count == 1 && queue[0] == "Demo.C.cls", "append-skips-known-verified-files");
            Contents["Demo.C.cls"] = "three"; Stage(baseline, next, new[] {extra[1]}); baseline.Ingest(next, Receipt(extra[1]));
            Check(Directory.GetDirectories(root).Length == 2 && Directory.Exists(Path.Combine(root, ".export")), "no-user-facing-batch-roots");
            var check = baseline.NewRun("check"); var unchanged = new[] {Item("Demo.A.cls", "one", "fetched")};
            baseline.Plan(check, unchanged, "check"); Stage(baseline, check, unchanged); baseline.Ingest(check, Receipt(unchanged));
            Check(baseline.Find("Demo.A.cls").checkedAt != null && baseline.Find("Demo.A.cls").contentAt == oldContentAt && File.GetLastWriteTimeUtc(Path.Combine(root, "src/Demo/A.cls")) == oldFileTime, "unchanged-check-does-not-invent-content-update");
            var changes = baseline.NewRun("check");
            var updated = new[] {Item("Demo.A.cls", "updated", "fetched"), Item("Demo.B.cls", null, "missing")};
            baseline.Plan(changes, updated, "check"); Contents["Demo.A.cls"] = "updated"; Stage(baseline, changes, updated); baseline.Ingest(changes, Receipt(updated));
            Check(File.ReadAllText(Path.Combine(root, "src/Demo/A.cls")) == "one", "checks-stage-until-acceptance");
            Check(File.ReadAllText(Path.Combine(root, "src/Demo/B.cls")) == "two" && baseline.Find("Demo.B.cls").sha256 != null, "remote-404-does-not-delete-current-source");
            Check(baseline.AcceptChanges() == 1 && File.ReadAllText(Path.Combine(root, "src/Demo/A.cls")) == "updated", "accepts-only-safe-candidates");
            Check(File.ReadAllText(Path.Combine(root, ".export/versions/" + oldHash + "/Demo/A.cls")) == "one", "old-version-preserved");
            File.WriteAllText(Path.Combine(root, "src/Demo/A.cls"), "local edit");
            var conflict = baseline.NewRun("check"); baseline.Plan(conflict, unchanged, "check");
            Contents["Demo.A.cls"] = "one"; Stage(baseline, conflict, unchanged); baseline.Ingest(conflict, Receipt(unchanged));
            Check(baseline.Find("Demo.A.cls").outcome == "local-conflict" && baseline.AcceptChanges() == 0 && File.ReadAllText(Path.Combine(root, "src/Demo/A.cls")) == "local edit", "local-edit-protected");
            Reject(() => baseline.Freeze(Path.Combine(directory, "bad-handoff")), "handoff-rejects-local-drift");
            baseline.KeepCurrentCandidates();
            Check(baseline.Find("Demo.A.cls").outcome == "local-conflict", "keeping-local-does-not-hide-unresolved-edit");
            File.WriteAllText(Path.Combine(root, "src/Demo/A.cls"), "updated");
            var paused = baseline.NewRun("retry");
            var pending = new[] {Item("Demo.Missing.cls", null, "pending")}; baseline.Plan(paused, pending, "retry"); baseline.Ingest(paused, Receipt(pending)); paused.elapsedMs = 1234; baseline.Save();
            Check(baseline.Index.activeRun == paused.id && paused.state == "paused", "incomplete-run-keeps-one-persistent-resume-record");
        }
        using (var baseline = new ProjectBaseline(root, "Demo project", origin)) {
            var paused = baseline.FindRun(baseline.Index.activeRun);
            Check(paused != null && paused.elapsedMs == 1234 && baseline.Index.items.Count == 4, "restart-preserves-progress-and-range");
            baseline.EndRun(paused);
            string copy = Path.Combine(directory, "handoff"); baseline.Freeze(copy);
            Check(File.ReadAllText(Path.Combine(copy, "src/Demo/A.cls")) == "updated" && !Directory.Exists(Path.Combine(copy, ".export")), "handoff-is-one-independent-source-folder");
            Check(File.ReadAllText(Path.Combine(copy, "交付清单.json")).Contains("\"complete\":false"), "partial-handoff-does-not-claim-completeness");
            Reject(() => baseline.Freeze(Path.Combine(root, "nested")), "no-recursive-handoff");
            Reject(() => baseline.Freeze(copy), "no-overwrite-existing-handoff");
            Reject(()=>baseline.Freeze("relative-folder"),"no-relative-handoff-destination");
            Reject(()=>baseline.Freeze(Path.GetPathRoot(root)),"no-volume-root-handoff");
            var rejected = baseline.NewRun("append");
            Reject(() => baseline.Plan(rejected, new[] {Item("demo.a.cls", "x", "pending")}, "case"), "case-collision-rejected");
            baseline.EndRun(rejected);
            Reject(() => ProjectBaseline.Within(root, "../escape.txt"), "path-traversal-rejected");
            var interrupted = baseline.NewRun("check"); var next = new[] {Item("Demo.C.cls", "four", "fetched")};
            baseline.Plan(interrupted, next, "check"); Contents["Demo.C.cls"] = "four"; Stage(baseline, interrupted, next); baseline.Ingest(interrupted, Receipt(next));
            var entry = baseline.Find("Demo.C.cls");
            var transaction = new[] {new BaselinePublication {document = entry.document, path = entry.path, expected = entry.sha256, sha256 = entry.candidateSha256, candidate = ".export/runs/" + interrupted.id + "/export/src/" + entry.path, bytes = 4, contentAt = DateTime.UtcNow.ToString("o")}};
            // A persisted acceptance is recovered after the application closes before publishing.
            File.WriteAllText(Path.Combine(root, ".export/publication.json"), Json.Serialize(transaction), Encoding.UTF8);
        }
        using (var baseline = new ProjectBaseline(root, "Demo project", origin)) {
            Check(File.ReadAllText(Path.Combine(root, "src/Demo/C.cls")) == "four" && !File.Exists(Path.Combine(root, ".export/publication.json")), "interrupted-publication-recovers-idempotently");
            Check(baseline.Find("Demo.C.cls").sha256 == ProjectBaseline.Hash(Encoding.UTF8.GetBytes("four")), "recovered-index-matches-published-source");
        }
        string before = File.ReadAllText(Path.Combine(root, ".export/project.json"));
        Reject(() => {using (var wrong = new ProjectBaseline(root, "Other", "different-origin")) {}}, "source-identity-mismatch-rejected");
        Check(File.ReadAllText(Path.Combine(root, ".export/project.json")) == before, "wrong-source-does-not-mutate-baseline");
        using (var baseline = new ProjectBaseline(root, "Demo project", origin)) {
            var run = baseline.NewRun("check"); var item = Item("Demo.B.cls", "bad candidate", "fetched");
            baseline.Plan(run, new[] {item}, "tampered"); Contents["Demo.B.cls"] = "different bytes"; Stage(baseline, run, new[] {item});
            Reject(() => baseline.Ingest(run, Receipt(item)), "tampered-server-candidate-rejected");
            Check(File.ReadAllText(Path.Combine(root, "src/Demo/B.cls")) == "two", "bad-candidate-cannot-touch-current-source");
            baseline.EndRun(run);
        }
        using(var baseline=new ProjectBaseline(root,"Demo project",origin)){
            var run=baseline.NewRun("check");var items=new[]{Item("Demo.B.cls","six","fetched"),Item("Demo.C.cls","five","fetched")};
            baseline.Plan(run,items,"interrupted-publish");Contents["Demo.B.cls"]="six";Contents["Demo.C.cls"]="five";Stage(baseline,run,items);baseline.Ingest(run,Receipt(items));
            var transaction=new List<BaselinePublication>();
            foreach(var name in run.documents){var entry=baseline.Find(name);transaction.Add(new BaselinePublication{document=name,path=entry.path,expected=entry.sha256,sha256=entry.candidateSha256,candidate=".export/runs/"+run.id+"/export/src/"+entry.path,bytes=new FileInfo(ProjectBaseline.Within(baseline.RunDirectory(run.id),"export/src/"+entry.path)).Length,contentAt=DateTime.UtcNow.ToString("o")});}
            File.WriteAllText(Path.Combine(root,".export/publication.json"),Json.Serialize(transaction),Encoding.UTF8);
            var first=transaction[0];string file=ProjectBaseline.Within(root,"src/"+first.path);
            ProjectBaseline.Atomic(ProjectBaseline.Within(root,".export/versions/"+first.expected+"/"+first.path),File.ReadAllBytes(file));
            ProjectBaseline.Atomic(file,File.ReadAllBytes(ProjectBaseline.Within(root,first.candidate)));
            // Crash after one file was published, before the index and the remaining file.
        }
        using(var baseline=new ProjectBaseline(root,"Demo project",origin)){
            Check(File.ReadAllText(Path.Combine(root,"src/Demo/B.cls"))=="six"&&File.ReadAllText(Path.Combine(root,"src/Demo/C.cls"))=="five","partially-published-multi-file-acceptance-recovers");
            Check(baseline.Index.runs[baseline.Index.runs.Count-1].accepted==2,"recovery-counts-each-published-object-once");
        }
        using(var baseline=new ProjectBaseline(root,"Demo project",origin)){
            Check(baseline.Index.runs[baseline.Index.runs.Count-1].accepted==2,"reopening-a-completed-publication-is-idempotent");
        }
    }
    public static int Main(string[] args) {
        try {Run(args[0]); Console.WriteLine("passed " + assertions + " baseline assertions"); return 0;} catch (Exception ex) {Console.Error.WriteLine(ex); return 1;}
    }
}
