using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace AiDevOffline {
    static class SleepCode {
        static void Main(string[] args) {
            if(args.Length>0 && args[0]=="--child"){Thread.Sleep(60000);return;}
            Console.In.ReadToEnd();
            string root=Environment.GetEnvironmentVariable("AI_DEV_TEST_ROOT");
            var child=Process.Start(new ProcessStartInfo {FileName=Assembly.GetExecutingAssembly().Location,Arguments="--child",UseShellExecute=false,CreateNoWindow=true});
            File.WriteAllText(Path.Combine(root,"child.pid"),child.Id.ToString());
            File.WriteAllText(Path.Combine(root,"node.pid"),Process.GetCurrentProcess().Id.ToString());
            Thread.Sleep(60000);
        }
    }
    static class SixSelfTest {
        static readonly BindingFlags Hidden=BindingFlags.Instance|BindingFlags.NonPublic;
        static int checks;
        static T Field<T>(object instance,string name) {return (T)instance.GetType().GetField(name,Hidden).GetValue(instance);}
        static void Check(bool value,string message) {if(!value)throw new Exception(message);checks++;}
        static bool Exited(int pid) {try {using(Process process=Process.GetProcessById(pid))return process.HasExited;}catch(ArgumentException){return true;}}
        [STAThread] static int Main(string[] args) {
            string root=Path.GetFullPath(args[0]);Environment.SetEnvironmentVariable("AI_DEV_TEST_ROOT",root);
            Environment.SetEnvironmentVariable("LOCALAPPDATA",Path.Combine(root,"local"));
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            try {
                var components=new JavaScriptSerializer().Deserialize<PackageManifest>(File.ReadAllText(Path.Combine(root,"manifest.json"))).components;
                string code=Path.Combine(root,"fake","Code.exe");
                var selected=new Dictionary<string,string>{{"vscode",code}};
                using(var project=new ProjectConfigurationForm(root,components,selected,delegate(object request,Action<bool,string> complete){
                    complete(true,"{\"state\":\"inspected\",\"hasMcp\":true,\"hasCredentials\":true}");
                })) {
                    var mcp=Field<CheckBox>(project,"mcp");var credentials=Field<CheckBox>(project,"credentials");
                    Check(!mcp.Checked && !credentials.Checked,"fresh project should begin with VS Code only");
                    mcp.Checked=true;
                    Check(credentials.Checked && Field<TextBox>(project,"username").Enabled && Field<TextBox>(project,"password").Enabled,"first MCP selection did not reveal credentials");
                    Check(!credentials.Enabled,"missing credentials should not be silently omitted");
                    project.GetType().GetMethod("LoadExisting",Hidden).Invoke(project,new object[]{null,EventArgs.Empty});
                    Check(mcp.Checked && !credentials.Checked && credentials.Enabled,"existing credentials were not reused");
                    string portable=Path.Combine(root,"portable");Directory.CreateDirectory(Path.Combine(portable,"data"));File.Copy(code,Path.Combine(portable,"Code.exe"));
                    Field<TextBox>(project,"codeExe").Text=Path.Combine(portable,"Code.exe");
                    Check(Field<ComboBox>(project,"userMode").SelectedIndex==0,"portable mode not inferred");
                    Field<TextBox>(project,"codeExe").Text=code;
                    Check(Field<ComboBox>(project,"userMode").SelectedIndex==1,"installed mode not inferred");
                }
                using(var form=new InstallerForm()) {
                    Exception failure=null;bool cancelled=false;DateTime deadline=DateTime.UtcNow.AddSeconds(25);
                    var timer=new System.Windows.Forms.Timer {Interval=100};
                    form.Shown+=delegate {
                        var request=new Dictionary<string,object>{{"action","extensionInspect"},{"codeExe",code}};
                        typeof(InstallerForm).GetMethod("Execute",Hidden,null,new[]{typeof(object),typeof(Action<bool,string>)},null).Invoke(form,new object[]{request,null});
                        timer.Start();
                    };
                    timer.Tick+=delegate {
                        try {
                            if(DateTime.UtcNow>deadline)throw new Exception("cancellation did not finish in time");
                            if(!cancelled && File.Exists(Path.Combine(root,"child.pid"))) {
                                Check(Field<TaskProgressForm>(form,"taskProgress")!=null,"progress window missing");
                                typeof(InstallerForm).GetMethod("CancelTask",Hidden).Invoke(form,null);cancelled=true;
                            }
                            if(cancelled && !Field<bool>(form,"running")) {
                                Check(Exited(Int32.Parse(File.ReadAllText(Path.Combine(root,"node.pid")))),"worker child survived cancellation");
                                Check(Exited(Int32.Parse(File.ReadAllText(Path.Combine(root,"child.pid")))),"worker grandchild survived cancellation");
                                Check(Field<string>(form,"requestFile")==null,"request files survived completion");
                                Check(Field<Label>(form,"status").Text.Contains("已停止"),"cancel status was not shown");
                                timer.Stop();form.Close();
                            }
                        } catch(Exception error) {
                            failure=error;timer.Stop();
                            var job=Field<TaskJob>(form,"activeJob");if(job!=null)job.Dispose();
                            var progress=Field<TaskProgressForm>(form,"taskProgress");if(progress!=null)progress.Complete();
                            typeof(InstallerForm).GetField("running",Hidden).SetValue(form,false);form.Close();
                        }
                    };
                    Application.Run(form);timer.Dispose();
                    if(failure!=null)throw failure;
                }
                File.WriteAllText(Path.Combine(root,"result.txt"),checks+" native GUI and cancellation checks passed");
                return 0;
            }catch(Exception error){File.WriteAllText(Path.Combine(root,"result.txt"),error.ToString());return 1;}
        }
    }
}
