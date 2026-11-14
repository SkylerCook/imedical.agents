using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

public static class BaselineGuiFlowTest {
    const BindingFlags Flags=BindingFlags.Instance|BindingFlags.NonPublic;
    static object Field(ExporterForm form,string name){return typeof(ExporterForm).GetField(name,Flags).GetValue(form);}
    static void Call(ExporterForm form,string name,params object[] args){typeof(ExporterForm).GetMethod(name,Flags).Invoke(form,args);}
    static void Text(ExporterForm form,string name,string text){((Control)Field(form,name)).Text=text;}
    static void Check(bool pass,string name){if(!pass)throw new Exception(name);}
    static void Until(Func<bool> predicate,string phase){
        var timer=Stopwatch.StartNew();
        while(!predicate()){Application.DoEvents();System.Threading.Thread.Sleep(10);if(timer.ElapsedMilliseconds>20000)throw new Exception("timeout: "+phase);}
        Application.DoEvents();
    }
    [STAThread] public static int Main(string[] args){
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        Control.CheckForIllegalCrossThreadCalls=true;
        ExporterForm form=null;
        try{
            form=new ExporterForm(Path.Combine(args[0],"state"));form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new System.Drawing.Point(-20000,-20000);form.Show();
            Text(form,"url",args[1]);Text(form,"ns","TEST");Text(form,"user","test");Text(form,"password","synthetic-password");Text(form,"profiles","Demo project");Text(form,"destination",Path.Combine(args[0],"project"));
            Call(form,"SaveProfile");
            Text(form,"projectVersionInput","R9.0.1");
            Call(form,"StartWorker");Until(()=>((Label)Field(form,"status")).Text.Contains("就绪"),"worker-ready");
            Text(form,"documents","Demo.A.cls\r\nDemo.C.cls\r\nDemo.Missing.cls");Call(form,"BeginProjectSample","append",1);
            Until(()=>!(bool)Field(form,"busy"),"first-append");
            var project=(ProjectBaseline)Field(form,"project");
            Check(project.Index.runs.Count==1&&project.Index.activeRun==null&&project.Find("Demo.A.cls").sha256!=null,"first-item-and-rest-share-one-run");
            Check(project.Index.projectVersion=="R9.0.1","first-project-open-preserves-entered-project-version");
            Check(project.Index.runs[0].segments==1&&project.Index.runs[0].requestCount==1&&project.Index.runs[0].authenticationCount==1,"first-item-segments-preserve-cumulative-counters");
            Check(project.Find("Demo.C.cls")==null && project.Find("Demo.Missing.cls")==null,"sample-stops-before-remainder");
            Check(File.Exists(Path.Combine((string)Field(form,"batch"),"sample-full-scope.txt")),"sample-full-scope-persisted");
            Check(((Button)Field(form,"continueCurrent")).Enabled && ((Button)Field(form,"continueCurrent")).Text.Contains("继续剩余 2 项"),"sample-continuation-visible-after-completion");
            string original=File.ReadAllText(Path.Combine(project.Root,"src/Demo/A.cls"));
            ((Button)Field(form,"continueCurrent")).PerformClick();Until(()=>!(bool)Field(form,"busy"),"second-append");
            Check(project.Index.items.Count==3&&project.Index.runs.Count==2&&project.Index.runs[1].documents.Count==2,"incremental-plan-skips-existing-content");
            Call(form,"BeginProject","check");Until(()=>!(bool)Field(form,"busy"),"update-check");
            Check(project.Find("Demo.A.cls").outcome=="candidate-change"&&File.ReadAllText(Path.Combine(project.Root,"src/Demo/A.cls"))==original,"check-does-not-silently-accept");
            Check(project.Find("Demo.C.cls").outcome=="missing"&&File.Exists(Path.Combine(project.Root,"src/Demo/C.cls")),"known-file-survives-remote-404");
            ((Button)Field(form,"acceptUpdates")).PerformClick();
            Check(project.Find("Demo.A.cls").outcome=="fetched"&&File.ReadAllText(Path.Combine(project.Root,"src/Demo/A.cls"))!=original,"accept-button-publishes-candidate");
            Check(Directory.GetDirectories(project.Root).Length==2,"only-current-src-and-hidden-history");
            Text(form,"documents","invalid-object-without-extension");Call(form,"BeginProject","append");
            Until(()=>!(bool)Field(form,"busy"),"invalid-plan");
            Check(project.Index.activeRun==null,"failed-plan-does-not-block-retry");
            Check(!((Panel)Field(form,"diagnostics")).Visible,"failure-does-not-force-technical-log-open");
            ((ComboBox)Field(form,"speed")).SelectedIndex=1;
            var sampleNames=new System.Collections.Generic.List<string>();
            for(int i=0;i<11;i++)sampleNames.Add("Trial.Item"+i+".cls");
            Text(form,"documents",String.Join("\r\n",sampleNames));
            Call(form,"BeginProjectSample","append",10);Until(()=>!(bool)Field(form,"busy"),"multi-session-sample");
            Check(project.Find("Trial.Item9.cls")!=null && project.Find("Trial.Item10.cls")==null && project.Index.activeRun==null,"multi-session-sample-stops-at-ten");
            ((CheckBox)Field(form,"budget")).Checked=true;
            ((Button)Field(form,"continueCurrent")).PerformClick();Until(()=>!(bool)Field(form,"busy"),"multi-session-remainder");
            Check(project.Find("Trial.Item10.cls").sha256!=null,"multi-session-remainder-saved");
            ((ComboBox)Field(form,"speed")).SelectedIndex=0;
            Text(form,"documents","Auto.First.cls\r\nAuto.Second.cls\r\nAuto.Third.cls");Call(form,"BeginProject","append");Until(()=>!(bool)Field(form,"busy"),"default-full-append");
            var automatic=project.Index.runs[project.Index.runs.Count-1];
            Check(automatic.documents.Count==3&&automatic.segments==2&&project.Find("Auto.Third.cls").sha256!=null,"default-full-append-verifies-first-item-and-continues-without-user-stop");
            ((ComboBox)Field(form,"resultFilter")).SelectedIndex=1;
            var visible=(System.Collections.Generic.List<ListViewItem>)Field(form,"visibleRows");var results=(ListView)Field(form,"results");
            results.SelectedIndices.Clear();results.SelectedIndices.Add(visible.FindIndex(r=>r.Text=="Demo.Missing.cls"));
            Check(((Button)Field(form,"retryMissing")).Enabled&&((Button)Field(form,"retryMissing")).Text=="补取所选 1 项","retry-action-follows-selection");
            ((Button)Field(form,"retryMissing")).PerformClick();Until(()=>!(bool)Field(form,"busy"),"selected-retry");
            var selected=project.Index.runs[project.Index.runs.Count-1];Check(selected.mode=="retry"&&selected.documents.Count==1&&selected.documents[0]=="Demo.Missing.cls","selected-retry-does-not-expand-to-all-missing");
            ((ComboBox)Field(form,"speed")).SelectedIndex=1;
            Check(((CheckBox)Field(form,"budget")).Checked,"confirmed-concurrency-restored-for-same-target-and-tier");
            Text(form,"ns","OTHER");Check(!((CheckBox)Field(form,"budget")).Checked,"other-namespace-does-not-inherit-concurrency-approval");Text(form,"ns","TEST");
            Text(form,"user","another-account");Check(!((CheckBox)Field(form,"budget")).Checked,"other-account-does-not-inherit-concurrency-approval");Text(form,"user","test");
            ((ComboBox)Field(form,"speed")).SelectedIndex=2;Check(!((CheckBox)Field(form,"budget")).Checked,"larger-tier-needs-its-own-approval");((ComboBox)Field(form,"speed")).SelectedIndex=1;
            bool rejectedTier=false;try{Call(form,"ValidateBudget",10);}catch(TargetInvocationException ex){rejectedTier=ex.InnerException is InvalidOperationException;}Check(rejectedTier,"visible-four-session-approval-cannot-authorize-ten-session-resume");
            ((ComboBox)Field(form,"speed")).SelectedIndex=0;Text(form,"documents","");((ComboBox)Field(form,"version")).SelectedIndex=3;
            Call(form,"BeginProjectSample","append",1);Until(()=>!(bool)Field(form,"busy"),"version-sample");
            Check(project.Index.projectVersion=="R9.0.1"&&project.Index.catalogVersions.Contains("v8.5")&&project.Find("Version.First.cls")!=null&&project.Find("Version.Second.cls")==null,"actual-version-and-catalog-range-are-stored-independently");
            string snapshot=ProjectBaseline.VersionDirectory(Path.Combine(args[0],"shared"),project.Index.name,project.Index.projectVersion);
            Call(form,"SaveVersionProject",Path.Combine(args[0],"shared"),project.Index.name,project.Index.projectVersion,"Demo project full name","Delivery team","Demo product");Until(()=>!(bool)Field(form,"projectImporting"),"save-version-snapshot");string originalSnapshot=ProjectBaseline.FileHash(Path.Combine(snapshot,"交付清单.json"));
            Call(form,"BeginSharedImport",snapshot,Path.Combine(args[0],"colleague"));Until(()=>!(bool)Field(form,"projectImporting"),"offline-shared-import");project=(ProjectBaseline)Field(form,"project");
            Check(project!=null&&project.Index.origin==null&&project.Index.items.Count==19&&project.Find("Version.Second.cls")!=null,"offline-import-keeps-full-trial-remainder");
            Check(((TextBox)Field(form,"url")).Text==""&&((TextBox)Field(form,"user")).Text==""&&((ComboBox)Field(form,"version")).SelectedIndex==0,"import-does-not-inherit-donor-connection-or-stale-input-scope");
            Check(((System.Collections.Generic.List<ListViewItem>)Field(form,"resultRows")).Exists(r=>r.SubItems[1].Text.Contains("共享基线")),"imported-files-are-labelled-as-shared-source");
            string importedProfile=((ComboBox)Field(form,"profiles")).Text;
            Text(form,"url",args[1]);Text(form,"ns","COLLEAGUE");Text(form,"user","test");Text(form,"password","synthetic-password");Call(form,"SaveProfile");
            Text(form,"documents","Version.First.cls\r\nVersion.Colleague.cls");Call(form,"BeginProject","append");Until(()=>!(bool)Field(form,"busy"),"colleague-append");
            var appended=project.Index.runs[project.Index.runs.Count-1];Check(appended.documents.Count==1&&appended.documents[0]=="Version.Colleague.cls","colleague-reuses-baseline-without-recollecting-existing-files");
            Call(form,"BeginProject","check");Until(()=>!(bool)Field(form,"busy"),"colleague-update-check");
            Check(project.Find("Version.First.cls").outcome=="candidate-change"&&project.Find("Version.Second.cls").outcome=="candidate-new","colleague-can-check-both-reused-and-uncollected-scope");
            Check(ProjectBaseline.FileHash(Path.Combine(snapshot,"交付清单.json"))==originalSnapshot,"colleague-work-does-not-modify-shared-artifact");
            Call(form,"RequestClose");Until(()=>form.IsDisposed,"graceful-close");
            using(var reopened=new ExporterForm(Path.Combine(args[0],"state"))){
                Call(reopened,"Receive","{\"kind\":\"ready\",\"data\":{\"blocked\":false}}");
                Check(((Label)Field(reopened,"status")).Text.Contains("已处理 1 / 1"),"worker-ready-must-preserve-restored-progress");
                Check(((Label)Field(reopened,"elapsedLabel")).Text.Contains("本次用时"),"reopened-clock-is-preserved");
                Check(((ComboBox)Field(reopened,"speed")).SelectedIndex==0,"last-saved-single-session-choice-survives-restart");((ComboBox)Field(reopened,"speed")).SelectedIndex=1;
                Check(((CheckBox)Field(reopened,"budget")).Checked,"concurrency-approval-survives-restart-for-the-same-profile");
                ((ComboBox)Field(reopened,"profiles")).Text=importedProfile;
                Check(((ProjectBaseline)Field(reopened,"project")).Index.projectVersion=="R9.0.1"&&((TextBox)Field(reopened,"ns")).Text=="COLLEAGUE","imported-working-project-and-own-connection-survive-restart");
            }
            Console.WriteLine("gui-flow-passed");return 0;
        }catch(Exception ex){Console.Error.WriteLine(ex);return 1;}
        finally{
            if(form!=null&&!form.IsDisposed){
                var worker=Field(form,"worker") as Process;
                try{Call(form,"RequestClose");var timer=Stopwatch.StartNew();while(worker!=null&&!worker.HasExited&&timer.ElapsedMilliseconds<3000){Application.DoEvents();System.Threading.Thread.Sleep(10);}if(worker!=null&&!worker.HasExited)worker.Kill();}catch{}
                form.Dispose();
            }
        }
    }
}
