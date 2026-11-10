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
        ExporterForm form=null;
        try{
            form=new ExporterForm(Path.Combine(args[0],"state"));form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new System.Drawing.Point(-20000,-20000);form.Show();
            Text(form,"url",args[1]);Text(form,"ns","TEST");Text(form,"user","test");Text(form,"password","synthetic-password");Text(form,"profiles","Demo project");Text(form,"destination",Path.Combine(args[0],"project"));
            Call(form,"SaveProfile");
            Call(form,"StartWorker");Until(()=>((Label)Field(form,"status")).Text.Contains("就绪"),"worker-ready");
            Text(form,"documents","Demo.A.cls\r\nDemo.C.cls\r\nDemo.Missing.cls");Call(form,"BeginProjectSample","append",1);
            Until(()=>!(bool)Field(form,"busy"),"first-append");
            var project=(ProjectBaseline)Field(form,"project");
            Check(project.Index.runs.Count==1&&project.Index.activeRun==null&&project.Find("Demo.A.cls").sha256!=null,"first-item-and-rest-share-one-run");
            Check(project.Index.runs[0].segments==1&&project.Index.runs[0].requestCount==1&&project.Index.runs[0].authenticationCount==1,"first-item-segments-preserve-cumulative-counters");
            Check(project.Find("Demo.C.cls")==null && project.Find("Demo.Missing.cls")==null,"sample-stops-before-remainder");
            Check(File.Exists(Path.Combine((string)Field(form,"batch"),"sample-full-scope.txt")),"sample-full-scope-persisted");
            Check(((Button)Field(form,"remaining")).Visible,"sample-continuation-visible-after-completion");
            string original=File.ReadAllText(Path.Combine(project.Root,"src/Demo/A.cls"));
            ((Button)Field(form,"remaining")).PerformClick();Until(()=>!(bool)Field(form,"busy"),"second-append");
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
            ((Button)Field(form,"remaining")).PerformClick();Until(()=>!(bool)Field(form,"busy"),"multi-session-remainder");
            Check(project.Find("Trial.Item10.cls").sha256!=null,"multi-session-remainder-saved");
            Call(form,"RequestClose");Until(()=>form.IsDisposed,"graceful-close");
            using(var reopened=new ExporterForm(Path.Combine(args[0],"state"))){
                Call(reopened,"Receive","{\"kind\":\"ready\",\"data\":{\"blocked\":false}}");
                Check(((Label)Field(reopened,"status")).Text.Contains("已处理 1 / 1"),"worker-ready-must-preserve-restored-progress");
                Check(((Label)Field(reopened,"elapsedLabel")).Text.Contains("本次用时"),"reopened-clock-is-preserved");
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
