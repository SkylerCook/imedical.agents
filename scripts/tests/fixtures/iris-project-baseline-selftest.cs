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
    static void ScopedProtection(string directory) {
        using (var baseline = new ProjectBaseline(Path.Combine(directory,"scoped"), "Scoped", "synthetic-origin")) {
            var initial=baseline.NewRun("append"); var items=new[]{Item("Demo.A.cls","original","fetched"),Item("Demo.B.cls","original","fetched")};
            baseline.Plan(initial,items,"initial");Contents["Demo.A.cls"]=Contents["Demo.B.cls"]="original";Stage(baseline,initial,items);baseline.Ingest(initial,Receipt(items));
            var check=baseline.NewRun("check");var changed=Item("Demo.A.cls","candidate","fetched");baseline.Plan(check,new[]{changed},"check");Contents["Demo.A.cls"]="candidate";Stage(baseline,check,new[]{changed});baseline.Ingest(check,Receipt(changed));
            var append=baseline.NewRun("append");var extra=Item("Demo.C.cls","unrelated","fetched");var queue=baseline.Plan(append,new[]{changed,extra},"append");
            Check(queue.Count==1&&queue[0]=="Demo.C.cls"&&append.protectedCount==1,"candidate-protects-only-its-own-object");
            Contents["Demo.C.cls"]="unrelated";Stage(baseline,append,new[]{extra});baseline.Ingest(append,Receipt(extra));
            Check(baseline.Find("Demo.A.cls").candidateRun==check.id&&File.ReadAllText(Path.Combine(baseline.Root,"src/Demo/A.cls"))=="original","unrelated-append-preserves-original-candidate-and-current-source");
            Check(baseline.AcceptChanges()==1&&check.accepted==1&&append.accepted==1,"candidates-from-different-runs-keep-their-own-accounting");
            File.WriteAllText(Path.Combine(baseline.Root,"src/Demo/B.cls"),"local edit");
            var local=baseline.NewRun("append");var next=Item("Demo.D.cls","new","fetched");queue=baseline.Plan(local,new[]{items[1],next},"local");
            Check(queue.Count==1&&queue[0]=="Demo.D.cls"&&local.protectedCount==1&&baseline.Find("Demo.B.cls").outcome=="local-conflict","local-edit-does-not-block-unrelated-object");
            Contents["Demo.D.cls"]="new";Stage(baseline,local,new[]{next});baseline.Ingest(local,Receipt(next));
            Check(File.ReadAllText(Path.Combine(baseline.Root,"src/Demo/B.cls"))=="local edit","scoped-protection-does-not-overwrite-local-edit");
            var retry=baseline.NewRun("retry");Check(baseline.Plan(retry,new[]{changed},"explicit-retry").Count==1,"explicit-retry-rereads-known-source-instead-of-skipping-it");baseline.EndRun(retry);
            var allProtected=baseline.NewRun("append");Check(baseline.Plan(allProtected,new[]{items[1]},"all-protected").Count==0&&allProtected.protectedCount==1&&baseline.Index.activeRun==null,"all-protected-range-completes-without-request-or-lingering-task");
        }
    }
    static void SharedVersions(string directory) {
        string source=Path.Combine(directory,"shared-origin"),library=Path.Combine(directory,"library"),snapshot=ProjectBaseline.VersionDirectory(library,"Demo project","R9.0.1");
        string origin=ProjectBaseline.Origin("http://127.0.0.1:1/api/atelier/","TEST");
        using(var baseline=new ProjectBaseline(source,"Demo project",origin)) {
            baseline.Index.fullName="Demo project full name";baseline.Index.owner="Delivery team";baseline.Index.product="Demo product";baseline.Index.projectVersion="R9.0.1";baseline.Index.catalogVersions.Add("v8.5");
            var items=new[]{Item("Demo.Shared.cls","class source","fetched"),
                new Dictionary<string,object>{{"document","app/shared.js"},{"path","src/app/shared.js"},{"sha256",ProjectBaseline.Hash(Encoding.UTF8.GetBytes("web source"))},{"status","fetched"},{"bytes",10}},
                new Dictionary<string,object>{{"document","Demo.Shared.mac"},{"path","src/routines/Demo.Shared.mac"},{"sha256",ProjectBaseline.Hash(Encoding.UTF8.GetBytes("routine source"))},{"status","fetched"},{"bytes",14}},
                new Dictionary<string,object>{{"document","Demo.Absent.inc"},{"path","src/routines/Demo.Absent.inc"},{"sha256",null},{"status","missing"},{"bytes",0}}};
            Contents["Demo.Shared.cls"]="class source";Contents["app/shared.js"]="web source";Contents["Demo.Shared.mac"]="routine source";
            var run=baseline.NewRun("append");baseline.Plan(run,items,"synthetic");Stage(baseline,run,items);baseline.Ingest(run,Receipt(items));baseline.Freeze(snapshot);
            string manifest=File.ReadAllText(Path.Combine(snapshot,"交付清单.json"));
            Check(manifest.Contains("\"projectVersion\":\"R9.0.1\"")&&manifest.Contains("\"catalogVersions\":[\"v8.5\"]"),"project-version-is-distinct-from-catalog-version");
            Check(manifest.Contains("Demo project full name")&&manifest.Contains("Delivery team")&&manifest.Contains("Demo product"),"short-name-keeps-optional-full-metadata");
            Check(!manifest.Contains("127.0.0.1")&&!manifest.Contains("TEST")&&!Directory.Exists(Path.Combine(snapshot,".export")),"shared-snapshot-excludes-private-connection-and-runtime-state");
            Check(manifest.Contains("\"complete\":false"),"incomplete-version-snapshot-does-not-claim-complete");
            string before=ProjectBaseline.FileHash(Path.Combine(snapshot,"src/Demo/Shared.cls"));Reject(()=>baseline.Freeze(snapshot),"same-project-version-never-overwrites-existing-snapshot");Check(ProjectBaseline.FileHash(Path.Combine(snapshot,"src/Demo/Shared.cls"))==before,"existing-version-bytes-survive-save-rejection");
            Reject(()=>ProjectBaseline.VersionDirectory(library,"../escape","R1"),"invalid-project-name-cannot-escape-library");Reject(()=>ProjectBaseline.VersionDirectory(library,"Demo","CON"),"reserved-version-name-rejected");
        }
        string target=Path.Combine(directory,"colleague");
        Reject(()=>{using(var bad=ProjectBaseline.ImportShared(snapshot,"relative-target")){}},"shared-import-rejects-relative-target");
        Reject(()=>{using(var stopped=ProjectBaseline.ImportShared(snapshot,target,(count,total)=>{if(count==1)throw new IOException("synthetic interruption");})){}},"interrupted-import-persists-recovery-state");
        string staged;DateTime stagedTime;
        using(var paused=new ProjectBaseline(target,"ignored",null)) {var run=paused.FindRun(paused.Index.activeRun);Check(run!=null&&run.mode=="import"&&run.manifestHash!=null,"import-recovery-is-independent-of-gui-session");staged=Path.Combine(paused.RunDirectory(run.id),"export/src/Demo/Shared.cls");stagedTime=File.GetLastWriteTimeUtc(staged);}
        using(var imported=ProjectBaseline.ImportShared(snapshot,target)) {
            Check(File.GetLastWriteTimeUtc(staged)==stagedTime,"import-resume-reuses-verified-staged-file");
            Check(imported.Index.name=="Demo project"&&imported.Index.projectVersion=="R9.0.1"&&imported.Index.catalogVersions[0]=="v8.5"&&imported.Index.owner=="Delivery team","import-preserves-project-version-scope-and-optional-details");
            Check(imported.Index.items.Count==4&&imported.Find("Demo.Absent.inc").sha256==null&&imported.Index.activeRun==null,"import-keeps-missing-scope-and-finishes-without-network");
            Check(String.IsNullOrEmpty(imported.Index.origin)&&String.IsNullOrEmpty(imported.Find("Demo.Shared.cls").checkedAt)&&imported.Find("Demo.Shared.cls").source.StartsWith("shared:"),"shared-source-is-not-a-current-server-read");
            Check(File.ReadAllText(Path.Combine(target,"src/app/shared.js"))=="web source"&&File.ReadAllText(Path.Combine(target,"src/routines/Demo.Shared.mac"))=="routine source","import-preserves-web-and-routine-paths");
            imported.BindOrigin(ProjectBaseline.Origin("http://127.0.0.1:2/api/atelier/","OTHER"));imported.Save();
            var append=imported.NewRun("append");var extra=Item("Demo.Colleague.cls","extra","fetched");var queue=imported.Plan(append,new[]{Item("Demo.Shared.cls","class source","pending"),extra},"colleague");Check(queue.Count==1&&queue[0]=="Demo.Colleague.cls","reused-baseline-skips-known-files-while-appending-new-scope");Contents["Demo.Colleague.cls"]="extra";Stage(imported,append,new[]{extra});imported.Ingest(append,Receipt(extra));
            var check=imported.NewRun("check");var changed=Item("Demo.Shared.cls","server change","fetched");imported.Plan(check,new[]{changed},"new server");Contents["Demo.Shared.cls"]="server change";Stage(imported,check,new[]{changed});imported.Ingest(check,Receipt(changed));
            Check(imported.Find("Demo.Shared.cls").candidateRun==check.id&&File.ReadAllText(Path.Combine(target,"src/Demo/Shared.cls"))=="class source","colleague-server-check-stages-changes-without-overwriting-imported-source");
            Check(File.ReadAllText(Path.Combine(snapshot,"src/Demo/Shared.cls"))=="class source","colleague-work-never-mutates-shared-original");
        }
        string indexBefore=File.ReadAllText(Path.Combine(target,".export/project.json"));Reject(()=>{using(var overwrite=ProjectBaseline.ImportShared(snapshot,target)){}},"import-cannot-overwrite-existing-workspace");Check(File.ReadAllText(Path.Combine(target,".export/project.json"))==indexBefore,"rejected-import-does-not-rewrite-existing-index");
        string manifestFile=Path.Combine(snapshot,"交付清单.json"),original=File.ReadAllText(manifestFile),sourceFile=Path.Combine(snapshot,"src/app/shared.js");File.WriteAllText(sourceFile,"tampered");string rejected=Path.Combine(directory,"bad-import");Reject(()=>{using(var bad=ProjectBaseline.ImportShared(snapshot,rejected)){}},"tampered-shared-file-is-rejected-before-import");Check(!Directory.Exists(rejected),"invalid-package-creates-no-target-state");File.WriteAllText(sourceFile,"web source");
        var malicious=Json.Deserialize<Dictionary<string,object>>(original);var nodes=(IList)malicious["items"];((Dictionary<string,object>)nodes[0])["path"]="src/../outside.cls";File.WriteAllText(manifestFile,Json.Serialize(malicious));Reject(()=>{using(var bad=ProjectBaseline.ImportShared(snapshot,rejected)){}},"shared-path-traversal-is-rejected");File.WriteAllText(manifestFile,original);
        var legacy=Json.Deserialize<Dictionary<string,object>>(original);legacy["schema"]="iris-baseline-handoff/v1";legacy.Remove("items");legacy.Remove("projectVersion");legacy.Remove("catalogVersions");File.WriteAllText(manifestFile,Json.Serialize(legacy));
        using(var old=ProjectBaseline.ImportShared(snapshot,Path.Combine(directory,"legacy-import"))) {Check(old.Index.items.Count==4&&old.Find("Demo.Absent.inc").path=="routines/Demo.Absent.inc","legacy-handoff-import-retains-original-missing-scope");Check(String.IsNullOrEmpty(old.Index.projectVersion),"legacy-import-does-not-invent-project-version");}
        File.WriteAllText(manifestFile,original);
        string emptyTarget=Path.Combine(directory,"empty-configured");using(var configured=new ProjectBaseline(emptyTarget,"Local project",null)){}
        File.WriteAllText(Path.Combine(emptyTarget,"project-notes.txt"),"user notes");using(var imported=ProjectBaseline.ImportShared(snapshot,emptyTarget)){Check(imported.Index.items.Count==4&&File.ReadAllText(Path.Combine(emptyTarget,"project-notes.txt"))=="user notes","configured-empty-project-can-import-without-discarding-local-notes");}
        string untracked=Path.Combine(directory,"untracked-source");using(var configured=new ProjectBaseline(untracked,"Local project",null)){}Directory.CreateDirectory(Path.Combine(untracked,"src"));File.WriteAllText(Path.Combine(untracked,"src/user-file.txt"),"user source");
        Reject(()=>{using(var bad=ProjectBaseline.ImportShared(snapshot,untracked)){}},"untracked-source-is-not-an-empty-import-target");Check(File.ReadAllText(Path.Combine(untracked,"src/user-file.txt"))=="user source","rejected-import-keeps-untracked-source");
    }
    public static int Main(string[] args) {
        try {Run(args[0]);ScopedProtection(args[0]);SharedVersions(args[0]); Console.WriteLine("passed " + assertions + " baseline assertions"); return 0;} catch (Exception ex) {Console.Error.WriteLine(ex); return 1;}
    }
}
